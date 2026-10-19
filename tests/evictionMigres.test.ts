// tests/evictionMigres.test.ts — [L25] un fait migré en pièce ne doit pas PRENDRE LA PLACE
// d'un fait qui parle de Marc.
//
// ⚠️⚠️ CE FICHIER EXISTE PARCE QUE `tests/comptesMigres.test.ts` AVAIT RAISON ET NE SUFFISAIT
// PAS. Son en-tête dit, exactement :
//
//     « `estServable` les exclut bien de ce qui est SERVI (`lib/lecture.ts`) ; la garde
//       manquait là où on COMPTE. »
//
// Vrai PAR FAIT, faux EN AGRÉGAT. `estServable` les exclut **après** le `LIMIT` du SQL. Les
// ~2 729 `document.existe` migrés sont les plus RÉCENTS, et `faits()` ordonnait par
// `desc(creeLe)` avec `limite: 500` : ils ne sont pas servis, ils occupent la fenêtre.
//
// Mesuré sur la PRODUCTION le 18/09/2026, avant le correctif :
//   - `memoryai_contexte` sans filtre de domaine →  **2 faits servis sur 99 validés** ;
//   - le même appel avec `domaines: [preference, projet, gout]` → **27**.
// Le filtre de domaine excluait `document`, donc la fenêtre contenait de vrais faits. C'est
// cette PAIRE de mesures qui a nommé le défaut, pas un seul chiffre.
//
// C'était la plainte de Marc du 17/09 : « on dirait qu'elle a pas beaucoup d'info sur moi
// mais impossible a valider ». Elle était exacte et elle désignait un défaut de REQUÊTE.
//
// **La leçon, formulée pour être réutilisable** : exclure un fait de ce qui est servi ne
// suffit pas s'il occupe la place avant d'être exclu. Un filtre de lecture qui vit dans un
// prédicat TypeScript et pas dans le SQL est une garde qui tire trop tard.
//
// D'où la forme des cas ci-dessous : ils ne vérifient pas « le filtre est écrit » (un scan de
// source le ferait et se périmerait) mais « avec une fenêtre PLUS PETITE que le nombre de
// migrés, le fait de Marc sort quand même ». La mutation qui doit les faire rougir est
// nommée dans les titres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { depotMigrationDrizzle } from "../lib/pieces/depotMigration";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { migrerLotInventaire } from "../lib/pieces/migrerInventaire";
import { ecrireLot } from "../lib/ecrireFaits";
import { LIMITE_LECTURE_BASE, noteEcartes, OUTILS, type ContexteOutils } from "../lib/mcp/outils";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(randomBytes(32).toString("base64"));
const CLE_JOURNAL = "cle-de-journal-de-test-0123456789abcdef";
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const STATUTS = ["valide", "propose"] as const;

/** Combien de documents d'inventaire on sème. La FENÊTRE des lectures ci-dessous est plus
 *  PETITE que ce nombre — c'est toute la question : sans le filtre SQL, ils la remplissent. */
const DOCS = 5;
const FENETRE = 3;

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

function ctx(): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: CLE_JOURNAL },
    lecteur: "claude-ai",
    maintenant: () => new Date("2026-09-16T20:00:00Z"),
  };
}

beforeEach(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });

  // LE fait qui parle de Marc, écrit d'abord.
  await ecrireLot([BON], DRIVEAI, cle, depotDrizzle(db));
  // Puis l'inventaire, en nombre.
  await ecrireLot(
    Array.from({ length: DOCS }, (_, i) => doc(`1AbCdEfGhIjKlMnOpQrStUvWxY${String(i).padStart(2, "0")}`)),
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );

  // ⚠️ `cree_le` est `defaultNow()` : deux `ecrireLot` de suite peuvent tomber dans la même
  // milliseconde, et l'ordre deviendrait indéterminé — donc le cas ne discriminerait plus
  // rien un jour sur deux. On le FORCE, et on l'asserte plus bas : c'est la précondition du
  // fichier, pas un détail de confort.
  await db.update(schema.faits).set({ creeLe: new Date("2026-01-01T00:00:00Z") })
    .where(eq(schema.faits.predicat, "emploi.employeur"));
  await db.update(schema.faits).set({ creeLe: new Date("2026-09-16T00:00:00Z") })
    .where(eq(schema.faits.predicat, "document.existe"));

  await migrerLotInventaire(depotMigrationDrizzle(db), depotPiecesDrizzle(db), cle, new Date("2026-09-16T12:00:00Z"), 50);
});

afterEach(async () => {
  await pg?.close();
});

