// tests/routeFaits.test.ts — la couche HTTP de POST /api/faits, sans base : chaque
// réponse d'échec est distincte, et une panne n'est jamais rendue comme un refus.

import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { POST } from "../app/api/faits/route";
import { readFileSync } from "node:fs";

const JETON = "jeton-driveai-0123456789abcdef";
const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "MEMORYAI_CHIFFREMENT", "DATABASE_URL"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

function requete(corps: string | object, jeton: string | null = JETON): Request {
  return new Request("http://memoryai.test/api/faits", {
    method: "POST",
    headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

describe("POST /api/faits — les échecs, dans l'ordre où ils se décident", () => {
  it("503 memoire_gelee quand MEMORYAI_GEL=1, avant même de lire le jeton", async () => {
    process.env.MEMORYAI_GEL = "1";
    const r = await POST(requete({ faits: [] }, null));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("401 indiscernable : jeton absent, faux, tronqué, ou variable absente", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    const corps: string[] = [];
    for (const j of [null, "faux-jeton-0123456789abcdef", JETON.slice(0, 10)]) {
      const r = await POST(requete({ faits: [] }, j));
      expect(r.status).toBe(401);
      corps.push(await r.text());
    }
    delete process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE;
    const r = await POST(requete({ faits: [] }, JETON));
    expect(r.status).toBe(401);
    corps.push(await r.text());
    expect(new Set(corps).size).toBe(1);
  });

  it("503 cle_absente avec un bon jeton mais sans clé de chiffrement — une panne, pas un refus", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    delete process.env.MEMORYAI_CHIFFREMENT;
    const r = await POST(requete({ faits: [] }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("cle_absente");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("503 base_absente avec clé mais sans DATABASE_URL", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
    delete process.env.DATABASE_URL;
    const r = await POST(requete({ faits: [] }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("base_absente");
  });

  it("400 corps_invalide sur du non-JSON ou sans tableau `faits` (jeton et clé présents)", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
    process.env.DATABASE_URL = "postgres://jamais-appelee.invalid/x";
    for (const corps of ["{pas du json", { faits: "non" }, { autre: [] }, "null"]) {
      const r = await POST(requete(corps));
      expect(r.status, JSON.stringify(corps)).toBe(400);
      expect((await r.json()).error).toBe("corps_invalide");
    }
  });
});

describe("POST /api/faits — le contrat de la réponse 200", () => {
  // Pas de base ici, donc pas de 200 à provoquer : c'est la SOURCE qu'on garde. Ce que ce cas
  // défend n'est pas une valeur mais une FORME — la route projette les quatre champs du
  // contrat au lieu de rendre `ResultatLot` entier, qui porte aussi `idsCrees` (utile en
  // processus, sans raison de partir chez un écrivain distant). Sans cette garde, le contrat
  // public s'élargit au premier champ ajouté à l'objet interne, en silence.
  const source = readFileSync("app/api/faits/route.ts", "utf8");

  it("la route rend UNE réponse JSON de succès — anti-vacuité du scan", () => {
    expect(source).toMatch(/status: 200/);
  });

  it("elle projette le contrat, et ne passe jamais l'objet interne entier", () => {
    expect(source).not.toMatch(/Response\.json\(\s*resultat\b/);
    expect(source).toMatch(/const \{ recus, acceptes, dejaPresents, refuses \} = resultat;/);
  });
});
