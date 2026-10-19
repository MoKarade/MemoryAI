// lib/niveau.ts — le niveau d'un fait, dérivé par le CODE, jamais abaissé par un modèle.
//
// `niveau = MAX(niveau minimal du prédicat, niveau dérivé du dossier DriveAI du document,
// niveau dérivé du TYPE de document, niveau proposé par l'appelant)`. Un appelant peut
// monter un niveau, jamais le descendre — le brief §5 le dit et cette fonction est le seul
// endroit où ça se calcule (CLAUDE.md §1 : une garde n'existe qu'aux endroits qui la
// consultent ; il n'y en a qu'un).
//
// Les dossiers sont ceux de la taxonomie DriveAI (`CONFIG.DOMAINES`, 15/09/2026). Un dossier
// inconnu ne dérive RIEN (0) : c'est le prédicat qui porte alors le niveau.

import type { Niveau } from "./vocabulaire";

const PAR_DOSSIER: readonly { readonly prefixe: string; readonly niveau: Niveau }[] = [
  { prefixe: "04 · Immigration", niveau: 3 },
  { prefixe: "01 · Administratif & identité", niveau: 2 },
  { prefixe: "02 · Finances", niveau: 2 },
  { prefixe: "07 · Santé", niveau: 2 },
  { prefixe: "03 · Logement & véhicule", niveau: 1 },
  { prefixe: "05 · Carrière", niveau: 1 },
  { prefixe: "06 · Études & diplômes", niveau: 1 },
  { prefixe: "09 · Voyages", niveau: 1 },
  { prefixe: "08 · Perso & projets", niveau: 0 },
];

/** Types de documents qui sont N3 quel que soit le dossier : identité, immigration, fiscal. */
const TYPES_N3 = [
  /passeport/i,
  /permis de (conduire|travail|études?|séjour)/i,
  /carte (d'assurance|d’assurance) (maladie|sociale)/i,
  /assurance sociale|\bNAS\b/i,
  /certificat de (naissance|citoyenneté|sélection)/i,
  /citoyenneté|résidence permanente|résident permanent|\bCSQ\b|\bCAQ\b|\bEIMT\b|visa/i,
  /avis de cotisation|déclaration de revenus|\bT4\b|relevé 1|\bT1\b|\bTP-?1\b|impôt/i,
];

/**
 * Le dossier est-il RECONNU par la taxonomie ? Distinct de `niveauParDossier`, qui rend 0
 * aussi bien pour « 08 · Perso & projets » (reconnu, sans enjeu) que pour un dossier
 * inconnu (on ne sait rien). Les faits s'en passent — leur prédicat porte un plancher de
 * niveau. Les pièces, elles, n'ont aucun vocabulaire fermé pour les rattraper : sans ce
 * prédicat, une pièce d'origine inconnue tomberait au régime le moins protecteur par
 * DÉFAUT, et un défaut de configuration n'est pas une décision.
 */
export function dossierReconnu(dossier: string | null | undefined): boolean {
  if (!dossier) return false;
  const norm = dossier.normalize("NFC");
  return PAR_DOSSIER.some((d) => norm.startsWith(d.prefixe.normalize("NFC")));
}

export function niveauParDossier(dossier: string | null | undefined): Niveau {
  if (!dossier) return 0;
  const norm = dossier.normalize("NFC");
  return PAR_DOSSIER.find((d) => norm.startsWith(d.prefixe.normalize("NFC")))?.niveau ?? 0;
}

export function niveauParTypeDocument(type: string | null | undefined): Niveau {
  if (!type) return 0;
  return TYPES_N3.some((m) => m.test(type)) ? 3 : 0;
}

/** Le MAX de toutes les sources de niveau. Un appelant ne peut pas abaisser. */
export function niveauFinal(parts: {
  predicat: Niveau;
  dossier?: string | null;
  typeDocument?: string | null;
  propose?: number | null;
}): Niveau {
  const propose = Number.isInteger(parts.propose) ? Math.min(3, Math.max(0, parts.propose as number)) : 0;
  return Math.max(parts.predicat, niveauParDossier(parts.dossier), niveauParTypeDocument(parts.typeDocument), propose) as Niveau;
}
