// tests/chiffrement.test.ts — ce que le chiffrement PROMET, éprouvé cas par cas.
//
// Le cas qui compte est « AAD altéré ⇒ échec » : c'est lui qui rend impossible de
// rétrograder un fait N2 en N0 pour le lire. Sans lui, ce module serait du chiffrement
// ordinaire, pas la garde de l'ADR 0001 §3.

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  estScelleAncien,
  longueurClaire,
  ClefAbsenteError,
  DechiffrementError,
  chiffrer,
  cleDepuisEnv,
  dechiffrer,
  deriverCle,
  empreinte,
} from "../lib/chiffrement";

const MAITRESSE = randomBytes(32).toString("base64");
const cle = deriverCle(MAITRESSE);

describe("deriverCle", () => {
  it("exige 32 octets en base64 — sinon ClefAbsenteError", () => {
    expect(() => deriverCle(undefined)).toThrow(ClefAbsenteError);
    expect(() => deriverCle("")).toThrow(ClefAbsenteError);
    expect(() => deriverCle(randomBytes(16).toString("base64"))).toThrow(ClefAbsenteError);
  });

  it("dérive DEUX clés distinctes de la clé maîtresse", () => {
    expect(cle.chiffrement.equals(cle.empreinte)).toBe(false);
    expect(cle.chiffrement.equals(Buffer.from(MAITRESSE, "base64"))).toBe(false);
  });

  it("cleDepuisEnv lit MEMORYAI_CHIFFREMENT et rien d'autre", () => {
    expect(() => cleDepuisEnv({})).toThrow(ClefAbsenteError);
    expect(cleDepuisEnv({ MEMORYAI_CHIFFREMENT: MAITRESSE }).chiffrement.equals(cle.chiffrement)).toBe(true);
  });
});

describe("chiffrer / dechiffrer", () => {
  it("rend la valeur d'origine avec le même id et le même niveau", () => {
    const scelle = chiffrer(cle, "Employeur inc.", "f1", 1);
    expect(scelle.startsWith("v2:")).toBe(true);
    expect(scelle).not.toContain("Employeur");
    expect(dechiffrer(cle, scelle, "f1", 1)).toBe("Employeur inc.");
  });

  it("un scellé de la clé perdue (v1) n'est jamais déchiffré, mais sa longueur se lit (ADR 0019)", () => {
    const v2 = chiffrer(cle, "Employé né à Montréal", "f1", 1);
    const v1 = `v1:${v2.slice(3)}`;
    expect(estScelleAncien(v1)).toBe(true);
    expect(estScelleAncien(v2)).toBe(false);
    expect(estScelleAncien(null)).toBe(false);
    expect(() => dechiffrer(cle, v1, "f1", 1)).toThrow(DechiffrementError);
    // AES-GCM chiffre octet pour octet : la longueur du clair en OCTETS, accents compris.
    expect(longueurClaire(v1)).toBe(Buffer.byteLength("Employé né à Montréal", "utf8"));
    expect(longueurClaire(v2)).toBe(Buffer.byteLength("Employé né à Montréal", "utf8"));
    for (const faux of ["", "v3:a:b:c", "v1:a:b", "v1:a:b:@@"]) expect(longueurClaire(faux), faux).toBeNull();
  });

  it("deux chiffrements de la même valeur diffèrent (nonce frais)", () => {
    expect(chiffrer(cle, "x", "f1", 1)).not.toBe(chiffrer(cle, "x", "f1", 1));
  });

  // LA garde : un niveau modifié après coup rend la valeur illisible.
  it("échoue si le NIVEAU a changé — rétrograder pour lire est impossible", () => {
    const scelle = chiffrer(cle, "123 rue Exemple", "f2", 2);
    expect(() => dechiffrer(cle, scelle, "f2", 0)).toThrow(DechiffrementError);
    expect(() => dechiffrer(cle, scelle, "f2", 1)).toThrow(DechiffrementError);
    expect(dechiffrer(cle, scelle, "f2", 2)).toBe("123 rue Exemple");
  });

  it("échoue si l'ID a changé — une valeur ne se recopie pas sur un autre fait", () => {
    const scelle = chiffrer(cle, "v", "f3", 1);
    expect(() => dechiffrer(cle, scelle, "f4", 1)).toThrow(DechiffrementError);
  });

  it("échoue avec une autre clé", () => {
    const autre = deriverCle(randomBytes(32).toString("base64"));
    const scelle = chiffrer(cle, "v", "f5", 1);
    expect(() => dechiffrer(autre, scelle, "f5", 1)).toThrow(DechiffrementError);
  });

  it("échoue sur des octets altérés ou un format inconnu", () => {
    const scelle = chiffrer(cle, "valeur assez longue pour être altérée", "f6", 1);
    const [v, n, t, c] = scelle.split(":") as [string, string, string, string];
    const altere = [v, n, t, (c[0] === "A" ? "B" : "A") + c.slice(1)].join(":");
    expect(() => dechiffrer(cle, altere, "f6", 1)).toThrow(DechiffrementError);
    expect(() => dechiffrer(cle, "v0:a:b:c", "f6", 1)).toThrow(DechiffrementError);
    expect(() => dechiffrer(cle, "pas un scellé", "f6", 1)).toThrow(DechiffrementError);
  });

  it("refuse un tag TRONQUÉ — sans longueur imposée, Node accepte 4 octets et le scellé se falsifie", () => {
    const scelle = chiffrer(cle, "valeur", "f9", 1);
    const [v, n, t, c] = scelle.split(":") as [string, string, string, string];
    // Préfixe EXACT du vrai tag : sans `authTagLength`, Node 24 le vérifie sur 4 octets et accepte.
    const tronque = [v, n, Buffer.from(t, "base64").subarray(0, 4).toString("base64"), c].join(":");
    expect(() => dechiffrer(cle, tronque, "f9", 1)).toThrow(DechiffrementError);
    // Anti-vacuité : le scellé intact, lui, se lit.
    expect(dechiffrer(cle, scelle, "f9", 1)).toBe("valeur");
  });

  it("accepte la valeur vide et l'unicode", () => {
    expect(dechiffrer(cle, chiffrer(cle, "", "f7", 1), "f7", 1)).toBe("");
    expect(dechiffrer(cle, chiffrer(cle, "Québec — été 2026 ✓", "f8", 1), "f8", 1)).toBe("Québec — été 2026 ✓");
  });
});

describe("empreinte", () => {
  it("est déterministe pour une clé et des parties données", () => {
    expect(empreinte(cle, "marc", "emploi.employeur", "src", "v1", "X")).toBe(
      empreinte(cle, "marc", "emploi.employeur", "src", "v1", "X"),
    );
  });

  it("change avec la clé — un SHA nu se brute-force, pas un HMAC", () => {
    const autre = deriverCle(randomBytes(32).toString("base64"));
    expect(empreinte(cle, "a", "b")).not.toBe(empreinte(autre, "a", "b"));
  });

  // Sans séparateur, ("ab","c") et ("a","bc") donneraient la même empreinte.
  it("distingue le découpage des parties", () => {
    expect(empreinte(cle, "ab", "c")).not.toBe(empreinte(cle, "a", "bc"));
  });
});
