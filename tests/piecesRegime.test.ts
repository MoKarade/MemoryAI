// tests/piecesRegime.test.ts — le régime de chiffrement d'une pièce ne vient jamais d'un modèle.
//
// Marc a choisi DEUX régimes selon le niveau (16/09) contre la recommandation « tout chiffré ».
// Ce qui rendait ce choix risqué est ce que ces cas vérifient : le niveau est dérivé par le
// CODE, un extracteur ne peut que le MONTER, un dossier inconnu tombe du côté chiffré, et un
// clair déjà écrit ne se répare qu'en réécrivant.

import { describe, it, expect } from "vitest";
import { regimePiece, doitReecrire, NIVEAU_CHIFFRE_INTEGRAL } from "../lib/pieces/regime";

describe("le niveau vient du CODE, jamais du modèle", () => {
  it("un dossier d'immigration donne le régime chiffré, quoi que propose l'extracteur", () => {
    const r = regimePiece({ domaine: "04 · Immigration", type: "lettre", niveauPropose: 0 });
    expect(r.niveau).toBe(3);
    expect(r.resumeEnClair).toBe(false);
  });

  it("un TYPE de document sensible suffit, même dans un dossier anodin", () => {
    // « avis de cotisation » est N3 par type (lib/niveau.ts), et le dossier « 08 · Perso »
    // vaut 0 : sans la dérivation par type, cette pièce partirait en clair.
    const r = regimePiece({ domaine: "08 · Perso & projets", type: "Avis de cotisation 2024" });
    expect(r.niveau).toBe(NIVEAU_CHIFFRE_INTEGRAL);
    expect(r.resumeEnClair).toBe(false);
  });

  it("un extracteur peut MONTER le niveau", () => {
    const r = regimePiece({ domaine: "08 · Perso & projets", type: "note", niveauPropose: 3 });
    expect(r.resumeEnClair).toBe(false);
  });

  it("un extracteur ne peut PAS abaisser le niveau", () => {
    // La mutation à craindre : un modèle qui répond « niveau 0 » sur un papier d'immigration.
    const r = regimePiece({ domaine: "04 · Immigration", type: "CSQ", niveauPropose: 0 });
    expect(r.niveau).toBe(3);
    expect(r.resumeEnClair).toBe(false);
  });
});

describe("le défaut le plus prudent", () => {
  it("aucun dossier ⇒ chiffré, et la raison le dit", () => {
    const r = regimePiece({ type: "facture" });
    expect(r.resumeEnClair).toBe(false);
    expect(r.raison).toContain("aucun dossier");
  });

  it("dossier HORS taxonomie ⇒ chiffré, et la raison NOMME le dossier", () => {
    const r = regimePiece({ domaine: "99 · Fourre-tout", type: "facture" });
    expect(r.resumeEnClair).toBe(false);
    expect(r.raison).toContain("99 · Fourre-tout");
  });

  it("un dossier reconnu de niveau 0 passe bien en clair — sinon la règle serait vacueuse", () => {
    // Anti-vacuité : sans ce cas, « tout est chiffré » satisferait tous les cas ci-dessus.
    const r = regimePiece({ domaine: "08 · Perso & projets", type: "note de voyage" });
    expect(r.niveau).toBe(0);
    expect(r.resumeEnClair).toBe(true);
  });

  it("un dossier reconnu de niveau 2 passe aussi en clair (c'est le choix de Marc)", () => {
    const r = regimePiece({ domaine: "02 · Finances", type: "relevé bancaire" });
    expect(r.niveau).toBe(2);
    expect(r.resumeEnClair).toBe(true);
  });
});

describe("le clair est irréversible, donc un reclassement RÉÉCRIT", () => {
  it("clair puis chiffré ⇒ il faut réécrire", () => {
    expect(doitReecrire({ resumeEnClair: true }, regimePiece({ domaine: "04 · Immigration" }))).toBe(true);
  });

  it("chiffré puis chiffré ⇒ rien à faire", () => {
    expect(doitReecrire({ resumeEnClair: false }, regimePiece({ domaine: "04 · Immigration" }))).toBe(false);
  });

  it("chiffré puis clair ⇒ on ne déprotège JAMAIS tout seul", () => {
    const vers = regimePiece({ domaine: "08 · Perso & projets" });
    expect(vers.resumeEnClair).toBe(true);
    expect(doitReecrire({ resumeEnClair: false }, vers)).toBe(false);
  });
});
