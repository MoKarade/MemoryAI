// tests/ficheRattachements.test.ts — [L33a] la garde qui TRAVERSE, de la base à la fiche.
//
// ⚠️⚠️ CE FICHIER EXISTE À CAUSE DE [L25c]. Là-bas, trente gardes appelaient le module avec un
// objet écrit à la main : elles testaient le module et jamais son ALIMENTATION, donc remettre
// le défaut les laissait toutes VERTES. `tests/faitPhrase.test.ts` a exactement cette forme —
// c'est légitime pour une fonction pure, et insuffisant pour le lot. Ici, on part d'un fait
// RÉELLEMENT écrit en base et on remonte jusqu'à ce que la fiche affiche.
//
// Le trou que ça ferme est nommable : `provenances.source_ref` était `notNull` et INDEXÉ
// (`provenances_source`), et `rendreLisible` le jetait. Deux moitiés correctes — une colonne
// écrite, un index posé — et aucune surface entre les deux. Un trou entre deux moitiés
// testées n'appartient à personne.
//
// Les mutations qui doivent faire rougir chaque cas sont nommées dans les titres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLiensDrizzle } from "../lib/depotLiens";
import { ecrireLot } from "../lib/ecrireFaits";
import { autreExtremite, sourceDuFait, titreDuFait } from "../lib/faitPhrase";
import { rendreLisible } from "../lib/lecture";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(randomBytes(32).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

/** LE document dont trois faits sont tirés — préfixé, donc il promet un lien. */
const SOURCE = "drive|1AbCdEfGhIjKlMnOpQrStUvWxYz";
/** Une AUTRE source : elle ne doit jamais apparaître dans les rattachements de la première. */
const AILLEURS = "drive|ZZautreDocumentZZ";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const fait = (predicat: string, valeur: string, sourceRef: string, extra: Record<string, unknown> = {}) => ({
  ...BON,
  predicat,
  valeur,
  ...extra,
  provenance: { ...BON.provenance, source_ref: sourceRef, extracteur: "moteur-document-v1" },
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
      fait("logement.proprietaire", "Gestion Exemple inc.", SOURCE),
      fait("logement.bail.fin", "2028-06-30", SOURCE, { valeur_type: "date" }),
      fait("logement.ville", "Québec", SOURCE),
      fait("emploi.employeur", "Entreprise Exemple", AILLEURS),
    ],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
});

afterEach(async () => {
  await pg?.close();
});

/** Le fait écrit sous ce prédicat, tel que la fiche le lit — chemin COMPLET, pas un stub. */
async function lire(predicat: string) {
  const [ligne] = await db.select({ id: schema.faits.id }).from(schema.faits).where(eq(schema.faits.predicat, predicat));
  expect(ligne, `le fait ${predicat} n'a pas été écrit : la fixture ne mesure rien`).toBeTruthy();
  const brut = await depotAdminDrizzle(db).parId(ligne!.id);
  expect(brut, `parId n'a pas rendu ${predicat}`).toBeTruthy();
  return { id: ligne!.id, lisible: rendreLisible(brut!, cle) };
}

describe("de la base à la fiche — la référence de source arrive jusqu'à l'écran", () => {
  it("rendreLisible PUBLIE sourceRef (mutation : le retirer de l'objet rendu)", async () => {
    const { lisible } = await lire("logement.bail.fin");
    // ⚠️ L'assertion porte sur la VALEUR exacte, pas sur la présence de la clé : un
    // `sourceRef: ""` passerait un simple `toBeDefined()` et casserait tous les
    // rattachements en silence.
    expect(lisible.provenance?.sourceRef).toBe(SOURCE);
  });

  it("et cette référence donne le lien du document (mutation : ne plus préfixer, ou ne plus lier)", async () => {
    const { lisible } = await lire("logement.bail.fin");
    const s = sourceDuFait(lisible.provenance?.sourceRef);
    expect(s?.genre).toBe("drive");
    expect(s?.lien).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view");
  });
});

