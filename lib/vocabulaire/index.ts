// lib/vocabulaire/index.ts — l'accès au vocabulaire, par version, et les refus STRUCTURELS.
//
// Deux listes, deux natures :
//  - le VOCABULAIRE dit ce qu'on accepte (fermé, versionné, extensible) ;
//  - les REFUS STRUCTURELS disent ce qu'on n'acceptera JAMAIS, quelle que soit la version :
//    position GPS, coordonnées, adresse d'un tiers, tout numéro d'identité (ADR 0001 §2).
//    `tests/vocabulaire.test.ts` échoue si une version les réintroduit.

import { VOCABULAIRE_V1, VERSION_VOCABULAIRE_V1, type DefinitionPredicat } from "./v1";

export type { DefinitionPredicat, Niveau, TypeValeur } from "./v1";

const VERSIONS: Readonly<Record<number, readonly DefinitionPredicat[]>> = {
  [VERSION_VOCABULAIRE_V1]: VOCABULAIRE_V1,
};

export const VERSION_COURANTE = VERSION_VOCABULAIRE_V1;

/** Motifs de prédicats refusés quelle que soit la version. Un test verrouille leur absence. */
export const REFUS_STRUCTURELS: readonly RegExp[] = [
  // ⚠️ ÉLARGI le 16/09, DANS LE MÊME LOT QUE LA QUARANTAINE (ADR 0004 §2.3), et il le fallait :
  // jusque-là `logement.position` n'était refusé que parce qu'il était HORS du vocabulaire
  // fermé. Ouvrir le vocabulaire retire ce filet — et cette liste, elle, ne connaissait
  // `position` qu'en TÊTE de prédicat. Une position GPS serait donc entrée, en quarantaine
  // certes, mais stockée, alors que l'ADR 0001 §2 la refuse POUR TOUJOURS. C'est la leçon
  // « rendre une fonction plus permissive DÉSARME les gardes aval » : après un
  // assouplissement, on relit ce qui reposait sur la sévérité d'avant.
  /(^|\.)positions?($|\.)/,
  /(^|\.)(lat|lon|latitude|longitude|gps|coordonnees?)($|\.)/,
  /adresse_tiers|tiers\.adresse/,
  /(^|\.)(nas|sin|numero|passeport\.numero|permis\.numero|carte\.numero)($|\.)/,
];

export function estRefuseStructurellement(predicat: string): boolean {
  return REFUS_STRUCTURELS.some((m) => m.test(predicat));
}

export function vocabulaire(version: number = VERSION_COURANTE): readonly DefinitionPredicat[] {
  return VERSIONS[version] ?? [];
}

export function definition(predicat: string, version: number = VERSION_COURANTE): DefinitionPredicat | null {
  return vocabulaire(version).find((p) => p.predicat === predicat) ?? null;
}

/** Les domaines du vocabulaire (pour les périmètres d'app). */
export function domaines(version: number = VERSION_COURANTE): readonly string[] {
  return [...new Set(vocabulaire(version).map((p) => p.domaine))];
}
