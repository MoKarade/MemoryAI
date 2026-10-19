// tests/entetes.test.ts — les en-têtes de sécurité sont ENFORCÉS, sur toutes les routes.
//
// Un en-tête se lit dans la réponse, pas dans le fichier source : ce test lit ce que
// `next.config.mjs` DÉCLARE. La vérification sur la réponse réelle reste un geste
// post-déploiement (CLAUDE.md §6).

import { describe, it, expect } from "vitest";
import nextConfig, { ENTETES_SECURITE, ENTETES_WIDGET } from "../next.config.mjs";

const parCle = Object.fromEntries(ENTETES_SECURITE.map((e) => [e.key, e.value]));

describe("en-têtes de sécurité", () => {
  it("la CSP est enforcée, pas en Report-Only", () => {
    expect(parCle["Content-Security-Policy"]).toBeDefined();
    expect(parCle["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("aucune mise en cadre en phase 0 — le widget l'ouvrira par route, jamais ici", () => {
    expect(parCle["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(parCle["X-Frame-Options"]).toBe("DENY");
  });

  it("aucun appel réseau navigateur hors de l'app", () => {
    expect(parCle["Content-Security-Policy"]).toContain("connect-src 'self'");
  });

  it("HSTS un an, sous-domaines inclus", () => {
    expect(parCle["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  // ⚠️ CE TEST A ÉTÉ ÉTENDU AU LOT 12, PAS RE-BASÉ. Il affirmait « une seule règle, et c'est
  // `/:path*` » — vrai jusqu'à ce que `/widget` ait besoin d'une CSP à lui. Ce qu'il garde
  // désormais est le FAIT et non la forme d'avant : le fourre-tout couvre TOUJOURS tout, et
  // l'exception est NOMMÉE, placée avant lui, et ne diffère que par ce qu'on a voulu.
  it("le fourre-tout couvre toutes les routes, et les exceptions sont nommées", async () => {
    const regles = await nextConfig.headers();
    const attrape_tout = regles.filter((r) => r.source === "/:path*");
    expect(attrape_tout).toHaveLength(1);
    expect(attrape_tout[0]?.headers).toBe(ENTETES_SECURITE);
    // Toute règle qui n'est pas le fourre-tout est une exception assumée, et elles sont
    // connues : si une session en ajoute une, ce test tombe et il faut la justifier ici.
    expect(regles.filter((r) => r.source !== "/:path*").map((r) => r.source)).toEqual(["/widget"]);
  });

  // ⚠️ L'ORDRE EST LA GARDE, et il ne se relit pas dans la config : Next applique la PREMIÈRE
  // règle qui matche pour une clé. `/widget` après `/:path*` hériterait de
  // `frame-ancestors 'none'` — l'iframe resterait blanche, sans rien de rouge nulle part.
  it("la règle du widget passe AVANT le fourre-tout", async () => {
    const regles = await nextConfig.headers();
    const iWidget = regles.findIndex((r) => r.source === "/widget");
    const iTout = regles.findIndex((r) => r.source === "/:path*");
    expect(iWidget).toBeGreaterThanOrEqual(0);
    expect(iWidget).toBeLessThan(iTout);
  });

  it("le widget ne diffère que par la mise en cadre — tout le reste est identique", async () => {
    const widget = Object.fromEntries(ENTETES_WIDGET.map((e) => [e.key, e.value]));
    // `X-Frame-Options` n'a pas de valeur « liste d'origines » (`ALLOW-FROM` est morte) :
    // le laisser à `DENY` ferait échouer l'iframe dans les navigateurs qui le préfèrent.
    expect(widget["X-Frame-Options"]).toBeUndefined();
    expect(widget["Content-Security-Policy"]).toContain("frame-ancestors 'self' https://hubperso.com https://*.hubperso.com");
    expect(widget["Content-Security-Policy"]).not.toContain("frame-ancestors 'none'");
    // Le reste ne bouge pas : une exception se borne à ce qu'elle doit ouvrir.
    for (const cle of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(widget[cle]).toBe(parCle[cle]);
    }
    // Et ce que la CSP garde par ailleurs reste gardé.
    expect(widget["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(widget["Content-Security-Policy"]).toContain("object-src 'none'");
  });
});
