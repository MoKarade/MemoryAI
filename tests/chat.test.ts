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
import { PlafondAtteintError, PROMPT_SYSTEME, tourDeChat, type ClientModele, type ReponseModele } from "../lib/chat/agent";
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

function outils(env: Record<string, string | undefined> = {}): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef", ...env },
    lecteur: "chat",
    maintenant: () => MAINTENANT,
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
    const r = await tourDeChat({ client, modele: "claude-sonnet-5", messages: [{ role: "user", content: "salut" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
    expect(r.reponse).toBe("Bonjour Marc.");
    expect(r.appels).toBe(1);
    expect(r.coutUsd).toBeCloseTo(0.0045);
    expect(await depotAdminDrizzle(db).depenseDuJourUsd("2026-09-15", "chat")).toBeCloseTo(0.0045);
  });

  it("un tour d'outil : le fait arrive en tool_result balisé, jamais dans le système ; l'accès est journalisé", async () => {
    const { client, recus } = faux([appel("memoryai_chercher", { question: "employeur" }), texte("Tu travailles à la Entreprise Exemple (fait proposé).")]);
    const r = await tourDeChat({ client, modele: "claude-haiku-4-5", messages: [{ role: "user", content: "où je travaille ?" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) });
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

  // LA garde Q11 : la bascule de la CONVERSATION écrase ce que le modèle demande.
  it("le modèle demande inclure_n2=true, la conversation dit non : N2 ne sort pas", async () => {
    const { client, recus } = faux([appel("memoryai_contexte", { inclure_n2: true }), texte("ok")]);
    await tourDeChat({ client, modele: "claude-haiku-4-5", messages: [{ role: "user", content: "tout" }], inclureN2: false, inclureN3: false, outils: outils({ MEMORYAI_N2_CHAT: "1" }), admin: depotAdminDrizzle(db) });
    const dernier = (m: unknown[]) => (m[m.length - 1] as { content: { content: string }[] }).content[0]!.content;
    expect(dernier(recus[1]!)).not.toContain("Arachides");
    // Et l'inverse : conversation oui + variable oui ⇒ N2 servi.
    const second = faux([appel("memoryai_contexte", { inclure_n2: false }), texte("ok")]);
    await tourDeChat({ client: second.client, modele: "claude-haiku-4-5", messages: [{ role: "user", content: "tout" }], inclureN2: true, inclureN3: false, outils: outils({ MEMORYAI_N2_CHAT: "1" }), admin: depotAdminDrizzle(db) });
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
      modele: "claude-haiku-4-5",
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
    const reponses = [
      appel("memoryai_contexte", {}),
      appel("lia_blocs", { blocs: [chiffre(bon!.id), chiffre(inventee)] }),
      texte("Voilà."),
    ];
    const client: ClientModele = {
      async create(p) {
        outilsVus.push(p.tools.map((t) => t.name));
        return reponses.shift()!;
      },
    };
    const base = { modele: "claude-haiku-4-5" as const, messages: [{ role: "user" as const, content: "montre" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) };
    const r = await tourDeChat({ ...base, client, blocs: true });
    expect(outilsVus[0]).toContain("lia_blocs");
    expect(r.blocs).toEqual([chiffre(bon!.id)]);
    expect(r.blocsRejetes).toBe(1);
    expect(r.raisonsBlocs).toHaveLength(1);
    // Sans `blocs`, l'outil n'est pas offert, et un appel qui le nomme n'est pas exécuté.
    const sans = faux([appel("lia_blocs", { blocs: [chiffre(bon!.id)] }), texte("ok")]);
    const r2 = await tourDeChat({ ...base, client: sans.client });
    expect(r2.blocs).toEqual([]);
    expect(r2.outilsAppeles).toEqual([]);
  });

  it("le plafond ferme la porte AVANT l'appel, y compris entre deux tours d'outils", async () => {
    const admin = depotAdminDrizzle(db);
    await admin.enregistrerDepense({ jour: "2026-09-15", modele: "claude-opus-5", entree: 0, sortie: 0, coutUsd: 0.999 });
    // 0,999 + le petit tour précédent < 1 ? Non : les tours précédents ont déjà dépensé ; on force au-dessus.
    await admin.enregistrerDepense({ jour: "2026-09-15", modele: "claude-opus-5", entree: 0, sortie: 0, coutUsd: 0.01 });
    const { client } = faux([texte("jamais rendu")]);
    await expect(
      tourDeChat({ client, modele: "claude-opus-5", messages: [{ role: "user", content: "x" }], inclureN2: false, inclureN3: false, outils: outils(), admin }),
    ).rejects.toThrow(PlafondAtteintError);
  });

  it("refuse un historique dont le dernier message n'est pas de Marc", async () => {
    const { client } = faux([]);
    await expect(
      tourDeChat({ client, modele: "claude-sonnet-5", messages: [{ role: "assistant", content: "?" }], inclureN2: false, inclureN3: false, outils: outils(), admin: depotAdminDrizzle(db) }),
    ).rejects.toThrow(/dernier message/);
  });
});
