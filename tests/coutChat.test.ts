// tests/coutChat.test.ts — le plafond dur et le coût d'un appel, PURS.

import { describe, it, expect } from "vitest";
import {
  budgetOuvert,
  coutUsd,
  estModele,
  jourQuebec,
  lireUsage,
  MODELE_DEFAUT,
  MODELES,
  PLAFONDS_DEFAUT_USD_PAR_JOUR,
  PLAFOND_MAX_USD_PAR_JOUR,
  PLAFOND_MIN_USD_PAR_JOUR,
  PLAFOND_TOTAL_USD_PAR_JOUR,
  plafondValide,
  POSTES,
} from "../lib/coutChat";
import { POSTES_DEPENSE } from "../lib/db/schema";

describe("coûts du chat", () => {
  it("les trois modèles de Q13, Sonnet 5 par défaut, jamais Fable", () => {
    expect(MODELES.map((m) => m.id)).toEqual(["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]);
    expect(MODELE_DEFAUT).toBe("claude-sonnet-5");
    expect(estModele("claude-fable-5-1")).toBe(false);
    expect(estModele("claude-sonnet-5")).toBe(true);
  });

  it("calcule un coût par million de tokens, cache dérivé du prix d'entrée", () => {
    expect(coutUsd("claude-sonnet-5", { entree: 1_000_000, sortie: 0, ecritureCache: 0, lectureCache: 0 })).toBe(3);
    expect(coutUsd("claude-sonnet-5", { entree: 0, sortie: 1_000_000, ecritureCache: 0, lectureCache: 0 })).toBe(15);
    expect(coutUsd("claude-sonnet-5", { entree: 0, sortie: 0, ecritureCache: 1_000_000, lectureCache: 0 })).toBeCloseTo(3.75);
    expect(coutUsd("claude-sonnet-5", { entree: 0, sortie: 0, ecritureCache: 0, lectureCache: 1_000_000 })).toBeCloseTo(0.3);
    expect(coutUsd("claude-haiku-4-5", { entree: 1000, sortie: 500, ecritureCache: 0, lectureCache: 0 })).toBeCloseTo(0.0035);
  });

  // Un `undefined` dans une somme donne NaN et empoisonne tout le cumul (leçon DriveAI).
  it("un usage absent ou partiel vaut 0, jamais NaN, et dit s'il était lisible", () => {
    expect(lireUsage(undefined)).toEqual({ usage: { entree: 0, sortie: 0, ecritureCache: 0, lectureCache: 0 }, lisible: false });
    const u = lireUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null });
    expect(u.usage).toEqual({ entree: 10, sortie: 5, ecritureCache: 0, lectureCache: 0 });
    expect(u.lisible).toBe(true);
    expect(Number.isNaN(coutUsd("claude-opus-5", lireUsage({ input_tokens: -1 }).usage))).toBe(false);
  });

  it("chaque poste a SON plafond, et il se ferme STRICTEMENT quand il est atteint", () => {
    // ⚠️ Le plafond est un ARGUMENT depuis [L34] : Marc le règle dans l'app. Les cas ci-dessous
    // passent les DÉFAUTS, qui sont ce qui s'applique tant qu'il n'a rien réglé.
    const p = PLAFONDS_DEFAUT_USD_PAR_JOUR;
    expect(p.chat).toBe(1);
    expect(budgetOuvert(0, "chat", p)).toBe(true);
    expect(budgetOuvert(0.9999, "chat", p)).toBe(true);
    expect(budgetOuvert(1, "chat", p)).toBe(false);
    expect(budgetOuvert(3, "chat", p)).toBe(false);
    // …et le poste de l'apprentissage se ferme à SON chiffre, pas à celui du chat : c'est
    // toute la raison d'être de la séparation.
    expect(budgetOuvert(1.5, "apprentissage", p)).toBe(true);
    expect(budgetOuvert(2, "apprentissage", p)).toBe(false);

    // ⚠⚠ ET IL SE FERME AU PLAFOND RÉGLÉ, pas au défaut. Sans ce cas, `budgetOuvert` pourrait
    // ignorer son argument et lire une constante : les lignes ci-dessus resteraient vertes.
    expect(budgetOuvert(4, "apprentissage", { chat: 1, apprentissage: 5 })).toBe(true);
    expect(budgetOuvert(4, "apprentissage", { chat: 1, apprentissage: 2 })).toBe(false);
    // Un plafond à zéro est une PAUSE : le plafond au maximum de son effet, jamais un arrêt
    // du contrôle. La dépense nulle elle-même est refusée, parce que la comparaison est stricte.
    expect(budgetOuvert(0, "apprentissage", { chat: 1, apprentissage: 0 })).toBe(false);
  });

  it("la somme des postes est EXACTEMENT le total décidé par Marc (réallouer, jamais augmenter)", () => {
    // Patron des budgets de DriveAI. L'agrégat « ≤ total » ne suffirait pas : il tolère une
    // croissance tant qu'il reste de la marge. Une ÉGALITÉ tombe dès que la somme bouge, dans
    // les deux sens — donc relever un poste OBLIGE à prendre à l'autre, ou à rouvrir le total
    // avec Marc, ce qui est une décision de dépense et pas un effet de bord.
    const somme = POSTES.reduce((n, p) => n + PLAFONDS_DEFAUT_USD_PAR_JOUR[p], 0);
    expect(somme).toBe(PLAFOND_TOTAL_USD_PAR_JOUR);
    expect(PLAFOND_TOTAL_USD_PAR_JOUR).toBe(3);
  });

  it("⚠⚠ un plafond réglable reste un plafond : borné, jamais absent", () => {
    // [L34] Marc règle les plafonds dans l'app (« jveux pouvoir choisir dans lapp », 18/09).
    // L'ADR 0001 §5.5 dit « plafond dur, NON DÉSACTIVABLE » : ce qui est interdit est de
    // l'ÉTEINDRE, pas d'en choisir la valeur — et le test de la somme, juste au-dessus, disait
    // lui-même que relever un poste oblige à « rouvrir le total avec Marc, ce qui est une
    // décision de dépense ». Il vient de la prendre. Ce cas garde ce qui NE change pas.
    //
    // 1. Une valeur au-delà du maximum du CODE est ramenée : un plafond sans borne serait un
    //    plafond absent d'un caractère de trop dans un formulaire.
    expect(plafondValide(1e9, "apprentissage")).toBe(PLAFOND_MAX_USD_PAR_JOUR);
    expect(plafondValide(-5, "apprentissage")).toBe(PLAFOND_MIN_USD_PAR_JOUR);
    // 2. ⚠️ `Infinity` est le plafond désactivé écrit autrement, et il passerait un `!isNaN`.
    expect(plafondValide(Number.POSITIVE_INFINITY, "chat")).toBe(PLAFONDS_DEFAUT_USD_PAR_JOUR.chat);
    // 3. Une valeur ILLISIBLE vaut le DÉFAUT, jamais « illimité » ni zéro : `depense < NaN` est
    //    FAUX, donc un plafond illisible couperait tout en silence — l'inverse du danger,
    //    mais un mensonge quand même.
    expect(plafondValide(NaN, "chat")).toBe(PLAFONDS_DEFAUT_USD_PAR_JOUR.chat);
    expect(plafondValide(undefined, "apprentissage")).toBe(PLAFONDS_DEFAUT_USD_PAR_JOUR.apprentissage);
    expect(plafondValide("beaucoup", "chat")).toBe(PLAFONDS_DEFAUT_USD_PAR_JOUR.chat);
    // 4. Une valeur ordinaire passe telle quelle — sinon les trois cas ci-dessus seraient
    //    satisfaits par une fonction qui rend toujours le défaut.
    expect(plafondValide(7.5, "apprentissage")).toBe(7.5);
    expect(plafondValide(0, "apprentissage")).toBe(0);
  });

  it("les postes du code et ceux de la BASE sont la MÊME liste", () => {
    // Le schéma ne peut pas importer `coutChat` (drizzle-kit le charge hors du bundle), donc
    // la liste y est RECOPIÉE. Sans ce test, un poste ajouté d'un seul côté passerait le
    // typage et se ferait refuser par la contrainte de la base, en production seulement.
    expect([...POSTES_DEPENSE]).toEqual([...POSTES]);
  });

  it("le jour est celui du Québec, pas celui du serveur (UTC)", () => {
    // 15 septembre 23 h 30 à Québec = 16 septembre 03 h 30 UTC.
    expect(jourQuebec(new Date("2026-09-16T03:30:00Z"))).toBe("2026-09-15");
    // Hiver (UTC-5) : 1er février 00 h 30 à Québec = 05 h 30 UTC.
    expect(jourQuebec(new Date("2026-02-01T05:30:00Z"))).toBe("2026-02-01");
    expect(jourQuebec(new Date("2026-02-01T04:30:00Z"))).toBe("2026-01-31");
  });
});
