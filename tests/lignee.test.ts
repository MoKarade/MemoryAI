// tests/lignee.test.ts — ADR 0008 : ce qui autorise un extracteur à en remplacer un autre.
//
// ⚠️⚠️ POURQUOI CE FICHIER EXISTE. L'ADR 0006 avait fermé deux portes, à raison : « la
// meilleure confiance gagne » (un modèle s'AUTO-évalue) et « la plus récente gagne » (une
// re-lecture ratée détruirait une bonne extraction). Mais il avait fermé AVEC elles la seule
// question que la machine sait trancher : *qui l'a demandé ?*. Conséquence mesurée le
// 21/09/2026 sur le passeport de Marc — un papier lu sous un prompt plus pauvre garde son
// extraction À VIE, et la dette grandit à chaque amélioration du prompt.
//
// Ce que ces cas défendent, et qui n'est PAS ce qu'on croirait : le prédicat doit rester
// AVEUGLE à la confiance et à la date. Il ne lit que des noms, dans un ordre décidé par un
// humain. C'est cette cécité qui est la garantie.

import { describe, it, expect } from "vitest";
import { APP_INVENTAIRE, APPS_PIECES, LIGNEE_EXTRACTEURS, peutRemplacer, type AuteurPiece } from "../lib/pieces/lignee";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";

const V1 = "haiku-4.5-piece-v1";
const V2 = "haiku-4.5-piece-v2";
const V3 = "sonnet-5-vision-piece-v3";

/** Un papier (ou une lecture entrante) de DriveAI sous ce nom ; l'inventaire ; une autre app. */
const d = (extracteur: string): AuteurPiece => ({ app: "driveai", extracteur });
const INV: AuteurPiece = { app: APP_INVENTAIRE, extracteur: EXTRACTEUR_MIGRATION };
const autre = (extracteur: string): AuteurPiece => ({ app: "carai", extracteur });

describe("la lignée des extracteurs", () => {
  it("garde l'ADR 0006 §2 intact : un extracteur de modèle remplace l'inventaire", () => {
    expect(peutRemplacer(INV, d(V1))).toBe(true);
    // ⚠️ Y COMPRIS un nom que la lignée ne connaît pas. Restreindre ici casserait l'import le
    // jour où DriveAI change de modèle, et le symptôme serait « l'import n'avance plus »,
    // muet — exactement la panne que l'ADR 0006 existait pour corriger.
    expect(peutRemplacer(INV, d("un-modele-pas-encore-liste"))).toBe(true);
  });

  it("un rang STRICTEMENT supérieur remplace, et rien d'autre", () => {
    expect(peutRemplacer(d(V1), d(V2))).toBe(true);
    // L'ORDRE est la règle, pas le nom : c'est ce qu'on asserte, pour qu'un rang ajouté au
    // MILIEU de la lignée fasse tomber ce cas au lieu de réécrire le passé en silence.
    expect(LIGNEE_EXTRACTEURS.indexOf(V2)).toBeGreaterThan(LIGNEE_EXTRACTEURS.indexOf(V1));
  });

  it("ADR 0010 — la lecture de l'IMAGE remplace les lectures de texte, jamais l'inverse", () => {
    // Le rang 3 existe pour une seule raison : que les ~2 700 papiers déjà lus en v1/v2 puissent
    // être RELUS depuis leur image. Sans ce cas, retirer le nom de la lignée laisserait DriveAI
    // payer une lecture Sonnet par papier, et la Mémoire la rangerait en « déjà présente ».
    expect(peutRemplacer(d(V2), d(V3))).toBe(true);
    expect(peutRemplacer(d(V1), d(V3))).toBe(true);
    expect(peutRemplacer(INV, d(V3))).toBe(true);
    expect(peutRemplacer(d(V3), d(V2))).toBe(false);
    expect(LIGNEE_EXTRACTEURS[LIGNEE_EXTRACTEURS.length - 1]).toBe(V3);
  });

  it("NE REDESCEND JAMAIS, et ne se remplace pas lui-même", () => {
    expect(peutRemplacer(d(V1), d(EXTRACTEUR_MIGRATION))).toBe(false);
    expect(peutRemplacer(d(V1), d(V1))).toBe(false);
    expect(peutRemplacer(INV, d(EXTRACTEUR_MIGRATION))).toBe(false);
  });

  it("UNE VRAIE LECTURE N'EST JAMAIS ÉCRASÉE PAR UN NOM INCONNU", () => {
    // C'est la moitié qui protège : un producteur qui annoncerait « je suis la v9 » sans que
    // ce nom figure dans la lignée ne peut RIEN remplacer. Il ne s'auto-autorise pas.
    expect(peutRemplacer(d(V1), d("haiku-4.5-piece-v9"))).toBe(false);
    expect(peutRemplacer(d(V1), d("je-suis-meilleur"))).toBe(false);
  });

  it("la lignée est ORDONNÉE, sans doublon, et l'inventaire est son rang 0", () => {
    // L'ordre EST la règle : un nom ajouté ailleurs qu'en queue réécrirait le passé, et un
    // doublon rendrait le rang ambigu sans que rien ne lève.
    expect(LIGNEE_EXTRACTEURS[0]).toBe(EXTRACTEUR_MIGRATION);
    expect(new Set(LIGNEE_EXTRACTEURS).size).toBe(LIGNEE_EXTRACTEURS.length);
    expect(LIGNEE_EXTRACTEURS).toContain(V1);
  });

  it("le prédicat est AVEUGLE à tout ce qui n'est pas un nom", () => {
    // Anti-vacuité de la garde entière : `peutRemplacer` ne prend QUE deux auteurs (app du jeton
    // + nom). Si un lot futur lui passait une confiance ou une date, ce cas ne compilerait plus —
    // c'est `tsc` qui tient cette moitié, et le dire vaut mieux que de croire qu'un test la couvre.
    expect(peutRemplacer.length).toBe(2);
  });
});

describe("ADR 0015 — la lignée se lit dans l'app du JETON (INC-31)", () => {
  it("une AUTRE app ne remplace rien, même sous le nom du rang le plus haut", () => {
    expect(peutRemplacer(d(V1), autre(V3))).toBe(false);
    expect(peutRemplacer(INV, autre(V3))).toBe(false);
    expect(peutRemplacer(autre(V1), d(V3))).toBe(false);
  });

  it("seules les apps de APPS_PIECES écrivent, et l'inventaire n'y est pas", () => {
    expect([...APPS_PIECES]).toEqual(["driveai"]);
    expect(APPS_PIECES.has(APP_INVENTAIRE)).toBe(false);
    expect(peutRemplacer(INV, { app: APP_INVENTAIRE, extracteur: V1 })).toBe(false);
  });

  it("un papier SANS app (antérieur à la migration 0020) : inventaire par son nom, sinon intouchable", () => {
    expect(peutRemplacer({ app: null, extracteur: EXTRACTEUR_MIGRATION }, d(V1))).toBe(true);
    // Le côté sûr : tant que la migration 0021 ne l'a pas attribué, une vraie lecture sans app
    // ne se remplace pas — même par DriveAI.
    expect(peutRemplacer({ app: null, extracteur: V1 }, d(V3))).toBe(false);
  });

  it("une lecture entrante SANS app ne remplace jamais rien", () => {
    expect(peutRemplacer(INV, { app: null, extracteur: V1 })).toBe(false);
  });
});
