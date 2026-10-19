// tests/piecesOubli.test.ts — LE RETRAIT d'une pièce, sur une VRAIE Postgres.
//
// Ce fichier existe parce que le chemin qu'il teste n'existait pas : `empreinteOubliPiece`
// était écrite, testée et commentée depuis C49-1, et PERSONNE ne pouvait en poser une (ni
// page, ni outil, et le bouton « oublier » de la file ne vise que les FAITS). Marc a choisi le
// 17/09 de pousser `04 · Immigration` et `01 · Administratif & identité` EN PREMIER, en
// s'appuyant sur ce retour en arrière : il reposait sur une possibilité qui n'existait pas.
//
// Quatre propriétés, et aucune ne se déduit du code :
//
//  1. bout en bout, une pièce oubliée NE REVIENT PAS — c'est le seul énoncé qui compte ;
//  2. TOUS les exemplaires reçoivent l'empreinte, pas seulement le principal : sinon le même
//     papier rentre par sa deuxième copie au prochain rattrapage, sous une autre pièce ;
//  3. l'empreinte se pose AVANT la suppression — prouvé en coupant l'écriture entre les deux ;
//  4. `introuvable` n'est jamais un `ok` complaisant, sinon l'écran affirme un retrait qui
//     n'a pas eu lieu.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, isNull, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { ecrireLotPieces, empreinteOubliPiece } from "../lib/pieces/ecrire";
import { depotOubliPiecesDrizzle, listerPiecesRecentes } from "../lib/pieces/depotOubli";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 9).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

const papier = (fileIds: string[], extra: Record<string, unknown> = {}) => ({
  type: "permis de travail",
  emetteur: "Ministère Exemple",
  annee: 2026,
  domaine: "04 · Immigration",
  date_document: "2026-03-01",
  exemplaires: fileIds.map((f) => ({ file_id: f, chemin: `/04 · Immigration/${f}` })),
  extracteur: "haiku-4.5-piece-v1",
  ...extra,
});

const ecrire = (p: ReturnType<typeof papier>) =>
  ecrireLotPieces([p], DRIVEAI, cle, depotPiecesDrizzle(db));

const idDe = async (fileId: string) => {
  const r = await db
    .select({ id: schema.pieceExemplaires.pieceId })
    .from(schema.pieceExemplaires)
    .where(eq(schema.pieceExemplaires.fileId, fileId));
  return r[0]!.id;
};

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

