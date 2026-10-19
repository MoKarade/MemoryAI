// tests/jetons.test.ts — un jeton = une app = un rôle ; inconnu ⇒ rien, et rien de plus.

import { describe, it, expect } from "vitest";
import { identifierEcrivain, jetonDepuisEntete, LONGUEUR_MIN_JETON } from "../lib/jetons";

const J = "jeton-driveai-0123456789abcdef";
const ENV = {
  MEMORYAI_TOKEN_DRIVEAI_ECRITURE: J,
  MEMORYAI_TOKEN_CARAI_LECTURE: "jeton-carai-0123456789abcdef",
  MEMORYAI_TOKEN_SEED_ECRITURE: "jeton-seed-0123456789abcdefgh",
  HUB_TOKEN: "jeton-hub-0123456789abcdef",
};

describe("jetonDepuisEntete", () => {
  it("lit un Bearer, insensible à la casse du mot, et rien d'autre", () => {
    expect(jetonDepuisEntete("Bearer abc")).toBe("abc");
    expect(jetonDepuisEntete("bearer abc ")).toBe("abc");
    expect(jetonDepuisEntete("Basic abc")).toBeNull();
    expect(jetonDepuisEntete("Bearer")).toBeNull();
    expect(jetonDepuisEntete(null)).toBeNull();
  });
});

describe("identifierEcrivain", () => {
  it("déduit l'app, le rôle et le plafond de fiabilité du NOM de la variable", () => {
    expect(identifierEcrivain(J, ENV)).toEqual({
      appId: "driveai",
      role: "ecriture",
      fiabilites: ["document-tiers", "document-officiel", "mail-tiers"],
    });
    expect(identifierEcrivain("jeton-carai-0123456789abcdef", ENV)).toEqual({
      appId: "carai",
      role: "lecture",
      fiabilites: ["app"],
    });
    expect(identifierEcrivain("jeton-seed-0123456789abcdefgh", ENV)?.fiabilites).toEqual(["seed"]);
  });

  // LA garde de l'ADR : inconnu ⇒ null. Absent, trop court, faux, ou un jeton d'un AUTRE
  // usage (HUB_TOKEN) : tous rendent la même chose.
  it("rend null pour tout ce qui n'est pas un jeton d'écrivain — sans distinguer pourquoi", () => {
    expect(identifierEcrivain(null, ENV)).toBeNull();
    expect(identifierEcrivain("", ENV)).toBeNull();
    expect(identifierEcrivain(J.slice(0, -1), ENV)).toBeNull();
    expect(identifierEcrivain(J + "x", ENV)).toBeNull();
    expect(identifierEcrivain("jeton-hub-0123456789abcdef", ENV)).toBeNull();
    expect(identifierEcrivain(J, {})).toBeNull();
  });

  it("refuse un jeton court, même si la variable le porte", () => {
    const court = "court";
    expect(court.length).toBeLessThan(LONGUEUR_MIN_JETON);
    expect(identifierEcrivain(court, { MEMORYAI_TOKEN_X_ECRITURE: court })).toBeNull();
  });

  it("ignore une variable vide ou mal nommée", () => {
    expect(identifierEcrivain(J, { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: "" })).toBeNull();
    expect(identifierEcrivain(J, { MEMORYAI_TOKEN_DRIVEAI: J })).toBeNull();
    expect(identifierEcrivain(J, { MEMORYAI_TOKEN_DRIVEAI_ADMIN: J })).toBeNull();
    expect(identifierEcrivain(J, { TOKEN_DRIVEAI_ECRITURE: J })).toBeNull();
  });
});
