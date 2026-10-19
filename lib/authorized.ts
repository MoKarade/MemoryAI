// lib/authorized.ts
//
// Filtre d'accès de l'app : UNE SEULE adresse est admise, celle du propriétaire. Dans les
// autres apps de l'écosystème cette fonction n'est que le PREMIER étage (le second étant la
// liste d'invités tenue par le hub) ; ici c'est le seul, par décision — MemoryAI n'a pas
// d'invités (ADR 0001 §3). La valeur autorisée vient de AUTHORIZED_EMAIL, jamais en dur.
// Fonction PURE, sans lecture d'environnement, pour être testable directement.

/**
 * true seulement si `email` correspond à `authorized` (trim + lower-case).
 * Toute valeur absente/vide, côté candidat OU côté allowlist → refus : on ne laisse
 * JAMAIS passer quand l'allowlist n'est pas configurée (fail-closed).
 */
export function isAuthorizedEmail(
  email: string | null | undefined,
  authorized: string | null | undefined,
): boolean {
  const normalize = (value: string | null | undefined): string =>
    (value ?? "").trim().toLowerCase();

  const candidate = normalize(email);
  const allowed = normalize(authorized);

  if (!candidate || !allowed) return false;
  return candidate === allowed;
}
