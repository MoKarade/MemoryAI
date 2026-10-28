// tests/liaRetenir.test.ts — LIA retient SEULE ce que Marc lui dit (ADR 0033, voie A), sur une VRAIE
// Postgres (PGlite) : les deux signaux ou le fait reste proposé, la trace, le prédicat neuf accepté par la
// phrase de Marc, et chaque garde avec son cas valide ET son cas rejeté. Données FICTIVES.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { chiffrer, dechiffrer, deriverCle } from "../lib/chiffrement";
import { OUTIL_RETENIR, tourDeChat, type ClientBoucle, type ClientModele, type ReponseModele } from "../lib/chat/agent";
import { construirePrompt, REGLE_RETENIR, REGLES_SYSTEME } from "../lib/chat/prompt";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { poserLiensLia } from "../lib/depotLiens";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { empreinteOubli } from "../lib/ecrireFaits";
import type { ContexteOutils } from "../lib/mcp/outils";
import { depotRetenirDrizzle, fabriquerRetenir, paroleDeMarc, type RetenirLia } from "../lib/lia/retenir";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-10-28T20:00:00Z");
const JOUR = "2026-10-28";
const PREDICAT = "loisir.sport_prefere";

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.validationsLia);
  await db.delete(schema.provenances);
  await db.delete(schema.faits);
  await db.delete(schema.predicatsProposes);
  await db.delete(schema.depensesChat);
  await db.delete(schema.oublis);
});

