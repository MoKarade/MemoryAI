// tests/depotAccueil.test.ts — les comptes des panneaux de la maison (maquette v5, écart B), sur
// PGlite : la dépense par modèle depuis un jour, les appels par outil depuis un instant.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { depotAccueilDrizzle } from "../lib/accueil/depotAccueil";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
});
afterAll(async () => pg?.close());

const lecture = (outil: string, ts: string) => ({ ts: new Date(ts), version: 2, lecteur: "chat", outil, usage: "conversation" as const, niveauMaxServi: 0, hmac: "fictif" });

describe("appelsParOutilDepuis", () => {
  it("compte les appels depuis l'instant, par outil, le plus appelé d'abord", async () => {
    await db.insert(schema.accesJournal).values([
      lecture("memoryai_chercher", "2026-10-02T12:00:00Z"),
      lecture("memoryai_etat", "2026-10-03T12:00:00Z"),
      lecture("memoryai_etat", "2026-10-04T12:00:00Z"),
      lecture("memoryai_etat", "2026-09-30T12:00:00Z"),
    ]);
    const appels = await depotAccueilDrizzle(db).appelsParOutilDepuis(new Date("2026-10-01T04:00:00Z"));
    expect(appels).toEqual([
      { outil: "memoryai_etat", n: 2 },
      { outil: "memoryai_chercher", n: 1 },
    ]);
  });

  it("rien depuis l'instant : une liste vide, pas une erreur", async () => {
    expect(await depotAccueilDrizzle(db).appelsParOutilDepuis(new Date("2027-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("lecturesDepuis", () => {
  it("rend les lectures depuis l'instant, la plus récente d'abord, sans dépasser la limite", async () => {
    const r = await depotAccueilDrizzle(db).lecturesDepuis(new Date("2026-10-03T00:00:00Z"), 1);
    expect(r).toEqual([{ ts: new Date("2026-10-04T12:00:00Z"), lecteur: "chat", outil: "memoryai_etat" }]);
  });
});

describe("depenseParModeleDepuis", () => {
  it("somme la dépense par modèle depuis le jour (inclus), la plus forte d'abord", async () => {
    const ligne = (jour: string, modele: string, coutUsd: number) => ({ jour, modele, coutUsd, poste: "chat" as const });
    await db.insert(schema.depensesChat).values([
      ligne("2026-09-24", "claude-sonnet-5", 9),
      ligne("2026-09-25", "claude-haiku-5", 0.5),
      ligne("2026-10-20", "claude-sonnet-5", 2),
      ligne("2026-10-21", "claude-haiku-5", 0.25),
    ]);
    expect(await depotAccueilDrizzle(db).depenseParModeleDepuis("2026-09-25")).toEqual([
      { modele: "claude-sonnet-5", usd: 2 },
      { modele: "claude-haiku-5", usd: 0.75 },
    ]);
  });
});
