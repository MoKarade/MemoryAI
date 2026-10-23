// tests/sauvetageRoutes.test.ts — pendant le sauvetage, les apps n'écrivent pas (ADR 0019 §2).
//
// Les trois routes d'écriture répondent 503 `sauvetage_en_cours` APRÈS l'identité (un inconnu
// reçoit toujours son 401) et AVANT toute écriture. Sauvetage clos, elles retombent sur leur
// chemin normal. La base et l'écriture sont simulées : c'est la PORTE qui est testée ici, le
// sauvetage lui-même l'est sur une vraie Postgres (`tests/sauvetage.test.ts`).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

let fermees = true;
const ecrireLot = vi.fn(async () => ({ recus: 0, acceptes: 0, dejaPresents: 0, refuses: [], idsCrees: [] }));
const ecrireLotPieces = vi.fn(async () => ({ recues: 0, acceptees: 0, refusees: [], idsCrees: [] }));

vi.mock("@/lib/migrations", () => ({ assurerMigrations: async () => {} }));
vi.mock("@/lib/db", () => ({ db: {}, baseConfiguree: () => true }));
vi.mock("@/lib/sauvetage/depot", () => ({ depotSauvetageDrizzle: () => ({ ecrituresFermees: async () => fermees }) }));
vi.mock("@/lib/ecrireFaits", async (original) => ({ ...(await original<object>()), ecrireLot }));
vi.mock("@/lib/pieces/ecrire", async (original) => ({ ...(await original<object>()), ecrireLotPieces }));
vi.mock("@/lib/depotFaits", () => ({ depotDrizzle: () => ({}) }));
vi.mock("@/lib/pieces/depot", () => ({ depotPiecesDrizzle: () => ({}) }));

const { POST: postFaits } = await import("@/app/api/faits/route");
const { POST: postPieces } = await import("@/app/api/pieces/route");

const JETON = "jeton-driveai-0123456789abcdef";
const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "MEMORYAI_CHIFFREMENT", "DATABASE_URL"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

beforeEach(() => {
  delete process.env.MEMORYAI_GEL;
  process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
  process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
  ecrireLot.mockClear();
  ecrireLotPieces.mockClear();
});
afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

const requete = (chemin: string, corps: object, jeton: string | null = JETON) =>
  new Request(`http://memoryai.test${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify(corps),
  });

describe("les écritures pendant le sauvetage", () => {
  it("/api/faits et /api/pieces répondent 503 sauvetage_en_cours, sans rien écrire", async () => {
    fermees = true;
    for (const [post, chemin, corps] of [
      [postFaits, "/api/faits", { faits: [] }],
      [postPieces, "/api/pieces", { pieces: [] }],
    ] as const) {
      const r = await post(requete(chemin, corps));
      expect(r.status, chemin).toBe(503);
      expect((await r.json()).error).toBe("sauvetage_en_cours");
    }
    expect(ecrireLot).not.toHaveBeenCalled();
    expect(ecrireLotPieces).not.toHaveBeenCalled();
  });

  it("un jeton faux reçoit toujours son 401 : le sauvetage ne se révèle pas à un inconnu", async () => {
    fermees = true;
    expect((await postFaits(requete("/api/faits", { faits: [] }, "faux-jeton-0123456789abcdef"))).status).toBe(401);
  });

  it("sauvetage clos : la route écrit de nouveau", async () => {
    fermees = false;
    expect((await postFaits(requete("/api/faits", { faits: [] }))).status).toBe(200);
    expect(ecrireLot).toHaveBeenCalledTimes(1);
  });
});