describe("retirer une pièce", () => {
  it("une pièce oubliée ne revient pas, même réécrite à l'identique", async () => {
    expect((await ecrire(papier(["ret-a1"]))).acceptees).toBe(1);
    const id = await idDe("ret-a1");

    expect(await depotOubliPiecesDrizzle(db).oublier(id, cle, "test", new Date())).toBe("ok");

    const rejeu = await ecrire(papier(["ret-a1"]));
    expect(rejeu.oubliees).toBe(1);
    expect(rejeu.acceptees).toBe(0);
    // ⚠️ Et RIEN n'a été réinséré : « comptée oubliée » et « pas écrite » sont deux choses,
    // et c'est la seconde qui compte pour Marc.
    const actives = await db
      .select({ id: schema.pieces.id })
      .from(schema.pieces)
      .where(isNull(schema.pieces.supprimeLe));
    expect(actives.map((a) => a.id)).not.toContain(id);
  });

  it("TOUS les exemplaires sont oubliés, pas seulement le principal", async () => {
    // Deux copies du même papier dans le Drive. `ret-b1` est le principal (le premier).
    expect((await ecrire(papier(["ret-b1", "ret-b2"]))).acceptees).toBe(1);
    const id = await idDe("ret-b1");
    expect(await depotOubliPiecesDrizzle(db).oublier(id, cle, "test", new Date())).toBe("ok");

    // ⚠️ LE CAS QUI DISCRIMINE : le rattrapage repasse et ne voit que la SECONDE copie, qui
    // devient alors le principal. Si l'oubli n'avait porté que sur `ret-b1`, ce papier
    // rentrerait ici sous une autre pièce — un retrait qui laisse entrer la même chose par la
    // porte d'à côté n'est pas un retrait.
    const rejeu = await ecrire(papier(["ret-b2"]));
    expect(rejeu.oubliees).toBe(1);
    expect(rejeu.acceptees).toBe(0);
  });

  it("l'empreinte est posée AVANT la suppression", async () => {
    expect((await ecrire(papier(["ret-c1"]))).acceptees).toBe(1);
    const id = await idDe("ret-c1");

    // Une coupure entre les deux écritures. Dans l'ordre inverse, elle laisserait une pièce
    // SUPPRIMÉE SANS OUBLI : elle reviendrait au prochain rattrapage et Marc croirait l'avoir
    // retirée. Ici, la coupure doit laisser l'état le plus sûr — empreinte posée, pièce encore
    // là (donc un second clic finit le travail).
    const dbCoupee = {
      select: db.select.bind(db),
      insert: db.insert.bind(db),
      update: () => {
        throw new Error("coupure entre les deux écritures");
      },
    } as unknown as Parameters<typeof depotOubliPiecesDrizzle>[0];

    await expect(depotOubliPiecesDrizzle(dbCoupee).oublier(id, cle, "test", new Date())).rejects.toThrow(/coupure/);

    const attendue = empreinteOubliPiece(cle, "marc", "ret-c1");
    const posees = await db.select({ e: schema.oublis.empreinte }).from(schema.oublis).where(eq(schema.oublis.empreinte, attendue));
    expect(posees).toHaveLength(1);
    const encoreLa = await db
      .select({ id: schema.pieces.id })
      .from(schema.pieces)
      .where(and(eq(schema.pieces.id, id), isNull(schema.pieces.supprimeLe)));
    expect(encoreLa).toHaveLength(1);

    // Et le second clic aboutit : l'empreinte déjà posée ne fait pas échouer l'insertion.
    expect(await depotOubliPiecesDrizzle(db).oublier(id, cle, "test", new Date())).toBe("ok");
  });

  it("« introuvable » plutôt qu'un ok complaisant", async () => {
    const depot = depotOubliPiecesDrizzle(db);
    expect(await depot.oublier("00000000-0000-4000-8000-000000000000", cle, "test", new Date())).toBe("introuvable");

    expect((await ecrire(papier(["ret-d1"]))).acceptees).toBe(1);
    const id = await idDe("ret-d1");
    expect(await depot.oublier(id, cle, "test", new Date())).toBe("ok");
    // Déjà partie : le second appel ne doit pas affirmer un retrait qui n'a pas eu lieu.
    expect(await depot.oublier(id, cle, "test", new Date())).toBe("introuvable");
  });
});

describe("la liste de l'écran de retrait", () => {
  it("ne rend QUE des métadonnées, jamais le contenu", async () => {
    await ecrire(papier(["ret-e1"], { resume: "Permis valide jusqu'en 2027.", champs_structures: { numeros: [{ libelle: "n° de dossier", valeur: "W7654321" }] } }));
    const lignes = await listerPiecesRecentes(db, 50);
    expect(lignes.length).toBeGreaterThan(0);
    // ⚠️ Liste FERMÉE : le jour où quelqu'un ajoute `resume` ou `titulaire` à cette requête
    // « pour que l'écran soit plus parlant », ce test tombe. C'est exactement le geste qu'on
    // veut rendre délibéré — cet écran déchiffrerait alors cent pièces à chaque affichage.
    expect(Object.keys(lignes[0]!).sort()).toEqual(
      ["annee", "creeLe", "dateDocument", "domaine", "extracteur", "fileIds", "id", "niveau"].sort(),
    );
  });

  it("exclut les pièces retirées et rend les exemplaires", async () => {
    await ecrire(papier(["ret-f1", "ret-f2"]));
    const id = await idDe("ret-f1");
    const avant = await listerPiecesRecentes(db, 100);
    expect(avant.find((l) => l.id === id)?.fileIds.sort()).toEqual(["ret-f1", "ret-f2"]);

    await depotOubliPiecesDrizzle(db).oublier(id, cle, "test", new Date());
    const apres = await listerPiecesRecentes(db, 100);
    expect(apres.map((l) => l.id)).not.toContain(id);
  });
});
