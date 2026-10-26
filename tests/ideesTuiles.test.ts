// tests/ideesTuiles.test.ts — les tuiles de l'espace « Idées » (ADR 0027, tâche MemoryAI 233) : ce que
// l'écran dit selon ce que la base répond. La règle et la passe ont leur fichier
// (`tests/ideesPasse.test.ts`). Données FICTIVES : noms, apps et jours inventés.

import { describe, expect, it } from "vitest";
import { contenuEspaces } from "../lib/accueil/espaces";
import { tableauIdees } from "../lib/accueil/tableaux";
import type { IdeeAffichee } from "../lib/idees/regles";
import { tableauIdeesLues } from "../lib/idees/tableau";

const idee = (o: Partial<IdeeAffichee> = {}): IdeeAffichee => ({
  id: "i",
  app: "hub",
  genre: "tuile",
  nom: "Budget fictif",
  etat: "proposee",
  utilite: 47,
  raisons: { jours: 3, fenetre: 30, derniere: "2026-10-24" },
  ...o,
});

describe("les tuiles de l'espace « Idées »", () => {
  it("non lues : les tuiles vides d'avant, sans rien changer", () => {
    expect(tableauIdeesLues(undefined)).toEqual(tableauIdees());
  });

  it("sans base, chaque tuile le dit ; sans idée, la boîte dit pourquoi", () => {
    const panne = tableauIdeesLues(null);
    expect(panne.tuiles.every((t) => t.corps.length === 1 && t.corps[0]?.genre === "vide")).toBe(true);
    expect(panne.tuiles[0]?.corps[0]).toEqual({ genre: "vide", texte: "La base ne répond pas : les idées ne sont pas lisibles." });
    expect(tableauIdeesLues([]).tuiles[0]?.corps).toEqual([{ genre: "vide", texte: "Aucune idée : tu n'as encore rien demandé deux fois au hub." }]);
  });

  it("les quatre tuiles de la maquette gardent leur titre, leur place et leur repli", () => {
    const base = tableauIdees();
    const t = tableauIdeesLues([idee()]);
    expect(t.question).toBe(base.question);
    expect(t.tuiles.map((x) => [x.cle, x.titre, x.largeur, x.repliee])).toEqual(base.tuiles.map((x) => [x.cle, x.titre, x.largeur, x.repliee]));
  });

  it("la boîte, les étapes, l'utilité estimée et les écartées montrent les vraies idées", () => {
    const t = tableauIdeesLues([
      idee({ id: "a", utilite: 40, nom: "Petit fictif" }),
      idee({ id: "b", utilite: 80, etat: "retenue" }),
      idee({ id: "c", etat: "ecartee", nom: "Écarté fictif", genre: "bouton", app: "jobai" }),
      idee({ id: "d", etat: "faite" }),
      idee({ id: "e" }),
    ]);
    const [boite, etapes, utilite, refusees] = t.tuiles;
    expect(boite?.corps[0]).toEqual({
      genre: "liste",
      elements: [
        { libelle: "Revoir la tuile « Budget fictif » dans le hub", detail: "Retenue · demandé 3 jours sur 30, la dernière fois le 24 oct." },
        { libelle: "Revoir la tuile « Budget fictif » dans le hub", detail: "demandé 3 jours sur 30, la dernière fois le 24 oct." },
        { libelle: "Revoir la tuile « Petit fictif » dans le hub", detail: "demandé 3 jours sur 30, la dernière fois le 24 oct." },
      ],
    });
    expect(etapes?.corps[0]).toMatchObject({
      genre: "barres",
      barres: [
        { libelle: "Proposées", valeur: "2", part: 1 },
        { libelle: "Retenues", valeur: "1", part: 0.5 },
        { libelle: "Faites", valeur: "1", part: 0.5 },
        { libelle: "Écartées", valeur: "1", part: 0.5 },
      ],
    });
    const barres = utilite?.corps[0];
    if (barres?.genre !== "barres") throw new Error("barres attendues");
    expect(barres.barres.map((b) => b.valeur)).toEqual(["≈ 80 / 100", "≈ 47 / 100", "≈ 40 / 100"]);
    expect(barres.barres[0]?.part).toBeCloseTo(0.8);
    // L'utilité se dit estimation : jamais présentée comme une mesure.
    expect(utilite?.corps[1]).toMatchObject({ genre: "texte", texte: expect.stringContaining("Estimation, pas une mesure") });
    expect(refusees?.corps).toEqual([{ genre: "liste", elements: [{ libelle: "Revoir le bouton « Écarté fictif » dans JobAI", detail: "Écartée : elle ne la reproposera pas." }] }]);
  });

  it("au-delà de huit idées en attente, la boîte dit combien d'autres suivent", () => {
    const toutes = Array.from({ length: 10 }, (_, i) => idee({ id: `i${i}`, nom: `Idée ${i} fictive`, utilite: 90 - i }));
    const liste = tableauIdeesLues(toutes).tuiles[0]?.corps[0];
    if (liste?.genre !== "liste") throw new Error("liste attendue");
    expect(liste.elements).toHaveLength(9);
    expect(liste.elements[8]).toEqual({ libelle: "Et 2 autres" });
  });

  it("l'espace dit ce qui est vrai : non lues, panne, aucune idée, des idées, toutes closes", () => {
    const entrees = { budget: null, outils: [], formes: [] };
    const espace = (idees: Parameters<typeof contenuEspaces>[0]["idees"]) => contenuEspaces({ ...entrees, idees }).idees;
    expect(espace(undefined)).toMatchObject({ phrase: "Elle ne propose pas encore d'idées pour tes apps.", vide: true });
    expect(espace(null)).toMatchObject({ phrase: "La base ne répond pas : ses idées ne sont pas lisibles.", vide: true });
    expect(espace([])).toMatchObject({ phrase: "Aucune idée : tu n'as encore rien demandé deux fois au hub.", vide: true });
    expect(espace([idee()])).toMatchObject({ phrase: "1 idée en attente pour tes apps, nées de tes demandes au hub.", dit: "J'ai 1 idée pour tes apps, nées de tes demandes au hub.", vide: false });
    expect(espace([idee({ id: "a" }), idee({ id: "b", etat: "retenue" }), idee({ id: "c", etat: "faite" })])?.phrase).toBe("2 idées en attente pour tes apps, nées de tes demandes au hub.");
    expect(espace([idee({ etat: "ecartee" })])).toMatchObject({ phrase: "Toutes ses idées sont faites ou écartées.", vide: false });
  });
});
