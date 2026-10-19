// tests/plafondsEtImport.test.ts — [L34] un plafond réglable reste un plafond.
//
// Décision de Marc, 18/09 : « jveux pouvoir choisir dans lapp je veux aussi un onglet dédié
// aux depenses a limport etc ». L'ADR 0001 §5.5 dit « plafond dur, NON DÉSACTIVABLE » (Q15) :
// ce qui y est interdit est de l'ÉTEINDRE, pas d'en choisir la valeur — et le test qui
// verrouillait la somme des postes disait lui-même que relever un poste oblige « à rouvrir le
// total avec Marc, ce qui est une décision de dépense ». Il vient de la prendre.
//
// Ce fichier garde les TROIS choses qui ne changent pas, dans l'ordre d'importance :
//   1. un plafond EXISTE toujours — table vide, ligne supprimée, valeur illisible : le DÉFAUT
//      du 16/09, jamais « illimité » ;
//   2. il est BORNÉ par le code ET par la base — une valeur entrée par erreur ne peut pas
//      ouvrir une facture sans fond ;
//   3. ce que Marc règle est ce qui COUPE — sinon le formulaire serait décoratif.
//
// Plus le compte d'import, dont l'exactitude décide d'une phrase que Marc va lire : « X lus
// sur Y ». Un compte faux dirait un import terminé qui ne l'est pas.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import {
  budgetOuvert,
  PLAFONDS_DEFAUT_USD_PAR_JOUR,
  PLAFOND_MAX_USD_PAR_JOUR,
  POSTES,
} from "../lib/coutChat";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { EXTRACTEUR_INVENTAIRE, depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { COUPLES_MECANIQUES } from "../lib/autoValidation";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterEach(async () => {
  await pg?.close();
});

describe("un plafond EXISTE toujours", () => {
  it("table VIDE ⇒ les défauts du 16/09, jamais « illimité »", async () => {
    // ⚠️ L'état le plus probable en production le jour du déploiement : la migration est
    // jouée, Marc n'a rien réglé. Si ce cas rendait `undefined`, `depense < undefined` serait
    // FAUX et tout serait coupé ; s'il rendait `Infinity`, rien ne le serait jamais. Les deux
    // sont des mensonges, dans les deux sens opposés.
    expect(await depotAdminDrizzle(db).plafonds()).toEqual(PLAFONDS_DEFAUT_USD_PAR_JOUR);
  });

  it("⚠⚠ une valeur ILLISIBLE ne peut pas ENTRER — la base la refuse avant le repli", async () => {
    // ⚠⚠ MON SCÉNARIO D'ORIGINE ÉTAIT IMPOSSIBLE, et c'est le schéma qui l'a dit. J'écrivais
    // « une colonne altérée rend `NaN`, et `plafondValide` la rabat sur le défaut » — or
    // `NaN >= 0 AND NaN <= 50` n'est pas vrai, donc `plafonds_borne` REFUSE la ligne. La
    // garantie réelle est plus forte que celle que je pensais tester : la valeur illisible
    // n'atteint jamais le lecteur.
    //
    // ⚠️ Conséquence à écrire, sinon le repli de `plafondValide` passerait pour du code mort :
    // il protège le chemin du FORMULAIRE, où `Number(fd.get(…))` rend `NaN` sur n'importe
    // quelle saisie non numérique. Ce chemin-là est gardé dans `tests/coutChat.test.ts`.
    await db.insert(schema.plafonds).values({ poste: "chat", usdParJour: 0.5 });
    await expect(pg.exec(`UPDATE plafonds SET usd_par_jour = 'NaN' WHERE poste = 'chat'`)).rejects.toThrow();
    // Et la ligne SAINE est intacte : un refus n'écrase pas ce qui était là.
    expect((await depotAdminDrizzle(db).plafonds()).chat).toBe(0.5);
  });
  it("un poste réglé, l'autre non : chacun garde le sien", async () => {
    // Sans ce cas, `plafonds()` pourrait rendre la ligne lue POUR TOUS les postes et le cas
    // précédent resterait vert.
    await depotAdminDrizzle(db).reglerPlafond("apprentissage", 7);
    const p = await depotAdminDrizzle(db).plafonds();
    expect(p.apprentissage).toBe(7);
    expect(p.chat).toBe(PLAFONDS_DEFAUT_USD_PAR_JOUR.chat);
  });
});

describe("le plafond est BORNÉ par le code ET par la base", () => {
  it("une valeur énorme est ramenée au maximum du code", async () => {
    await depotAdminDrizzle(db).reglerPlafond("apprentissage", 1_000_000);
    expect((await depotAdminDrizzle(db).plafonds()).apprentissage).toBe(PLAFOND_MAX_USD_PAR_JOUR);
  });

  it("une valeur négative est ramenée à zéro — une pause, pas un arrêt du contrôle", async () => {
    await depotAdminDrizzle(db).reglerPlafond("chat", -10);
    expect((await depotAdminDrizzle(db).plafonds()).chat).toBe(0);
    // Et à zéro, le poste est FERMÉ, pas ouvert : la comparaison est stricte.
    expect(budgetOuvert(0, "chat", await depotAdminDrizzle(db).plafonds())).toBe(false);
  });

  it("⚠️ la BASE refuse aussi, pas seulement le code", async () => {
    // L'app n'est pas le seul chemin d'écriture possible — même raison que `pieces_niveau_0_3`.
    // Si seul `plafondValide` bornait, un `INSERT` direct ouvrirait la facture.
    await expect(pg.exec(`INSERT INTO plafonds (poste, usd_par_jour) VALUES ('chat', 9999)`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO plafonds (poste, usd_par_jour) VALUES ('chat', -1)`)).rejects.toThrow();
    // Et un poste inconnu ne peut pas entrer : sinon un réglage sur un nom mal orthographié
    // serait accepté puis ignoré — Marc croirait avoir réglé quelque chose.
    await expect(pg.exec(`INSERT INTO plafonds (poste, usd_par_jour) VALUES ('aprentissage', 2)`)).rejects.toThrow();
  });
});

describe("ce que Marc règle est ce qui COUPE", () => {
  it("⚠️ le plafond réglé décide, pas le défaut (mutation : lire la constante)", async () => {
    // LA garde du lot. Sans elle, `budgetOuvert` pourrait ignorer son argument et lire
    // `PLAFONDS_DEFAUT_USD_PAR_JOUR` : le formulaire serait décoratif, et Marc croirait avoir
    // relevé un plafond qui coupe toujours au même endroit.
    const admin = depotAdminDrizzle(db);
    await admin.reglerPlafond("apprentissage", 5);
    const p = await admin.plafonds();
    // 3 $ dépensés : au-dessus du défaut (2 $), en dessous du réglé (5 $).
    expect(budgetOuvert(3, "apprentissage", p)).toBe(true);
    expect(budgetOuvert(3, "apprentissage", PLAFONDS_DEFAUT_USD_PAR_JOUR)).toBe(false);
  });

  it("régler deux fois REMPLACE, jamais n'ajoute une seconde ligne", async () => {
    const admin = depotAdminDrizzle(db);
    await admin.reglerPlafond("chat", 2);
    await admin.reglerPlafond("chat", 4);
    const lignes = await db.select().from(schema.plafonds).where(eq(schema.plafonds.poste, "chat"));
    expect(lignes.length).toBe(1);
    expect((await admin.plafonds()).chat).toBe(4);
  });

  it("chaque poste de la liste fermée a un plafond effectif", () => {
    // Anti-vacuité : si `POSTES` grandissait sans que `PLAFONDS_DEFAUT` suive, tous les cas
    // ci-dessus resteraient verts sur les deux postes qu'ils nomment.
    for (const p of POSTES) expect(typeof PLAFONDS_DEFAUT_USD_PAR_JOUR[p]).toBe("number");
    expect(Object.keys(PLAFONDS_DEFAUT_USD_PAR_JOUR).sort()).toEqual([...POSTES].sort());
  });
});

describe("le compte d'import dit la vérité", () => {
  /** Un papier minimal. `extracteur` est le seul champ que ces cas éprouvent. */
  const papier = (id: string, extracteur: string) => ({
    id,
    sujet: "marc",
    niveau: 1,
    resumeEnClair: true,
    extracteur,
    empreinte: `empreinte-${id}`,
  });

  it("sépare les papiers LUS de ceux qui ne sont qu'un nom de fichier", async () => {
    await db.insert(schema.pieces).values([
      papier("a", EXTRACTEUR_INVENTAIRE),
      papier("b", EXTRACTEUR_INVENTAIRE),
      papier("c", "haiku-4.5-piece-v1"),
    ]);
    const r = await depotPiecesLectureDrizzle(db).comptesParExtracteur();
    expect(r.nonLus).toBe(2);
    expect(r.lus).toBe(1);
    expect(r.parExtracteur[EXTRACTEUR_INVENTAIRE]).toBe(2);
  });

  it("un papier SUPPRIMÉ ne compte dans aucun des deux", async () => {
    // Sinon « X lus sur Y » grandirait à chaque oubli, et l'import aurait l'air de reculer.
    await db.insert(schema.pieces).values([papier("a", EXTRACTEUR_INVENTAIRE), papier("b", "haiku-4.5-piece-v1")]);
    await db.update(schema.pieces).set({ supprimeLe: new Date() }).where(eq(schema.pieces.id, "a"));
    const r = await depotPiecesLectureDrizzle(db).comptesParExtracteur();
    expect(r.nonLus).toBe(0);
    expect(r.lus).toBe(1);
  });

  it("⚠️ la chaîne de l'extracteur d'inventaire est la MÊME des deux côtés", () => {
    // ⚠️ Cette assertion tient une promesse que `lib/pieces/depotLecture.ts` écrit dans son
    // commentaire. Deux graphies feraient compter TOUS les papiers comme lus — donc annoncer
    // à Marc un import terminé alors que 2 645 documents n'ont jamais été ouverts. Le compte
    // d'une page n'est pas du décor quand c'est lui qui dit s'il reste du travail.
    const regle = COUPLES_MECANIQUES.find((r) => r.extracteur === EXTRACTEUR_INVENTAIRE);
    expect(regle, `aucun couple mécanique ne porte « ${EXTRACTEUR_INVENTAIRE} »`).toBeTruthy();
  });
});
