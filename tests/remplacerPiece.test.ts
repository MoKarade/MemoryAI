// tests/remplacerPiece.test.ts — [L39] une VRAIE lecture remplace un INVENTAIRE, et rien
// d'autre ne remplace jamais. Sur une vraie Postgres, parce que ce qui se prouve ici est ce
// qui est RÉELLEMENT écrit : deux lignes, deux statuts, UNE seule identité vivante.
//
// ⚠️⚠️ POURQUOI CE FICHIER EXISTE. `empreintePiece(cle, sujet, fileId)` identifie le
// DOCUMENT, pas la lecture — et le chemin d'écriture répondait `dejaPresentes` sur collision,
// sans aucun UPDATE. Donc DriveAI pouvait ouvrir un papier, appeler un modèle, PAYER l'appel,
// et la ligne restait celle devinée du nom de fichier. L'argent partait, rien ne changeait.
// C'est l'ADR 0006 qui tranche, et chaque « jamais » de son §6 a sa garde ci-dessous.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const depot = () => depotPiecesDrizzle(db);

/** Ce que la MIGRATION écrit : le type et l'émetteur devinés du nom de fichier. Rien de lu. */
function inventaire(fileId: string, extra: Record<string, unknown> = {}) {
  return {
    type: "bail",
    emetteur: "Gestion Exemple",
    annee: 2026,
    domaine: "03 · Logement & véhicule",
    extracteur: EXTRACTEUR_MIGRATION,
    exemplaires: [{ file_id: fileId }],
    ...extra,
  };
}

/** Ce qu'une VRAIE lecture écrit : un résumé, des champs, une confiance. */
function lecture(fileId: string, extra: Record<string, unknown> = {}) {
  return {
    type: "bail",
    emetteur: "Gestion Exemple",
    annee: 2026,
    domaine: "03 · Logement & véhicule",
    resume: "Bail de 12 mois avec stationnement souterrain inclus.",
    champs_libres: { particularite: "stationnement souterrain" },
    extracteur: "haiku-4.5-piece-v1",
    exemplaires: [{ file_id: fileId }],
    ...extra,
  };
}

const lire = async (id: string) => (await db.select().from(schema.pieces).where(eq(schema.pieces.id, id)))[0];
const combien = async () => Number((await db.select({ n: sql<number>`count(*)::int` }).from(schema.pieces))[0]!.n);

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

describe("une vraie lecture remplace un inventaire — le seul sens autorisé", () => {
  it("la lecture est écrite, l'ancienne est GARDÉE et marquée, et le neuf la DÉSIGNE", async () => {
    const a = await ecrireLotPieces([inventaire("f-remplace")], DRIVEAI, cle, depot());
    expect(a.acceptees).toBe(1);
    expect(a.remplacees).toBe(0);
    const ancienId = a.idsCrees[0]!;

    const b = await ecrireLotPieces([lecture("f-remplace")], DRIVEAI, cle, depot());
    expect(b.acceptees).toBe(1);
    // ⚠️ LE COMPTEUR EST LA MOITIÉ UTILE : sans lui, `acceptees: 1` ne distingue pas un
    // enrichissement d'un ajout, donc une boucle qui dépense sans rien changer serait
    // indistinguable d'une boucle qui travaille.
    expect(b.remplacees).toBe(1);
    expect(b.dejaPresentes).toBe(0);

    const ancien = await lire(ancienId);
    expect(ancien, "l'ancienne ligne doit EXISTER encore — rien n'est supprimé").toBeDefined();
    expect(ancien!.statut).toBe("remplacee");
    // Elle a CÉDÉ l'empreinte canonique : sinon l'index unique aurait refusé l'insertion.
    expect(ancien!.empreinte).toBe(`remplacee:${ancienId}`);

    const neuf = await lire(b.idsCrees[0]!);
    expect(neuf!.statut).toBe("active");
    expect(neuf!.remplaceId, "sans ce champ, « gardée » ne veut rien dire").toBe(ancienId);
    expect(neuf!.extracteur).toBe("haiku-4.5-piece-v1");
  });

  it("⚠️ c'est le CONTENU qui apparaît : la lecture donne un résumé là où l'inventaire n'en a aucun", async () => {
    // La mesure qui justifie tout le lot. L'inventaire ne porte que ce qu'un nom de fichier
    // laisse devenir : un type, un émetteur, une année. Ce que le papier DIT n'existe
    // qu'après une vraie lecture.
    const a = await ecrireLotPieces([inventaire("f-contenu")], DRIVEAI, cle, depot());
    const avant = await lire(a.idsCrees[0]!);
    expect(avant!.resume).toBeNull();
    // ⚠️⚠️ MESURE QUI CORRIGE L'ADR 0006 §1.1 : `recherche` n'est PAS nulle pour un
    // inventaire, parce que `validerPiece` la DÉRIVE du type et de l'émetteur devinés. Le
    // papier est donc déjà trouvable par son ÉTIQUETTE — ce qui manquait est son CONTENU, pas
    // son existence. Le §1.1 disait « une colonne nulle ne matche rien » : mécanisme faux,
    // manque réel mais plus étroit.
    expect(avant!.recherche).toContain("bail");
    expect(avant!.recherche).not.toContain("stationnement");

    const b = await ecrireLotPieces([lecture("f-contenu")], DRIVEAI, cle, depot());
    const apres = await lire(b.idsCrees[0]!);
    expect(apres!.resume).toContain("stationnement");
    expect(apres!.recherche).toContain("stationnement");
  });
});

