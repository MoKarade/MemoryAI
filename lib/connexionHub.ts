// lib/connexionHub.ts — où envoyer quelqu'un qui n'a pas de session.
//
// MemoryAI ne parle pas à Google (ADR 0001 de Hubperso) : elle LIT la session que le hub a
// posée sur `.hubperso.com`. Quand il n'y en a pas, elle renvoie au hub, porte d'entrée
// unique de l'écosystème. Porté de `carai/lib/connexionHub.ts`.

/** Le hub. Surchargeable pour un déploiement de test, jamais écrit en dur ailleurs. */
export const URL_HUB = process.env.NEXT_PUBLIC_HUB_URL?.trim() || "https://hubperso.com";

/**
 * Le chemin interne demandé, ou `/` si on ne peut pas lui faire confiance.
 *
 * ⚠️ On n'accepte QUE des chemins internes. Une URL absolue venue de l'extérieur ferait de
 * MemoryAI un tremplin : `?retour=https://evil.com` renverrait la personne sur un site
 * tiers APRÈS une connexion réussie, donc en confiance. Et `//evil.com` ressemble à un
 * chemin sans en être un — le navigateur y voit une autre origine.
 */
export function cheminInterne(retour: string | null | undefined): string {
  const valeur = retour?.trim();
  if (!valeur) return "/";
  if (!valeur.startsWith("/") || valeur.startsWith("//")) return "/";
  return valeur;
}

/**
 * L'URL de connexion du hub, avec de quoi revenir ici ensuite.
 *
 * `origine` est l'origine de CETTE app telle que la requête l'a vue — pas une constante :
 * l'app répond sur son domaine ET en local. Le hub valide cette destination de son côté
 * (`lib/retour.ts` chez lui) : il n'accepte que les sous-domaines de `hubperso.com`.
 */
export function urlConnexionHub(origine: string, retour: string | null | undefined): string {
  const url = new URL("/login", URL_HUB);
  url.searchParams.set("callbackUrl", new URL(cheminInterne(retour), origine).toString());
  return url.toString();
}
