// tests/niveau3.test.ts — LE CONTENU DES PAPIERS D'IDENTITÉ, et ce qui l'ouvre.
//
// Décision de Marc du 19/09/2026 : « pour tous les docs niveau 3 max, tout ». Ce qui l'a
// déclenchée est mesurable — la Mémoire portait son passeport et ne pouvait pas dire son âge,
// parce qu'un papier de niveau 3 sortait toujours en SOMMAIRE (domaine, année, dates).
//
// Quatre propriétés, et aucune ne se déduit de la précédente :
//
//  1. IL FAUT LES DEUX VERROUS. La variable d'environnement seule ferait sortir un passeport
//     à chaque question, y compris depuis claude.ai par le MCP — qui s'authentifie par jeton,
//     pas par la session de Marc. La demande par appel seule serait à la main d'un modèle.
//  2. LE PLAFOND EST MONOTONE : demander N3 sert AUSSI N2. L'écrire autrement ferait sortir
//     MOINS pour une demande PLUS large, sans que rien ne rougisse.
//  3. LE DÉFAUT EST FERMÉ : sans rien demander, un papier d'identité reste un sommaire.
//  4. UN SOMMAIRE SE COMPTE. « ce papier n'a pas de contenu » et « son contenu existe et ne
//     sort pas ici » ne disent pas la même chose, et seule la seconde désigne un geste.
//
// Module PUR : ni base, ni réseau, ni clé — `sortDeLaPiece` et `niveauMaxServi` décident seules.

import { describe, it, expect } from "vitest";
import { niveauMaxServi, n3Autorise, type PolitiqueLecture } from "../lib/lecture";
import { niveauServi, sortDeLaPiece } from "../lib/pieces/lecture";
import type { Piece } from "../lib/db/schema";

const politique = (o: Partial<PolitiqueLecture> = {}): PolitiqueLecture => ({
  inclureN2: false,
  n2Autorise: false,
  inclureN3: false,
  n3Autorise: false,
  inclureProposes: true,
  ...o,
});

/** Un papier d'identité : le passeport de la capture du 19/09. */
const papier = (niveau: number): Piece =>
  ({ niveau, statut: "active", supprimeLe: null }) as unknown as Piece;

describe("les deux verrous du niveau 3", () => {
  it("la variable d'environnement SEULE n'ouvre rien", () => {
    const p = politique({ n3Autorise: true });
    expect(niveauMaxServi(p)).toBe(1);
    expect(sortDeLaPiece(papier(3), p)).toBe("sommaire");
  });

  it("la demande par appel SEULE n'ouvre rien", () => {
    const p = politique({ inclureN3: true });
    expect(niveauMaxServi(p)).toBe(1);
    expect(sortDeLaPiece(papier(3), p)).toBe("sommaire");
  });

  it("les deux ensemble ouvrent le contenu", () => {
    const p = politique({ inclureN3: true, n3Autorise: true });
    expect(niveauMaxServi(p)).toBe(3);
    expect(sortDeLaPiece(papier(3), p)).toBe("complete");
  });

  it("n3Autorise lit MEMORYAI_N3_CHAT, et rien d'autre", () => {
    expect(n3Autorise({ MEMORYAI_N3_CHAT: "1" })).toBe(true);
    expect(n3Autorise({ MEMORYAI_N3_CHAT: " 1 " })).toBe(true);
    expect(n3Autorise({ MEMORYAI_N3_CHAT: "0" })).toBe(false);
    expect(n3Autorise({ MEMORYAI_N3_CHAT: "true" })).toBe(false);
    expect(n3Autorise({})).toBe(false);
    // ⚠️ La bascule N2 n'ouvre PAS le N3 : deux variables, deux décisions.
    expect(n3Autorise({ MEMORYAI_N2_CHAT: "1" })).toBe(false);
  });
});

describe("le plafond reste monotone", () => {
  it("demander N3 sert AUSSI le niveau 2, même sans MEMORYAI_N2_CHAT", () => {
    // Le piège que ce cas garde : un plafond qui retomberait à 1 parce que la bascule N2
    // manque, alors que la PLUS large des deux est accordée.
    const p = politique({ inclureN3: true, n3Autorise: true });
    expect(niveauMaxServi(p)).toBe(3);
    expect(sortDeLaPiece(papier(2), p)).toBe("complete");
  });

  it("chaque niveau sort dès que le plafond l'atteint", () => {
    const n3 = politique({ inclureN3: true, n3Autorise: true });
    for (const n of [0, 1, 2, 3]) expect(sortDeLaPiece(papier(n), n3)).toBe("complete");
  });
});

describe("le défaut est fermé", () => {
  it("sans rien demander, un papier d'identité reste un sommaire", () => {
    expect(sortDeLaPiece(papier(3), politique())).toBe("sommaire");
  });

  it("la bascule N2 seule ne suffit pas pour un papier d'identité", () => {
    const p = politique({ inclureN2: true, n2Autorise: true });
    expect(niveauMaxServi(p)).toBe(2);
    expect(sortDeLaPiece(papier(3), p)).toBe("sommaire");
    // …et elle n'a pas non plus ouvert le N2 par accident : elle DOIT l'ouvrir.
    expect(sortDeLaPiece(papier(2), p)).toBe("complete");
  });

  it("un papier supprimé ou inactif ne sort pas, même au plafond 3", () => {
    const p = politique({ inclureN3: true, n3Autorise: true });
    expect(sortDeLaPiece({ niveau: 3, statut: "active", supprimeLe: new Date() } as unknown as Piece, p)).toBe("retenue");
    expect(sortDeLaPiece({ niveau: 3, statut: "oubliee", supprimeLe: null } as unknown as Piece, p)).toBe("retenue");
  });
});

describe("niveauServi — ce que le journal d'accès note d'un papier", () => {
  it("un papier N3 servi en SOMMAIRE n'est pas noté niveau 3", () => {
    expect(niveauServi(3, "sommaire")).toBeLessThan(3);
  });

  it("un papier N3 servi COMPLET est noté niveau 3", () => {
    expect(niveauServi(3, "complete")).toBe(3);
  });

  it("ne remonte jamais un niveau : un sommaire plus bas garde le sien", () => {
    expect(niveauServi(1, "sommaire")).toBe(1);
    expect(niveauServi(0, "sommaire")).toBe(0);
    expect(niveauServi(2, "complete")).toBe(2);
  });

  it("suit sortDeLaPiece : sommaire sous politique fermée, complet sous N3 ouvert", () => {
    const ferme = politique();
    const ouvert = politique({ inclureN3: true, n3Autorise: true });
    expect(niveauServi(3, sortDeLaPiece(papier(3), ferme) as "complete" | "sommaire")).toBeLessThan(3);
    expect(niveauServi(3, sortDeLaPiece(papier(3), ouvert) as "complete" | "sommaire")).toBe(3);
  });
});
