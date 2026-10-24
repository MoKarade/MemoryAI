// tests/depotAcces.test.ts — le journal de l'onglet Accès, sur PGlite : les filtres par niveau
// servi et « Toi » (ta conversation seule) ne gardent que les lignes qu'ils annoncent.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { depotAccesDrizzle } from "../lib/memoire/depotAcces";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
  const lecture = (lecteur: string, niveauMaxServi: number) => ({ version: 2, lecteur, outil: "memoryai_chercher", usage: "conversation" as const, niveauMaxServi, hmac: "fictif" });
  await db.insert(schema.accesJournal).values([lecture("chat", 1), lecture("claude-ai", 2), lecture("lia-maison", 1), lecture("chat", 2)]);
});
afterAll(async () => pg?.close());

describe("journal", () => {
  it("sans filtre, tout, le plus récent d'abord", async () => {
    const r = await depotAccesDrizzle(db).journal(10, null);
    expect(r.map((l) => l.lecteur)).toEqual(["chat", "lia-maison", "claude-ai", "chat"]);
  });

  it("filtré par niveau, seulement les lectures servies à ce niveau", async () => {
    const r = await depotAccesDrizzle(db).journal(10, 2);
    expect(r.map((l) => [l.lecteur, l.niveauMaxServi])).toEqual([
      ["chat", 2],
      ["claude-ai", 2],
    ]);
  });

  it("« Toi » : seulement ta conversation, ni Claude ni LIA", async () => {
    const r = await depotAccesDrizzle(db).journal(10, "toi");
    expect(r).toHaveLength(2);
    expect(r.every((l) => l.lecteur === "chat")).toBe(true);
  });
});