/** Un faux modèle de relecture : il rend le verdict demandé, ou tombe en panne (`null`), et note ce qu'on lui a montré. */
function fabrique(
  parole: string,
  verdict: "confirme" | "doute" | "infirme" | null = "confirme",
  depot = depotRetenirDrizzle(db),
  poserLiens = (faitId: string, cibles: readonly string[], maintenant: Date) => poserLiensLia(db, faitId, cibles, maintenant),
) {
  const vus: string[] = [];
  const client: ClientModele = {
    async create(p) {
      vus.push(String((p.messages[0] as { content: unknown }).content));
      if (verdict === null) throw new Error("panne fictive");
      const r: ReponseModele = {
        content: [{ type: "text", text: JSON.stringify({ verdicts: [{ n: 1, verdict, raison: "Marc parle de lui à la première personne." }] }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 300, output_tokens: 60 },
      };
      return r;
    },
  };
  const retenir = fabriquerRetenir({ parole, cle, faits: depotDrizzle(db), depot, admin: depotAdminDrizzle(db), client, poserLiens });
  return { retenir, vus };
}

const SPORT = { predicat: PREDICAT, valeur: "badminton", valeur_type: "texte" };
const PAROLE = "Mon sport préféré, c'est le badminton.";
const faitsDuPredicat = () => db.select().from(schema.faits).where(eq(schema.faits.predicat, PREDICAT));

async function ajouterFaitLiable(
  id: string,
  niveau = 2,
  statut: "valide" | "propose" = "valide",
  supprimeLe: Date | null = null,
) {
  await db.insert(schema.faits).values({
    id,
    sujet: "marc",
    predicat: `fictif.${id}`,
    valeur: niveau === 3 ? "2026-01-01" : "valeur fictive",
    valeurType: niveau === 3 ? "date" : "texte",
    niveau,
    statut,
    fiabiliteSource: "marc",
    canari: false,
    versionVocabulaire: 1,
    empreinte: `empreinte-${id}`,
    supprimeLe,
  });
}

describe("ce que LIA valide seule, quand Marc le dit", () => {
  it("⚠ la valeur est dans ses mots ET la relecture confirme : validé, prédicat neuf accepté, tout tracé", async () => {
    const { retenir, vus } = fabrique(PAROLE);
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(true);
    expect(r.phrase).toContain("Retenu et validé");
    expect(r.phrase).toContain(PREDICAT);

    const [fait] = await faitsDuPredicat();
    expect(fait).toMatchObject({ statut: "valide", niveau: 2, fiabiliteSource: "marc", canari: false });
    // Niveau 2 (le plancher d'un prédicat neuf) : scellé, jamais en clair.
    expect(fait!.valeur).not.toContain("badminton");
    expect(dechiffrer(cle, fait!.valeur!, fait!.id, fait!.niveau)).toBe("badminton");
    const [prov] = await db.select().from(schema.provenances).where(eq(schema.provenances.faitId, fait!.id));
    expect(prov).toMatchObject({ sourceType: "marc", extracteur: "lia-retenir-v1", sourceRef: `lia-marc:${JOUR}` });

    // Le prédicat neuf sort de quarantaine par la phrase de Marc (A3), pas par le volume.
    const [pred] = await db.select().from(schema.predicatsProposes).where(eq(schema.predicatsProposes.predicat, PREDICAT));
    expect(pred).toMatchObject({ statut: "accepte", sortiePar: "marc" });

    // La trace : deux signaux, raison chiffrée, hors de la pile de doutes.
    const [t] = await db.select().from(schema.validationsLia);
    expect(t).toMatchObject({ faitId: fait!.id, decision: "valide", verdict: "confirme", signalCode: true, enPile: false, jour: JOUR });
    expect(t!.extracteur).toBe("lia-retenir-v1|claude-haiku-5-5");
    expect(t!.raison).not.toContain("première personne");

    // Le modèle a lu SA phrase balisée, comptée au poste chat.
    expect(vus).toHaveLength(1);
    expect(vus[0]).toContain("<parole>");
    expect(vus[0]).toContain("badminton");
    expect(await depotAdminDrizzle(db).depenseDuJourUsd(JOUR, "chat")).toBeGreaterThan(0);
    expect(await depotRetenirDrizzle(db).dejaValidesAujourdhui(JOUR)).toBe(1);
  });

  it("⚠ la valeur n'est PAS dans les mots de Marc : rien n'est écrit, le modèle n'est pas payé", async () => {
    const { retenir, vus } = fabrique("Bonjour LIA, tu vas bien ?");
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(false);
    expect(r.phrase).toContain("pas retrouvé cette valeur");
    expect(await faitsDuPredicat()).toHaveLength(0);
    expect(vus).toHaveLength(0);
  });

  it("⚠ un modèle qui doute, ou infirme, laisse le fait proposé — et le prédicat en quarantaine", async () => {
    for (const [verdict, morceau] of [["doute", "j'ai un doute"], ["infirme", "ne dit pas vraiment cela"]] as const) {
      await db.delete(schema.validationsLia);
      await db.delete(schema.provenances);
      await db.delete(schema.faits);
      await db.delete(schema.predicatsProposes);
      const r = await fabrique(PAROLE, verdict).retenir.retenir(SPORT, T0);
      expect(r.ok, verdict).toBe(true);
      expect(r.phrase, verdict).toContain(morceau);
      expect((await faitsDuPredicat())[0]?.statut, verdict).toBe("propose");
      expect((await db.select().from(schema.validationsLia))[0], verdict).toMatchObject({ decision: "doute", verdict });
      expect((await db.select().from(schema.predicatsProposes))[0]?.statut, verdict).toBe("en_quarantaine");
    }
  });

  it("⚠ le modèle en panne : échec FERMÉ — le fait est gardé, jamais validé", async () => {
    const r = await fabrique(PAROLE, null).retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(true);
    expect(r.phrase).toContain("je n'ai pas pu le relire");
    expect((await faitsDuPredicat())[0]?.statut).toBe("propose");
    expect((await db.select().from(schema.validationsLia))[0]).toMatchObject({ decision: "doute", verdict: null });
  });
});

describe("les liens posés par LIA", () => {
  it("lie une cible servie et éligible, normalise la paire et ne double pas le lien", async () => {
    const cible = "a-fait-fictif";
    await ajouterFaitLiable(cible, 2, "propose");
    const { retenir } = fabrique(PAROLE);
    const r = await retenir.retenir({ ...SPORT, lie_a: [cible, cible] }, T0, new Set([cible]));
    const faits = await faitsDuPredicat();
    const nouveau = faits[0]!;
    const liens = await db.select().from(schema.liens);

    expect(r.phrase).toContain("Je l'ai rapproché de 1 fait que je connaissais.");
    expect(liens).toHaveLength(1);
    expect(liens[0]).toMatchObject({
      faitA: [nouveau.id, cible].sort()[0],
      faitB: [nouveau.id, cible].sort()[1],
      cibleB: "fait",
      type: "lie-par-lia",
      poids: 0.5,
      origine: "modele",
      regle: "lia-lie-v1",
      pourquoi: "Rapproché par LIA quand Marc l'a dit : même sujet (lien deviné).",
    });
    expect(await poserLiensLia(db, nouveau.id, [cible], T0)).toBe(0);
    expect(await db.select().from(schema.liens)).toHaveLength(1);
  });

  it("ignore un identifiant inconnu", async () => {
    const r = await fabrique(PAROLE).retenir.retenir({ ...SPORT, lie_a: ["inconnu"] }, T0, new Set(["inconnu"]));
    expect(r.phrase).not.toContain("rapproché");
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });

  it("ignore un identifiant qui n'a pas été servi pendant le tour", async () => {
    await ajouterFaitLiable("fait-non-servi");
    const r = await fabrique(PAROLE).retenir.retenir({ ...SPORT, lie_a: ["fait-non-servi"] }, T0);
    expect(r.phrase).not.toContain("rapproché");
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });

  it("ignore un fait de niveau supérieur à celui du fait retenu", async () => {
    await ajouterFaitLiable("fait-niveau-3", 3);
    const r = await fabrique(PAROLE).retenir.retenir({ ...SPORT, lie_a: ["fait-niveau-3"] }, T0, new Set(["fait-niveau-3"]));
    expect(r.phrase).not.toContain("rapproché");
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });

  it("ignore un fait supprimé", async () => {
    await ajouterFaitLiable("fait-supprime", 2, "valide", T0);
    const r = await fabrique(PAROLE).retenir.retenir({ ...SPORT, lie_a: ["fait-supprime"] }, T0, new Set(["fait-supprime"]));
    expect(r.phrase).not.toContain("rapproché");
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });

  it("ne pose que cinq liens pour six identifiants", async () => {
    const cibles = Array.from({ length: 6 }, (_, i) => `fait-fictif-${i}`);
    for (const cible of cibles) await ajouterFaitLiable(cible);
    const r = await fabrique(PAROLE).retenir.retenir({ ...SPORT, lie_a: cibles }, T0, new Set(cibles));
    expect(r.phrase).toContain("Je l'ai rapproché de 5 faits que je connaissais.");
    expect(await db.select().from(schema.liens)).toHaveLength(5);
  });

  it("ne fait pas échouer la rétention si la pose des liens échoue", async () => {
    await ajouterFaitLiable("fait-liable");
    const erreurJournal = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { retenir } = fabrique(PAROLE, "confirme", depotRetenirDrizzle(db), async () => {
        throw new Error("valeur fictive à ne pas journaliser");
      });
      const r = await retenir.retenir({ ...SPORT, lie_a: ["fait-liable"] }, T0, new Set(["fait-liable"]));
      expect(r.ok).toBe(true);
      expect(await faitsDuPredicat()).toHaveLength(1);
      expect(erreurJournal).toHaveBeenCalledWith("[lia_retenir] liens impossibles", "Error");
    } finally {
      erreurJournal.mockRestore();
    }
  });

  it("sans `lie_a`, ne change rien au graphe", async () => {
    const r = await fabrique(PAROLE).retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(true);
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });
});

describe("ce que LIA ne valide jamais seule", () => {
  it("un montant, ou un prédicat mal formé, est refusé avant toute écriture", async () => {
    const { retenir, vus } = fabrique("Mon salaire est de 5000 dollars.");
    const montant = await retenir.retenir({ predicat: "emploi.salaire", valeur: "5000", valeur_type: "montant" }, T0);
    expect(montant.ok).toBe(false);
    expect(montant.phrase).toContain("montant");
    const mal = await retenir.retenir({ predicat: "N'importe quoi", valeur: "badminton", valeur_type: "texte" }, T0);
    expect(mal.ok).toBe(false);
    expect(await db.select().from(schema.faits)).toHaveLength(0);
    expect(vus).toHaveLength(0);
  });

  it("⚠ un fait que Marc a demandé d'oublier ne revient pas", async () => {
    await db.insert(schema.oublis).values({ empreinte: empreinteOubli(cle, `lia-marc:${JOUR}`, PREDICAT, "marc"), raison: null });
    const { retenir, vus } = fabrique(PAROLE);
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(false);
    expect(r.phrase).toContain("oublier");
    expect(await faitsDuPredicat()).toHaveLength(0);
    expect(vus).toHaveLength(0);
  });

  it("⚠ un prédicat que Marc a REFUSÉ n'est ni retenu ni rouvert", async () => {
    const depot = { ...depotRetenirDrizzle(db), statutPredicat: async () => "refuse" };
    const { retenir, vus } = fabrique(PAROLE, "confirme", depot);
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(false);
    expect(r.phrase).toContain("refusé");
    expect(await faitsDuPredicat()).toHaveLength(0);
    expect(vus).toHaveLength(0);
  });

  it("⚠ un fait qui en CONTREDIT un déjà validé n'écrase rien : il reste proposé, sans payer le modèle", async () => {
    await db.insert(schema.faits).values({
      id: "f-tennis",
      sujet: "marc",
      predicat: PREDICAT,
      valeur: chiffrer(cle, "tennis", "f-tennis", 2),
      valeurType: "texte",
      niveau: 2,
      statut: "valide",
      fiabiliteSource: "marc",
      canari: false,
      versionVocabulaire: 1,
      empreinte: "empreinte-f-tennis",
    });
    const { retenir, vus } = fabrique(PAROLE);
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(true);
    expect(r.phrase).toContain("contredit");
    const faits = await faitsDuPredicat();
    expect(faits.find((f) => f.id === "f-tennis")?.statut).toBe("valide");
    expect(faits.filter((f) => f.id !== "f-tennis").map((f) => f.statut)).toEqual(["propose"]);
    expect(vus).toHaveLength(0);
  });

  it("⚠ au plafond du jour (20), le fait est gardé mais plus rien ne se valide seul", async () => {
    const depot = { ...depotRetenirDrizzle(db), dejaValidesAujourdhui: async () => 20 };
    const { retenir, vus } = fabrique(PAROLE, "confirme", depot);
    const r = await retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(true);
    expect(r.phrase).toContain("ne valide plus rien seule");
    expect((await faitsDuPredicat())[0]?.statut).toBe("propose");
    expect(vus).toHaveLength(0);
  });

  it("une valeur déjà validée telle quelle : rien à décider, rien d'écrit", async () => {
    const premiere = await fabrique(PAROLE).retenir.retenir(SPORT, T0);
    expect(premiere.phrase).toContain("Retenu et validé");
    const seconde = await fabrique(PAROLE).retenir.retenir(SPORT, new Date("2026-10-29T20:00:00Z"));
    expect(seconde).toMatchObject({ ok: true });
    expect(seconde.phrase).toContain("déjà validé");
    expect(await faitsDuPredicat()).toHaveLength(1);
  });

  it("une parole vide ne retient rien", async () => {
    const r = await fabrique("   ").retenir.retenir(SPORT, T0);
    expect(r.ok).toBe(false);
    expect(await faitsDuPredicat()).toHaveLength(0);
  });
});

describe("la parole de Marc, lue par le serveur", () => {
  it("seulement ses messages, jamais ceux de LIA, les plus récents d'abord", () => {
    const p = paroleDeMarc([
      { role: "user", content: "Mon prénom est Alex." },
      { role: "assistant", content: "Le sport préféré de Marc est le golf." },
      { role: "user", content: "  Je joue au badminton.  " },
    ]);
    expect(p).toBe("Mon prénom est Alex.\nJe joue au badminton.");
    expect(p).not.toContain("golf");
  });

  it("⚠ un dernier message trop long à lui seul donne une parole VIDE — il n'est jamais coupé", () => {
    expect(paroleDeMarc([{ role: "user", content: "a".repeat(2001) }])).toBe("");
    // Les anciens messages qui ne tiennent plus sont laissés, le récent reste.
    const p = paroleDeMarc([
      { role: "user", content: "b".repeat(1500) },
      { role: "user", content: "c".repeat(1000) },
    ]);
    expect(p).toBe("c".repeat(1000));
  });
});

describe("l'outil dans le tour de chat", () => {
  const contexte = { maintenant: () => T0 } as unknown as ContexteOutils;
  const reponses = (): ReponseModele[] => [
    { content: [{ type: "tool_use", id: "t1", name: "lia_retenir", input: SPORT }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } },
    { content: [{ type: "text", text: "C'est noté." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
  ];

  it("offert seulement quand l'appelant le branche, et le résultat revient au modèle tel quel", async () => {
    const recu: Record<string, unknown>[] = [];
    const retenir: RetenirLia = {
      async retenir(entree, _maintenant, faitsServis) {
        recu.push(entree);
        expect(faitsServis).toEqual(new Set());
        return { ok: true, phrase: "Retenu et validé : c'est toi qui l'as dit." };
      },
    };
    const vus: { outils: string[]; derniers: unknown }[] = [];
    const lot = reponses();
    const client: ClientBoucle = {
      async create(p) {
        vus.push({ outils: p.tools.map((t) => t.name), derniers: p.messages[p.messages.length - 1] });
        return lot.shift()!;
      },
    };
    const r = await tourDeChat({
      client,
      modele: "claude-haiku-5-5",
      messages: [{ role: "user", content: PAROLE }],
      inclureN2: false,
      inclureN3: false,
      outils: contexte,
      admin: depotAdminDrizzle(db),
      outilsPermis: new Set(),
      retenir,
    });
    expect(vus[0]!.outils).toEqual(["lia_retenir"]);
    expect(OUTIL_RETENIR.input_schema.properties).toHaveProperty("lie_a");
    expect(recu).toEqual([SPORT]);
    expect(r.outilsAppeles).toEqual(["lia_retenir"]);
    expect(JSON.stringify(vus[1]!.derniers)).toContain("Retenu et validé");

    // Sans `retenir`, l'outil n'existe pas — et un appel qui le nommerait reçoit « inconnu ».
    const lot2 = reponses();
    const vus2: string[][] = [];
    const sans: ClientBoucle = {
      async create(p) {
        vus2.push(p.tools.map((t) => t.name));
        return lot2.shift()!;
      },
    };
    const r2 = await tourDeChat({ client: sans, modele: "claude-haiku-5-5", messages: [{ role: "user", content: PAROLE }], inclureN2: false, inclureN3: false, outils: contexte, admin: depotAdminDrizzle(db), outilsPermis: new Set() });
    expect(vus2[0]).toEqual([]);
    expect(r2.outilsAppeles).toEqual([]);
  });

  it("transmet à `lia_retenir` les faits de `memoryai_chercher` servis plus tôt dans le tour", async () => {
    const id = "fait-servi-ce-tour";
    await ajouterFaitLiable(id, 0);
    await db.update(schema.faits).set({ valeur: "badminton" }).where(eq(schema.faits.id, id));
    const recus: ReadonlySet<string>[] = [];
    const retenir: RetenirLia = {
      async retenir(_entree, _maintenant, faitsServis) {
        recus.push(faitsServis ?? new Set());
        return { ok: true, phrase: "Retenu." };
      },
    };
    const lot: ReponseModele[] = [
      { content: [{ type: "tool_use", id: "cherche", name: "memoryai_chercher", input: { question: "badminton" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: "tool_use", id: "retient", name: "lia_retenir", input: SPORT }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: "text", text: "C'est noté." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
    ];
    const client: ClientBoucle = { async create() { return lot.shift()!; } };
    const contexteComplet = {
      lecture: depotLectureDrizzle(db),
      ecriture: depotDrizzle(db),
      pieces: depotPiecesLectureDrizzle(db),
      questions: depotQuestionsDrizzle(db),
      conversations: depotConversationsDrizzle(db),
      cle,
      env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef" },
      lecteur: "chat",
      maintenant: () => T0,
    } satisfies ContexteOutils;
    await tourDeChat({
      client,
      modele: "claude-haiku-5-5",
      messages: [{ role: "user", content: PAROLE }],
      inclureN2: false,
      inclureN3: false,
      outils: contexteComplet,
      admin: depotAdminDrizzle(db),
      retenir,
    });
    expect(recus).toHaveLength(1);
    expect(recus[0]).toEqual(new Set([id]));
  });

  it("la règle du prompt suit les règles, seulement quand l'outil est offert", () => {
    expect(construirePrompt(undefined, { retenir: false })).toBe(REGLES_SYSTEME);
    const p = construirePrompt({ voix: "<voix>\nV\n</voix>", profil: null }, { retenir: true });
    expect(p.startsWith(`${REGLES_SYSTEME}\n\n${REGLE_RETENIR}\n\n<voix>`)).toBe(true);
    expect(REGLE_RETENIR).toContain("lia_retenir");
  });
});
