// tests/facettes.test.ts — ce qui se regroupe, et ce qui ne doit pas se regrouper.

import { describe, it, expect } from "vitest";
import { deriverCle } from "../lib/chiffrement";
import { cleFacette, normaliserFacette } from "../lib/pieces/facettes";

const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));

describe("la normalisation", () => {
  it("replie la casse, les accents et les espaces", () => {
    expect(normaliserFacette("  Fédération   DES Caisses ")).toBe("federation des caisses");
  });

  it("ne rapproche PAS deux raisons sociales différentes", () => {
    // Ce n'est pas son rôle : c'est la liste des valeurs connues servie au modèle qui règle
    // ça (ADR §7). Une normalisation qui fusionnerait ici ferait mentir les compteurs.
    expect(normaliserFacette("Banque Aurore")).not.toBe(normaliserFacette("Fédération des caisses Aurore"));
  });

  it("rend une chaîne vide pour de la ponctuation seule — donc aucune clé", () => {
    expect(normaliserFacette("—")).toBe("");
    expect(cleFacette(cle, "emetteur", "—")).toBeNull();
  });
});

describe("la clé de regroupement", () => {
  it("deux écritures de la même valeur donnent la MÊME clé", () => {
    expect(cleFacette(cle, "emetteur", "Banque Aurore")).toBe(cleFacette(cle, "emetteur", "  banque aurore "));
  });

  it("deux valeurs différentes donnent des clés différentes", () => {
    expect(cleFacette(cle, "emetteur", "Banque Aurore")).not.toBe(cleFacette(cle, "emetteur", "Hydro-Québec"));
  });

  it("la FAMILLE entre dans la clé — sinon un type et un émetteur se compteraient ensemble", () => {
    expect(cleFacette(cle, "type", "bail")).not.toBe(cleFacette(cle, "emetteur", "bail"));
  });

  it("une autre clé de chiffrement donne d'autres clés — la valeur ne se déduit pas du hash", () => {
    const autre = deriverCle(Buffer.alloc(32, 9).toString("base64"));
    expect(cleFacette(cle, "emetteur", "Banque Aurore")).not.toBe(cleFacette(autre, "emetteur", "Banque Aurore"));
  });

  it("une valeur absente ne produit aucune clé", () => {
    expect(cleFacette(cle, "type", null)).toBeNull();
    expect(cleFacette(cle, "type", "")).toBeNull();
  });
});
