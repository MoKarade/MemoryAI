// lib/autoValidation.ts — quels faits n'ont PAS besoin de l'œil de Marc (ADR 0003).
//
// L'ADR 0001 §5.1 posait « le statut est TOUJOURS `propose` : personne n'écrit un fait
// validé ». La règle avait un sens tant que tout fait venait d'un MODÈLE : ce qu'un LLM
// déduit se relit. Elle est devenue fausse le 2026-09-16, quand DriveAI a commencé à
// pousser un fait par document classé — 19 900 faits « ce document existe, voici son
// fileId », dérivés de l'Index par du CODE, sans un seul appel LLM. Les valider un par un
// n'apprend rien à personne, et une file de 19 000 est une liste morte : c'est exactement
// « le vrai risque du projet » que le CLAUDE.md nomme.
//
// ⚠️ LA RÈGLE PORTE SUR LA PROVENANCE, JAMAIS SUR LE CONTENU. On n'auto-valide pas « ce
// qui a l'air sûr » — on auto-valide ce qu'aucun modèle n'a touché. Un fait est mécanique
// quand son EXTRACTEUR est dans la liste fermée ci-dessous ET que son PRÉDICAT est celui
// qu'on attend de lui. Les deux, pas l'un ou l'autre : un extracteur qui se mettrait à
// pousser autre chose retomberait en `propose`, ce qui est le bon défaut.
//
// ⚠️ UN CANARI NE S'AUTO-VALIDE JAMAIS, quelle que soit sa provenance. `estCanari` marque
// une valeur qui ressemble à une consigne ; sur un `fileId` ça ne devrait pas arriver, et
// c'est précisément pour ça que le cas mérite un œil plutôt qu'un passe-droit. Une garde
// qui ne peut pas tirer n'est pas une protection — celle-ci le peut, et elle est testée.
//
// PURE : aucune base, aucun réseau, aucune horloge. C'est ce qui permet au test de la
// prendre en défaut sans rien monter, et au rattrapage de réutiliser EXACTEMENT la même
// décision que l'insertion (une seconde implémentation divergerait au premier extracteur
// ajouté).

import { STATUTS } from "./db/schema";

export type Statut = (typeof STATUTS)[number];

/**
 * Les couples (extracteur, prédicat) qu'aucun modèle ne produit. FERMÉ : ajouter une
 * entrée ici est une DÉCISION — elle retire une population entière de la file de Marc.
 */
export const COUPLES_MECANIQUES: readonly { extracteur: string; predicat: string }[] = [
  // DriveAI, ADR-0059 §3 point 2 : un fait par document classé, valeur = `fileId`. Tout se
  // lit dans l'Index et dans le NOM du fichier (`AAAA-MM-JJ_Type_Émetteur.ext`).
  { extracteur: "moteur-inventaire-v1", predicat: "document.existe" },
];

export interface SourceDecision {
  readonly predicat: string;
  readonly canari: boolean;
  readonly provenance: { readonly extracteur: string };
}

/** Ce fait vient-il d'un mécanisme, et pas d'un modèle ? */
export function estMecanique(fait: SourceDecision): boolean {
  if (fait.canari) return false;
  return COUPLES_MECANIQUES.some(
    (c) => c.extracteur === fait.provenance.extracteur && c.predicat === fait.predicat,
  );
}

/**
 * Le statut à l'insertion. `valide` pour un fait mécanique, `propose` pour tout le reste —
 * et « tout le reste » inclut ce dont on n'est pas sûr, par construction.
 */
export function statutInitial(fait: SourceDecision): Statut {
  return estMecanique(fait) ? "valide" : "propose";
}