describe("[L25] la fenêtre de lecture ne se laisse pas remplir par les migrés", () => {
  it("ANTI-VACUITÉ — la fixture est bien dans l'état qui rend le cas discriminant", async () => {
    // Sans ces trois faits, tout ce qui suit passerait pour de bonnes raisons qui ne sont pas
    // les bonnes : une fenêtre assez large, aucun migré, ou un ordre inverse.
    const migres = await db.select({ n: sql<number>`count(*)::int` }).from(schema.faits).where(isNotNull(schema.faits.migreEnPiece));
    expect(migres[0]!.n).toBe(DOCS);
    expect(FENETRE).toBeLessThan(DOCS); // la fenêtre NE PEUT PAS contenir les migrés ET le vrai fait

    const vivants = await db.select({ n: sql<number>`count(*)::int` }).from(schema.faits).where(isNull(schema.faits.migreEnPiece));
    expect(vivants[0]!.n).toBe(1); // le fait d'emploi, et lui seul

    // Et les migrés sont bien les PLUS RÉCENTS — c'est ce qui leur donnait la fenêtre.
    const [plusRecent] = await db.select({ p: schema.faits.predicat }).from(schema.faits)
      .orderBy(sql`${schema.faits.creeLe} DESC`).limit(1);
    expect(plusRecent!.p).toBe("document.existe");
  });

  it("MUTATION — retirer `isNull(migreEnPiece)` de conditionServis() fait rougir ce cas", async () => {
    // La fenêtre (3) est plus petite que le nombre de migrés (5). Sans le filtre SQL, les
    // trois lignes rendues sont trois migrés, `estServable` les jette, et il reste ZÉRO.
    const rows = await depotLectureDrizzle(db).faits({ statuts: STATUTS, limite: FENETRE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fait.predicat).toBe("emploi.employeur");
  });

  it("TRAVERSE — `memoryai_contexte` sert le fait de Marc même quand les migrés SATURENT la fenêtre", async () => {
    // ⚠⚠ CE CAS A FAILLI NE RIEN MESURER, et son premier titre affirmait le contraire de ce
    // qu'il prouvait. `lireEtFiltrer` n'emploie PAS le `limite` de l'appelant pour le SQL : il
    // lit toujours `LIMITE_LECTURE_BASE` lignes, puis `slice()` ensuite. Avec six lignes de
    // fixture, la fenêtre de 500 ne peut pas être saturée, `estServable` écartait les migrés
    // et le cas restait VERT sous perturbation — mesuré.
    //
    // Une perturbation muette accuse d'abord la FIXTURE, et c'était elle. On seme donc assez
    // de migrés pour remplir la VRAIE fenêtre, en insertion directe : ces lignes n'ont qu'un
    // rôle, occuper la place. Le nombre est DÉRIVÉ de la constante de production, jamais
    // recopié — sinon le cas cesserait de discriminer le jour où elle bouge.
    // UNE requête, colonnes explicites : `generate_series` évite 500 objets et 500 allers-
    // retours. Ces lignes n'ont qu'un rôle — occuper la fenêtre — et elles sont plus
    // RÉCENTES que le fait de Marc, ce qui est exactement ce qui la leur donnait.
    // ⚠️ `empreinte` est `notNull` ET sous index UNIQUE : une valeur constante passerait le
    // premier verrou et buterait sur le second — d'où une empreinte par ligne.
    await db.execute(sql`
      INSERT INTO faits (id, sujet, predicat, valeur_type, niveau, statut, fiabilite_source,
                         version_vocabulaire, empreinte, cree_le, migre_en_piece)
      SELECT 'bourrage-' || g, 'marc', 'document.existe', 'ref_document', 1, 'valide',
             'document-officiel', 1, 'empreinte-bourrage-' || g,
             TIMESTAMPTZ '2026-09-17 00:00:00+00', TIMESTAMPTZ '2026-09-17 01:00:00+00'
      FROM generate_series(1, ${LIMITE_LECTURE_BASE}) g
    `);

    // Anti-vacuité du bourrage : sans lui, tout ce cas ne prouve rien.
    const total = await db.select({ n: sql<number>`count(*)::int` }).from(schema.faits).where(isNotNull(schema.faits.migreEnPiece));
    expect(total[0]!.n).toBeGreaterThanOrEqual(LIMITE_LECTURE_BASE);

    const outil = OUTILS.find((o) => o.name === "memoryai_contexte")!;
    const r = await outil.executer({}, ctx());
    expect(r.texte).toContain("emploi.employeur");
    expect(r.texte).not.toContain("document.existe");
    expect(r.faitsServis).toHaveLength(1);
  });

  it("CONTRÔLE NÉGATIF — un fait NON migré reste servi, donc le filtre n'écarte pas tout", async () => {
    // Sans ce cas, « le filtre marche » serait indiscernable de « la requête ne rend plus
    // rien » : deux causes, un même vert.
    await db.update(schema.faits).set({ migreEnPiece: null }).where(eq(schema.faits.predicat, "document.existe"));
    const rows = await depotLectureDrizzle(db).faits({ statuts: STATUTS, limite: 50 });
    expect(rows).toHaveLength(DOCS + 1);
  });
});

describe("[L25] la quarantaine se DIT au modèle au lieu de disparaître", () => {
  it("MUTATION — jeter `retenus` dans lireEtFiltrer fait rougir ce cas", () => {
    // `rendreServables` calcule ce compte exprès ; `lireEtFiltrer` le détruisait par
    // destructuration. Un compteur que personne ne lit n'est pas une protection.
    const note = noteEcartes(0, 4);
    expect(note).toContain("4");
    expect(note).toMatch(/quarantaine|accept/i);
  });

  it("les deux causes d'écartement sont DISTINCTES dans la note", () => {
    // « illisible » (déchiffrement) et « en quarantaine » (vocabulaire) ne désignent pas le
    // même geste : l'une est une alerte, l'autre est un bouton à cliquer.
    const deux = noteEcartes(2, 3);
    expect(deux).toContain("2");
    expect(deux).toContain("3");
    expect(deux).toMatch(/illisible/i);
    expect(deux).toMatch(/quarantaine/i);
  });

  it("CONTRÔLE NÉGATIF — rien d'écarté ne dit rien", () => {
    // Un avertissement permanent est un avertissement mort : sans écarté, la note est VIDE.
    expect(noteEcartes(0, 0)).toBe("");
  });
});
