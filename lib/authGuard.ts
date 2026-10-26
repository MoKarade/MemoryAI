// lib/authGuard.ts
//
// Logique de garde du middleware, isolée en fonctions PURES : testable sans mocker tout
// NextAuth, et surtout LISIBLE — c'est ici que se décide ce qui est public.
//
// ⚠️⚠️ LE PIÈGE N°1 DE CE TEMPLATE, vécu en production par JobAI (« le défaut n°1 du
// squelette du 27/07 ») : **`/hub/summary` DOIT rester public ici.** Il porte sa PROPRE
// authentification (le jeton `x-hub-token`, vérifié en temps constant dans le Route
// Handler). S'il tombe sous le garde de session utilisateur, le hub reçoit une
// REDIRECTION HTML vers la page de connexion au lieu du JSON attendu — et le widget
// affiche « injoignable » en permanence, sans que rien ne semble cassé côté app.
//
// Le symptôme est trompeur : l'app marche parfaitement dans un navigateur (tu es
// connecté), seul le hub voit le problème. Ne jamais retirer `/hub/summary` de
// `isPublicPath`, et ne jamais l'ajouter au matcher du middleware.

export type GuardDecision =
  | { type: "next" }
  | { type: "unauthorized" }
  | { type: "redirect"; location: string };

/**
 * Routes accessibles SANS session utilisateur. Doit rester aligné avec le matcher du
 * middleware — les deux listes disent la même chose, à deux endroits différents.
 */
/**
 * Les routes qui portent LEUR PROPRE authentification, une par une — jamais un préfixe :
 * une route ajoutée sous `/api/` demain doit tomber du côté GARDÉ par défaut.
 * Chacune dit ce qui la garde. `tests/auth.test.ts` compare cette liste au matcher.
 */
export const ROUTES_A_AUTH_PROPRE = [
  /** Le hub lit le summary avec `x-hub-token` (temps constant). Voir l'en-tête du fichier. */
  "/hub/summary",
  /** Contrat d'écriture des apps (ADR 0001 §5.1) : jeton d'écrivain (`lib/jetons.ts`). */
  "/api/faits",
  "/api/pieces",
  "/api/pieces/file",
  "/api/pieces/relecture",
  /**
   * Les COMPTES de la mémoire, pour une app qui l'alimente (23/09/2026). Jeton de LECTURE
   * suffisant : rien n'y écrit. Publie des nombres, jamais un fait ni un papier — c'est ce
   * qui permet à DriveAI de montrer « envoyé » À CÔTÉ de « validé » au lieu de laisser croire
   * que la seconde grandeur n'existe pas.
   */
  "/api/etat",
  /**
   * L'AVANCEMENT qu'une app publie (ADR 0009). Jeton d'ÉCRITURE : c'est une écriture. Des
   * comptes, jamais des faits — et l'app vient du jeton, jamais du corps.
   */
  "/api/avancement",
  /**
   * Claude Code pousse ses sessions (ADR 0002 §5.2). Même jeton d'écrivain, et une garde de
   * plus : seule l'app `claudecode` est acceptée ici — un jeton qui écrit des FAITS n'écrit
   * pas de conversation.
   */
  "/api/conversations",
  /**
   * Les exports Messenger que DriveAI relit (ADR 0020). Jeton d'écrivain de DriveAI SEULEMENT :
   * c'est lui qui tient le Drive ; aucune autre app n'écrit de messages.
   */
  "/api/evenements",
  /**
   * L'agenda du jour que DriveAI envoie (ADR 0029). Jeton d'écrivain de DriveAI SEULEMENT : c'est
   * lui qui tient l'accès Google ; un envoi remplace le jour, et rien d'autre que l'agenda n'entre.
   */
  "/api/agenda",
  /** Connecteur MCP : OAuth 2.1 (`lib/mcp/oauth.ts`), et rien d'autre. */
  "/api/mcp",
  /**
   * L'horloge de l'apprentissage (lot 16). Secret DÉDIÉ (`CRON_SECRET`), jamais un jeton
   * d'écrivain : ce qu'elle déclenche est une DÉPENSE et une écriture de masse, un pouvoir
   * qu'aucune app n'a de raison d'avoir — et qui se propagerait à chacune. 503 si le secret
   * manque côté serveur, 401 s'il est faux : la distinction EST le diagnostic.
   */
  "/api/cron/apprentissage",
  /**
   * LIA répond au hub, et par lui à toutes les apps (ADR 0016). `x-hub-token` seul, en temps
   * constant ; propriétaire seul (`proprietaire: true` dit par le hub), niveaux 0 et 1, outils
   * en lecture seule. 503 sans `HUB_TOKEN`, 401 jeton faux.
   */
  "/api/ask",
  /**
   * L'état PARTAGÉ de LIA, relayé par le hub (contrat `CONTRAT-etat-lia.md`). `x-hub-token`
   * seul, en temps constant, et `x-lia-proprietaire: 1` dit par le hub. Des nombres et des
   * verbes de LIA, jamais un fait. 503 sans `HUB_TOKEN`, 401 jeton faux, 403 sans propriétaire.
   */
  "/api/etat-lia",
  /**
   * Les demandes « Que peut-on changer ici ? » du hub (ADR 0021). Même porte que `/api/etat-lia` :
   * `x-hub-token` en temps constant et `x-lia-proprietaire: 1`. Contenu borné, sans texte libre,
   * jamais servi à un modèle. 503 sans `HUB_TOKEN`, 401 jeton faux, 403 sans propriétaire.
   */
  "/api/demandes",
  /**
   * Les quatre endpoints du flux OAuth et les deux de métadonnées. Publics par nécessité :
   * claude.ai les appelle AVANT d'avoir le moindre jeton. Ce qui les garde : PKCE S256,
   * `redirect_uri` sur allowlist, et la clé d'accès de Marc sur `/api/mcp/authorize`.
   * Aucun d'eux ne lit ni ne sert un fait.
   */
  "/api/mcp/authorize",
  "/api/mcp/token",
  "/api/mcp/register",
  "/api/mcp/meta/as",
  "/api/mcp/meta/pr",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
] as const;

