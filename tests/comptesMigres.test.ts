// tests/comptesMigres.test.ts — un fait devenu PAPIER ne compte plus comme un fait, et le
// compte des papiers n'est JAMAIS silencieux.
//
// ⚠️ Ce fichier existe parce qu'un signal de fraîcheur est mort deux fois de suite, de la
// même façon, à deux heures d'intervalle :
//   1. le lot 19 a écrit « `aValider` N'EST PLUS un signal » — le canal DriveAI entre
//      directement en `valide`, donc la file reste à 0 même à plein régime — et il a désigné
//      en remplacement « le `nombre` du prédicat `document.existe` » ;
//   2. le lot 17 a migré ces mêmes faits en pièces (ADR 0004 §6.2) SANS les retirer des
//      compteurs. `estServable` les exclut bien de ce qui est SERVI (`lib/lecture.ts`) ; la
//      garde manquait là où on COMPTE. Le compteur est resté figé à 2 729, la doc a continué
//      de dire de le surveiller, et rien n'a rougi : un compteur agrégé rend toujours un
//      nombre.
//
// D'où la forme de ces tests : ils ne vérifient pas « le filtre est écrit » (un scan de
// source le ferait, et se périmerait) mais « migrer un fait DÉPLACE son compte d'un champ à
// l'autre, et la somme se conserve ». Les mutations qui doivent rougir sont nommées dans les
// titres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { comptesParDomaine } from "../lib/depotAdmin";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotMigrationDrizzle } from "../lib/pieces/depotMigration";
import { migrerLotInventaire } from "../lib/pieces/migrerInventaire";
import { ecrireLot } from "../lib/ecrireFaits";
import { composerSummary } from "../lib/hubSummary";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const doc = (fileId: string) => ({
  ...BON,
  predicat: "document.existe",
  valeur: fileId,
  valeur_type: "ref_document" as const,
  valide_de: "2026-03-01",
  attributs: { type: "Facture", annee: "2026", emetteur: "Hydro" },
  provenance: { ...BON.provenance, source_ref: `drive|${fileId}`, extracteur: "moteur-inventaire-v1", dossier: "02 · Finances" },
});

beforeEach(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
  // Trois documents de l'inventaire + un fait qui parle VRAIMENT de Marc. C'est la forme
  // réelle de la base : 96,5 % d'inventaire, le reste étant ce qui a de la valeur (ADR 0004
  // §1). Sans le fait d'emploi, « tout a migré » et le cas ne discriminerait pas
  // « les migrés sont exclus » de « il n'y a plus rien du tout ».
  await ecrireLot(
    [doc("1AbCdEfGhIjKlMnOpQrStUvWxYz01"), doc("1AbCdEfGhIjKlMnOpQrStUvWxYz02"), doc("1AbCdEfGhIjKlMnOpQrStUvWxYz03"), BON],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
});

afterEach(async () => {
  await pg?.close();
});

const migrerTout = () =>
  migrerLotInventaire(depotMigrationDrizzle(db), depotPiecesDrizzle(db), cle, new Date("2026-09-16T12:00:00Z"), 50);

