// tests/fileDeLecture.test.ts — [L35] la file de lecture, sur une VRAIE Postgres.
//
// Ce que ces cas défendent, et pourquoi chacun existe :
//   1. l'ORDRE est la demande de Marc — un émetteur nommé passe avant le reste, et l'export
//      Facebook passe APRÈS tout le reste, même s'il est le plus récent ;
//   2. un papier LU sort de la file TOUT SEUL ([L39]) — c'est toute l'idempotence, et elle ne
//      repose sur aucune marque ;
//   3. un papier qui ne DONNE RIEN sort de la file par un verdict — sinon il resterait en tête
//      pour toujours et la boucle paierait son OCR à chaque passe ;
//   4. le verdict vaut pour UN extracteur : un lecteur neuf ré-ouvre tout ;
//   5. un verdict sur un fichier INCONNU n'écrit rien, et il est COMPTÉ ;
//   6. `restants` décrit exactement la file — même critère, écrit une fois.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import {
  depotFileDeLectureDrizzle,
  emetteursPrioritaires,
  extracteurValide,
  limiteDeFile,
  validerVerdicts,
  FILE_DEFAUT,
  FILE_MAX,
  MOTIFS_VERDICT,
} from "../lib/pieces/fileDeLecture";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 9).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const LECTEUR = "haiku-4.5-piece-v1";

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
// Les émetteurs prioritaires sont explicites : la liste réelle vit dans l'environnement, jamais
// dans le dépôt (voir `emetteursPrioritaires`).
const PRIORITAIRES = ["Revenu Québec", "Banque Aurore"];
const file = () => depotFileDeLectureDrizzle(db, cle, PRIORITAIRES);

const inventaire = (fileId: string, emetteur: string | null, annee = 2020) => ({
  type: "releve",
  ...(emetteur ? { emetteur } : {}),
  annee,
  domaine: "02 · Finances",
  extracteur: EXTRACTEUR_MIGRATION,
  exemplaires: [{ file_id: fileId }],
});

const lecture = (fileId: string, emetteur: string) => ({
  type: "releve",
  emetteur,
  annee: 2020,
  domaine: "02 · Finances",
  resume: "Relevé de compte du mois.",
  extracteur: LECTEUR,
  exemplaires: [{ file_id: fileId }],
});

const ecrire = (pieces: unknown[]) => ecrireLotPieces(pieces, DRIVEAI, cle, depotPiecesDrizzle(db));

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

beforeEach(async () => {
  await db.execute(sql`TRUNCATE lectures_tentees, piece_exemplaires, pieces CASCADE`);
});

describe("la liste des émetteurs prioritaires vit dans l'environnement", () => {
  it("variable absente ou vide : seul Revenu Québec passe devant", () => {
    expect(emetteursPrioritaires({})).toEqual(["Revenu Québec"]);
    expect(emetteursPrioritaires({ MEMORYAI_EMETTEURS_PRIORITAIRES: "  " })).toEqual(["Revenu Québec"]);
    expect(emetteursPrioritaires({ MEMORYAI_EMETTEURS_PRIORITAIRES: " | " })).toEqual(["Revenu Québec"]);
  });

  it("variable posée : les noms, dans l'ordre, espaces retirés", () => {
    expect(
      emetteursPrioritaires({ MEMORYAI_EMETTEURS_PRIORITAIRES: "Banque Aurore | Zenith inc.|Revenu Québec" }),
    ).toEqual(["Banque Aurore", "Zenith inc.", "Revenu Québec"]);
  });
});

