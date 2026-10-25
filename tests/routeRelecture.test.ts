// tests/routeRelecture.test.ts — la couche HTTP de POST /api/pieces/relecture, sans base (ADR 0026).
//
// L'ordre des refus est celui de `POST /api/pieces` : gel, jeton (401 indiscernable), clé, base,
// corps. Un jeton de lecture ne relit rien : il ferait juger les papiers de Marc par un lecteur.

import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { GET, POST } from "../app/api/pieces/relecture/route";

const JETON_ECRITURE = "jeton-driveai-ecriture-0123456789";
const JETON_LECTURE = "jeton-claude-lecture-000123456789";
const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "MEMORYAI_TOKEN_CLAUDE_LECTURE", "MEMORYAI_CHIFFREMENT", "DATABASE_URL"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

const envoyer = (corps: string | object, jeton: string | null = JETON_ECRITURE) =>
  POST(
    new Request("http://memoryai.test/api/pieces/relecture", {
      method: "POST",
      headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
      body: typeof corps === "string" ? corps : JSON.stringify(corps),
    }),
  );

function configurer() {
  delete process.env.MEMORYAI_GEL;
  process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON_ECRITURE;
  process.env.MEMORYAI_TOKEN_CLAUDE_LECTURE = JETON_LECTURE;
  process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.DATABASE_URL = "postgres://jamais-appelee.invalid/x";
}

describe("POST /api/pieces/relecture — les refus, dans l'ordre", () => {
  it("503 memoire_gelee avant même le jeton", async () => {
    configurer();
    process.env.MEMORYAI_GEL = "1";
    const r = await envoyer({ relectures: [] }, null);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("401 sans jeton, avec un faux, ou avec un jeton de LECTURE", async () => {
    configurer();
    for (const j of [null, "faux-jeton-0123456789abcdefgh", JETON_LECTURE]) {
      const r = await envoyer({ relectures: [] }, j);
      expect(r.status, String(j)).toBe(401);
      expect(await r.json()).toEqual({ error: "non_autorise" });
    }
  });

  it("503 cle_absente et base_absente — des pannes, jamais des refus", async () => {
    configurer();
    delete process.env.MEMORYAI_CHIFFREMENT;
    expect((await (await envoyer({ relectures: [] })).json()).error).toBe("cle_absente");
    configurer();
    delete process.env.DATABASE_URL;
    expect((await (await envoyer({ relectures: [] })).json()).error).toBe("base_absente");
  });

  it("400 si le corps n'est pas { relectures: [...] }", async () => {
    configurer();
    for (const corps of ["{pas du json", {}, { relectures: {} }]) {
      const r = await envoyer(corps);
      expect(r.status, JSON.stringify(corps)).toBe(400);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("GET /api/pieces/relecture — ce qu'il reste à relire (25/10)", () => {
  const lire = (requete: string, jeton: string | null = JETON_ECRITURE) =>
    GET(new Request(`http://memoryai.test/api/pieces/relecture${requete}`, { headers: jeton ? { authorization: `Bearer ${jeton}` } : {} }));

  it("401 sans jeton, avec un faux, ou avec un jeton de LECTURE", async () => {
    configurer();
    for (const j of [null, "faux-jeton-0123456789abcdefgh", JETON_LECTURE]) {
      const r = await lire("?canal=texte", j);
      expect(r.status, String(j)).toBe(401);
      expect(await r.json()).toEqual({ error: "non_autorise" });
    }
  });

  it("400 sans canal valide ou avec une limite hors bornes ; 503 sans base", async () => {
    configurer();
    for (const q of ["", "?canal=ocr", "?canal=texte&limite=0", "?canal=texte&limite=51", "?canal=vision&limite=2.5"]) {
      const r = await lire(q);
      expect(r.status, q).toBe(400);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    delete process.env.DATABASE_URL;
    expect((await (await lire("?canal=texte")).json()).error).toBe("base_absente");
  });
});
