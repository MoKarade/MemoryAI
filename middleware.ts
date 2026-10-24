// middleware.ts
//
// Garde global : l'app est PRIVÉE, rien n'est servi sans session valide. La décision est
// déléguée à `decideGuard` (lib/authGuard.ts, testé unitairement) ; ce fichier ne fait que
// la brancher sur NextAuth.
//
// ⚠️ Le matcher DOIT rester aligné avec `isPublicPath`. En particulier `hub/summary` en
// est EXCLU : il porte sa propre auth par jeton. L'y inclure renverrait au hub une
// redirection HTML au lieu du JSON — le widget afficherait « injoignable » en permanence
// alors que l'app marche (bug vécu par JobAI). Voir l'en-tête de lib/authGuard.ts.
//
// ⚠️ Toute NOUVELLE route qui affiche des données doit rester DERRIÈRE ce garde : ne
// jamais l'ajouter aux exclusions du matcher « pour dépanner ».
//
// ⚠️ UNE NUANCE DEPUIS LE LOT 12, et ce n'est PAS une exclusion du matcher : `/widget` y
// reste, il traverse par une décision NOMMÉE de `decideGuard` (`ROUTES_CADREES`). Un refus
// n'y part pas en redirection, parce que dans une iframe une redirection donne un rectangle
// blanc au lieu d'une explication. La page refuse elle-même, par `requireSession()`.

import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { decideGuard } from "@/lib/authGuard";
import { isAuthConfigured } from "@/lib/authConfigured";
import { identiteNouveauCookie, NOM_COOKIE_SESSION_HUB } from "@/lib/sessionAsymetrique";

export default auth(async (req) => {
  // Fail-closed : sans AUTH_SECRET/AUTHORIZED_EMAIL, Auth.js loggue MissingSecret mais
  // laisse passer (constaté en préproduction). On refuse alors TOUT ce qui est protégé.
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error: "auth_unconfigured",
        message:
          "Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants). Accès refusé.",
      },
      { status: 503 },
    );
  }

  // Plan `auth-asym-hubperso`, phase 1 : le garde accepte les MÊMES cookies que
  // `requireSession()` (lib/session.ts) — le nouveau cookie signé du hub, puis l'ancien
  // (Auth.js). Sans cette lecture, une session émise par le hub sous le nouveau nom serait
  // refusée ici alors que la page l'accepterait. Cookie absent, signature fausse, jeton
  // expiré ou adresse autre que le propriétaire : `null`, et on retombe sur l'ancien chemin.
  const nouveau = await identiteNouveauCookie(req.cookies.get(NOM_COOKIE_SESSION_HUB)?.value);

  const decision = decideGuard({
    isAuthenticated: Boolean(nouveau) || Boolean(req.auth),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  });

  switch (decision.type) {
    case "next":
      return;
    case "unauthorized":
      return NextResponse.json(
        { error: "unauthenticated", message: "Authentification requise." },
        { status: 401 },
      );
    case "redirect":
      return NextResponse.redirect(new URL(decision.location, req.nextUrl.origin));
  }
});

export const config = {
  // Tout est protégé SAUF : l'endpoint du hub (auth par jeton), les routes Auth.js, la
  // page de login et les assets Next. Doit rester aligné avec `isPublicPath`.
  matcher: [
    "/((?!hub/summary|api/faits$|api/pieces$|api/pieces/file$|api/etat$|api/avancement$|api/conversations$|api/evenements$|api/mcp$|api/cron/apprentissage$|api/ask$|api/etat-lia$|api/demandes$|api/mcp/authorize|api/mcp/token|api/mcp/register|api/mcp/meta/as|api/mcp/meta/pr|\\.well-known/oauth-authorization-server|\\.well-known/oauth-protected-resource|api/auth|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.).*)",
  ],
};
