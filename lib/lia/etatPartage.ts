// lib/lia/etatPartage.ts — l'état PARTAGÉ de LIA (contrat `commun/assistant/CONTRAT-etat-lia.md`) :
// ce qui fait d'elle UNE seule LIA, quel que soit l'hôte. PUR : la lecture du corps, la séparation
// de la discussion et la relecture de la ligne gardée ; l'I/O vit dans `depotEtat.ts`, les routes
// dans `app/api/…`.
//
// Une seule définition des bornes : `validerEtat` du paquet épinglé (lia-ui ≥ v0.39.0 pour la
// discussion), le même que LIA applique à ce que l'hôte lui rend. Il retire les clés inconnues, les
// faits hors verbe, la mémoire lente et le monde intérieur hors bornes ; un champ obligatoire faux
// refuse tout. Le JSON de l'état ne porte aucun contenu de Marc : des nombres, des verbes de LIA et
// un nom d'humeur. La DISCUSSION (du texte de Marc, ADR 0030) en est retirée avant l'écriture, rangée
// à part et chiffrée par `depotEtat.ts`, puis remise à la lecture : elle repasse alors par
// `validerEtat`, donc par les mêmes bornes, jamais recopiées ici.

import { validerEtat, type DiscussionPartagee, type EtatLia } from "@mokarade/lia-ui";

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

/** L'état SANS sa discussion (ce que le JSON de la base garde) et la discussion à ranger à part, chiffrée. PURE. */
export function separerDiscussion(etat: EtatPartage): { sansDiscussion: EtatPartage; discussion: DiscussionPartagee | null } {
  const { discussion, ...sansDiscussion } = etat;
  return { sansDiscussion, discussion: discussion ?? null };
}

/**
 * Ce que la base garde déjà est-il relu tel quel ? Une ligne abîmée n'est jamais rendue : `null`.
 * La discussion, déchiffrée par l'appelant, est remise dans l'état AVANT `validerEtat` : ses bornes
 * sont celles du paquet. Une clé `discussion` qui traînerait dans le JSON gardé est ignorée.
 */
export function relireEtat(garde: unknown, discussion?: unknown): EtatPartage | null {
  if (typeof garde !== "object" || garde === null) return null;
  const base: Record<string, unknown> = { ...(garde as Record<string, unknown>) };
  delete base.discussion;
  if (discussion !== undefined) base.discussion = discussion;
  return validerEtat(base);
}