describe("les quatre « jamais » de l'ADR 0006 §6", () => {
  it("une VRAIE LECTURE n'est jamais écrasée par un extracteur HORS LIGNÉE", async () => {
    // ⚠️ CE CAS A ÉTÉ PRÉCISÉ PAR L'ADR 0008, il n'a pas été supprimé. Son titre disait
    // « même par une autre vraie lecture », ce qui n'est plus vrai en général : un rang
    // strictement supérieur de la lignée remplace désormais. Ce qui reste vrai, et c'est la
    // moitié qui PROTÈGE, c'est qu'un nom que MemoryAI ne connaît pas ne remplace rien — un
    // producteur ne peut pas s'auto-autoriser en changeant son étiquette.
    const a = await ecrireLotPieces([lecture("f-deux-lectures")], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces(
      // Un autre modèle, et une confiance qu'il s'attribue LUI-MÊME : rien de tout ça
      // n'autorise à écraser, justement parce qu'il se l'attribue lui-même.
      [lecture("f-deux-lectures", { extracteur: "sonnet-4.6-piece-v1", confiance: 0.99 })],
      DRIVEAI,
      cle,
      depot(),
    );
    expect(b.remplacees).toBe(0);
    expect(b.acceptees).toBe(0);
    expect(b.dejaPresentes).toBe(1);
    const p = await lire(a.idsCrees[0]!);
    expect(p!.statut).toBe("active");
    expect(p!.extracteur).toBe("haiku-4.5-piece-v1");
  });

  it("⚠️ ADR 0008 : un rang SUPÉRIEUR de la lignée remplace, et l'ancienne est gardée", async () => {
    // Le cas que l'amendement existe pour permettre : un papier lu le 17/09 sous un prompt
    // qui ne demandait pas la date de naissance et n'offrait aucune façon de dire « je n'ai
    // pas pu lire ». Sans ce sens, cette extraction restait à vie, et la dette grandissait à
    // chaque amélioration du prompt.
    const a = await ecrireLotPieces([lecture("f-lignee")], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces(
      [lecture("f-lignee", { extracteur: "haiku-4.5-piece-v2", resume: "Relu sous le prompt du 21/09." })],
      DRIVEAI, cle, depot(),
    );
    expect(b.remplacees).toBe(1);
    expect(b.acceptees).toBe(1);
    expect(b.dejaPresentes).toBe(0);
    // ⚠️ RIEN N'EST DÉTRUIT, et c'est ce qui referme la porte que l'ADR 0006 craignait : une
    // relecture ratée ne fait pas disparaître la bonne, elle la marque. On peut comparer.
    const ancienne = await lire(a.idsCrees[0]!);
    expect(ancienne!.statut).toBe("remplacee");
    const neuve = await lire(b.idsCrees[0]!);
    expect(neuve!.remplaceId).toBe(a.idsCrees[0]!);
    expect(neuve!.resume).toContain("21/09");
  });

  it("⚠️ et on NE REDESCEND PAS : le rang inférieur ne reprend jamais la main", async () => {
    // Sans ce cas, « la plus récente gagne » rentrerait par la fenêtre : il suffirait qu'un
    // rejeu de l'ancienne campagne repasse après la neuve.
    await ecrireLotPieces([lecture("f-redescente", { extracteur: "haiku-4.5-piece-v2" })], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces([lecture("f-redescente")], DRIVEAI, cle, depot());
    expect(b.remplacees).toBe(0);
    expect(b.dejaPresentes).toBe(1);
  });

  it("un inventaire ne remplace pas un inventaire — il n'y a rien à gagner", async () => {
    await ecrireLotPieces([inventaire("f-deux-inv")], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces([inventaire("f-deux-inv")], DRIVEAI, cle, depot());
    expect(b.remplacees).toBe(0);
    expect(b.dejaPresentes).toBe(1);
  });

  it("⚠️ un inventaire ne remplace pas une vraie lecture — le sens INVERSE est refusé", async () => {
    // Le cas qui arrive pour de vrai : un rejeu de la migration passe APRÈS que DriveAI a lu.
    // L'accepter effacerait un contenu au profit d'un nom de fichier.
    const a = await ecrireLotPieces([lecture("f-inverse")], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces([inventaire("f-inverse")], DRIVEAI, cle, depot());
    expect(b.remplacees).toBe(0);
    expect(b.dejaPresentes).toBe(1);
    const p = await lire(a.idsCrees[0]!);
    expect(p!.resume).toContain("stationnement");
  });

  it("RIEN n'est supprimé : un remplacement ajoute exactement UNE ligne", async () => {
    await ecrireLotPieces([inventaire("f-compte")], DRIVEAI, cle, depot());
    const avant = await combien();
    const b = await ecrireLotPieces([lecture("f-compte")], DRIVEAI, cle, depot());
    expect(b.remplacees).toBe(1);
    expect(await combien()).toBe(avant + 1);
  });

  it("⚠️ un document garde exactement UNE identité VIVANTE, et c'est la lecture", async () => {
    // La conséquence de l'ORDRE des deux écritures. Si l'ancienne n'avait pas cédé son
    // empreinte, l'insertion aurait violé `pieces_empreinte` ; si elle l'avait cédée SANS que
    // la neuve la prenne, le document serait devenu invisible à l'idempotence — et une
    // troisième passe en aurait créé une SECONDE copie. C'est cette troisième passe qui le
    // mesure, parce qu'elle est la seule chose qui distingue les deux pannes.
    await ecrireLotPieces([inventaire("f-identite")], DRIVEAI, cle, depot());
    const b = await ecrireLotPieces([lecture("f-identite")], DRIVEAI, cle, depot());

    const troisieme = await ecrireLotPieces([lecture("f-identite")], DRIVEAI, cle, depot());
    expect(troisieme.acceptees, "aucune seconde copie").toBe(0);
    expect(troisieme.dejaPresentes).toBe(1);

    const vivantes = await db.select().from(schema.pieces).where(eq(schema.pieces.statut, "active"));
    const pourCeDocument = vivantes.filter((p) => p.id === b.idsCrees[0]!);
    expect(pourCeDocument).toHaveLength(1);
  });
});

describe("⚠️ et la pièce remplacée disparaît de ce que Marc VOIT", () => {
  it("une seule réponse, pas deux — le filtre `statut = active` devient enfin atteignable", async () => {
    // `depotLecture.vivante()` filtrait déjà sur le statut ; ce lot est ce qui rend cette
    // branche ATTEIGNABLE. Sans elle, remplacer aurait DOUBLÉ chaque papier dans la recherche
    // de Marc — le remède aurait coûté plus que le défaut.
    const lectureDepot = depotPiecesLectureDrizzle(db);

    await ecrireLotPieces([inventaire("f-vue", { emetteur: "Bailleur Singulier" })], DRIVEAI, cle, depot());
    const req = { texte: "Bailleur Singulier", limite: 10 };
    // ⚠️ ANTI-VACUITÉ : la requête doit TROUVER l'inventaire, sinon « une seule réponse »
    // serait vrai parce que la recherche ne matche rien du tout.
    expect(await lectureDepot.compter({ texte: req.texte })).toBe(1);

    await ecrireLotPieces([lecture("f-vue", { emetteur: "Bailleur Singulier" })], DRIVEAI, cle, depot());
    expect(await lectureDepot.compter({ texte: req.texte })).toBe(1);
    const trouvees = await lectureDepot.chercher(req);
    expect(trouvees).toHaveLength(1);
    // La projection de lecture ne publie pas `extracteur` : on discrimine donc sur ce que
    // Marc VOIT vraiment, ce qui est plus fidele de toute facon — le contenu lu, pas la
    // ligne devinee du nom de fichier.
    expect(trouvees[0]!.piece.resume).toContain("stationnement");
  });
});
