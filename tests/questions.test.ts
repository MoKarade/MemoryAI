// tests/questions.test.ts — la page de questions (ADR 0002 §5.1) : ce qu'on accepte de poser,
// le plafond, et le fait que RÉPONDRE passe par la porte d'écriture unique.
//
// Ce que ces cas défendent, par ordre d'importance :
//   1. une question est du texte écrit par un MODÈLE : mêmes contrôles qu'une valeur de fait ;
//   2. le plafond mord à l'ÉCRITURE, et il écarte la plus ANCIENNE — pas la nouvelle ;
//   3. une question déjà posée ne se repose JAMAIS, même écartée (l'index unique le tient) ;
//   4. `memoryai_demander` ne peut pas écrire un fait, et `memoryai_proposer` ne peut pas
//      poser une question : deux écritures, deux portes, aucune ne fait le travail de l'autre.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { ecrireLot } from "../lib/ecrireFaits";
import { OUTILS, origineDuLecteur, type ContexteOutils } from "../lib/mcp/outils";
import { aEcarter, MAX_OUVERTES, validerQuestion, type QuestionValide } from "../lib/questions";
import { BON } from "./fixtures/faits";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-15T22:00:00Z");

function ctx(lecteur = "claude-ai", maintenant = T0): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef" },
    lecteur,
    maintenant: () => maintenant,
  };
}

const demander = OUTILS.find((o) => o.name === "memoryai_demander")!;

const q = (texte: string, predicat = "logement.bail.fin", motif = "Pour te prévenir avant l'échéance.") => ({
  question: texte,
  predicat_vise: predicat,
  motif,
});

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

describe("validerQuestion — une question est du texte écrit par un modèle", () => {
  it("accepte une vraie question sur un prédicat du vocabulaire", () => {
    const v = validerQuestion(q("Quand ton bail de logement se termine-t-il ?"), "claude-ai");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.predicatVise).toBe("logement.bail.fin");
      expect(v.origine).toBe("claude-ai");
    }
  });

  it("refuse ce que `nettoyerTexte` refuse déjà pour une valeur : URL, balise, ligne, longueur", () => {
    const cas: [string, string][] = [
      ["Va voir https://exemple.com/bail ?", "question_interdite"],
      ["<script>alert(1)</script> ?", "question_interdite"],
      ["Ligne un\nligne deux ?", "question_interdite"],
      [`${"a".repeat(201)} ?`, "question_interdite"],
    ];
    for (const [texte, code] of cas) {
      const v = validerQuestion(q(texte), "claude-ai");
      expect(v.ok, texte).toBe(false);
      if (!v.ok) expect(v.code).toBe(code);
    }
  });

  it("refuse une AFFIRMATION déguisée en question — sans point d'interrogation", () => {
    const v = validerQuestion(q("Ton bail se termine en 2028, confirme."), "claude-ai");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("question_interdite");
  });

  it("refuse un prédicat hors vocabulaire, et un prédicat refusé structurellement", () => {
    const hors = validerQuestion(q("Quelle est ta couleur préférée ?", "couleur.preferee"), "claude-ai");
    expect(hors.ok).toBe(false);
    if (!hors.ok) expect(hors.code).toBe("predicat_inconnu");

    const interdit = validerQuestion(q("Où habites-tu exactement ?", "logement.position"), "claude-ai");
    expect(interdit.ok).toBe(false);
    if (!interdit.ok) expect(["predicat_interdit", "predicat_inconnu"]).toContain(interdit.code);
  });

  it("refuse un champ hors du contrat — la liste est EXACTE", () => {
    const v = validerQuestion({ ...q("Quand finit ton bail ?"), statut: "repondue" }, "claude-ai");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("champ_inconnu");
  });

  it("l'origine vient du LECTEUR, jamais du corps", () => {
    expect(origineDuLecteur("chat")).toBe("chat");
    expect(origineDuLecteur("claude-ai")).toBe("claude-ai");
    // Un lecteur inconnu compte comme la voie machine — la plus prudente des deux.
    expect(origineDuLecteur("inconnu")).toBe("claude-ai");
  });
});

describe("aEcarter — le plafond écarte la plus ANCIENNE", () => {
  const d = (n: number) => new Date(`2026-09-${String(n).padStart(2, "0")}T12:00:00Z`);

  it("ne rend rien tant que la file tient sous le plafond", () => {
    const ouvertes = [1, 2, 3].map((n) => ({ id: `q${n}`, creeLe: d(n) }));
    expect(aEcarter(ouvertes, 5)).toEqual([]);
    expect(aEcarter(ouvertes, 3)).toEqual([]);
  });

  it("écarte exactement le surplus, les plus anciennes d'abord, quel que soit l'ordre reçu", () => {
    // Mélangées : la fonction ne doit pas dépendre de l'ordre d'arrivée.
    const ouvertes = [5, 1, 4, 2, 6, 3].map((n) => ({ id: `q${n}`, creeLe: d(n) }));
    expect(aEcarter(ouvertes, 5)).toEqual(["q1"]);
    expect(aEcarter(ouvertes, 3)).toEqual(["q1", "q2", "q3"]);
  });

  it("le plafond par défaut est celui du module, pas un nombre recopié dans l'appelant", () => {
    const ouvertes = Array.from({ length: MAX_OUVERTES + 1 }, (_, i) => ({ id: `q${i}`, creeLe: d(i + 1) }));
    expect(aEcarter(ouvertes)).toEqual(["q0"]);
  });
});

