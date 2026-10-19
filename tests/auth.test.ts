// tests/auth.test.ts — le garde d'accès de l'app privée.
//
// Ces tests partent avec le fork : ce sont eux qui empêchent de re-casser les deux
// défauts que les apps réelles ont dû corriger en production.

import { describe, it, expect } from "vitest";
import { isAuthorizedEmail } from "../lib/authorized";
import { isAuthConfigured } from "../lib/authConfigured";
import { readFileSync } from "node:fs";
import { decideGuard, isPublicPath, ROUTES_A_AUTH_PROPRE, ROUTES_CADREES } from "../lib/authGuard";

describe("isAuthorizedEmail — une seule adresse admise, celle du propriétaire", () => {
  it("accepte l'adresse autorisée, insensible à la casse et aux espaces", () => {
    expect(isAuthorizedEmail(" Marc@Example.COM ", "marc@example.com")).toBe(true);
  });

  it("refuse toute autre adresse", () => {
    expect(isAuthorizedEmail("autre@example.com", "marc@example.com")).toBe(false);
  });

  // Fail-closed : une allowlist non configurée ne doit JAMAIS tout laisser passer.
  it("refuse quand l'allowlist est absente ou vide", () => {
    expect(isAuthorizedEmail("marc@example.com", undefined)).toBe(false);
    expect(isAuthorizedEmail("marc@example.com", "   ")).toBe(false);
  });

  it("refuse quand le candidat est absent", () => {
    expect(isAuthorizedEmail(null, "marc@example.com")).toBe(false);
  });
});

describe("isAuthConfigured — fail-closed", () => {
  it("exige AUTH_SECRET ET AUTHORIZED_EMAIL", () => {
    expect(isAuthConfigured({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: "a@b.c" })).toBe(true);
    expect(isAuthConfigured({ AUTH_SECRET: "s" })).toBe(false);
    expect(isAuthConfigured({ AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
    expect(isAuthConfigured({})).toBe(false);
  });

  it("une valeur blanche ne compte pas comme configurée", () => {
    expect(isAuthConfigured({ AUTH_SECRET: "  ", AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
  });
});

describe("isPublicPath", () => {
  // ⚠️ LE test à ne jamais supprimer. Si /hub/summary tombe derrière la session, le hub
  // reçoit une redirection HTML au lieu du JSON et affiche « injoignable » en permanence,
  // alors que l'app marche parfaitement dans un navigateur. Bug vécu par JobAI.
  it("laisse /hub/summary PUBLIC — il porte sa propre auth par jeton", () => {
    expect(isPublicPath("/hub/summary")).toBe(true);
  });

  // Même raison, même sévérité : `/api/faits` est appelée par des serveurs, avec un jeton.
  it("laisse /api/faits PUBLIC (jeton d'écrivain), par égalité stricte — pas /api/faits/x", () => {
    expect(isPublicPath("/api/faits")).toBe(true);
    expect(isPublicPath("/api/faits/")).toBe(false);
    expect(isPublicPath("/api/faits/oublier")).toBe(false);
    expect(isPublicPath("/api/faitsx")).toBe(false);
  });

  it("laisse les routes du connecteur MCP passer (OAuth), par égalité stricte", () => {
    for (const r of ["/api/mcp", "/api/mcp/authorize", "/api/mcp/token", "/api/mcp/register", "/api/mcp/meta/as", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      expect(isPublicPath(r), r).toBe(true);
    }
    expect(isPublicPath("/api/mcpx")).toBe(false);
    expect(isPublicPath("/api/mcp/admin")).toBe(false);
  });

  // Deux listes disent la même chose à deux endroits : ce test les tient ensemble.
  it("le matcher du middleware exclut EXACTEMENT les routes à auth propre", () => {
    const src = readFileSync("middleware.ts", "utf8");
    const m = /matcher: \[\s*"\/\(\(\?!(.*?)\|api\/auth/s.exec(src);
    expect(m).not.toBeNull();
    const exclues = m![1]!.split("|").map((x) => "/" + x.replace(/\\\\\./g, ".").replace(/\$$/, ""));
    for (const r of ROUTES_A_AUTH_PROPRE) expect(exclues, r).toContain(r);
    for (const e of exclues) expect((ROUTES_A_AUTH_PROPRE as readonly string[]).includes(e), e).toBe(true);
  });

  it("laisse passer login, routes Auth.js (session, déconnexion) et assets", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/session")).toBe(true);
    expect(isPublicPath("/api/auth/signout")).toBe(true);
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true);
    expect(isPublicPath("/icon.svg")).toBe(true);
  });

  it("protège les pages de données", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/detail/42")).toBe(false);
  });
});

describe("decideGuard", () => {
  it("laisse passer une session valide", () => {
    expect(decideGuard({ isAuthenticated: true, pathname: "/" })).toEqual({ type: "next" });
  });

  it("redirige une PAGE non authentifiée vers /login, en gardant la destination", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/detail", search: "?a=1" })).toEqual({
      type: "redirect",
      location: "/login?callbackUrl=%2Fdetail%3Fa%3D1",
    });
  });

  // Un client machine attend du JSON : une redirection HTML serait illisible pour lui.
  it("répond 401 pour une route API non authentifiée, jamais une redirection", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/api/truc" })).toEqual({
      type: "unauthorized",
    });
  });

  // ── Les routes CADRÉES (lot 12) ────────────────────────────────────────────────────
  // Ce bloc garde une concession, pas un acquis : `/widget` est la seule page dont le refus
  // ne part pas en redirection, parce que dans une iframe une redirection ne donne pas une
  // page de connexion mais un rectangle blanc. Ce qui doit rester vrai, et que ces trois
  // cas vérifient : la liste est COURTE et nommée, elle ne déborde sur aucune autre page,
  // et `/widget` n'est PAS devenu public pour autant.
  it("une route cadrée non authentifiée rend la PAGE, qui refusera dans le cadre", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/widget" })).toEqual({ type: "next" });
  });

  it("la concession ne déborde pas : /widget/autre et les pages voisines redirigent", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/widgets" }).type).toBe("redirect");
    expect(decideGuard({ isAuthenticated: false, pathname: "/widget/x" }).type).toBe("redirect");
    expect(decideGuard({ isAuthenticated: false, pathname: "/moi" }).type).toBe("redirect");
  });

  it("une route cadrée n'est PAS publique — la page garde, elle", () => {
    // La distinction est tout le point : `next` ici veut dire « rends la page », et cette
    // page appelle `requireSession()`. Si `/widget` glissait dans `isPublicPath`, il
    // sortirait du matcher et deviendrait une exception d'un autre genre.
    for (const r of ROUTES_CADREES) expect(isPublicPath(r), r).toBe(false);
    expect(ROUTES_CADREES).toEqual(["/widget"]);
  });

  it("le endpoint du hub passe même sans session", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/hub/summary" })).toEqual({
      type: "next",
    });
  });
});
