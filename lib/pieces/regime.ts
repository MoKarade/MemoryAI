// lib/pieces/regime.ts — ce qui reste EN CLAIR dans une pièce, et ce qui est chiffré.
//
// ── LA DÉCISION, ET QUI L'A PRISE ────────────────────────────────────────────────────────
// L'ADR 0004 promet deux choses incompatibles pour un même champ : les numéros « vivront
// chiffrés » (§2.1) et la recherche se fait en « plein texte français natif de Postgres »
// (§7) — or `to_tsvector` a besoin du texte EN CLAIR dans la base. Marc a tranché le 16/09 :
// DEUX RÉGIMES selon le niveau. Une pièce ordinaire porte son résumé en clair et devient
// cherchable en plein texte ; une pièce sensible (N3 : identité, immigration, fiscal) chiffre
// tout et ne se retrouve que par ses facettes.
//
// ⚠️ L'option écartée était « tout chiffré, plein texte après filtrage » (ma recommandation).
// Marc a préféré la vitesse de recherche sur le gros du corpus. Ce qui rendait son choix
// risqué est nommé ici et refermé : le régime NE PEUT PAS venir d'un modèle.
//
// ── TROIS VERROUS, ET CHACUN RÉPARE UN DÉFAUT PRÉCIS ─────────────────────────────────────
//  1. Le niveau est DÉRIVÉ PAR LE CODE (`lib/niveau.ts`), depuis le dossier DriveAI et le
//     type de document. Ce qu'un extracteur propose ne peut que le MONTER, jamais l'abaisser
//     — donc l'erreur d'un modèle rend une pièce PLUS protégée, jamais moins.
//  2. Un dossier INCONNU ⇒ régime chiffré. Sans ça, une pièce d'origine inconnue tomberait au
//     régime le moins protecteur par défaut, et un défaut de configuration n'est pas une
//     décision. `dossierReconnu` existe pour cette seule raison.
//  3. Le clair est IRRÉVERSIBLE : ce qui est écrit en clair l'est aussi dans toutes les
//     sauvegardes. D'où `doitReecrire` — une pièce qui MONTE en niveau après coup n'est pas
//     seulement re-marquée, son clair doit être effacé et réécrit chiffré. Sans lui, le
//     reclassement serait cosmétique.
//
// Module PUR : ni base, ni réseau, ni horloge, ni clé.

import { dossierReconnu, niveauFinal } from "../niveau";
import type { Niveau } from "../vocabulaire";

export interface EntreePiece {
  /** Le dossier DriveAI d'origine (`04 · Immigration`…). Absent ou inconnu ⇒ régime chiffré. */
  readonly domaine?: string | null;
  /** Le type de document tel qu'extrait (« avis de cotisation », « bail »…). */
  readonly type?: string | null;
  /** Ce que l'extracteur propose. Ne peut que MONTER le niveau. */
  readonly niveauPropose?: number | null;
}

export interface Regime {
  readonly niveau: Niveau;
  /**
   * Le RÉSUMÉ et les clés de recherche sont-ils écrits en clair ? Les facettes (type,
   * émetteur, année) ne sont PAS concernées : elles suivent le régime des faits, c'est-à-dire
   * chiffrées avec une clé de regroupement keyée — voir `lib/pieces/facettes.ts`.
   */
  readonly resumeEnClair: boolean;
  /** Pourquoi. Un régime se lit et s'audite ; un booléen nu ne s'explique pas en incident. */
  readonly raison: string;
}

/** Le seuil du régime chiffré. Écrit une fois. */
export const NIVEAU_CHIFFRE_INTEGRAL: Niveau = 3;

export function regimePiece(entree: EntreePiece): Regime {
  const niveau = niveauFinal({
    // Une pièce n'a pas de prédicat : rien ne lui donne de plancher, d'où le verrou n° 2.
    predicat: 0,
    dossier: entree.domaine,
    typeDocument: entree.type,
    propose: entree.niveauPropose,
  });

  if (!dossierReconnu(entree.domaine)) {
    return {
      niveau,
      resumeEnClair: false,
      raison: entree.domaine
        ? `dossier « ${entree.domaine} » hors taxonomie : on ne sait pas ce que la pièce contient, donc on chiffre`
        : "aucun dossier d'origine : on ne sait pas ce que la pièce contient, donc on chiffre",
    };
  }

  if (niveau >= NIVEAU_CHIFFRE_INTEGRAL) {
    return { niveau, resumeEnClair: false, raison: `niveau ${niveau} : identité, immigration ou fiscal` };
  }

  return { niveau, resumeEnClair: true, raison: `niveau ${niveau} dans un dossier connu` };
}

/**
 * Une pièce déjà écrite doit-elle être RÉÉCRITE parce que son régime a changé ?
 *
 * ⚠️ Le seul sens qui compte est clair → chiffré. L'inverse (chiffré → clair) ne se fait
 * JAMAIS automatiquement : rien n'oblige à déprotéger une pièce, et un reclassement à la
 * baisse produit par un modèle est exactement ce que le verrou n° 1 interdit.
 */
export function doitReecrire(ancien: { resumeEnClair: boolean }, nouveau: Regime): boolean {
  return ancien.resumeEnClair && !nouveau.resumeEnClair;
}
