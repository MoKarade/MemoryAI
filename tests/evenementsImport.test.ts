// tests/evenementsImport.test.ts — l'import d'un export en événements, sur une VRAIE Postgres (ADR 0020).
//
// Ce que « fini » exige (MemoryAI#70) et qui ne se déduit pas du code : relancer l'import ne crée
// aucun doublon ; un papier oublié ne revient pas en messages ; aucun texte ne sort du résultat ;
// le texte est chiffré au niveau 2 et se relit.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { dechiffrer, deriverCle } from "../lib/chiffrement";
import { importerExport, NIVEAU_MESSAGE } from "../lib/evenements/depot";
import { lireExportMessenger } from "../lib/evenements/messenger";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { depotOubliPiecesDrizzle } from "../lib/pieces/depotOubli";
import type { Ecrivain } from "../lib/jetons";
import { exportFictif } from "./fixtures/messenger";

const cle = deriverCle(Buffer.alloc(32, 5).toString("base64"));
let pg: PGlite;
let db: ReturnType<typeof drizzle>;

const TEXTE = "Rendez-vous au parc fictif";
// Assemblée à l'exécution, comme dans `tests/secrets.test.ts` : aucune ligne ne ressemble à une clé.
const FAUSSE_CLE = ["sk", "ant", "api03", "Xy9Zk2mQ4nR7tV1wB8cD3eF6gH0jK5lM"].join("-"); // gitleaks:allow (factice)
const lu = lireExportMessenger(
  exportFictif({
    fil: "Fil fictif",
    participants: ["Alice Fictive", "Paul Exemple"],
    messages: [
      { auteur: "Alice Fictive", date: "mai 3, 2022 6:00:00 pm", texte: `Ma clé : ${FAUSSE_CLE}` },
      { auteur: "Paul Exemple", date: "mai 3, 2022 5:00:00 pm", texte: TEXTE },
    ],
  }),
);

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

describe("importer un export Messenger", () => {
  it("écrit chaque message, avec son auteur et ses destinataires, et ne rend que des nombres", async () => {
    const r = await importerExport(db, cle, lu, "fichier-fictif-0001", "driveai");
    expect(r).toEqual({ lus: 2, ecrits: 2, dejaPresents: 0, datesIllisibles: 0, personnesNouvelles: 2, secretsRetires: 1, oublie: false });
    expect(JSON.stringify(r)).not.toContain("parc");

    const ev = await db.select().from(schema.evenements).where(eq(schema.evenements.sourceRef, "fichier-fictif-0001"));
    expect(ev.map((e) => e.position).sort()).toEqual([0, 1]);
    const premier = ev.find((e) => e.position === 0)!;
    expect(premier.survenuLe.toISOString()).toBe("2022-05-03T21:00:00.000Z");
    expect(premier.texte).not.toContain("parc");
    expect(dechiffrer(cle, premier.texte!, `evenement|${premier.id}`, NIVEAU_MESSAGE)).toBe(TEXTE);
    const second = ev.find((e) => e.position === 1)!;
    expect(dechiffrer(cle, second.texte!, `evenement|${second.id}`, NIVEAU_MESSAGE)).not.toContain(FAUSSE_CLE);

    const roles = await db.select().from(schema.evenementPersonnes).where(eq(schema.evenementPersonnes.evenementId, premier.id));
    expect(roles.map((x) => x.role).sort()).toEqual(["auteur", "destinataire"]);
    const marc = await db.select().from(schema.personnes).where(eq(schema.personnes.estMarc, true));
    expect(marc).toHaveLength(1);
    expect(marc[0]!.id).toBe(premier.auteurId);
    expect(marc[0]!.nom).not.toContain("Paul");
  });

  it("relancer l'import ne crée aucun doublon, ni message ni personne", async () => {
    const r = await importerExport(db, cle, lu, "fichier-fictif-0001", "driveai");
    expect(r).toMatchObject({ ecrits: 0, dejaPresents: 2, personnesNouvelles: 0 });
    expect(await db.select().from(schema.evenements)).toHaveLength(2);
    expect(await db.select().from(schema.personnes)).toHaveLength(2);
    expect(await db.select().from(schema.evenementPersonnes)).toHaveLength(4);
  });

  it("la même personne dans un autre export reste la même personne", async () => {
    const r = await importerExport(db, cle, lu, "fichier-fictif-0002", "driveai");
    expect(r).toMatchObject({ ecrits: 2, personnesNouvelles: 0 });
  });

  it("un papier oublié emporte ses messages et ne revient pas par l'import", async () => {
    const driveai: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
    await ecrireLotPieces(
      [{ type: "export", emetteur: "Exemple", annee: 2022, domaine: "_Technique", exemplaires: [{ file_id: "fichier-fictif-0003", chemin: "/x" }], extracteur: "haiku-4.5-piece-v1" }],
      driveai,
      cle,
      depotPiecesDrizzle(db),
    );
    await importerExport(db, cle, lu, "fichier-fictif-0003", "driveai");
    const [ex] = await db.select().from(schema.pieceExemplaires).where(eq(schema.pieceExemplaires.fileId, "fichier-fictif-0003"));
    expect(await depotOubliPiecesDrizzle(db).oublier(ex!.pieceId, cle, "test", new Date())).toBe("ok");

    const restes = await db.select().from(schema.evenements).where(eq(schema.evenements.sourceRef, "fichier-fictif-0003"));
    expect(restes.every((e) => e.supprimeLe !== null)).toBe(true);
    await db.delete(schema.evenements).where(eq(schema.evenements.sourceRef, "fichier-fictif-0003"));
    expect(await importerExport(db, cle, lu, "fichier-fictif-0003", "driveai")).toMatchObject({ oublie: true, ecrits: 0 });
  });
});
