// tests/questionsTest.test.ts — la mesure du socle ne peut pas dériver de sa décision.
//
// Trois choses sont verrouillées ici, et la plus importante est la première :
//  1. les dix questions du fichier sont MOT POUR MOT celles de l'ADR 0004 §10. Sans ça, une
//     session qui trouve une question « mal formulée » l'adoucit, et la mesure devient un
//     miroir de ce qu'on vient de construire ;
//  2. il existe EXACTEMENT une question à capacité neuve — la n° 5. L'ADR dit qu'un socle
//     qui la rate n'a rien prouvé : si ce drapeau se dilue sur plusieurs questions, ou
//     disparaît, le verdict strict devient un verdict mou sans que rien ne le signale ;
//  3. le verdict exige les DEUX conditions, et un résultat absent vaut « non répondue ».

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { QUESTIONS_TEST, SEUIL_REPONDUES, verdictSocle, type ResultatQuestion } from "../lib/questionsTest";

const ADR = readFileSync("docs/adr/0004-tout-entre-et-tout-se-retrouve.md", "utf8");

/** Les dix lignes numérotées de la §10 de l'ADR, dans l'ordre. */
function questionsDeLAdr(): string[] {
  const section = ADR.split("**Les 10 questions, figées AVANT le code**")[1] ?? "";
  const arret = section.indexOf("⚠️");
  const bloc = arret >= 0 ? section.slice(0, arret) : section;
  return [...bloc.matchAll(/^\s*(\d{1,2})\.\s+(.+?)\s*$/gm)].map((m) => m[2]!);
}

describe("les dix questions sont celles de l'ADR", () => {
  it("l'extraction de l'ADR trouve bien dix questions", () => {
    // Anti-vacuité : sans ce cas, un motif cassé rendrait une liste vide et les
    // comparaisons ci-dessous seraient satisfaites par le néant.
    expect(questionsDeLAdr()).toHaveLength(10);
  });

  it("chaque question du fichier est mot pour mot celle de l'ADR", () => {
    const adr = questionsDeLAdr();
    for (const q of QUESTIONS_TEST) {
      expect(q.question, `question n° ${q.numero}`).toBe(adr[q.numero - 1]);
    }
  });

  it("les numéros vont de 1 à 10, sans trou ni doublon", () => {
    expect(QUESTIONS_TEST.map((q) => q.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("chaque question dit ce que son échec désignerait", () => {
    for (const q of QUESTIONS_TEST) {
      expect(q.ceQueLEchecDesigne.length, `question n° ${q.numero}`).toBeGreaterThan(20);
    }
  });
});

describe("la capacité neuve", () => {
  it("est portée par une seule question, la n° 5", () => {
    const neuves = QUESTIONS_TEST.filter((q) => q.capaciteNeuve);
    expect(neuves.map((q) => q.numero)).toEqual([5]);
  });

  it("la n° 5 exerce bien la lecture du CONTENU d'une pièce", () => {
    expect(QUESTIONS_TEST.find((q) => q.numero === 5)?.capacite).toBe("contenu-piece");
  });
});

/** Fabrique les dix résultats, en marquant répondues celles dont le numéro est listé. */
function resultats(repondues: readonly number[]): ResultatQuestion[] {
  return QUESTIONS_TEST.map((q) => ({ numero: q.numero, repondue: repondues.includes(q.numero) }));
}

describe("le verdict du socle", () => {
  it("refuse neuf réponses sur dix quand la n° 5 manque", () => {
    // Le cas EXACT que l'ADR décrit : « un socle qui passerait les neuf autres et raterait
    // la cinquième n'aurait rien prouvé ». Un seuil écrit « 8 sur 10 » l'accepterait.
    const v = verdictSocle(resultats([1, 2, 3, 4, 6, 7, 8, 9, 10]));
    expect(v.passe).toBe(false);
    expect(v.repondues).toBe(9);
    expect(v.raison).toContain("capacité neuve");
    expect(v.manquantes).toEqual([5]);
  });

  it("accepte huit réponses sur dix quand la n° 5 en est", () => {
    const v = verdictSocle(resultats([1, 2, 3, 5, 6, 7, 8, 9]));
    expect(v.passe).toBe(true);
    expect(v.repondues).toBe(SEUIL_REPONDUES);
    expect(v.manquantes).toEqual([4, 10]);
  });

  it("refuse sept réponses sur dix, même avec la n° 5", () => {
    const v = verdictSocle(resultats([1, 2, 3, 5, 6, 7, 8]));
    expect(v.passe).toBe(false);
    expect(v.raison).toContain(`il en faut ${SEUIL_REPONDUES}`);
  });

  it("un résultat ABSENT vaut « non répondue », jamais « on verra »", () => {
    // Une mesure incomplète ne doit pas rendre un verdict favorable par omission : ici
    // seules huit questions sont mesurées, et les huit sont bonnes — mais la n° 5 n'a
    // pas été mesurée du tout.
    const partiels = resultats([1, 2, 3, 4, 6, 7, 8, 9]).filter((r) => r.numero !== 5 && r.numero !== 10);
    const v = verdictSocle(partiels);
    expect(v.passe).toBe(false);
    expect(v.manquantes).toContain(5);
  });

  it("dix sur dix passe, et le dit", () => {
    const v = verdictSocle(resultats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(v.passe).toBe(true);
    expect(v.manquantes).toEqual([]);
  });
});
