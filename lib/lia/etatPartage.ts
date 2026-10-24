// lib/lia/etatPartage.ts — l'état PARTAGÉ de LIA (contrat `commun/assistant/CONTRAT-etat-lia.md`) :
// ce qui fait d'elle UNE seule LIA, quel que soit l'hôte. PUR : la lecture du corps et la relecture
// de la ligne gardée ; l'I/O vit dans `depotEtat.ts`, les routes dans `app/api/…`.
//
// Une seule définition des bornes : `validerEtat` du paquet épinglé (lia-ui ≥ v0.22.0), le même
// que LIA applique à ce que l'hôte lui rend. Il retire les clés inconnues, les faits hors verbe, la
// mémoire lente et le monde intérieur hors bornes ; un champ obligatoire faux refuse tout. Aucun
// contenu de Marc : des nombres, des verbes de LIA et un nom d'humeur.

import { validerEtat, type EtatLia } from "@mokarade/lia-ui";

export type EtatPartage = EtatLia;

/** Au-delà, 413 avant même de lire le JSON (contrat : 16 Ko). */
export const TAILLE_MAX_ETAT = 16 * 1024;

export type LectureEtat =
  | { ok: true; etat: EtatPartage }
  | { ok: false; status: 400 | 413; code: string; message: string };

/** Lit le corps BRUT d'un PUT. Le refus ne cite jamais une valeur. */
export function lireEtat(brut: string): LectureEtat {
  if (Buffer.byteLength(brut, "utf8") > TAILLE_MAX_ETAT) {
    return { ok: false, status: 413, code: "corps_trop_gros", message: `Corps au-delà de ${TAILLE_MAX_ETAT} octets.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "JSON attendu." };
  }
  const etat = validerEtat(json);
  return etat
    ? { ok: true, etat }
    : { ok: false, status: 400, code: "corps_invalide", message: "État de LIA non conforme (contrat CONTRAT-etat-lia)." };
}

/** Ce que la base garde déjà est-il relu tel quel ? Une ligne abîmée n'est jamais rendue : `null`. */
export function relireEtat(garde: unknown): EtatPartage | null {
  return validerEtat(garde);
}