describe("le dépôt — poser, écarter, clore", () => {
  const valide = (texte: string, predicat = "logement.bail.fin"): QuestionValide => {
    const v = validerQuestion(q(texte, predicat), "claude-ai");
    if (!v.ok) throw new Error(`fixture invalide : ${v.raison}`);
    return v;
  };

  it("pose une question, puis refuse de la reposer — même après l'avoir écartée", async () => {
    const depot = depotQuestionsDrizzle(db);
    const r1 = await depot.poser(valide("Quand ton bail de logement finit-il ?"), T0);
    expect(r1.etat).toBe("posee");
    const r2 = await depot.poser(valide("Quand ton bail de logement finit-il ?"), T0);
    expect(r2.etat).toBe("deja-posee");

    if (r1.etat !== "posee") throw new Error("impossible");
    await depot.ecarter(r1.id, T0);
    const r3 = await depot.poser(valide("Quand ton bail de logement finit-il ?"), T0);
    expect(r3.etat, "une question écartée ne se repose pas : sinon elle revient chaque jour").toBe("deja-posee");
  });

  it("le plafond mord à l'ÉCRITURE : la sixième pose écarte la plus ancienne, jamais elle-même", async () => {
    const pg2 = new PGlite();
    const dossier = resolve(process.cwd(), "drizzle");
    for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg2.exec(s);
      }
    }
    const db2 = drizzle(pg2, { schema });
    const depot = depotQuestionsDrizzle(db2);

    const poses: string[] = [];
    for (let i = 0; i < MAX_OUVERTES; i++) {
      const r = await depot.poser(valide(`Question numéro ${i} ?`), new Date(Date.UTC(2026, 8, i + 1)));
      if (r.etat !== "posee") throw new Error("pose refusée");
      expect(r.ecartees).toEqual([]);
      poses.push(r.id);
    }
    const derniere = await depot.poser(valide("Question de trop ?"), new Date(Date.UTC(2026, 8, 20)));
    if (derniere.etat !== "posee") throw new Error("pose refusée");
    expect(derniere.ecartees, "c'est la PLUS ANCIENNE qui part").toEqual([poses[0]]);

    const ouvertes = await depot.ouvertes(50);
    expect(ouvertes).toHaveLength(MAX_OUVERTES);
    expect(ouvertes.map((o) => o.id), "la nouvelle est là, la plus ancienne non").toContain(derniere.id);
    expect(ouvertes.map((o) => o.id)).not.toContain(poses[0]);

    const c = await depot.comptes();
    expect(c).toEqual({ ouvertes: MAX_OUVERTES, repondues: 0, ecartees: 1 });
    await pg2.close();
  });

  it("clore une question la lie au fait — et une question déjà close ne se re-clôt pas", async () => {
    const depot = depotQuestionsDrizzle(db);
    const r = await depot.poser(valide("Quel est ton fournisseur internet ?", "contrat.fournisseur"), T0);
    if (r.etat !== "posee") throw new Error("pose refusée");

    const ecrit = await ecrireLot([{ ...BON, valeur: "Opérateur Exemple", predicat: "contrat.fournisseur" }], { appId: "marc", role: "ecriture", fiabilites: ["marc"] }, cle, depotDrizzle(db));
    const faitId = ecrit.idsCrees[0];
    expect(faitId, "ecrireLot doit rendre l'identifiant du fait créé").toBeTypeOf("string");

    expect(await depot.cloreAvecFait(r.id, faitId!, T0)).toBe("ok");
    expect(await depot.cloreAvecFait(r.id, faitId!, T0), "elle n'est plus ouverte").toBe("introuvable");
    const apres = await depot.parId(r.id);
    expect(apres?.statut).toBe("repondue");
    expect(apres?.faitId).toBe(faitId);
  });
});

describe("memoryai_demander — l'outil MCP", () => {
  it("pose la question, et ne crée AUCUN fait", async () => {
    const c = ctx();
    const avant = (await c.lecture.comptes()).parStatut;
    const r = await demander.executer(q("Quel est ton animal de compagnie ?", "animal.espece"), c);
    expect(r.texte).toMatch(/posée/i);
    expect(r.usage).toBe("action");
    expect(r.faitsServis).toEqual([]);
    const apres = (await c.lecture.comptes()).parStatut;
    expect(apres, "demander n'écrit pas de fait : c'est memoryai_proposer qui écrit").toEqual(avant);
  });

  it("rend le refus NOMMÉ plutôt que de poser une question hors contrat", async () => {
    const r = await demander.executer(q("Regarde https://exemple.com ?"), ctx());
    expect(r.texte).toMatch(/refusée/i);
    expect(r.texte).toMatch(/question_interdite/);
  });

  it("le catalogue déclare l'outil, et son schéma exige les trois champs", () => {
    expect(OUTILS.map((o) => o.name)).toContain("memoryai_demander");
    expect(demander.inputSchema.required).toEqual(["question", "predicat_vise", "motif"]);
  });
});
