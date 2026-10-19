// lib/journal.ts — le journal d'accès, chaîné par HMAC (ADR 0001 §3, menace n° 5).
//
// Chaque entrée signe la précédente : `hmac = HMAC(cle, hmac_precedent | ... | question)`.
// Supprimer ou modifier une ligne casse toutes les suivantes ; `verifierChaine` le dit. La
// clé est `MEMORYAI_JOURNAL_CLE`, DISTINCTE de la clé de chiffrement — un journal ne doit pas
// tomber avec les données qu'il surveille.
//
// Fonctions PURES : l'écriture en base vit chez l'appelant (lot 4, quand un lecteur existe).
// Aucun outil MCP ne sert ce journal au modèle.
//
// ── ADR 0014 : le corpus est VERSIONNÉ, l'historique n'est JAMAIS retouché ─────────────────
//
// Revue #72 : le journal ne consignait que les FAITS servis, jamais les PAPIERS lus par le
// chat. Ajouter `idsPieces` change ce que CHAQUE FUTURE entrée signe — mais les entrées DÉJÀ
// écrites ont été signées avec l'ancien corpus (v1), sans ce champ. Deux mauvaises réponses,
// écartées (ADR 0014 §1) : ignorer le problème (casse `verifierChaine` sur tout l'historique
// dès ce déploiement) ou retrosigner l'historique (manipuler un journal tamper-evident, le
// geste qu'il existe pour repérer chez un tiers).
//
// La réponse retenue : chaque entrée porte un `version`. `signer()` calcule un corpus
// DIFFÉRENT selon la version — la v1 est EXACTEMENT celle d'avant cet ADR, gelée pour
// toujours (`tests/journal.test.ts` la fige par un hmac ATTENDU, calculé une fois avec le
// code d'avant) ; la v2 ajoute `idsPieces`, ET porte `version` en clair comme premier champ
// PROPRE à l'entrée (juste après le lien de chaîne `precedent`) — pas seulement une longueur
// de corpus différente, une hygiène de séparation de domaine qui ne dépend d'aucun détail de
// sérialisation futur (revue pole-securite, 29/09). Précédent direct : le plan
// `auth-asym-hubperso` §5 phase 4 fait la même chose pour une rotation de clé — deux formats
// qui coexistent, l'ancien jamais retouché.
//
// `verifierChaine` impose en plus un invariant MONOTONE : la version d'une entrée ne peut
// jamais être INFÉRIEURE à celle de la précédente dans la chaîne. Sans cette règle, une base
// compromise ou un bug pourrait produire une chaîne v2→v1 dont CHAQUE hmac est pourtant
// individuellement valide (chacun signé avec le bon corpus pour sa version) — la régression
// ne serait détectée nulle part (revue pole-securite, 29/09).

import { createHmac, timingSafeEqual } from "node:crypto";

/** v1 : le corpus d'avant l'ADR 0014, gelé. v2 : v1 + `idsPieces` (revue #72). */
export type VersionEntree = 1 | 2;

/** Ce que `journaliserAcces` écrit pour toute NOUVELLE entrée, depuis l'ADR 0014. */
export const VERSION_JOURNAL_ACTUELLE: VersionEntree = 2;

export interface EntreeASigner {
  version: VersionEntree;
  ts: string;
  lecteur: string;
  outil: string;
  usage: "conversation" | "action";
  niveauMaxServi: number;
  idsFaits: string[];
  /**
   * SEULEMENT en v2 — absente (ou ignorée) en v1, qui ne consignait pas les papiers. Une v2
   * sans papier lu signe `idsPieces: []`, jamais un champ omis : `JSON.stringify(undefined)`
   * et `JSON.stringify([])` ne sont PAS les mêmes octets, et le corpus doit rester déterministe.
   */
  idsPieces?: string[];
  questionEmpreinte: string | null;
}

export interface EntreeSignee extends EntreeASigner {
  hmacPrecedent: string | null;
  hmac: string;
}

export class ClefJournalAbsenteError extends Error {
  constructor() {
    super("MEMORYAI_JOURNAL_CLE absente : aucun accès ne peut être journalisé, donc servi.");
    this.name = "ClefJournalAbsenteError";
  }
}

const SEPARATEUR = String.fromCharCode(0);

export function cleJournalDepuisEnv(env: Record<string, string | undefined> = process.env): Buffer {
  const v = env.MEMORYAI_JOURNAL_CLE?.trim();
  if (!v || v.length < 32) throw new ClefJournalAbsenteError();
  return Buffer.from(v, "utf8");
}

/** Le corpus v1, EXACTEMENT celui d'avant l'ADR 0014 — ne JAMAIS y toucher. */
function champsV1(e: EntreeASigner): string[] {
  return [
    e.ts,
    e.lecteur,
    e.outil,
    e.usage,
    String(e.niveauMaxServi),
    JSON.stringify(e.idsFaits),
    e.questionEmpreinte ?? "",
  ];
}

/** Le corpus v2 : `version` en clair, puis les champs v1, puis `idsPieces` (ADR 0014). */
function champsV2(e: EntreeASigner): string[] {
  return ["2", ...champsV1(e), JSON.stringify(e.idsPieces ?? [])];
}

function signer(cle: Buffer, precedent: string | null, e: EntreeASigner): string {
  const champs = e.version === 2 ? champsV2(e) : champsV1(e);
  const corps = [precedent ?? "", ...champs].join(SEPARATEUR);
  return createHmac("sha256", cle).update(corps, "utf8").digest("hex");
}

/** Signe une entrée à la suite de `precedent` (le hmac de la dernière ligne, ou null au départ). */
export function signerEntree(cle: Buffer, precedent: string | null, e: EntreeASigner): EntreeSignee {
  return { ...e, hmacPrecedent: precedent, hmac: signer(cle, precedent, e) };
}

/**
 * Vérifie une chaîne dans l'ordre d'écriture. Rend l'index de la première entrée fautive,
 * ou -1 si tout tient. Comparaison en temps constant.
 */
export function verifierChaine(cle: Buffer, entrees: readonly EntreeSignee[]): number {
  let precedent: string | null = null;
  let versionPrecedente: VersionEntree = 1;
  for (let i = 0; i < entrees.length; i++) {
    const e = entrees[i]!;
    if (e.hmacPrecedent !== precedent) return i;
    // ADR 0014, revue pole-securite : la version ne redescend JAMAIS dans la chaîne. Vérifié
    // AVANT le hmac — un hmac individuellement valide ne rattrape pas une régression de version.
    if (e.version < versionPrecedente) return i;
    const attendu = Buffer.from(signer(cle, precedent, e), "hex");
    const recu = Buffer.from(e.hmac, "hex");
    if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return i;
    precedent = e.hmac;
    versionPrecedente = e.version;
  }
  return -1;
}
