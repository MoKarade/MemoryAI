// tests/tuilesMemoire.test.ts — les tuiles de l'onglet Mémoire autour du réseau (maquette v5,
// écart C) : Thèmes et Sources, des comptes et des dates, jamais une valeur de fait.

import { describe, it, expect } from "vitest";
import { corpsSources, corpsThemes, depuis } from "@/lib/memoire/tuilesMemoire";

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
