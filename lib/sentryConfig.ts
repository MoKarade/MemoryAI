// lib/sentryConfig.ts — réglages Sentry du serveur et du script d'essai (tâche MemoryAI n° 127).
//
// Pur et sans effet de bord : ne lit aucun environnement, ne démarre rien. Le DSN arrive en
// paramètre, et SANS DSN Sentry reste éteint (le build et la CI n'ont besoin d'aucune variable).
// Aucun import : le script d'essai le lit directement (Node 24 retire les types).
//
// ══ POURQUOI C'EST PLUS STRICT QUE LE MODÈLE D'APP-TEMPLATE ═══════════════════════════════════
//
// MemoryAI est la mémoire de Marc : ses messages d'erreur peuvent porter une donnée personnelle.
// Une erreur de base Drizzle recopie la requête ET ses paramètres dans son message ; une erreur
// de validation peut citer la valeur refusée. App-template ne retire que la requête et
// l'utilisateur ; ici le MESSAGE de l'exception, les fils d'Ariane (console, requêtes), les
// données libres (`extra`) et le chemin de requête partent aussi. Il reste le type de l'erreur,
// la pile et l'adresse de la page : de quoi trouver la ligne, jamais de quoi apprendre un fait.
// Verrou : `tests/sentryConfig.test.ts`.
//
// ⚠️ Côté SERVEUR seulement. La CSP de l'app (`connect-src 'self'`) interdit déjà au navigateur
// d'écrire vers un domaine tiers ; brancher Sentry côté navigateur voudrait dire desserrer une
// règle de sécurité, une décision de Marc, pas un détail de cette tâche.

/** Le sous-ensemble d'un événement Sentry que l'on nettoie (types structurels, aucun import). */
export interface EvenementNettoyable {
  message?: string;
  logentry?: unknown;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: unknown;
  extra?: unknown;
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    query_string?: unknown;
  };
  user?: unknown;
}

/** Ce qui remplace le message d'une exception : on voit qu'il y en avait un, jamais son texte. */
export const MESSAGE_RETIRE = "[message retiré]";

/** Retire tout ce qui peut identifier une personne ou porter un fait ; garde le type et la pile. */
export function retirerDonneesPersonnelles<T extends EvenementNettoyable>(evenement: T): T {
  if (evenement.request) {
    delete evenement.request.data;
    delete evenement.request.cookies;
    delete evenement.request.headers;
    delete evenement.request.query_string;
  }
  delete evenement.user;
  delete evenement.breadcrumbs;
  delete evenement.extra;
  delete evenement.logentry;
  if (evenement.message !== undefined) evenement.message = MESSAGE_RETIRE;
  for (const e of evenement.exception?.values ?? []) {
    if (e.value !== undefined) e.value = MESSAGE_RETIRE;
  }
  return evenement;
}

export interface OptionsSentry {
  dsn: string | undefined;
  enabled: boolean;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  maxBreadcrumbs: 0;
  beforeSend: typeof retirerDonneesPersonnelles;
}

/**
 * Options de `Sentry.init`. `dsn` vide ou absent = éteint : aucun événement ne part.
 * Pas de traces de performance (`tracesSampleRate` à 0) : le besoin est de voir les ERREURS.
 * Pas de fils d'Ariane (`maxBreadcrumbs` à 0) : ils recopient ce que l'app écrit dans la console.
 */
export function optionsSentry(dsn: string | undefined): OptionsSentry {
  const propre = dsn?.trim() ? dsn.trim() : undefined;
  return {
    dsn: propre,
    enabled: propre !== undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend: retirerDonneesPersonnelles,
  };
}
