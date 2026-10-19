// tests/connexionHub.test.ts — le couloir vers le hub, et ce qu'il refuse.

import { describe, it, expect } from "vitest";
import { cheminInterne, urlConnexionHub } from "../lib/connexionHub";

describe("cheminInterne", () => {
  it("garde un chemin interne", () => {
    expect(cheminInterne("/a-valider?x=1")).toBe("/a-valider?x=1");
  });

  it("retombe sur / quand rien n'est demandé", () => {
    expect(cheminInterne(undefined)).toBe("/");
    expect(cheminInterne("   ")).toBe("/");
  });

  // Un retour vers un site tiers après connexion serait un tremplin de hameçonnage.
  it("refuse une URL absolue et un chemin protocol-relative", () => {
    expect(cheminInterne("https://evil.com/")).toBe("/");
    expect(cheminInterne("//evil.com/x")).toBe("/");
  });
});

describe("urlConnexionHub", () => {
  it("envoie au /login du hub avec un callbackUrl absolu vers CETTE app", () => {
    const url = new URL(urlConnexionHub("https://memoryai.hubperso.com", "/moi"));
    expect(url.origin + url.pathname).toBe("https://hubperso.com/login");
    expect(url.searchParams.get("callbackUrl")).toBe("https://memoryai.hubperso.com/moi");
  });

  it("le callbackUrl ne peut pas sortir de l'app", () => {
    const url = new URL(urlConnexionHub("https://memoryai.hubperso.com", "https://evil.com"));
    expect(url.searchParams.get("callbackUrl")).toBe("https://memoryai.hubperso.com/");
  });
});