describe("les autres faits du MÊME document", () => {
  it("rend les frères, s'exclut lui-même, et ignore l'autre source", async () => {
    const { id, lisible } = await lire("logement.bail.fin");
    const autres = await depotAdminDrizzle(db).autresDeLaMemeSource(lisible.provenance!.sourceRef, id, 20);
    const predicats = autres.map((a) => a.fait.predicat).sort();
    // Trois faits partagent la source ; le courant est exclu, donc DEUX. Et `emploi.employeur`
    // vient d'AILLEURS : le voir ici voudrait dire que le filtre de source ne tire pas.
    expect(predicats).toEqual(["logement.proprietaire", "logement.ville"]);
    expect(predicats).not.toContain("emploi.employeur");
  });

  it("les frères sont LISIBLES jusqu'à leur titre (mutation : casser le déchiffrement)", async () => {
    // Le bout de chaîne que la fiche parcourt vraiment : chaque frère est déchiffré puis
    // titré. Sans ce cas, `autresDeLaMemeSource` pourrait rendre des lignes que la fiche
    // n'arrive pas à afficher, et la garde serait verte sur une fiche vide.
    const { id, lisible } = await lire("logement.bail.fin");
    const autres = await depotAdminDrizzle(db).autresDeLaMemeSource(lisible.provenance!.sourceRef, id, 20);
    const titres = autres.map((a) => titreDuFait(rendreLisible(a, cle)).titre).sort();
    expect(titres).toEqual(["Gestion Exemple inc.", "Québec"]);
  });

  it("un fait SUPPRIMÉ ne revient pas dans les rattachements", async () => {
    const { id, lisible } = await lire("logement.bail.fin");
    const frere = await lire("logement.ville");
    await depotAdminDrizzle(db).oublier(frere.id, cle, "test", new Date("2026-09-18T00:00:00Z"));
    const autres = await depotAdminDrizzle(db).autresDeLaMemeSource(lisible.provenance!.sourceRef, id, 20);
    expect(autres.map((a) => a.fait.predicat)).toEqual(["logement.proprietaire"]);
  });

  it("⚠️ une référence VIDE ne rattache rien — même si la table en porte", async () => {
    // ⚠️ PREMIÈRE VERSION DE CE CAS : VACUEUSE. Elle n'appelait qu'avec `""` et attendait
    // `[]` — or `where source_ref = ''` ne matche AUCUNE ligne écrite par le contrat
    // (`min(1)`), donc retirer le repli précoce la laissait VERTE (perturbation muette,
    // mesurée). Le commentaire du code annonçait « plutôt que de balayer toute la table » :
    // c'était faux, et la garde écrite d'après lui héritait de son erreur.
    //
    // Le risque RÉEL est plus étroit : la COLONNE accepte la chaîne vide (`notNull` ne
    // l'interdit pas), donc deux lignes posées HORS du contrat — un import direct, une
    // migration à venir — se rattacheraient l'une à l'autre au motif qu'elles n'ont pas
    // de source. D'où deux lignes insérées en SQL brut, hors du chemin d'écriture.
    const orphelins = [randomUUID(), randomUUID()];
    for (const id of orphelins) {
      await db.insert(schema.faits).values({
        id,
        sujet: "marc",
        predicat: "emploi.poste",
        valeur: "chiffre-non-lu-par-ce-cas",
        valeurType: "texte",
        niveau: 1,
        statut: "valide",
        fiabiliteSource: "document-officiel",
        versionVocabulaire: 1,
        empreinte: `orphelin-${id}`,
      });
      await db.insert(schema.provenances).values({ faitId: id, sourceType: "document", sourceRef: "", extracteur: "brut" });
    }
    // Le repli précoce doit tirer AVANT le SQL : sans lui, ces deux orphelins se voient.
    expect(await depotAdminDrizzle(db).autresDeLaMemeSource("", orphelins[0]!, 20)).toEqual([]);
    expect(await depotAdminDrizzle(db).autresDeLaMemeSource("   ", orphelins[0]!, 20)).toEqual([]);
  });

  it("la borne de lecture est RESPECTÉE", async () => {
    const { id, lisible } = await lire("logement.bail.fin");
    expect((await depotAdminDrizzle(db).autresDeLaMemeSource(lisible.provenance!.sourceRef, id, 1)).length).toBe(1);
  });
});

