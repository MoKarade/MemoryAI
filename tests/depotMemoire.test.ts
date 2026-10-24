// tests/depotMemoire.test.ts — les comptes de l'onglet Mémoire (maquette v5, écart C), sur PGlite :
// faits validés par source (les autres statuts ne comptent pas) et papiers gardés.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { ecrireLot } from "../lib/ecrireFaits";
import type { Ecrivain } from "../lib/jetons";
import { depotMemoireDrizzle } from "../lib/memoire/depotMemoire";
import { BON } from "./fixtures/faits";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
});
afterAll(async () => pg?.close());

describe("faitsParSource", () => {
  it("compte seulement les faits validés, par type de source, avec la date la plus récente", async () => {
    const lot = ["emploi.employeur", "logement.ville"].map((predicat, i) => ({ ...BON, predicat, provenance: { ...BON.provenance, source_ref: `ref-${i}` } }));
    await ecrireLot(lot, DRIVEAI, cle, depotDrizzle(db));
    const [premier] = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "emploi.employeur"));
    expect(await depotMemoireDrizzle(db).faitsParSource()).toEqual([]);
    expect(await depotAdminDrizzle(db).valider(premier!.id, new Date("2026-10-24T12:00:00Z"))).toBe("ok");
    const r = await depotMemoireDrizzle(db).faitsParSource();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: "document", n: 1 });
    expect(r[0]?.dernier).toBeInstanceOf(Date);
  });
});

describe("nombrePapiers et papiersParDomaine", () => {
  it("rend zéro sans papier", async () => {
    expect(await depotMemoireDrizzle(db).nombrePapiers()).toBe(0);
    expect(await depotMemoireDrizzle(db).papiersParDomaine()).toEqual([]);
  });

  it("compte les papiers gardés par dossier ; un papier supprimé ne compte plus", async () => {
    const papier = (id: string, domaine: string | null) => ({ id, niveau: 2, resumeEnClair: false, extracteur: "fictif", empreinte: `empreinte-${id}`, domaine });
    await db.insert(schema.pieces).values([papier("p1", "Dossier A"), papier("p2", "Dossier A"), papier("p3", null), papier("p4", "Dossier B")]);
    await db.update(schema.pieces).set({ supprimeLe: new Date() }).where(eq(schema.pieces.id, "p4"));
    const r = (await depotMemoireDrizzle(db).papiersParDomaine()).sort((a, b) => (a.domaine ?? "").localeCompare(b.domaine ?? ""));
    expect(r).toEqual([
      { domaine: null, n: 1 },
      { domaine: "Dossier A", n: 2 },
    ]);
    expect(await depotMemoireDrizzle(db).nombrePapiers()).toBe(3);
  });
});
