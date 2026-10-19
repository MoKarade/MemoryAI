// tests/routeFileDeLecture.test.ts — la couche HTTP de /api/pieces/file, sans base.
//
// Ce qui se garde ici est l'ORDRE des refus et le RÔLE exigé : la file est réservée aux
// ÉCRIVAINS. La servir à un jeton de lecture lui ferait payer OCR et appels de modèle pour
// des pièces que `POST /api/pieces` refusera ensuite — une boucle qui dépense sans écrire.

import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { GET, POST } from "../app/api/pieces/file/route";

const JETON_ECRITURE = "jeton-driveai-ecriture-0123456789";
const JETON_LECTURE = "jeton-driveai-lecture-00123456789";
const VARS = [
  "MEMORYAI_GEL",
  "MEMORYAI_TOKEN_DRIVEAI_ECRITURE",
  "MEMORYAI_TOKEN_CLAUDE_LECTURE",
  "MEMORYAI_CHIFFREMENT",
  "DATABASE_URL",
] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

const lire = (query: string, jeton: string | null = JETON_ECRITURE) =>
  GET(
    new Request(`http://memoryai.test/api/pieces/file${query}`, {
      headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
    }),
  );

const noter = (corps: string | object, jeton: string | null = JETON_ECRITURE) =>
  POST(
    new Request("http://memoryai.test/api/pieces/file", {
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

describe("/api/pieces/file — les refus, dans l'ordre où ils se décident", () => {
  it("503 memoire_gelee avant même de lire le jeton — le gel de Marc ARRÊTE la lecture", async () => {
    configurer();
    process.env.MEMORYAI_GEL = "1";
    for (const r of [await lire("?extracteur=x", null), await noter({}, null)]) {
      expect(r.status).toBe(503);
      expect((await r.json()).error).toBe("memoire_gelee");
    }
  });

  it("401 sans jeton ou avec un faux", async () => {
    configurer();
    expect((await lire("?extracteur=x", null)).status).toBe(401);
    expect((await lire("?extracteur=x", "faux-jeton-0123456789abcdefgh")).status).toBe(401);
    expect((await noter({ extracteur: "x", verdicts: [] }, null)).status).toBe(401);
  });

  it("⚠️ jeton de LECTURE refusé sur les DEUX verbes, par le refus commun (ADR 0015 §2.3)", async () => {
    configurer();
    const g = await lire("?extracteur=haiku-4.5-piece-v1", JETON_LECTURE);
    expect(g.status).toBe(401);
    expect(await g.json()).toEqual({ error: "non_autorise" });
    const p = await noter({ extracteur: "x", verdicts: [{ file_id: "f", motif: "sans-texte" }] }, JETON_LECTURE);
    expect(p.status).toBe(401);
  });

  it("503 cle_absente et base_absente — des pannes, jamais des refus", async () => {
    configurer();
    delete process.env.MEMORYAI_CHIFFREMENT;
    expect((await (await lire("?extracteur=x")).json()).error).toBe("cle_absente");
    configurer();
    delete process.env.DATABASE_URL;
    expect((await (await lire("?extracteur=x")).json()).error).toBe("base_absente");
  });

  it("400 sans extracteur, ou avec celui de la MIGRATION — qui ne lit rien", async () => {
    configurer();
    for (const q of ["", "?extracteur=", "?extracteur=moteur-inventaire-v1"]) {
      const r = await lire(q);
      expect(r.status, q).toBe(400);
      expect((await r.json()).error).toBe("extracteur_requis");
    }
  });

  it("400 sur des verdicts invalides — dont une PANNE DE CANAL déguisée en verdict", async () => {
    configurer();
    for (const corps of [
      "{pas du json",
      { extracteur: "haiku-4.5-piece-v1" },
      { extracteur: "haiku-4.5-piece-v1", verdicts: [] },
      { extracteur: "haiku-4.5-piece-v1", verdicts: [{ file_id: "f", motif: "jeton-refuse" }] },
    ]) {
      const r = await noter(corps);
      expect(r.status, JSON.stringify(corps)).toBe(400);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });
});