export function isPublicPath(pathname: string): boolean {
  if ((ROUTES_A_AUTH_PROPRE as readonly string[]).includes(pathname)) return true;
  // La RFC 9728 autorise un suffixe de ressource derrière les métadonnées.
  if (pathname.startsWith("/.well-known/oauth-authorization-server/")) return true;
  if (pathname.startsWith("/.well-known/oauth-protected-resource/")) return true;

  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  ) {
    return true;
  }
  // Fichier avec extension (svg, png, css…) → asset public.
  const lastSegment = pathname.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

/**
 * Les pages destinées à être RENDUES DANS UNE IFRAME, une par une.
 *
 * ⚠️ CE N'EST PAS `isPublicPath`, ET LA DIFFÉRENCE EST TOUT LE POINT. Une route publique
 * porte sa propre authentification et SERT quelque chose sans session. `/widget` ne sert
 * RIEN sans session : sa page appelle `requireSession()` comme toutes les autres et lève.
 * Ce qui change ici est seulement le SORT DU REFUS — il reste sur place au lieu de partir
 * en redirection.
 *
 * Pourquoi : le refus d'un invité se décide au callback `jwt` (`auth.ts` rend `null` pour
 * toute adresse autre que le propriétaire), donc `isAuthenticated` est faux et la règle
 * ordinaire redirige vers `/login`, qui renvoie au hub — lequel porte `frame-ancestors
 * 'none'`. Dans un cadre, ça ne donne pas une page de connexion : ça donne un RECTANGLE
 * BLANC, sans erreur, sans explication. L'app hôte croirait la mémoire en panne.
 *
 * Ce que ça coûte, dit en clair : la sécurité de cette page repose entièrement sur son
 * `requireSession()`, puisque le middleware la laisse traverser. C'est tenable parce que
 * `tests/gardePages.test.ts` exige cet appel sur toute page, que `/widget` ne lit la base
 * qu'APRÈS lui, et que `tests/authGuard.test.ts` refuse qu'on allonge cette liste sans
 * l'écrire. Le matcher du middleware, lui, ne bouge PAS — on n'y touche jamais.
 */
export const ROUTES_CADREES = ["/widget"] as const;

/**
 * Décide du sort d'une requête. Une route publique OU authentifiée passe ; sinon 401
 * pour une route API (un client machine attend du JSON, pas une page de login), la page
 * elle-même pour une route cadrée (elle refusera lisiblement, dans le cadre), et une
 * redirection vers /login pour tout le reste.
 */
export function decideGuard(params: {
  isAuthenticated: boolean;
  pathname: string;
  search?: string;
}): GuardDecision {
  const { isAuthenticated, pathname, search = "" } = params;

  if (isPublicPath(pathname) || isAuthenticated) return { type: "next" };
  if (pathname.startsWith("/api/")) return { type: "unauthorized" };
  if ((ROUTES_CADREES as readonly string[]).includes(pathname)) return { type: "next" };

  const callbackUrl = encodeURIComponent(pathname + search);
  return { type: "redirect", location: `/login?callbackUrl=${callbackUrl}` };
}
