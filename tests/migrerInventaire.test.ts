// tests/migrerInventaire.test.ts — les `document.existe` deviennent des PIÈCES, et REVIENNENT.
//
// ADR 0004 §6.2, décision n° 7. « Une migration sur 2 729 lignes de production : elle se livre
// avec son retour en arrière, et elle se prouve sur une copie avant de toucher la prod. »
// Faute d'une copie de la prod ici, elle se prouve sur une VRAIE Postgres et les migrations
// committées — et ce fichier est cette preuve.
//
// Cinq propriétés, et aucune ne se déduit du code :
//   1. la valeur CHIFFRÉE du fait (AAD `id|niveau`) redevient le `fileId` d'une pièce, scellé
//      sous l'identifiant de la PIÈCE — c'est pour ça que c'est du code et pas du SQL ;
//   2. rien n'est effacé : le fait reste, marqué, et cesse simplement d'être SERVI ;
//   3. c'est IDEMPOTENT — une seconde passe ne crée pas de doublon, et `document.existe` est
//      alimenté en continu par le tick de DriveAI, donc on relancera ;
//   4. le RETOUR EN ARRIÈRE rend exactement ce qui a été pris, et rien d'autre ;
//   5. ce qui est sauté est COMPTÉ par motif — une migration qui saute en silence ment.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, isNotNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { dechiffrer, deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotMigrationDrizzle } from "../lib/pieces/depotMigration";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLot } from "../lib/ecrireFaits";
import { estServable } from "../lib/lecture";
import { migrerLotInventaire, annulerMigrationInventaire } from "../lib/pieces/migrerInventaire";
import { pieceDepuisFait, EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 11).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const doc = (fileId: string, dossier: string, attributs: Record<string, string>) => ({
  ...BON,
  predicat: "document.existe",
  valeur: fileId,
  valeur_type: "ref_document" as const,
  valide_de: "2026-03-01",
  attributs,
  provenance: { ...BON.provenance, source_ref: `drive|${fileId}`, extracteur: "moteur-inventaire-v1", dossier },
});

beforeEach(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
  await ecrireLot(
    [
      doc("1AbCdEfGhIjKlMnOpQrStUvWxYz01", "02 · Finances", { type: "Facture", annee: "2026", emetteur: "Hydro" }),
      doc("1AbCdEfGhIjKlMnOpQrStUvWxYz02", "02 · Finances", { type: "Relevé", annee: "2026", emetteur: "Hydro" }),
      // N3 : chiffré intégralement en pièce, et son émetteur ne sort pas.
      doc("1AbCdEfGhIjKlMnOpQrStUvWxYz03", "04 · Immigration", { type: "Permis", annee: "2025" }),
    ],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
});

afterEach(async () => {
  await pg?.close();
});

const migrer = (taille = 50) =>
  migrerLotInventaire(depotMigrationDrizzle(db), depotPiecesDrizzle(db), cle, new Date("2026-09-16T12:00:00Z"), taille);