describe("un fait migré en papier sort des compteurs", () => {
  it("MUTATION — retirer `isNull(migreEnPiece)` de comptes() fait rougir ce cas", async () => {
    const avant = await depotLectureDrizzle(db).comptes();
    expect(avant.parPredicat["document.existe"]).toBe(3);
    expect(avant.migresEnPiece).toBe(0);

    const r = await migrerTout();
    expect(r.migres).toBe(3);

    const apres = await depotLectureDrizzle(db).comptes();
    // LE point de ce fichier : le prédicat désigné comme signal de fraîcheur redescend à 0
    // parce que ces trois documents vivent maintenant dans `pieces`. Sans le filtre, il
    // resterait à 3 — et c'est exactement ce que la production affichait (2 729 figé).
    expect(apres.parPredicat["document.existe"]).toBeUndefined();
    expect(apres.migresEnPiece).toBe(3);
  });

  it("la SOMME se conserve : rien n'est perdu, tout est déplacé", async () => {
    const avant = await depotLectureDrizzle(db).comptes();
    const totalAvant = Object.values(avant.parStatut).reduce((t, n) => t + n, 0) + avant.migresEnPiece;

    await migrerTout();

    const apres = await depotLectureDrizzle(db).comptes();
    const totalApres = Object.values(apres.parStatut).reduce((t, n) => t + n, 0) + apres.migresEnPiece;
    expect(totalApres).toBe(totalAvant);
    // Et le fait qui parle de Marc, lui, ne bouge pas : la migration ne vise que l'inventaire.
    expect(apres.parPredicat["emploi.employeur"]).toBe(1);
  });

  it("les niveaux suivent le même filtre que les statuts", async () => {
    const avant = await depotLectureDrizzle(db).comptes();
    const niveauxAvant = Object.values(avant.parNiveau).reduce((t, n) => t + n, 0);
    await migrerTout();
    const apres = await depotLectureDrizzle(db).comptes();
    const niveauxApres = Object.values(apres.parNiveau).reduce((t, n) => t + n, 0);
    // ⚠️ Un filtre posé sur `parStatut` et oublié sur `parNiveau` donnerait deux totaux
    // contradictoires sur la MÊME page (`/moi` affiche les deux).
    expect(niveauxAvant - niveauxApres).toBe(3);
  });

  it("MUTATION — retirer `isNull(migreEnPiece)` de comptesParDomaine() fait rougir ce cas", async () => {
    const avant = await comptesParDomaine(db);
    expect(avant.document).toBe(3);
    await migrerTout();
    const apres = await comptesParDomaine(db);
    // Sans le filtre, la somme des lignes « Faits validés par domaine » publiées au hub
    // dépasserait la métrique « Faits validés » d'à côté — la classe de défaut qui a mis
    // `/hub/summary` en 500 le 15/09.
    expect(apres.document).toBeUndefined();
    // ⚠️ `emploi` n'y est PAS, et mon premier jet l'attendait à 1 : cette fonction ne compte
    // que les faits `valide`, et seul le couple mécanique `moteur-inventaire-v1` ×
    // `document.existe` s'auto-valide (ADR 0003). Le fait d'emploi reste `propose`. Ce que
    // ça mesure incidemment, et qui vaut d'être épinglé : après la migration, la ventilation
    // publiée au hub est VIDE tant que Marc n'a rien validé — ce qui est exact, et c'est
    // pour ça que la métrique « Papiers » existe.
    expect(apres.emploi).toBeUndefined();
    expect(Object.keys(apres)).toHaveLength(0);
  });
});

describe("la carte du hub dit où l'inventaire est parti", () => {
  const base = {
    aValider: 0,
    canaris: 0,
    dernierValideLe: "2026-09-17T12:00:00.000Z",
    parDomaine: { emploi: 1 },
    chat: { totalUsd: 0, appels: 0 },
    gele: false,
  };

  it("publie les papiers à côté des faits", () => {
    const s = composerSummary({ ...base, valides: 1, papiers: 2723 });
    const labels = s.metrics.map((m) => m.label);
    expect(labels).toContain("Faits validés");
    expect(labels).toContain("Papiers");
    expect(s.metrics.find((m) => m.label === "Papiers")?.value).toBe(2723);
    // Le contrat borne `metrics` à 6 : ajouter une ligne sans compter est le genre de
    // dépassement qui REFUSE le summary entier plutôt que de le tronquer (piège du 15/09).
    expect(s.metrics.length).toBeLessThanOrEqual(6);
  });

  it("MUTATION — remettre `c.valides === 0` seul fait rougir ce cas", () => {
    // Une mémoire dont TOUT l'inventaire a migré et qui n'a encore aucun fait validé n'est
    // pas « en construction » : elle porte 2 723 papiers. `status: "building"` du contrat
    // veut dire « aucune donnée confirmée », ce qui serait faux.
    const s = composerSummary({ ...base, valides: 0, papiers: 2723 });
    expect(s.status).not.toBe("building");
    expect(s.metrics.find((m) => m.label === "Papiers")?.value).toBe(2723);
  });

  it("vide des DEUX côtés reste « en construction » — le contrôle négatif", () => {
    const s = composerSummary({ ...base, valides: 0, papiers: 0 });
    expect(s.status).toBe("building");
  });
});
