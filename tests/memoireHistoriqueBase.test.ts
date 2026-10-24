// tests/memoireHistoriqueBase.test.ts — les comptes par jour de l'onglet Historique sur une VRAIE
// Postgres (PGlite) : la requête passe, et le jour est celui de Québec. Base FICTIVE.
//
// ⚠️ Prod du 23/10 : « column faits.cree_le must appear in the GROUP BY clause ». Le fuseau, passé
// en paramètre, l'était deux fois ($1 dans le select, $3 dans le group by) : pour Postgres, deux
// expressions différentes. Un dépôt simulé ne le voit pas ; seule une vraie base le voit.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { depotHistoriqueDrizzle } from "@/lib/memoire/depotHistorique";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
  // 23/10 à 21 h 30 à Québec = 24/10 01 h 30 UTC : le fait compte le 23.
  for (const [id, cree] of [
    ["f1", "2026-10-22T15:00:00Z"],
    ["f2", "2026-10-24T01:30:00Z"],
    ["f3", "2026-10-23T14:00:00Z"],
  ]) {
    await pg.query(
      `INSERT INTO faits (id, sujet, predicat, valeur_type, niveau, fiabilite_source, version_vocabulaire, empreinte, cree_le)
       VALUES ($1, 'marc', 'fictif', 'texte', 0, 'declaree', 1, $1, $2)`,
      [id, cree],
    );
  }
  // f1 a été remplacé (périmé) ; un fait périmé puis oublié ne compte plus.
  await pg.query(`UPDATE faits SET statut = 'perime', predicat = 'fictif.corrige' WHERE id = 'f1'`);
  await pg.query(`UPDATE faits SET statut = 'perime', supprime_le = now() WHERE id = 'f2'`);
  await pg.query(
    `INSERT INTO acces_journal (lecteur, outil, usage, niveau_max_servi, hmac, ts) VALUES ('chat', 'fictif', 'chat', 0, 'hmac-fictif', '2026-10-24T01:30:00Z')`,
  );
});
afterAll(async () => {
  await pg.close();
});

describe("les comptes par jour, sur une vraie base", () => {
  it("compte les faits écrits au jour de Québec", async () => {
    const r = await depotHistoriqueDrizzle(db as never).faitsParJour(new Date("2026-10-01T00:00:00Z"));
    expect([...r].sort((a, b) => a.jour.localeCompare(b.jour))).toEqual([
      { jour: "2026-10-22", n: 1 },
      { jour: "2026-10-23", n: 2 },
    ]);
  });

  it("compte les lectures au jour de Québec", async () => {
    const r = await depotHistoriqueDrizzle(db as never).lecturesParJour(new Date("2026-10-01T00:00:00Z"));
    expect(r).toEqual([{ jour: "2026-10-23", n: 1 }]);
  });

  it("liste les faits périmés, nommés par leur prédicat, sans les oubliés", async () => {
    const r = await depotHistoriqueDrizzle(db as never).corrections(8);
    expect(r).toEqual([{ predicat: "fictif.corrige" }]);
  });
});
