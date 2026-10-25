// tests/accueilParoles.test.ts — ce que LIA dit seule dans sa maison (maquette v5, écart A3) : le
// salut de l'heure, puis ce que les espaces disent de vrai. Données FICTIVES.

import { describe, expect, it } from "vitest";
import { contenuEspaces, ESPACES, type EntreesEspaces } from "@/lib/accueil/espaces";
import { parleSeuleMaison, salutSelonHeure } from "@/lib/accueil/paroles";

const BASE: EntreesEspaces = { budget: null, outils: ["memoryai_etat"], formes: ["carte"] };
const budget = (chat: number, apprentissage = 0): EntreesEspaces["budget"] => ({
  depense: { chat, apprentissage },
  plafonds: { chat: 1, apprentissage: 2 },
});

describe("le salut, à l'heure de Québec", () => {
  it("reprend les quatre saluts de la maquette", () => {
    expect(salutSelonHeure(0)).toBe("Il est tard. Je veille.");
    expect(salutSelonHeure(5)).toBe("Il est tard. Je veille.");
    expect(salutSelonHeure(6)).toBe("Bonjour. Café ?");
    expect(salutSelonHeure(11)).toBe("Bonjour. Café ?");
    expect(salutSelonHeure(12)).toBe("Bon après-midi.");
    expect(salutSelonHeure(17)).toBe("Bon après-midi.");
    expect(salutSelonHeure(18)).toBe("Bonsoir.");
    expect(salutSelonHeure(23)).toBe("Bonsoir.");
  });
});

describe("ce qu'elle dit seule", () => {
  it("rien qui attend Marc : le salut seul, puis elle se tait (elle parle alors d'elle)", () => {
    const c = contenuEspaces(BASE);
    expect(parleSeuleMaison("salut", c, 14)).toBe("Bon après-midi.");
    expect(parleSeuleMaison("rien", c, 14)).toBeNull();
    expect(parleSeuleMaison("relance", c, 14)).toBeNull();
  });

  it("elle ne propose JAMAIS de juger : Marc ne juge plus rien (tâche MemoryAI 231)", () => {
    const c = contenuEspaces({ ...BASE, budget: budget(0.11) });
    for (const motif of ["salut", "rien", "relance"] as const) {
      for (const tour of [0, 1, 2]) expect(parleSeuleMaison(motif, c, 9, tour) ?? "").not.toMatch(/juger|On regarde ensemble/);
    }
  });

  it("à tour de rôle : la dépense du jour, seule remarque vraie qui reste", () => {
    const c = contenuEspaces({ ...BASE, budget: budget(0.11) });
    expect(parleSeuleMaison("salut", c, 9)).toBe("Bonjour. Café ? 0,11 $ aujourd'hui, tout va bien.");
    expect(parleSeuleMaison("rien", c, 9, 0)).toBe("0,11 $ aujourd'hui, tout va bien.");
    expect(parleSeuleMaison("relance", c, 9, 1)).toBe("0,11 $ aujourd'hui, tout va bien.");
  });
});

describe("ce qu'elle dit du budget, avec la vraie dépense", () => {
  it("sous les plafonds : la somme du jour, tout va bien", () => {
    expect(contenuEspaces({ ...BASE, budget: budget(0.11, 0.2) }).budget.dit).toBe("0,31 $ aujourd'hui, tout va bien.");
  });

  it("proche d'un plafond (80 %) : elle nomme le poste", () => {
    expect(contenuEspaces({ ...BASE, budget: budget(0.85) }).budget.dit).toBe("0,85 $ aujourd'hui, « Parler » est proche de son plafond.");
  });

  it("plafond atteint : elle le dit", () => {
    expect(contenuEspaces({ ...BASE, budget: budget(1) }).budget.dit).toBe("1,00 $ aujourd'hui, plafond atteint pour « Parler ».");
  });

  it("un plafond nul ne compte pas : jamais « atteint » d'un plafond qui n'existe pas", () => {
    const b = { depense: { chat: 0.5, apprentissage: 0.1 }, plafonds: { chat: 0, apprentissage: 2 } };
    expect(contenuEspaces({ ...BASE, budget: b }).budget.dit).toBe("0,60 $ aujourd'hui, tout va bien.");
  });

  it("sans base : elle ne devine pas un zéro, et ne le dit pas seule", () => {
    const c = contenuEspaces(BASE);
    expect(c.budget.dit).toBe("Je ne lis pas la dépense du jour : la base ne répond pas.");
    expect(c.budget.remarque).toBeFalsy();
  });
});

describe("chaque espace a sa phrase et son geste", () => {
  it("une phrase non vide par espace, et une action de lia-ui", () => {
    const c = contenuEspaces(BASE);
    for (const e of ESPACES) {
      expect(c[e.id].dit.trim(), e.id).not.toBe("");
      expect(e.activite, e.id).toMatch(/^[a-z]+$/);
    }
  });

  it("les espaces sans source ne sont jamais une remarque : elle n'en parle pas seule", () => {
    const c = contenuEspaces({ ...BASE, budget: budget(0.1) });
    for (const id of ["sante", "journee", "monde", "souvenirs", "outils", "formes", "idees"] as const) {
      expect(c[id].remarque, id).toBeFalsy();
    }
  });
});

describe("la maison la fait parler", () => {
  it("le salut à l'arrivée et la parole seule passent par ces fonctions, à l'heure de Québec", async () => {
    const { readFileSync } = await import("node:fs");
    const accueil = readFileSync("app/AccueilClient.tsx", "utf8");
    expect(accueil).toMatch(/salut=\{salutSelonHeure\(heureQuebec\(new Date\(\)\)\)\}/);
    expect(accueil).toMatch(/onSpontane=\{parleSeule\}/);
    expect(accueil).toMatch(/parleSeuleMaison\(motif, contenus, heureQuebec\(new Date\(\)\)/);
  });
});
