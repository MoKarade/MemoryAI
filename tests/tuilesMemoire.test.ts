// tests/tuilesMemoire.test.ts — les tuiles de l'onglet Mémoire autour du réseau (maquette v5,
// écart C) : Thèmes et Sources, des comptes et des dates, jamais une valeur de fait.

import { describe, it, expect } from "vitest";
import { corpsCroissance, corpsPapiers, corpsPlusRelies, corpsSources, corpsThemes, corpsTranche, depuis, NE_JUGE_PLUS } from "@/lib/memoire/tuilesMemoire";

describe("Thèmes", () => {
  it("compte les faits par domaine (préfixe du prédicat), le plus gros d'abord", () => {
    const c = corpsThemes([{ predicat: "emploi.employeur" }, { predicat: "sante.allergie" }, { predicat: "emploi.poste" }, { predicat: "solo" }]);
    expect(c).toEqual({
      genre: "bulles",
      bulles: [
        { libelle: "emploi", valeur: 2 },
        { libelle: "sante", valeur: 1 },
        { libelle: "solo", valeur: 1 },
      ],
      resume: "Thèmes de la mémoire : emploi 2, sante 1, solo 1.",
    });
  });

  it("sans fait validé, la tuile le dit", () => {
    expect(corpsThemes([]).genre).toBe("vide");
  });
});

describe("Sources", () => {
  const maintenant = new Date("2026-10-24T12:00:00Z");

  it("par source, le compte et depuis quand la dernière ; une source vide est écartée", () => {
    const c = corpsSources(
      [
        { source: "mail", n: 3, dernier: new Date("2026-10-24T11:48:00Z") },
        { source: "document", n: 12, dernier: new Date("2026-10-20T12:00:00Z") },
        { source: "seed", n: 0, dernier: null },
        { source: "marc", n: 6, dernier: null },
      ],
      maintenant,
    );
    expect(c).toEqual({
      genre: "barres",
      barres: [
        { libelle: "Papiers", valeur: "12 · 4 j", part: 1 },
        { libelle: "Toi", valeur: "6", part: 0.5 },
        { libelle: "Courriels", valeur: "3 · 12 min", part: 0.25 },
      ],
      resume: "Faits validés par source : Papiers 12, Toi 6, Courriels 3.",
    });
  });

  it("aucune source : la tuile le dit", () => {
    expect(corpsSources([], maintenant).genre).toBe("vide");
  });

  it("depuis : minutes, heures jusqu'à deux jours, puis jours", () => {
    expect(depuis(new Date("2026-10-24T11:59:00Z"), maintenant)).toBe("1 min");
    expect(depuis(new Date("2026-10-23T00:00:00Z"), maintenant)).toBe("36 h");
    expect(depuis(new Date("2026-10-21T12:00:00Z"), maintenant)).toBe("3 j");
  });
});

describe("Croissance", () => {
  const maintenant = new Date("2026-10-24T12:00:00Z");

  it("le compte cumulé à la fin de chacun des douze derniers mois, à l'heure de Québec", () => {
    const c = corpsCroissance(
      [
        { valideLe: new Date("2025-08-15T12:00:00Z"), creeLe: new Date("2025-08-01T12:00:00Z") },
        { valideLe: null, creeLe: new Date("2026-03-10T12:00:00Z") },
        // Le 1er octobre à 2 h UTC, c'est encore septembre à Québec.
        { valideLe: new Date("2026-10-01T02:00:00Z"), creeLe: new Date("2026-09-01T12:00:00Z") },
        { valideLe: new Date("2026-10-20T12:00:00Z"), creeLe: new Date("2026-10-20T12:00:00Z") },
      ],
      maintenant,
    );
    if (c.genre !== "histogramme") throw new Error("histogramme attendu");
    expect(c.barres.map((b) => b.cle)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(c.barres.map((b) => b.valeur)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 4]);
    expect(c.barres[0]?.etiquette).toBe("nov.");
    expect(c.resume).toBe("Faits validés tenus par la mémoire à la fin de chaque mois : 1 il y a douze mois, 4 aujourd'hui.");
  });

  it("sans fait validé, la tuile le dit", () => {
    expect(corpsCroissance([], maintenant).genre).toBe("vide");
  });
});

describe("Les plus reliés", () => {
  const faits = [
    { id: "a", predicat: "emploi.employeur" },
    { id: "b", predicat: "logement.ville" },
    { id: "c", predicat: "sante.allergie" },
    { id: "d", predicat: "seul.fait" },
  ];

  it("classe les faits par nombre de liens, nommés par leur prédicat ; un fait sans lien est écarté", () => {
    const c = corpsPlusRelies(faits, [
      { faitA: "a", faitB: "b" },
      { faitA: "a", faitB: "c" },
    ]);
    expect(c).toEqual({
      genre: "barres",
      barres: [
        { libelle: "emploi.employeur", valeur: "2", part: 1 },
        { libelle: "logement.ville", valeur: "1", part: 0.5 },
        { libelle: "sante.allergie", valeur: "1", part: 0.5 },
      ],
      resume: "Les faits les plus reliés : emploi.employeur 2, logement.ville 1, sante.allergie 1.",
    });
    expect(corpsPlusRelies(faits, [{ faitA: "a", faitB: "b" }], 1)).toMatchObject({ barres: [{ libelle: "emploi.employeur" }] });
  });

  it("sans lien, la tuile le dit", () => {
    expect(corpsPlusRelies(faits, []).genre).toBe("vide");
  });
});

describe("Tranché par LIA (Marc ne juge plus rien, tâche MemoryAI 231)", () => {
  it("rien de tranché : la règle, puis un vide honnête, jamais un lien vers la pile", () => {
    expect(corpsTranche(0)).toEqual([
      { genre: "texte", texte: NE_JUGE_PLUS },
      { genre: "vide", texte: "Aucun papier encore confirmé par une seconde lecture." },
    ]);
    expect(JSON.stringify(corpsTranche(0))).not.toMatch(/\/questions|Juger maintenant|à juger/);
  });

  it("le compte réel des papiers jugés vrais, au singulier comme au pluriel", () => {
    expect(corpsTranche(1)[1]).toEqual({ genre: "texte", texte: "1 papier jugé vrai par LIA." });
    expect(corpsTranche(12)[1]).toEqual({ genre: "texte", texte: "12 papiers jugés vrais par LIA." });
  });
});

describe("Papiers", () => {
  it("sans papier : vide", () => {
    expect(corpsPapiers([])).toEqual({ genre: "vide", texte: "Aucun papier gardé pour l'instant." });
  });

  it("par dossier, le plus gros d'abord, et un papier sans dossier le dit", () => {
    const c = corpsPapiers([
      { domaine: "Dossier B", n: 2 },
      { domaine: null, n: 1 },
      { domaine: "Dossier A", n: 4 },
    ]);
    expect(c).toEqual({
      genre: "barres",
      barres: [
        { libelle: "Dossier A", valeur: "4", part: 1 },
        { libelle: "Dossier B", valeur: "2", part: 0.5 },
        { libelle: "Sans dossier", valeur: "1", part: 0.25 },
      ],
      resume: "Papiers gardés par dossier : Dossier A 4, Dossier B 2, Sans dossier 1.",
    });
  });
});
