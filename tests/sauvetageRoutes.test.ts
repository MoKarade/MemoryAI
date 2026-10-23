// tests/sauvetageRoutes.test.ts — pendant le sauvetage, les apps n'écrivent pas (ADR 0019 §2).
//
// La porte est au point d'écriture (`ecrireLot`, `ecrireLotPieces`, prouvé sur une vraie Postgres
// dans `tests/sauvetage.test.ts`). Ici, la traduction HTTP : l'erreur devient un 503
// `sauvetage_en_cours` (une panne, que l'écrivain retente), APRÈS l'identité — un inconnu reçoit
// toujours son 401.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

let fermees = true;
const { SauvetageEnCoursError } = await import("@/lib/sauvetage/porte");
const ecrireLot = vi.fn(async () => {
  if (fermees) throw new SauvetageEnCoursError();
  return { recus: 0, acceptes: 0, dejaPresents: 0, refuses: [], idsCrees: [] };
});
const ecrireLotPieces = vi.fn(async () => {
  if (fermees) throw new SauvetageEnCoursError();
  return { recus: 0, acceptees: 0, remplacees: 0, dejaPresentes: 0, oubliees: 0, refusees: [], idsCrees: [] };
});

vi.mock("@/lib/migrations", () => ({ assurerMigrations: async () => {} }));
vi.mock("@/lib/db", () => ({ db: {}, baseConfiguree: () => true }));
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
  it("/api/faits et /api/pieces traduisent le refus du point d'écriture en 503 sauvetage_en_cours", async () => {
    fermees = true;
    for (const [post, chemin, corps] of [
      [postFaits, "/api/faits", { faits: [] }],
      [postPieces, "/api/pieces", { pieces: [] }],
    ] as const) {
      const r = await post(requete(chemin, corps));
      expect(r.status, chemin).toBe(503);
      expect((await r.json()).error).toBe("sauvetage_en_cours");
    }
  });

  it("un jeton faux reçoit toujours son 401 : le sauvetage ne se révèle pas à un inconnu", async () => {
    fermees = true;
    expect((await postFaits(requete("/api/faits", { faits: [] }, "faux-jeton-0123456789abcdef"))).status).toBe(401);
    expect(ecrireLot).not.toHaveBeenCalled();
  });

  it("sauvetage clos : la route écrit de nouveau", async () => {
    fermees = false;
    expect((await postFaits(requete("/api/faits", { faits: [] }))).status).toBe(200);
    expect(ecrireLot).toHaveBeenCalledTimes(1);
  });
});
