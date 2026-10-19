// lib/jetons.ts — qui écrit, et avec quel plafond de fiabilité (ADR 0001 §3).
//
// Un jeton = une app = un rôle = un périmètre. Le jeton vit dans une variable
// `MEMORYAI_TOKEN_<APP>_<ROLE>` (ex. `MEMORYAI_TOKEN_DRIVEAI_ECRITURE`) ; l'app et le rôle
// sont donc DÉDUITS du nom de la variable qui a reconnu le jeton, jamais lus dans la
// requête. Comparaison en temps constant sur TOUTES les variables candidates, même après
// une correspondance, pour que la durée ne dise pas laquelle a matché.
//
// Jeton inconnu ⇒ `null` — pas un message qui dit s'il est absent, mal formé ou faux.
//
// La fiabilité est un PLAFOND par écrivain : ce qu'il peut déclarer, au plus. `validerFait`
// prend la première comme défaut et refuse tout ce qui n'est pas dans la liste.

import { createHash, timingSafeEqual } from "node:crypto";
import type { Fiabilite } from "./validerFait";

export type Role = "lecture" | "ecriture";

export interface Ecrivain {
  appId: string;
  role: Role;
  fiabilites: readonly Fiabilite[];
}

/** Ce que chaque app peut déclarer. Une app absente d'ici n'a que `app`. */
const FIABILITES_PAR_APP: Readonly<Record<string, readonly Fiabilite[]>> = {
  // DriveAI extrait de documents (officiels ou tiers) et de mails. Le défaut est le PLUS
  // PRUDENT : un document n'est officiel que si l'extracteur le dit.
  driveai: ["document-tiers", "document-officiel", "mail-tiers"],
  // Le seed de la session de démarrage (lot 6), relu par Marc avant envoi.
  seed: ["seed"],
};
const FIABILITE_APP: readonly Fiabilite[] = ["app"];

export const LONGUEUR_MIN_JETON = 16;
const PREFIXE = "MEMORYAI_TOKEN_";
const NOM_VARIABLE = /^MEMORYAI_TOKEN_([A-Z0-9]+)_(ECRITURE|LECTURE)$/;

function egal(a: string, b: string): boolean {
  // Les deux sont hachés à longueur fixe : la comparaison ne dépend ni de la longueur ni
  // du contenu du jeton reçu.
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Extrait le jeton d'un en-tête `Authorization: Bearer …`. */
export function jetonDepuisEntete(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  return m ? m[1]! : null;
}

/**
 * Reconnaît l'écrivain derrière un jeton. `null` si personne — et rien de plus.
 * Un jeton de moins de 16 caractères n'est jamais accepté, quelle que soit la variable.
 */
export function identifierEcrivain(
  jeton: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Ecrivain | null {
  if (!jeton || jeton.length < LONGUEUR_MIN_JETON) return null;
  let trouve: Ecrivain | null = null;
  for (const [nom, valeur] of Object.entries(env)) {
    if (!nom.startsWith(PREFIXE)) continue;
    const m = NOM_VARIABLE.exec(nom);
    const attendu = valeur?.trim() ?? "";
    // On compare TOUJOURS, même si la variable est mal nommée ou vide, pour que la durée
    // ne révèle rien ; on ne retient que ce qui est bien nommé et non vide.
    const ok = egal(attendu, jeton) && attendu.length >= LONGUEUR_MIN_JETON;
    if (ok && m && !trouve) {
      const appId = m[1]!.toLowerCase();
      trouve = {
        appId,
        role: m[2] === "ECRITURE" ? "ecriture" : "lecture",
        fiabilites: FIABILITES_PAR_APP[appId] ?? FIABILITE_APP,
      };
    }
  }
  return trouve;
}

/**
 * LE refus des routes à jeton (ADR 0015 §2.3). UNE seule définition, pour que la réponse soit
 * IDENTIQUE, code et corps, qu'il s'agisse :
 *   - d'un jeton absent, mal formé, faux ou trop court ;
 *   - d'un jeton valide dont le RÔLE ne convient pas (lecture sur une route d'écriture) ;
 *   - d'un jeton valide d'une APP qui n'est pas dans la liste de la route ;
 *   - d'une app dont Marc a retiré l'écriture (`perimetres.role = lecture`).
 *
 * ⚠️ Ni message, ni nom d'app : tout ce qui distinguerait ces cas apprendrait à un détenteur de
 * jeton ce que son jeton vaut. Une PANNE (503) reste distincte, mais seulement pour un écrivain
 * légitime : l'ordre des gardes (gel → identité/rôle/app → clé/base → corps) le garantit.
 */
export function refusJeton(): Response {
  return Response.json({ error: "non_autorise" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

/**
 * Identifie l'appelant ET vérifie qu'il a le droit d'entrer sur la route : rôle `ecriture`, et,
 * si la route en fixe une, une app de sa liste. `null` ⇒ la route rend `refusJeton()`, sans
 * distinguer pourquoi.
 */
export function ecrivainAutorise(
  authorization: string | null | undefined,
  apps?: ReadonlySet<string>,
  env: Record<string, string | undefined> = process.env,
): Ecrivain | null {
  const e = identifierEcrivain(jetonDepuisEntete(authorization), env);
  if (!e || e.role !== "ecriture") return null;
  if (apps && !apps.has(e.appId)) return null;
  return e;
}

/**
 * Les apps qui ont un jeton posé, déduites des NOMS de variables. PURE.
 *
 * ⚠️ AUCUNE VALEUR N'EST RENDUE, ni tronquée, ni hachée. La page `/apps` a besoin de savoir
 * QUI peut écrire, jamais avec quoi — et un jeton « juste les quatre premiers caractères »
 * est un jeton dont on vient de publier les quatre premiers caractères.
 *
 * Une variable vide ou trop courte ne compte pas : elle n'ouvrirait aucune porte, et
 * l'afficher ferait croire à un accès qui n'existe pas.
 */
export function appsConnues(env: Record<string, string | undefined> = process.env): { appId: string; role: Role }[] {
  const vues = new Map<string, { appId: string; role: Role }>();
  for (const [nom, valeur] of Object.entries(env)) {
    const m = NOM_VARIABLE.exec(nom);
    if (!m) continue;
    if ((valeur?.trim().length ?? 0) < LONGUEUR_MIN_JETON) continue;
    const appId = m[1]!.toLowerCase();
    const role: Role = m[2] === "ECRITURE" ? "ecriture" : "lecture";
    // L'écriture l'emporte sur la lecture : c'est le rôle le plus large que l'app détient.
    const deja = vues.get(appId);
    if (!deja || (deja.role === "lecture" && role === "ecriture")) vues.set(appId, { appId, role });
  }
  return [...vues.values()].sort((a, b) => a.appId.localeCompare(b.appId));
}
