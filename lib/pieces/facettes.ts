// lib/pieces/facettes.ts — compter et filtrer des facettes CHIFFRÉES (ADR 0004 §7).
//
// L'ADR promet des facettes « avec le NOMBRE à côté de chacune ». Or `type` et `emetteur`
// DISENT quelque chose — « Immigration Canada » révèle un statut — donc ils sont chiffrés
// comme les attributs d'un fait. Un `GROUP BY` sur une colonne chiffrée ne compte rien :
// chaque valeur a son propre aléa, donc deux « Banque Aurore » sont deux groupes.
//
// D'où une CLÉ KEYÉE en clair à côté : `HMAC(clé d'empreinte, famille, valeur normalisée)`.
// C'est le patron `empreinte` déjà en place pour l'idempotence, appliqué au regroupement.
// Elle permet l'égalité et le comptage en SQL sans révéler la valeur ; on ne déchiffre qu'UN
// représentant par groupe pour l'afficher.
//
// ⚠️ CE QU'ELLE FUIT, dit une fois : la FRÉQUENCE. Qui lit la base voit que 40 pièces
// partagent un émetteur, jamais lequel. C'est le prix des facettes à compteurs, et il est
// assumé — un simple SHA-256 aurait fuité bien plus (le hash d'un nom d'émetteur se
// brute-force en secondes ; un HMAC sans la clé, non).
//
// ⚠️ LA NORMALISATION DÉCIDE DE CE QUI SE REGROUPE. Trop lâche, deux entités distinctes
// fusionnent ; trop stricte, « Banque Aurore » et « banque aurore  » font deux facettes et le
// compteur ment. Elle replie les espaces, retire les accents et la casse, et s'arrête là :
// elle ne tronque pas, ne retire pas les mots vides, ne rapproche pas « Fédération des
// caisses Aurore » de « Banque Aurore ». C'est le rôle de la LISTE DES VALEURS CONNUES
// servie au modèle (ADR §7) — sans elle il devine les noms et ne trouve rien.
//
// Module PUR : la clé est un paramètre.

import { empreinte, type Cle } from "../chiffrement";

/** Les familles de facettes qui portent une clé keyée. Fermée. */
export const FAMILLES_FACETTE = ["type", "emetteur", "titulaire"] as const;
export type FamilleFacette = (typeof FAMILLES_FACETTE)[number];

/**
 * La forme sous laquelle deux valeurs sont « la même ». Accents retirés, casse repliée,
 * espaces normalisés, ponctuation de bord retirée.
 */
export function normaliserFacette(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * La clé de regroupement d'une facette. La FAMILLE entre dans le HMAC : sans elle, un type
 * « banque aurore » et un émetteur « banque aurore » partageraient la même clé et se compteraient
 * ensemble.
 */
export function cleFacette(cle: Cle, famille: FamilleFacette, valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  const norme = normaliserFacette(valeur);
  return norme ? empreinte(cle, "facette", famille, norme) : null;
}
