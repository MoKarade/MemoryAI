// tests/gel.test.ts — le kill-switch : il gèle sur « 1 », et sur rien d'autre.

import { describe, it, expect } from "vitest";
import { estGele, reponseGelee } from "../lib/gel";

describe("estGele", () => {
  it("gèle sur MEMORYAI_GEL=1 (espaces tolérés)", () => {
    expect(estGele({ MEMORYAI_GEL: "1" })).toBe(true);
    expect(estGele({ MEMORYAI_GEL: " 1 " })).toBe(true);
  });

  // Un kill-switch qui interprète large s'allume par accident, puis se fait retirer.
  it("ne gèle sur aucune autre valeur", () => {
    for (const v of [undefined, "", "0", "true", "oui", "yes", "on"]) {
      expect(estGele({ MEMORYAI_GEL: v })).toBe(false);
    }
  });
});

describe("reponseGelee", () => {
  it("rend un 503 nommé, jamais mis en cache", async () => {
    const r = reponseGelee();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).error).toBe("memoire_gelee");
  });
});
