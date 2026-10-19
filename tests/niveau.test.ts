// tests/niveau.test.ts — le niveau monte, il ne descend jamais.

import { describe, it, expect } from "vitest";
import { niveauFinal, niveauParDossier, niveauParTypeDocument } from "../lib/niveau";

describe("niveauParDossier", () => {
  it("suit la taxonomie DriveAI", () => {
    expect(niveauParDossier("04 · Immigration")).toBe(3);
    expect(niveauParDossier("04 · Immigration/Permis de travail")).toBe(3);
    expect(niveauParDossier("02 · Finances/2025")).toBe(2);
    expect(niveauParDossier("07 · Santé")).toBe(2);
    expect(niveauParDossier("05 · Carrière")).toBe(1);
    expect(niveauParDossier("08 · Perso & projets")).toBe(0);
  });

  it("un dossier inconnu ou absent ne dérive rien", () => {
    expect(niveauParDossier(undefined)).toBe(0);
    expect(niveauParDossier("")).toBe(0);
    expect(niveauParDossier("99 · Inconnu")).toBe(0);
  });

  it("tolère la forme décomposée des accents (NFD)", () => {
    expect(niveauParDossier("07 · Santé".normalize("NFD"))).toBe(2);
  });
});

describe("niveauParTypeDocument", () => {
  it("reconnaît identité, immigration et fiscal en N3", () => {
    for (const t of ["Passeport", "permis de travail", "Avis de cotisation", "T4", "Relevé 1", "CSQ", "Certificat de naissance"]) {
      expect(niveauParTypeDocument(t), t).toBe(3);
    }
  });
  it("laisse le reste à 0", () => {
    for (const t of ["Facture", "Bail", "Relevé de compte", undefined, ""]) expect(niveauParTypeDocument(t), t ?? "vide").toBe(0);
  });
});

describe("niveauFinal — le MAX, jamais le minimum", () => {
  it("prend le plus haut de toutes les sources", () => {
    expect(niveauFinal({ predicat: 0 })).toBe(0);
    expect(niveauFinal({ predicat: 1, propose: 0 })).toBe(1);
    expect(niveauFinal({ predicat: 0, propose: 2 })).toBe(2);
    expect(niveauFinal({ predicat: 1, dossier: "04 · Immigration" })).toBe(3);
    expect(niveauFinal({ predicat: 0, typeDocument: "Avis de cotisation" })).toBe(3);
  });

  // LA garde : un modèle qui « propose » 0 sur un fait de santé n'abaisse rien.
  it("un niveau proposé plus bas est ignoré", () => {
    expect(niveauFinal({ predicat: 2, propose: 0 })).toBe(2);
    expect(niveauFinal({ predicat: 3, propose: -5 })).toBe(3);
  });

  it("un niveau proposé hors bornes ou non entier ne fait ni monter ni planter", () => {
    expect(niveauFinal({ predicat: 1, propose: 99 })).toBe(3);
    expect(niveauFinal({ predicat: 1, propose: 1.5 })).toBe(1);
    expect(niveauFinal({ predicat: 1, propose: null })).toBe(1);
  });
});
