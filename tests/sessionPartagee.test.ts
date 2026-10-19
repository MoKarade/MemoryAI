// tests/sessionPartagee.test.ts — partage de session entre sous-domaines du hub.

import { describe, it, expect } from "vitest";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";

describe("cookiesSessionPartagee", () => {
  it("rend undefined lorsque le domaine est undefined", () => {
    const resultat = cookiesSessionPartagee(undefined);
    expect(resultat).toBeUndefined();
  });

  it("rend undefined lorsque le domaine est une chaîne vide", () => {
    const resultat = cookiesSessionPartagee("");
    expect(resultat).toBeUndefined();
  });

  it("rend undefined lorsque le domaine ne contient que des espaces", () => {
    const resultat = cookiesSessionPartagee("   ");
    expect(resultat).toBeUndefined();
  });

  it("définit la clé sessionToken avec le domaine .hubperso.com", () => {
    const resultat = cookiesSessionPartagee(".hubperso.com");
    expect(resultat?.sessionToken).toBeDefined();
  });

  it("ne contient aucune clé csrfToken avec le domaine .hubperso.com", () => {
    const resultat = cookiesSessionPartagee(".hubperso.com");
    expect(resultat).not.toHaveProperty("csrfToken");
  });

  it("fixe le nom du cookie sessionToken à __Secure-authjs.session-token", () => {
    const resultat = cookiesSessionPartagee(".hubperso.com");
    expect(resultat?.sessionToken?.name).toBe("__Secure-authjs.session-token");
  });

  it("configure les options attendues pour sessionToken", () => {
    const resultat = cookiesSessionPartagee(".hubperso.com");
    expect(resultat?.sessionToken?.options).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      domain: ".hubperso.com",
    });
  });

  it("nettoie les espaces autour du domaine fourni", () => {
    const resultat = cookiesSessionPartagee("  .hubperso.com  ");
    expect(resultat?.sessionToken?.options?.domain).toBe(".hubperso.com");
  });
});
