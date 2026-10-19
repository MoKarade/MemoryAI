// lib/sessionAsymetrique.ts
//
// Lecture du NOUVEAU cookie de session (JWS ES256), plan `auth-asym-hubperso`, phase 1
// (« accepter les deux »). Hubperso ne l'émet pas encore : en production, cette fonction
// rend systématiquement `null` tant que la phase 2 n'a pas basculé — additif seulement.
// `lib/session.ts` et `middleware.ts` retombent sur l'ancien cookie (Auth.js, JWE) si
// elle rend `null`, pour QUELQUE raison que ce soit : cookie absent, signature invalide,
// algorithme différent d'ES256 (confusion `none`/HS256), expiré, ou email hors accès.
// L'ancien chemin n'est pas touché ici (§8bis du plan).
//
// La vérification cryptographique est déléguée à `@mokarade/hub-contract/session`
// (`verifierSession`) : ce satellite n'importe AUCUNE fonction de signature ni clé
// privée, il ne peut donc pas fabriquer de session par construction. C'est le module
// partagé recommandé par pole-securite (plan §9.2) plutôt qu'une copie par app.

import { verifierSession } from "@mokarade/hub-contract/session";
import { isAuthorizedEmail } from "@/lib/authorized";

/** Nom fixé par le hub (plan §3) — identique dans les 5 apps de l'écosystème. */
export const NOM_COOKIE_SESSION_HUB = "__Secure-hub.session";

type Env = Record<string, string | undefined>;

/**
 * Les clés publiques publiées par le hub (JWKS), lues depuis l'environnement — JAMAIS
 * en dur dans le code. `undefined` si absentes ou illisibles : `verifierSession` rend
 * alors `null` sans lever, ce qui suffit à fermer cette branche (fail-closed).
 */
function clesPubliquesDepuisEnv(env: Env): unknown {
  const brut = env.HUB_SESSION_PUBLIC_KEYS?.trim();
  if (!brut) return undefined;
  try {
    return JSON.parse(brut);
  } catch {
    return undefined;
  }
}

/**
 * Vérifie le nouveau cookie et rend l'identité SI le hub l'a signée (algorithme,
 * émetteur, expiration — tout est vérifié par `verifierSession`) ET que l'adresse est
 * celle du propriétaire de cette app. `null` pour toute autre raison.
 */
export async function identiteNouveauCookie(
  cookieValue: string | undefined,
  env: Env = process.env,
): Promise<{ email: string } | null> {
  if (!cookieValue) return null;
  const identite = await verifierSession(cookieValue, clesPubliquesDepuisEnv(env));
  if (!identite) return null;
  if (!isAuthorizedEmail(identite.email, env.AUTHORIZED_EMAIL)) return null;
  return { email: identite.email };
}
