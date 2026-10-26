// tests/sortiesRetention.test.ts — garder peu, compter les refus, publier deux nombres (ADR 0031 §§ 4-5).
// Sur une vraie Postgres (PGlite) et les migrations committées. Données FICTIVES seulement.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { deriverCle } from "../lib/chiffrement";
import { composerEtatPublic } from "../lib/etatPublic";
import { lireEnvoiSorties } from "../lib/sorties/contrat";
import { ecrireSorties } from "../lib/sorties/depot";
import { comptesSorties, noterRefus, PLAFOND_PAR_APP, purgerSorties, RETENTION_JOURS } from "../lib/sorties/retention";
import { drizzle } from "drizzle-orm/pglite";

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const MAINTENANT = new Date("2026-10-26T12:00:00Z");
const JOUR_MS = 86_400_000;

async function ecrire(app: string, evenements: Record<string, unknown>[]) {
  const lu = lireEnvoiSorties({ source: "sorties", evenements }, MAINTENANT);
  if (!lu.ok) throw new Error(lu.code);
  return ecrireSorties(db as never, cle, app, lu.envoi.sorties);
}

const types = async (app: string) =>
  (await pg.query<{ type: string }>("select type from sorties where app = $1 order by date desc", [app])).rows.map((r) => r.type);

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg);
});

beforeEach(async () => {
  await pg.exec("delete from sorties");
  await pg.exec("delete from sorties_refus");
});

afterAll(async () => {
  await pg?.close();
});

describe("noterRefus — un nombre par jour et par code, jamais un texte", () => {
  it("additionne les codes d'un même jour, d'un appel à l'autre", async () => {
    await noterRefus(db as never, "2026-10-26", ["titre_invalide", "titre_invalide", "date_invalide"]);
    await noterRefus(db as never, "2026-10-26", ["titre_invalide"]);
    const r = await pg.query<{ jour: string; code: string; n: number }>("select jour, code, n from sorties_refus order by code");
    expect(r.rows).toEqual([
      { jour: "2026-10-26", code: "date_invalide", n: 1 },
      { jour: "2026-10-26", code: "titre_invalide", n: 3 },
    ]);
  });

  it("sans code, n'écrit rien ; un code trop long est coupé à 40 caractères", async () => {
    await noterRefus(db as never, "2026-10-26", []);
    expect((await pg.query("select 1 from sorties_refus")).rows).toHaveLength(0);
    await noterRefus(db as never, "2026-10-26", ["x".repeat(100)]);
    const r = await pg.query<{ code: string }>("select code from sorties_refus");
    expect(r.rows[0]?.code).toHaveLength(40);
  });
});

describe("comptesSorties — deux nombres globaux", () => {
  it("compte les sorties gardées et les refus des 7 derniers jours (heure du Québec), pas ceux d'avant", async () => {
    await ecrire("batchchef", [{ type: "recette_ajoutee", date: "2026-10-24T12:00:00Z", titre: "Soupe d'exemple", ref: "r1" }]);
    await ecrire("carai", [{ type: "recharge", date: "2026-10-23T12:00:00Z", titre: "Recharge fictive", ref: "c1" }]);
    await noterRefus(db as never, "2026-10-19", ["titre_invalide", "titre_invalide", "titre_invalide", "titre_invalide", "titre_invalide"]);
    await noterRefus(db as never, "2026-10-20", ["date_invalide", "date_invalide"]);
    await noterRefus(db as never, "2026-10-26", ["corps_trop_grand"]);
    expect(await comptesSorties(db as never, MAINTENANT)).toEqual({ gardees: 2, refusSur7Jours: 3 });
  });

  it("sans rien, rend des zéros — une table vide, pas une panne", async () => {
    expect(await comptesSorties(db as never, MAINTENANT)).toEqual({ gardees: 0, refusSur7Jours: 0 });
  });

  it("/api/etat les publie sans les découper par app, et seulement quand la route les a lus", () => {
    const faits = { parStatut: {}, canaris: 0, migresEnPiece: 0, dernierValideLe: null };
    const sans = composerEtatPublic(faits, { total: 0 }, { lus: 0, nonLus: 0 }, false, { faits: 0, papiers: 0 });
    expect("sorties" in sans).toBe(false);
    const avec = composerEtatPublic(faits, { total: 0 }, { lus: 0, nonLus: 0 }, false, { faits: 0, papiers: 0 }, undefined, {
      gardees: 7,
      refusSur7Jours: 2,
    });
    expect(avec.sorties).toEqual({ gardees: 7, refusSur7Jours: 2 });
    expect(Object.keys(avec.sorties ?? {}).sort()).toEqual(["gardees", "refusSur7Jours"]);
  });
});

describe("purgerSorties — la plus ancienne d'abord, app par app", () => {
  it("efface ce qui a été reçu il y a plus de 180 jours, et rien d'autre", async () => {
    await ecrire("batchchef", [
      { type: "ancien", date: "2026-10-20T12:00:00Z", titre: "Vieille sortie fictive", ref: "a" },
      { type: "recent1", date: "2026-10-21T12:00:00Z", titre: "Sortie fictive un", ref: "b" },
      { type: "recent2", date: "2026-10-22T12:00:00Z", titre: "Sortie fictive deux", ref: "c" },
    ]);
    const vieux = new Date(MAINTENANT.getTime() - (RETENTION_JOURS + 1) * JOUR_MS).toISOString();
    await pg.query("update sorties set recu_le = $1::timestamptz where type = 'ancien'", [vieux]);
    expect(await purgerSorties(db as never, MAINTENANT)).toEqual({ anciennes: 1, enTrop: 0 });
    expect(await types("batchchef")).toEqual(["recent2", "recent1"]);
  });

  it("au-delà du plafond, une app perd SES plus anciennes ; les autres apps n'y perdent rien", async () => {
    await ecrire("batchchef", [
      { type: "s1", date: "2026-10-20T12:00:00Z", titre: "Sortie fictive un", ref: "1" },
      { type: "s2", date: "2026-10-21T12:00:00Z", titre: "Sortie fictive deux", ref: "2" },
      { type: "s3", date: "2026-10-22T12:00:00Z", titre: "Sortie fictive trois", ref: "3" },
      { type: "s4", date: "2026-10-23T12:00:00Z", titre: "Sortie fictive quatre", ref: "4" },
    ]);
    await ecrire("carai", [{ type: "c1", date: "2026-10-19T12:00:00Z", titre: "Recharge fictive", ref: "c" }]);
    expect(await purgerSorties(db as never, MAINTENANT, 2)).toEqual({ anciennes: 0, enTrop: 2 });
    expect(await types("batchchef")).toEqual(["s4", "s3"]);
    expect(await types("carai")).toEqual(["c1"]);
  });

  it("sous les bornes, ne touche à rien — et le plafond de production est celui de l'ADR", async () => {
    await ecrire("jobai", [{ type: "offre", date: "2026-10-24T12:00:00Z", titre: "Offre fictive", ref: "o" }]);
    expect(await purgerSorties(db as never, MAINTENANT)).toEqual({ anciennes: 0, enTrop: 0 });
    expect(await types("jobai")).toEqual(["offre"]);
    expect(PLAFOND_PAR_APP).toBe(2000);
    expect(RETENTION_JOURS).toBe(180);
  });
});