describe("les faits liés — les DEUX sens de la paire", () => {
  /** Pose un lien brut, sans passer par le recalcul : on teste la LECTURE, pas les règles. */
  async function lien(
    a: string,
    b: string,
    cibleB: "fait" | "question" = "fait",
    type: (typeof schema.TYPES_LIEN)[number] = "meme-document",
  ) {
    await db.insert(schema.liens).values({
      id: randomUUID(),
      faitA: a,
      faitB: b,
      cibleB,
      type,
      regle: "test",
      pourquoi: "posé par le test",
    });
  }

  it("voit un lien où le fait est en A", async () => {
    const moi = await lire("logement.bail.fin");
    const autre = await lire("logement.ville");
    await lien(moi.id, autre.id);
    expect((await depotLiensDrizzle(db).voisinsDe(moi.id, 30)).length).toBe(1);
  });

  it("⚠️ voit aussi un lien où le fait est en B (mutation : ne lire que fait_a)", async () => {
    // LA raison d'être de ce bloc. La table stocke une paire ORDONNÉE et seul `fait_a` est
    // indexé, mais « vient du même document » est SYMÉTRIQUE : ne lire que `fait_a`
    // montrerait le lien à une extrémité et le cacherait à l'autre. Une fiche sur deux
    // mentirait par omission — « aucun fait lié » — sans rien de rouge nulle part.
    const moi = await lire("logement.bail.fin");
    const autre = await lire("logement.ville");
    await lien(autre.id, moi.id);
    const voisins = await depotLiensDrizzle(db).voisinsDe(moi.id, 30);
    expect(voisins.length).toBe(1);
    expect(voisins[0]!.faitA).toBe(autre.id);
  });

  it("⚠️ un lien vers une QUESTION remonte, et est marqué comme N'ÉTANT PAS un fait", async () => {
    // ⚠️ Mon premier jet de ce cas était IMPOSSIBLE, et c'est le schéma qui l'a dit :
    // l'insertion a ÉCHOUÉ parce que `liens.fait_a` porte une clé étrangère vers `faits`
    // alors que `fait_b` n'en porte aucune. Un identifiant de question ne peut donc être
    // qu'en **B** — un fait n'est jamais « en B d'un lien vers une question ».
    //
    // La forme RÉELLE du risque est donc celle-ci : le lien remonte bien (il touche ce
    // fait), et c'est l'AFFICHAGE qui doit refuser d'en faire un `/fait/<id>` — sinon la
    // fiche propose un rattachement qui rend un 404. D'où `autreExtremite`, pur et testé.
    const moi = await lire("logement.bail.fin");
    const idQuestion = randomUUID();
    // ⚠️ DEUXIÈME refus du schéma sur ce seul cas, et il apprend autant que le premier :
    // la contrainte `liens_question_seulement_cause` n'autorise un lien vers une question
    // QU'AVEC le type `cause-declaree`. La branche `estUnFait: false` d'`autreExtremite`
    // n'est donc atteignable que par ce type-là — écrit ici plutôt que supposé.
    await lien(moi.id, idQuestion, "question", "cause-declaree");
    const voisins = await depotLiensDrizzle(db).voisinsDe(moi.id, 30);
    expect(voisins.length).toBe(1);
    const bout = autreExtremite(voisins[0]!, moi.id);
    expect(bout.autre).toBe(idQuestion);
    expect(bout.estUnFait, "un identifiant de question ne doit jamais devenir un lien de fiche").toBe(false);
  });
  it("le lien d'un AUTRE couple ne remonte pas", async () => {
    const moi = await lire("logement.bail.fin");
    const a = await lire("logement.ville");
    const b = await lire("logement.proprietaire");
    await lien(a.id, b.id);
    expect(await depotLiensDrizzle(db).voisinsDe(moi.id, 30)).toEqual([]);
  });
});