describe("composer la pièce (PURE)", () => {
  const fait = {
    id: "f1", predicat: "document.existe", valeurType: "ref_document", niveau: 2,
    domaine: "02 · Finances", valideDe: "2026-03-01", creeLe: new Date(),
  };

  it("n'invente RIEN : tout vient du fait", () => {
    const r = pieceDepuisFait(fait, "fid-1", { type: "Facture", annee: "2026", emetteur: "Hydro" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece).toMatchObject({
      origineFaitId: "f1", type: "Facture", emetteur: "Hydro", annee: 2026,
      domaine: "02 · Finances", dateDocument: "2026-03-01", niveau: 2, fileId: "fid-1",
      extracteur: EXTRACTEUR_MIGRATION,
    });
    // ⚠️ Ni résumé, ni champs : personne n'a LU ce papier. Les inventer serait exactement le
    // « no fake data » retourné contre lui-même — un résumé plausible et faux.
    expect("resume" in r.piece).toBe(false);
    expect("champsLibres" in r.piece).toBe(false);
  });

  it("refuse en NOMMANT le motif, jamais en silence", () => {
    expect(pieceDepuisFait({ ...fait, predicat: "emploi.employeur" }, "x", null)).toMatchObject({ refus: "predicat" });
    expect(pieceDepuisFait({ ...fait, valeurType: "texte" }, "x", null)).toMatchObject({ refus: "type_valeur" });
    expect(pieceDepuisFait(fait, "   ", null)).toMatchObject({ refus: "valeur_vide" });
  });

  it("une année aberrante est JETÉE, pas recopiée", () => {
    for (const annee of ["0", "99999", "deux-mille", ""]) {
      const r = pieceDepuisFait(fait, "fid", { annee });
      expect(r.ok && r.piece.annee, annee).toBeNull();
    }
  });

  it("le niveau NE BAISSE PAS, et c'est lui qui décide du régime", () => {
    const n3 = pieceDepuisFait({ ...fait, niveau: 3, domaine: "04 · Immigration" }, "fid", null);
    expect(n3.ok && n3.piece.niveau).toBe(3);
    expect(n3.ok && n3.piece.regime.resumeEnClair).toBe(false);
  });
});

describe("la migration, de bout en bout", () => {
  it("déplace, marque, et NE SERT PLUS le fait — sans rien effacer", async () => {
    const r = await migrer();
    expect(r.lus).toBe(3);
    expect(r.migres).toBe(3);
    expect(r.reste).toBe(0);
    expect(r.refuses).toEqual({});
    expect(r.illisibles).toBe(0);

    // ⚠️ RIEN N'EST EFFACÉ : les trois faits sont toujours là, marqués.
    const faits = await db.select().from(schema.faits);
    expect(faits).toHaveLength(3);
    for (const f of faits) expect(f.migreEnPiece).not.toBeNull();
    // Et ils ne sortent plus — sinon le papier sortirait DEUX fois, une par table.
    const p = { inclureN2: true, n2Autorise: true, inclureN3: false, n3Autorise: false, inclureProposes: true };
    for (const f of faits) expect(estServable(f, p, new Set())).toBe(false);

    // La valeur a traversé le chiffrement : elle était scellée sous l'id du FAIT, elle l'est
    // maintenant sous celui de la PIÈCE. C'est ce passage-là qui interdit le SQL.
    const ex = await db.select().from(schema.pieceExemplaires);
    expect(ex.map((x) => x.fileId).sort()).toEqual([
      "1AbCdEfGhIjKlMnOpQrStUvWxYz01",
      "1AbCdEfGhIjKlMnOpQrStUvWxYz02",
      "1AbCdEfGhIjKlMnOpQrStUvWxYz03",
    ]);
    const pieces = await db.select().from(schema.pieces);
    for (const piece of pieces) expect(piece.origineFaitId).toBeTruthy();
    const hydro = pieces.find((x) => x.domaine === "02 · Finances")!;
    expect(dechiffrer(cle, hydro.emetteur!, hydro.id, hydro.niveau)).toBe("Hydro");
  });

  it("le N3 reste N3 : son émetteur ne sort pas de la lecture", async () => {
    await migrer();
    const rows = await depotPiecesLectureDrizzle(db).chercher({ domaines: ["04 · Immigration"], limite: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.piece.niveau).toBe(3);
    expect(rows[0]!.piece.resumeEnClair).toBe(false);
  });

  it("IDEMPOTENTE : une seconde passe ne crée aucun doublon", async () => {
    await migrer();
    const deux = await migrer();
    expect(deux.lus).toBe(0);
    expect(deux.migres).toBe(0);
    expect(deux.reste).toBe(0);
    expect(await db.select().from(schema.pieces)).toHaveLength(3);
  });

  it("par LOTS, et les PLUS ANCIENS d'abord", async () => {
    // ⚠️ `document.existe` est alimenté en continu par le tick de DriveAI : la migration ne
    // « finit » jamais, elle rattrape. C'est `reste` qui pilote, pas un drapeau « terminé ».
    //
    // ⚠️ ET L'ORDRE COMPTE, sur une file qui se remplit par le HAUT. Partir du plus récent
    // laisserait le vieux stock stagner indéfiniment pendant que le neuf passe devant —
    // c'est la leçon que DriveAI a payée deux fois sur ses files mouvantes. Les `creeLe`
    // sont posés ici EXPLICITEMENT : sans ça les trois faits partagent la même horloge et
    // le test ne mesure rien.
    const faits = await db.select().from(schema.faits).orderBy(schema.faits.empreinte);
    const parFileId = new Map<string, string>();
    for (const [i, f] of faits.entries()) {
      const quand = new Date(Date.UTC(2026, 0, 1 + i));
      await db.update(schema.faits).set({ creeLe: quand }).where(eq(schema.faits.id, f.id));
      parFileId.set(f.id, quand.toISOString());
    }
    const ordreAttendu = [...parFileId.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);

    const un = await migrer(2);
    expect(un.migres).toBe(2);
    expect(un.reste).toBe(1);
    const migres = await db
      .select({ origine: schema.pieces.origineFaitId })
      .from(schema.pieces);
    expect(migres.map((m) => m.origine).sort()).toEqual(ordreAttendu.slice(0, 2).sort());

    const deux = await migrer(2);
    expect(deux.migres).toBe(1);
    expect(deux.reste).toBe(0);
  });

  it("un fait ILLISIBLE est COMPTÉ et LAISSÉ EN PLACE, jamais migré à moitié", async () => {
    const [premier] = await db.select().from(schema.faits).limit(1);
    await db.update(schema.faits).set({ valeur: "ceci-n-est-pas-un-chiffre" }).where(eq(schema.faits.id, premier!.id));
    const r = await migrer();
    expect(r.illisibles).toBe(1);
    expect(r.migres).toBe(2);
    // ⚠️ Non marqué : il reviendra à la passe suivante, et le compte dit qu'il faut aller voir.
    const [apres] = await db.select().from(schema.faits).where(eq(schema.faits.id, premier!.id));
    expect(apres!.migreEnPiece).toBeNull();
    expect(r.reste).toBe(1);
  });

  it("LE RETOUR EN ARRIÈRE rend exactement ce qui a été pris, et rien d'autre", async () => {
    await migrer();
    // Une pièce écrite par DriveAI — pas par la migration — ne doit PAS être emportée.
    await db.insert(schema.pieces).values({
      id: "piece-externe", sujet: "marc", niveau: 1, resumeEnClair: true,
      extracteur: "haiku-4.5-piece-v1", empreinte: "empreinte-externe",
    });

    const annule = await annulerMigrationInventaire(depotMigrationDrizzle(db));
    expect(annule).toEqual({ faits: 3, pieces: 3 });

    const faits = await db.select().from(schema.faits);
    for (const f of faits) expect(f.migreEnPiece).toBeNull();
    const p = { inclureN2: true, n2Autorise: true, inclureN3: false, n3Autorise: false, inclureProposes: true };
    expect(faits.filter((f) => estServable(f, p, new Set()))).toHaveLength(3);
    // ⚠️ `origine_fait_id` est ce qui rend l'annulation EXACTE : sans lui, on supprimerait
    // aussi ce que DriveAI a extrait sur les mêmes papiers.
    const restantes = await db.select().from(schema.pieces);
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.id).toBe("piece-externe");
    expect(await db.select().from(schema.pieces).where(isNotNull(schema.pieces.origineFaitId))).toHaveLength(0);

    // Et on peut re-migrer après avoir annulé : le cycle est complet, pas à sens unique.
    const encore = await migrer();
    expect(encore.migres).toBe(3);
  });

  it("un fait dont la PIÈCE est refusée n'est PAS marqué migré", async () => {
    // ⚠️ LE CAS QUI MANQUAIT, et il n'est pas théorique : marquer tout le lot laissait les
    // tests verts (mutation MUETTE). Or un fait marqué dont la pièce n'existe pas est un
    // papier PERDU des deux côtés — il ne sort plus des faits, et il n'est nulle part
    // ailleurs. C'est le pire mode de panne de ce lot.
    //
    // Le fait est inséré DIRECTEMENT, sans passer par `validerFait` : c'est ainsi qu'un tel
    // état peut naître (une future migration SQL, un écrivain interne), et `faits.domaine`
    // est un `text` que rien ne borne en base. Le contrat des pièces, lui, le borne à 120.
    await db.insert(schema.faits).values({
      id: "11111111-1111-4111-8111-111111111111",
      sujet: "marc", predicat: "document.existe",
      valeur: "1AbCdEfGhIjKlMnOpQrStUvWxYz99", valeurType: "ref_document",
      domaine: "D".repeat(200), niveau: 0, statut: "valide",
      fiabiliteSource: "document-officiel", versionVocabulaire: 1,
      empreinte: "empreinte-domaine-trop-long",
    });

    const r = await migrer();
    expect(r.refuses.schema, "la pièce est refusée, et le motif est NOMMÉ").toBe(1);
    const [reste] = await db
      .select()
      .from(schema.faits)
      .where(eq(schema.faits.id, "11111111-1111-4111-8111-111111111111"));
    expect(reste!.migreEnPiece, "non marqué : il reviendra, il n'est pas perdu").toBeNull();
    // Les trois autres, eux, sont bien passés : un refus ne bloque pas le lot.
    expect(r.migres).toBe(3);
    expect(r.reste).toBe(1);
  });

  it("un prédicat qui n'est PAS `document.existe` n'est jamais touché", async () => {
    await ecrireLot([{ ...BON, valeur: "Ubisoft" }], DRIVEAI, cle, depotDrizzle(db));
    await migrer();
    const [autre] = await db.select().from(schema.faits).where(eq(schema.faits.predicat, BON.predicat));
    expect(autre!.migreEnPiece).toBeNull();
  });
});

/**
 * LA GARDE DU PRODUCTEUR — et elle vient d'un défaut commis dans ce lot même.
 *
 * Tout ce fichier peut être vert, la migration réversible, prouvée par mutation… et ne jamais
 * tourner, parce qu'aucun écran ne l'appelle. C'est `UN-CHAMP-TYPE-SANS-PRODUCTEUR` appliqué à
 * une FONCTION, et c'est plus discret que sur un champ : un champ absent d'un formulaire se
 * voit, une fonction exportée et testée a l'air branchée.
 *
 * La liste des fonctions à brancher se DÉRIVE des exports du module, jamais recopiée : une
 * troisième fonction ajoutée demain fait rougir ce test tant que personne ne l'appelle.
 */
describe("le producteur existe", () => {
  it("chaque fonction exportée de migrerInventaire est appelée depuis app/", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/pieces/migrerInventaire.ts"), "utf8");
    const fonctions = [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]!);
    expect(fonctions.sort()).toEqual(["annulerMigrationInventaire", "migrerLotInventaire"]);

    const fichiers = execSync("git ls-files --cached --others --exclude-standard app", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const codeApp = fichiers.map((f) => readFileSync(resolve(process.cwd(), f), "utf8")).join("\n");
    for (const fn of fonctions) {
      expect(codeApp, `${fn} n'est appelée par aucun écran`).toContain(`${fn}(`);
    }
  });
});
