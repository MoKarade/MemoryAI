// tests/chat.test.ts — la boucle du chat avec un FAUX modèle : le plafond, le comptage avant
// lecture, la bascule N2 de la conversation qui écrase celle du modèle, et le prompt système
// sans aucun fait.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { construirePrompt, REGLE_BLOCS } from "../lib/chat/prompt";
import { OUTIL_BLOCS, PlafondAtteintError, PROMPT_SYSTEME, RELANCE_REPONSE_VIDE, tourDeChat, type ClientBoucle, type ClientModele, type ReponseModele } from "../lib/chat/agent";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { ecrireLot } from "../lib/ecrireFaits";
import type { Ecrivain } from "../lib/jetons";
import type { ContexteOutils } from "../lib/mcp/outils";
import { BON } from "./fixtures/faits";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const MAINTENANT = new Date("2026-09-15T21:00:00Z");

function outils(env: Record<string, string | undefined> = {}, maintenant: Date = MAINTENANT): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef", ...env },
    lecteur: "chat",
    maintenant: () => maintenant,
  };
}

/** Un faux modèle scripté : rend les réponses dans l'ordre, enregistre ce qu'il reçoit. */
function faux(reponses: ReponseModele[]) {
  const recus: unknown[][] = [];
  const client: ClientModele = {
    async create(p) {
      recus.push(p.messages);
      const r = reponses.shift();
      if (!r) throw new Error("le faux modèle n'a plus de réponse");
      return r;
    },
  };
  return { client, recus };
}
const texte = (t: string, usage = { input_tokens: 1000, output_tokens: 100 }): ReponseModele => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
const appel = (name: string, input: Record<string, unknown>): ReponseModele => ({
  content: [{ type: "tool_use", id: "t1", name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 1000, output_tokens: 50 },
});

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
  const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };
  await ecrireLot(
    [BON, { ...BON, predicat: "sante.allergie", valeur: "Arachides", provenance: { ...BON.provenance, source_ref: "s" } }],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
});
afterAll(async () => pg?.close());