describe("l'ordre est la demande de Marc", () => {
  it("un émetteur NOMMÉ passe avant le reste, et Facebook passe après TOUT — même plus récent", async () => {
    await ecrire([
      inventaire("f-facebook", "Facebook", 2026),
      inventaire("f-quelconque", "Boulangerie du coin", 2025),
      inventaire("f-banque", "Banque Aurore", 2012),
      inventaire("f-revenu", "Revenu Québec", 2010),
      inventaire("f-sans-emetteur", null, 2024),
    ]);
    // ⚠️ Les ANNÉES sont choisies CONTRE l'ordre attendu : Facebook est le plus récent et
    // Revenu Québec le plus ancien. Un tri par année seule donnerait l'ordre exactement
    // inverse — donc ce cas ne peut pas passer par accident.
    expect(await file().prochains(LECTEUR, 10)).toEqual([
      "f-revenu",
      "f-banque",
      "f-quelconque",
      "f-sans-emetteur",
      "f-facebook",
    ]);
  });

  it("la graphie ne compte pas : « revenu-quebec » est Revenu Québec", async () => {
    await ecrire([inventaire("f-autre", "Zèbre SA", 2026), inventaire("f-rq", "REVENU-QUEBEC", 2001)]);
    expect((await file().prochains(LECTEUR, 10))[0]).toBe("f-rq");
  });

  it("les QUATRE graphies mesurées de l'export Facebook passent toutes en dernier", async () => {
    await ecrire([
      inventaire("f-1", "Facebook - Meta", 2026),
      inventaire("f-2", "Meta-Facebook", 2026),
      inventaire("f-3", "Facebook Marketplace", 2026),
      inventaire("f-vrai", "Hydro-Québec", 1999),
    ]);
    expect((await file().prochains(LECTEUR, 10))[0]).toBe("f-vrai");
  });

  it("à rang égal, le plus RÉCENT d'abord", async () => {
    await ecrire([inventaire("f-vieux", "Banque Aurore", 2011), inventaire("f-neuf", "Banque Aurore", 2025)]);
    expect(await file().prochains(LECTEUR, 10)).toEqual(["f-neuf", "f-vieux"]);
  });

  it("la limite borne la tranche, pas le compte des restants", async () => {
    await ecrire([inventaire("f-a", "Crédit du Lac"), inventaire("f-b", "Crédit du Lac"), inventaire("f-c", "Crédit du Lac")]);
    expect(await file().prochains(LECTEUR, 2)).toHaveLength(2);
    expect(await file().restants(LECTEUR)).toBe(3);
  });
});

describe("l'idempotence vit dans la Mémoire", () => {
  it("⚠️ un papier LU sort de la file TOUT SEUL — aucune marque, c'est [L39] qui le fait", async () => {
    await ecrire([inventaire("f-lu", "Banque Aurore"), inventaire("f-pas-lu", "Banque Aurore")]);
    expect(await file().restants(LECTEUR)).toBe(2);

    const r = await ecrire([lecture("f-lu", "Banque Aurore")]);
    expect(r.remplacees, "anti-vacuité : la lecture doit avoir REMPLACÉ l'inventaire").toBe(1);

    expect(await file().prochains(LECTEUR, 10)).toEqual(["f-pas-lu"]);
    expect(await file().restants(LECTEUR)).toBe(1);
  });

  it("une pièce lue d'emblée (sans inventaire) n'entre jamais dans la file", async () => {
    await ecrire([lecture("f-direct", "Banque Aurore")]);
    expect(await file().prochains(LECTEUR, 10)).toEqual([]);
  });

  it("⚠️ un papier qui ne DONNE RIEN sort par un VERDICT — sinon il resterait en tête pour toujours", async () => {
    await ecrire([inventaire("f-photo", "Revenu Québec"), inventaire("f-ok", "Banque Aurore")]);
    expect((await file().prochains(LECTEUR, 1))[0]).toBe("f-photo");

    const n = await file().noterVerdicts(LECTEUR, [{ fileId: "f-photo", motif: "sans-texte" }]);
    expect(n).toEqual({ notes: 1, inconnus: 0 });

    expect(await file().prochains(LECTEUR, 10)).toEqual(["f-ok"]);
    expect(await file().restants(LECTEUR)).toBe(1);
  });

  it("⚠️ le verdict vaut pour UN extracteur : un lecteur neuf ré-ouvre le papier", async () => {
    await ecrire([inventaire("f-reessai", "Banque Aurore")]);
    await file().noterVerdicts(LECTEUR, [{ fileId: "f-reessai", motif: "extraction-vide" }]);
    expect(await file().prochains(LECTEUR, 10)).toEqual([]);
    expect(await file().prochains("haiku-4.5-piece-v2", 10)).toEqual(["f-reessai"]);
  });

  it("un verdict répété se met à jour au lieu de lever", async () => {
    await ecrire([inventaire("f-deux-fois", "Banque Aurore")]);
    await file().noterVerdicts(LECTEUR, [{ fileId: "f-deux-fois", motif: "ocr-echec" }]);
    await file().noterVerdicts(LECTEUR, [
      { fileId: "f-deux-fois", motif: "sans-texte" },
      { fileId: "f-deux-fois", motif: "sans-texte" },
    ]);
    expect((await file().tentees()).parMotif).toEqual({ "sans-texte": 1 });
  });

  it("⚠️ un verdict sur un fichier INCONNU n'écrit rien, et il est COMPTÉ", async () => {
    await ecrire([inventaire("f-connu", "Banque Aurore")]);
    const n = await file().noterVerdicts(LECTEUR, [
      { fileId: "f-connu", motif: "sans-texte" },
      { fileId: "f-jamais-vu", motif: "sans-texte" },
    ]);
    expect(n).toEqual({ notes: 1, inconnus: 1 });
    expect((await file().tentees()).total).toBe(1);
  });

  it("une pièce OUBLIÉE ou remplacée n'est jamais servie", async () => {
    await ecrire([inventaire("f-supprime", "Banque Aurore")]);
    await db.execute(sql`UPDATE pieces SET supprime_le = now()`);
    expect(await file().prochains(LECTEUR, 10)).toEqual([]);
  });
});

