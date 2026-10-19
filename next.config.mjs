/** @type {import('next').NextConfig} */

/**
 * CSP ENFORCÉE (pas Report-Only), sur le modèle du hub : MemoryAI ne charge AUCUNE
 * ressource externe côté navigateur — pas de police web, pas de script tiers, pas d'image
 * distante. Tout le réseau sortant (Anthropic, Neon) est SERVER-SIDE, et le server-side
 * n'est pas soumis à la CSP.
 *
 * `'unsafe-inline'` sur script-src et style-src : l'App Router injecte le script
 * d'hydratation et les styles en ligne. Même avec, la CSP bloque l'essentiel : un script
 * DISTANT, une exfiltration vers un domaine tiers (`connect-src 'self'`), et la mise en
 * cadre (`frame-ancestors 'none'`).
 *
 * ⚠️ `frame-ancestors 'none'` vaut PARTOUT, SAUF `/widget` (lot 12) — par ROUTE, jamais
 * globalement. Une app du hub embarque la mémoire dans une iframe ; la laisser embarquer
 * `/moi`, `/chat` ou `/apps` rendrait toute l'interface cadrable par n'importe quelle page de
 * `hubperso.com`, y compris une page qu'on ajouterait demain sans y penser.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // ⚠️ `form-action` COUVRE LA CHAÎNE DE REDIRECTION qui suit une soumission, pas seulement
  // la première cible. La page de consentement du connecteur (`/api/mcp/authorize`) poste
  // vers elle-même PUIS redirige vers Claude avec le code d'autorisation : sans les deux
  // origines ici, le navigateur bloque cette redirection SANS RIEN DIRE — le serveur répond
  // bien `302`, et l'écran ne bouge pas. Vécu le 15/09/2026, dix-huit tentatives et zéro
  // appel à `/api/mcp/token` : tout marchait sauf la dernière marche. BatchChef avait posé
  // la même ligne par précaution ; ici elle a été payée.
  // Les origines sont celles de `DEFAULT_ALLOWED_ORIGINS` (`lib/mcp/oauth.ts`), et un test
  // refuse qu'elles divergent : l'une décide qui peut recevoir un code, l'autre si le
  // navigateur laisse passer. Un désaccord donne un flux qui s'autorise puis se fait bloquer.
  "form-action 'self' https://claude.ai https://claude.com",
  "object-src 'none'",
].join("; ");

/**
 * La CSP du WIDGET : identique, sauf `frame-ancestors`. Seuls le hub et ses sous-domaines
 * peuvent l'embarquer — c'est la même frontière que le cookie de session (`.hubperso.com`),
 * et l'ouvrir plus large rendrait la mémoire cadrable par n'importe quel site.
 *
 * ⚠️ `X-Frame-Options` n'a PAS d'équivalent « liste d'origines » : sa valeur `ALLOW-FROM` est
 * morte dans tous les navigateurs modernes. On le RETIRE donc pour cette route — c'est
 * `frame-ancestors` qui garde, et lui seul sait le faire. Laisser `DENY` ferait échouer
 * l'iframe en silence dans les navigateurs qui préfèrent l'ancien en-tête.
 */
const CSP_WIDGET = CSP.replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self' https://hubperso.com https://*.hubperso.com",
);

export const ENTETES_SECURITE = [
  { key: "Content-Security-Policy", value: CSP },
  // HSTS : 100 % HTTPS (Vercel). 1 an, sous-domaines inclus.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** Les en-têtes de `/widget` : les mêmes, moins `X-Frame-Options`, plus la CSP qui l'ouvre. */
export const ENTETES_WIDGET = [
  { key: "Content-Security-Policy", value: CSP_WIDGET },
  ...ENTETES_SECURITE.filter((e) => e.key !== "Content-Security-Policy" && e.key !== "X-Frame-Options"),
];

const nextConfig = {
  // Découverte OAuth du connecteur MCP (RFC 8414 / RFC 9728) : claude.ai interroge des chemins
  // NORMALISÉS à la racine. Réécrits vers un handler, le type dans le CHEMIN — jamais en query,
  // qui se perd à la réécriture (bug vécu par CarAI). Les variantes `/:suffixe*` existent parce
  // que la RFC 9728 autorise le chemin de la ressource après le préfixe.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/mcp/meta/as" },
      { source: "/.well-known/oauth-authorization-server/:suffixe*", destination: "/api/mcp/meta/as" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp/meta/pr" },
      { source: "/.well-known/oauth-protected-resource/:suffixe*", destination: "/api/mcp/meta/pr" },
    ];
  },
  reactStrictMode: true,
  // Sans cela Next empaquette le SDK Sentry côté serveur et son chargeur de crochets échoue avec
  // « Cannot find package '@sentry/server-runtime-injection' » (constaté sur app-template).
  serverExternalPackages: ["@sentry/server-runtime-injection"],
  async headers() {
    return [
      // ⚠️ L'ORDRE COMPTE : Next applique la PREMIÈRE règle qui matche pour une clé donnée.
      // `/widget` doit venir AVANT `/:path*`, sinon il hérite de `frame-ancestors 'none'` et
      // l'iframe reste blanche — sans erreur visible ailleurs que dans la console du
      // navigateur de l'app hôte.
      { source: "/widget", headers: ENTETES_WIDGET },
      { source: "/:path*", headers: ENTETES_SECURITE },
    ];
  },
};

export default nextConfig;