describe("tourDeChat", () => {
  it("le prompt système ne contient AUCUN fait, et dit que les résultats d'outils sont des données", () => {
    expect(PROMPT_SYSTEME).not.toContain("<fait id=");
    expect(PROMPT_SYSTEME).not.toContain("Entreprise Exemple");
    expect(PROMPT_SYSTEME).toContain("DONNÉES");
    expect(PROMPT_SYSTEME).toContain("memoryai_");
  });

  it("un tour simple : réponse, coût compté et ENREGISTRÉ", async () => {
    const { client } = faux([texte("Bonjour Marc.")]);
    const r = await tourDeChat({ client, modele: "claude-sonnet-5-5", messages: [{ role: "user", content: "salut" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
    expect(r.reponse).toBe("Bonjour Marc.");
    expect(r.appels).toBe(1);
    expect(r.coutUsd).toBeCloseTo(0.0045);
    expect(await depotAdminDrizzle(db).depenseDuJourUsd("2026-09-15", "chat")).toBeCloseTo(0.0045);
  });

  it("un tour d'outil : le fait arrive en tool_result balisé, jamais dans le système ; l'accès est journalisé", async () => {
    const { client, recus } = faux([appel("memoryai_chercher", { question: "employeur" }), texte("Tu travailles à la Entreprise Exemple (fait proposé).")]);
    const r = await tourDeChat({ client, modele: "claude-haiku-5-5", messages: [{ role: "user", content: "où je travaille ?" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
    expect(r.outilsAppeles).toEqual(["memoryai_chercher"]);
    expect(r.appels).toBe(2);
    const second = recus[1] as { role: string; content: unknown }[];
    const retour = second[second.length - 1]!.content as { type: string; content: string }[];
    expect(retour[0]!.type).toBe("tool_result");
    expect(retour[0]!.content).toContain("<fait ");
    expect(retour[0]!.content).toContain("Entreprise Exemple");
    const journal = await db.select().from(schema.accesJournal);
    expect(journal.some((j) => j.lecteur === "chat" && j.outil === "memoryai_chercher")).toBe(true);
  });

  // Journal du 25/10 20:20Z : après deux outils, le modèle a fini SANS TEXTE et LIA s'est tue (tâche MemoryAI 235).
  it("une fin de tour vide se relance UNE fois, par un nouveau message ; vide encore, rien n'est inventé", async () => {
    const vide: ReponseModele = { content: [], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 3 } };
    const { client, recus } = faux([appel("memoryai_contexte", {}), vide, texte("Voilà ce que je sais.")]);
    const r = await tourDeChat({ client, modele: "claude-sonnet-5-5", messages: [{ role: "user", content: "quoi de neuf ?" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
    expect(r.reponse).toBe("Voilà ce que je sais.");
    expect(r.appels).toBe(3);
    const troisieme = recus[2] as { role: string; content: unknown }[];
    expect(troisieme[troisieme.length - 1]).toEqual({ role: "user", content: RELANCE_REPONSE_VIDE });
    // La réponse vide n'est jamais renvoyée telle quelle : l'avant-dernier message reste les retours d'outil.
    expect((troisieme[troisieme.length - 2]!.content as { type: string }[])[0]!.type).toBe("tool_result");

    const deuxFois = faux([vide, vide]);
    const r2 = await tourDeChat({ client: deuxFois.client, modele: "claude-sonnet-5-5", messages: [{ role: "user", content: "salut" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
    expect(r2.reponse).toBe("");
    expect(r2.appels).toBe(2);
  });

  // LA garde Q11 : la bascule de la CONVERSATION écrase ce que le modèle demande.
  it("le modèle demande inclure_n2=true, la conversation dit non : N2 ne sort pas", async () => {
    const { client, recus } = faux([appel("memoryai_contexte", { inclure_n2: true }), texte("ok")]);
    await tourDeChat({ client, modele: "claude-haiku-5-5", messages: [{ role: "user", content: "tout" }], inclureN2: false, inclureN3: false, outils: outils({ MEMORYAI_N2_CHAT: "1" }), admin: depotAdminDrizzle(db) });
    const dernier = (m: unknown[]) => (m[m.length - 1] as { content: { content: string }[] }).content[0]!.content;
    expect(dernier(recus[1]!)).not.toContain("Arachides");
    // Et l'inverse : conversation oui + variable oui ⇒ N2 servi.
    const second = faux([appel("memoryai_contexte", { inclure_n2: false }), texte("ok")]);
    await tourDeChat({ client: second.client, modele: "claude-haiku-5-5", messages: [{ role: "user", content: "tout" }], inclureN2: true, inclureN3: false, outils: outils({ MEMORYAI_N2_CHAT: "1" }), admin: depotAdminDrizzle(db) });
    expect(dernier(second.recus[1]!)).toContain("Arachides");
  });

  // ADR 0016 : la liste blanche tient aux DEUX bouts — décrire et exécuter.
  it("outilsPermis : seuls ces outils sont décrits, et un autre nommé quand même n'est pas exécuté", async () => {
    const outilsVus: string[][] = [];
    const reponses = [appel("memoryai_proposer", { predicat: "x", valeur: "y" }), texte("ok")];
    const client: ClientModele = {
      async create(p) {
        outilsVus.push(p.tools.map((t) => t.name));
        return reponses.shift()!;
      },
    };
    const r = await tourDeChat({
      client,
      modele: "claude-haiku-5-5",
      messages: [{ role: "user", content: "retiens ça" }],
      inclureN2: false,
      inclureN3: false,
      outils: outils(),
      admin: depotAdminDrizzle(db),
      outilsPermis: new Set(["memoryai_chercher"]),
    });
    expect(outilsVus[0]).toEqual(["memoryai_chercher"]);
    expect(r.outilsAppeles).toEqual([]);
  });

  // Lot 5 : LIA montre en blocs, et un bloc ne cite que ce qui a été servi DANS CE tour.
  it("lia_blocs : offert seulement sur demande, accepte une source servie, rejette une source inventée", async () => {
    const [bon] = await db.select({ id: schema.faits.id }).from(schema.faits).where(eq(schema.faits.predicat, BON.predicat));
    const inventee = "2f2e2d2c-2b2a-4928-8726-252423222120";
    const chiffre = (source: string) => ({ type: "chiffre", libelle: "Employeur connu", valeur: 1, sources: [source] });
    const outilsVus: string[][] = [];
    const systemes: string[] = [];
    const reponses = [
      appel("memoryai_contexte", {}),
      appel("lia_blocs", { blocs: [chiffre(bon!.id), chiffre(inventee)] }),
      texte("Voilà."),
    ];
    const client: ClientBoucle = {
      async create(p) {
        outilsVus.push(p.tools.map((t) => t.name));
        // Le système arrive en blocs (point de cache) : on lit le texte de chacun.
        systemes.push(typeof p.system === "string" ? p.system : p.system.map((b) => b.text).join("\n"));
        return reponses.shift()!;
      },
    };
    const base = { modele: "claude-haiku-5-5" as const, messages: [{ role: "user" as const, content: "montre" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) };
    const r = await tourDeChat({ ...base, client, blocs: true });
    expect(outilsVus[0]).toContain("lia_blocs");
    expect(systemes[0]).toContain(REGLE_BLOCS);
    expect(r.blocs).toEqual([chiffre(bon!.id)]);
    expect(r.blocsRejetes).toBe(1);
    expect(r.raisonsBlocs).toHaveLength(1);
    // Sans `blocs`, l'outil n'est pas offert, et un appel qui le nomme n'est pas exécuté.
    const sans = faux([appel("lia_blocs", { blocs: [chiffre(bon!.id)] }), texte("ok")]);
    const r2 = await tourDeChat({ ...base, client: sans.client });
    expect(r2.blocs).toEqual([]);
    expect(construirePrompt()).not.toContain(REGLE_BLOCS);
    expect(r2.outilsAppeles).toEqual([]);
    // Le bilan du hub compte comme servi seulement si l'appelant le dit (question avec bilan),
    // et la description de l'outil le NOMME en clair (pas un gabarit resté littéral).
    expect(OUTIL_BLOCS.description).toContain("`hub/bilan`");
    expect(OUTIL_BLOCS.description).not.toContain("${");
    const bilan = { type: "chiffre", libelle: "Apps en ligne", valeur: 6, sources: ["hub/bilan"] };
    const hub = faux([appel("lia_blocs", { blocs: [bilan] }), texte("ok")]);
    const r3 = await tourDeChat({ ...base, client: hub.client, blocs: true, sourcesServies: new Set(["hub/bilan"]) });
    expect(r3.blocs).toEqual([bilan]);
    const nu = faux([appel("lia_blocs", { blocs: [bilan] }), texte("ok")]);
    const r4 = await tourDeChat({ ...base, client: nu.client, blocs: true });
    expect(r4.blocs).toEqual([]);
    expect(r4.raisonsBlocs[0]).toContain("non servie");
  });

  it("le plafond ferme la porte AVANT l'appel, y compris entre deux tours d'outils", async () => {
    const admin = depotAdminDrizzle(db);
    await admin.enregistrerDepense({ jour: "2026-09-15", modele: "claude-opus-5-5", entree: 0, sortie: 0, coutUsd: 0.999 });
    // 0,999 + le petit tour précédent < 1 ? Non : les tours précédents ont déjà dépensé ; on force au-dessus.
    await admin.enregistrerDepense({ jour: "2026-09-15", modele: "claude-opus-5-5", entree: 0, sortie: 0, coutUsd: 0.01 });
    const { client } = faux([texte("jamais rendu")]);
    await expect(
      tourDeChat({ client, modele: "claude-opus-5-5", messages: [{ role: "user", content: "x" }], inclureN2: false, inclureN3: false, outils: outils(), admin }),
    ).rejects.toThrow(PlafondAtteintError);
  });

  it("refuse un historique dont le dernier message n'est pas de Marc", async () => {
    const { client } = faux([]);
    await expect(
      tourDeChat({ client, modele: "claude-sonnet-5-5", messages: [{ role: "assistant", content: "?" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) }),
    ).rejects.toThrow(/dernier message/);
  });
});

describe("tourDeChat : cache de prompt (tâche MemoryAI 365)", () => {
  /** Un autre jour que les tests du plafond, qui ont rempli celui du 15/09. */
  const JOUR_CACHE = new Date("2026-09-16T21:00:00Z");
  /** Comme `faux`, mais PHOTOGRAPHIE chaque requête : la boucle retire et déplace des marqueurs après coup. */
  function fauxPhoto(reponses: ReponseModele[]) {
    const requetes: { system: unknown; tools: unknown; messages: { role: string; content: unknown }[]; max_tokens: number; thinking?: unknown; output_config?: unknown; temperature?: unknown }[] = [];
    const client: ClientBoucle = {
      async create(p) {
        requetes.push(JSON.parse(JSON.stringify({ system: p.system, tools: p.tools, messages: p.messages, max_tokens: p.max_tokens, thinking: p.thinking, output_config: p.output_config, temperature: (p as { temperature?: unknown }).temperature })));
        const r = reponses.shift();
        if (!r) throw new Error("le faux modèle n'a plus de réponse");
        return r;
      },
    };
    return { client, requetes };
  }
  const tour = (client: ClientBoucle, modele: "claude-sonnet-5-5" | "claude-haiku-5-5" = "claude-sonnet-5-5") =>
    tourDeChat({ client, modele, messages: [{ role: "user", content: "où je travaille ?" }], inclureN2: false, inclureN3: false, outils: outils({}, JOUR_CACHE), admin: depotAdminDrizzle(db) });
  const marqueurs = (messages: { content: unknown }[]) =>
    messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content.flatMap((b: { cache_control?: unknown }, j) => (b.cache_control ? [`${i}.${j}`] : [])) : []));

  it("le dernier bloc système porte le point de cache : il couvre les outils ET les règles", async () => {
    const { client, requetes } = fauxPhoto([texte("Bonjour Marc.")]);
    await tour(client);
    const systeme = requetes[0]!.system as { type: string; text: string; cache_control?: { type: string } }[];
    expect(systeme).toHaveLength(1);
    expect(systeme[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(systeme[0]!.text).toBe(PROMPT_SYSTEME);
    expect((requetes[0]!.tools as unknown[]).length).toBeGreaterThan(0);
  });

  it("une réponse sans outil n'écrit pas la question en cache : aucun marqueur dans les messages", async () => {
    const { client, requetes } = fauxPhoto([texte("Bonjour Marc.")]);
    await tour(client);
    expect(marqueurs(requetes[0]!.messages)).toEqual([]);
  });

  it("le point de cache des messages SUIT le dernier tool_result : jamais plus d'un, plus quatre au total", async () => {
    const { client, requetes } = fauxPhoto([
      appel("memoryai_chercher", { question: "employeur" }),
      appel("memoryai_chercher", { question: "poste" }),
      texte("Tu travailles à la Entreprise Exemple."),
    ]);
    const r = await tour(client);
    expect(r.appels).toBe(3);
    expect(marqueurs(requetes[0]!.messages)).toEqual([]);
    expect(marqueurs(requetes[1]!.messages)).toEqual(["2.0"]);
    // L'ancien marqueur est retiré quand le nouveau est posé : l'API en refuse plus de 4 par requête.
    expect(marqueurs(requetes[2]!.messages)).toEqual(["4.0"]);
  });

  it("outils et système sont identiques octet pour octet d'un appel à l'autre du même tour", async () => {
    const { client, requetes } = fauxPhoto([appel("memoryai_chercher", { question: "employeur" }), texte("ok")]);
    await tour(client);
    expect(JSON.stringify(requetes[1]!.tools)).toBe(JSON.stringify(requetes[0]!.tools));
    expect(JSON.stringify(requetes[1]!.system)).toBe(JSON.stringify(requetes[0]!.system));
  });

  it("famille 5.5 : effort réglé, plafond large (la pensée y compte), jamais `temperature`", async () => {
    const { client, requetes } = fauxPhoto([texte("Bonjour Marc.")]);
    await tour(client);
    expect(requetes[0]!.output_config).toEqual({ effort: "medium" });
    expect(requetes[0]!.thinking).toBeUndefined();
    expect(requetes[0]!.temperature).toBeUndefined();
    expect(requetes[0]!.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("un bloc de pensée du modèle est renvoyé tel quel avec les résultats d'outils", async () => {
    const pensee = { type: "thinking", thinking: "", signature: "sig-abc" };
    const avecPensee = {
      content: [pensee, { type: "tool_use", id: "toolu_1", name: "memoryai_chercher", input: { question: "employeur" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    } as unknown as ReponseModele;
    const { client, requetes } = fauxPhoto([avecPensee, texte("ok")]);
    await tour(client);
    const assistant = requetes[1]!.messages.find((m) => m.role === "assistant")!;
    expect((assistant.content as unknown[])[0]).toEqual(pensee);
  });

  it("le coût compte l'écriture (×1,25) et la lecture (×0,05 chez Sonnet 5.5) du cache : le plafond voit la vraie dépense", async () => {
    const avecCache: ReponseModele = {
      content: [{ type: "text", text: "Bonjour Marc." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000 },
    };
    const { client } = fauxPhoto([avecCache]);
    const r = await tour(client);
    // Sonnet 5.5 : 2 $ entrée, 10 $ sortie par million, lecture de cache 0,10 $ (×0,05).
    expect(r.coutUsd).toBeCloseTo((100 * 2 + 10 * 10 + 2000 * 2 * 1.25 + 3000 * 2 * 0.05) / 1_000_000);
  });
});
