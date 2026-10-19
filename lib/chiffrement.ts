// lib/chiffrement.ts — AES-256-GCM applicatif des faits N1+, et l'empreinte keyée.
//
// ── POURQUOI L'AAD EST `id|niveau` (ADR 0001 §3) ────────────────────────────────────────
// GCM authentifie des données ASSOCIÉES en plus de chiffrer : si l'on rétrograde un fait
// N2 en N0 « pour le lire », le déchiffrement échoue — la valeur est liée au niveau sous
// lequel elle a été écrite. C'est la seule garde qui tient contre un UPDATE direct en base.
//
// ── LA CLÉ ───────────────────────────────────────────────────────────────────────────────
// `MEMORYAI_CHIFFREMENT`, 32 octets en base64, en variable d'environnement Vercel. Jamais
// en base, jamais dans un commit. Absente ⇒ `ClefAbsenteError`, que les routes rendent en
// 503 fermé : rien de lisible, rien d'écrit. La retirer EST un kill-switch.
//
// ── L'EMPREINTE ─────────────────────────────────────────────────────────────────────────
// `empreinte(cle, ...parties)` = HMAC-SHA256, pour les clés d'idempotence et d'oubli. Un
// SHA-256 nu d'une valeur courte (une date, un employeur) se brute-force en secondes ; un
// HMAC sans la clé, non. La clé d'empreinte est DÉRIVÉE de la clé de chiffrement (HKDF),
// jamais la même : deux usages, deux clés.
//
// Module PUR : la clé est un paramètre, `process.env` n'est lu que par `cleDepuisEnv`.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export class ClefAbsenteError extends Error {
  constructor() {
    super("MEMORYAI_CHIFFREMENT absente ou invalide : rien n'est lisible ni écrit.");
    this.name = "ClefAbsenteError";
  }
}

export class DechiffrementError extends Error {
  constructor(id: string) {
    super(`Déchiffrement impossible pour le fait ${id} : clé, AAD (niveau) ou données altérés.`);
    this.name = "DechiffrementError";
  }
}

export interface Cle {
  chiffrement: Buffer;
  empreinte: Buffer;
}

const VERSION = "v1";
/**
 * Longueur du tag GCM, en octets — celle que produit `getAuthTag()`. Elle est IMPOSÉE au
 * déchiffrement : sans `authTagLength`, Node accepte un tag TRONQUÉ (mesuré le 23/09/2026 sur
 * Node 24.21 : les 4 premiers octets d'un vrai tag suffisent à déchiffrer). Un tag de 4 octets se
 * devine en ~2³² essais, ce qui ouvre la falsification d'un scellé. Signalé par Semgrep
 * (gcm-no-tag-length) à la mise en place des portes S6.
 */
const LONGUEUR_TAG = 16;
/** Séparateur des parties d'une empreinte : un octet nul, qu'aucune valeur textuelle ne porte. */
const SEPARATEUR = String.fromCharCode(0);

/** Dérive les deux clés d'usage depuis la clé maîtresse (32 octets en base64). */
export function deriverCle(base64: string | undefined): Cle {
  const brute = base64?.trim() ? Buffer.from(base64.trim(), "base64") : Buffer.alloc(0);
  if (brute.length !== 32) throw new ClefAbsenteError();
  return {
    chiffrement: Buffer.from(hkdfSync("sha256", brute, "memoryai", "chiffrement-faits", 32)),
    empreinte: Buffer.from(hkdfSync("sha256", brute, "memoryai", "empreinte", 32)),
  };
}

export function cleDepuisEnv(env: Record<string, string | undefined> = process.env): Cle {
  return deriverCle(env.MEMORYAI_CHIFFREMENT);
}

function aad(id: string, niveau: number): Buffer {
  return Buffer.from(`${id}|${niveau}`, "utf8");
}

/** Chiffre une valeur pour le fait `id` au niveau `niveau`. Nonce frais à chaque appel. */
export function chiffrer(cle: Cle, valeur: string, id: string, niveau: number): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cle.chiffrement, nonce, { authTagLength: LONGUEUR_TAG });
  cipher.setAAD(aad(id, niveau));
  const chiffre = Buffer.concat([cipher.update(valeur, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce.toString("base64"), tag.toString("base64"), chiffre.toString("base64")].join(":");
}

/** Déchiffre. Échoue si la clé, l'`id`, le `niveau` ou les octets ne sont pas ceux de l'écriture. */
export function dechiffrer(cle: Cle, scelle: string, id: string, niveau: number): string {
  const parties = scelle.split(":");
  if (parties.length !== 4 || parties[0] !== VERSION) throw new DechiffrementError(id);
  const [, nonceB64, tagB64, chiffreB64] = parties as [string, string, string, string];
  try {
    const decipher = createDecipheriv("aes-256-gcm", cle.chiffrement, Buffer.from(nonceB64, "base64"), {
      authTagLength: LONGUEUR_TAG,
    });
    decipher.setAAD(aad(id, niveau));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(chiffreB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new DechiffrementError(id);
  }
}

/**
 * HMAC-SHA256 keyé des parties, jointes par un séparateur qu'aucune partie ne peut contenir.
 * Sert aux clés d'idempotence et d'oubli.
 */
export function empreinte(cle: Cle, ...parties: string[]): string {
  return createHmac("sha256", cle.empreinte).update(parties.join(SEPARATEUR), "utf8").digest("hex");
}