describe("les entrées — pures", () => {
  it("la MIGRATION n'est pas un lecteur : lui servir une file n'a aucun sens", () => {
    expect(extracteurValide(EXTRACTEUR_MIGRATION)).toBeNull();
    expect(extracteurValide("  haiku-4.5-piece-v1 ")).toBe("haiku-4.5-piece-v1");
    expect(extracteurValide("")).toBeNull();
    expect(extracteurValide(42)).toBeNull();
    expect(extracteurValide("x".repeat(81))).toBeNull();
  });

  it("une limite illisible vaut le DÉFAUT, jamais « tout »", () => {
    expect(limiteDeFile(null)).toBe(FILE_DEFAUT);
    expect(limiteDeFile("abc")).toBe(FILE_DEFAUT);
    expect(limiteDeFile("0")).toBe(FILE_DEFAUT);
    expect(limiteDeFile("-3")).toBe(FILE_DEFAUT);
    expect(limiteDeFile("5")).toBe(5);
    expect(limiteDeFile("100000")).toBe(FILE_MAX);
  });

  it("⚠️ une PANNE DE CANAL n'est pas un verdict — la liste est fermée sur les issues du DOCUMENT", () => {
    for (const panne of ["jeton-refuse", "reseau", "frein-budget", "suspendu", "panne", "desactive", "ok"]) {
      const r = validerVerdicts([{ file_id: "f", motif: panne }]);
      expect(r.ok, `« ${panne} » sortirait de la file un papier parfaitement lisible`).toBe(false);
    }
    for (const motif of MOTIFS_VERDICT) {
      expect(validerVerdicts([{ file_id: "f", motif }]).ok, motif).toBe(true);
    }
  });

  it("le lot est refusé EN ENTIER sur une forme invalide", () => {
    expect(validerVerdicts("pas une liste").ok).toBe(false);
    expect(validerVerdicts([]).ok).toBe(false);
    expect(validerVerdicts([{ file_id: "bon", motif: "sans-texte" }, { file_id: "", motif: "sans-texte" }]).ok).toBe(false);
    expect(validerVerdicts(Array.from({ length: FILE_MAX + 1 }, (_, i) => ({ file_id: `f${i}`, motif: "sans-texte" }))).ok).toBe(false);
  });
});
