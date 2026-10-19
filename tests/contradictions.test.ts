// tests/contradictions.test.ts — quand deux sources divergent, la mémoire POSE LA QUESTION,
// et le rattrapage du 17/09 rend à Marc ce qu'une re-déduction lui avait pris.
//
// ⚠️ Décision de Marc, 17/09 : « une page de questions avec des questions précises que je
// peux répondre soit en QCM soit en texte alors oui, mais le reste non non ». Ce fichier
// garde les deux moitiés de ce choix :
//   1. une divergence devient une QUESTION à options, jamais un fait « à valider » de plus —
//      parce que valider dans `/a-valider` périme silencieusement le concurrent, ce qui a
//      coûté cinq faits le 17/09 ;
//   2. la migration `0014` annule ce défaut exact, et rien d'autre.
//
// Les mutations qui doivent rougir sont nommées dans les titres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { ecrireLot } from "../lib/ecrireFaits";
import { rendreLisible } from "../lib/lecture";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { contradictionDe, contradictions, doublonExactDe, doublonsExacts, type FaitEnConflit } from "../lib/questions/contradictions";
import { poserContradictions, predicatsAUneValeur } from "../lib/questions/poserContradictions";
import { lireOptions, optionChoisie, questionDeContradiction } from "../lib/questions";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 13).toString("base64"));
const DOCUMENT: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };
const MODELE: Ecrivain = { appId: "memoryai", role: "ecriture", fiabilites: ["app"] };
const MAINTENANT = new Date("2026-09-17T12:27:00Z");

const f = (o: Partial<FaitEnConflit>): FaitEnConflit => ({
  id: "00000000-0000-0000-0000-000000000001",
  predicat: "logement.bail.fin",
  valeur: "2028-06-30",
  fiabiliteSource: "document-tiers",
  extracteur: "moteur-document-v1",
  statut: "valide",
  ...o,
});

describe("détecter une contradiction (PUR)", () => {
  it("deux valeurs différentes du même prédicat ⇒ une question à deux options", () => {
    const c = contradictionDe([
      f({}),
      f({ id: "00000000-0000-0000-0000-000000000002", valeur: "2027-12-31", fiabiliteSource: "app", extracteur: "conversation-v1", statut: "propose" }),
    ]);
    expect(c).not.toBeNull();
    expect(c!.options).toHaveLength(2);
    // La provenance est LISIBLE, c'est elle qui rend le choix informé — pas l'identifiant.
    expect(c!.options.map((o) => o.provenance)).toEqual([
      "lu sur un document · moteur-document-v1",
      "déduit par un modèle · conversation-v1",
    ]);
    // ⚠️ Le texte de la question ne porte AUCUNE valeur : elles vivent dans les options.
    expect(c!.question).not.toContain("2027");
  });

  it("MUTATION — retirer le `parValeur.size < 2` fait rougir ce cas", () => {
    // Deux faits, UNE seule valeur : rien à décider. Poser la question ici demanderait à Marc
    // de choisir entre une chose et elle-même.
    expect(contradictionDe([f({}), f({ id: "00000000-0000-0000-0000-000000000002", extracteur: "conversation-v1", statut: "propose" })])).toBeNull();
  });

  it("un seul fait ⇒ rien — le contrôle négatif", () => {
    expect(contradictionDe([f({})])).toBeNull();
  });

  it("MUTATION — ignorer `predicatsAUneValeur` fait rougir ce cas", () => {
    // `contrat.fournisseur` est `multi: true` : deux fournisseurs ne sont pas une
    // contradiction, c'est le cas ordinaire. Une question ici serait absurde.
    const faits = [
      f({ predicat: "contrat.fournisseur", valeur: "Marque" }),
      f({ id: "00000000-0000-0000-0000-000000000002", predicat: "contrat.fournisseur", valeur: "Banque Aurore" }),
    ];
    expect(contradictions(faits, predicatsAUneValeur())).toEqual([]);
    // Et le prédicat non-multi du même lot, lui, sort bien : sans ce second cas, le test
    // passerait aussi avec une détection débranchée.
    expect(contradictions([...faits, f({}), f({ id: "00000000-0000-0000-0000-000000000003", valeur: "2028-01-01" })], predicatsAUneValeur())).toHaveLength(1);
  });

  it("les prédicats à une valeur se DÉRIVENT du vocabulaire", () => {
    const p = predicatsAUneValeur();
    expect(p.has("logement.bail.fin")).toBe(true);
    expect(p.has("contrat.fournisseur")).toBe(false);
    // Anti-vacuité : un ensemble vide passerait les deux lignes du dessus si elles étaient
    // écrites à l'envers.
    expect(p.size).toBeGreaterThan(10);
  });
});

describe("doublon EXACT sur un prédicat multiple (demandé par Marc, 17/09)", () => {
  const fourn = (id: string, valeur: string, fiab: FaitEnConflit["fiabiliteSource"], extr: string) =>
    f({ id, predicat: "contrat.fournisseur", valeur, fiabiliteSource: fiab, extracteur: extr });

  it("le détecteur trouve le doublon réel du 17/09 (appel DIRECT — voir plus bas pour le câblage)", () => {
    // Le cas RÉEL : « Marque Services Financiers » deux fois sur `contrat.fournisseur`, une
    // fois lu sur le contrat, une fois re-déduit par le modèle le 17/09.
    const d = doublonsExacts(
      [
        fourn("00000000-0000-0000-0000-00000000000a", "Marque Services Financiers", "document-tiers", "moteur-document-v1"),
        fourn("00000000-0000-0000-0000-00000000000b", "Marque Services Financiers", "app", "conversation-v1"),
      ],
      predicatsAUneValeur(),
    );
    expect(d).toHaveLength(1);
    expect(d[0]!.options).toHaveLength(2);
    // ⚠️ Le libellé porte la PROVENANCE : deux boutons portant la même valeur seraient
    // indiscernables, et c'est justement le propre d'un doublon exact.
    expect(d[0]!.options.map((o) => o.libelle)).toEqual([
      "Garder celui lu sur un document · moteur-document-v1",
      "Garder celui déduit par un modèle · conversation-v1",
    ]);
    // Choisir l'un REJETTE l'autre : sans ça, `valider` ne périmerait rien (prédicat
    // multiple) et la question reviendrait à chaque passe sur un état inchangé.
    expect(d[0]!.options[0]!.aRejeter).toEqual(["00000000-0000-0000-0000-00000000000b"]);
    expect(d[0]!.options[1]!.aRejeter).toEqual(["00000000-0000-0000-0000-00000000000a"]);
  });

  it("deux valeurs DIFFÉRENTES sur un prédicat multiple ⇒ RIEN — le contrôle négatif", () => {
    // Deux fournisseurs, c'est le cas ordinaire. Une question ici serait absurde, et c'est
    // exactement ce qui distingue ce détecteur de `contradictions`.
    expect(
      doublonsExacts(
        [
          fourn("00000000-0000-0000-0000-00000000000a", "Marque", "document-tiers", "moteur-document-v1"),
          fourn("00000000-0000-0000-0000-00000000000b", "Banque Aurore", "app", "conversation-v1"),
        ],
        predicatsAUneValeur(),
      ),
    ).toEqual([]);
  });

  it("la casse n'est PAS normalisée ici non plus", () => {
    expect(
      doublonsExacts(
        [
          fourn("00000000-0000-0000-0000-00000000000a", "Marque", "document-tiers", "moteur-document-v1"),
          fourn("00000000-0000-0000-0000-00000000000b", "marque", "app", "conversation-v1"),
        ],
        predicatsAUneValeur(),
      ),
    ).toEqual([]);
  });

  it("MUTATION — inverser le filtre `predicatsAUneValeur` fait rougir ce cas", () => {
    // Un doublon exact sur un prédicat à valeur UNIQUE ne concerne pas ce détecteur : la
    // garde d'écriture le refuse en amont, et le rattrapage du 17/09 a nettoyé le stock. Si
    // les deux détecteurs partageaient le même filtre, ce prédicat produirait DEUX questions.
    const doublonUnique = [
      f({ id: "00000000-0000-0000-0000-00000000000a" }),
      f({ id: "00000000-0000-0000-0000-00000000000b", extracteur: "conversation-v1" }),
    ];
    expect(doublonsExacts(doublonUnique, predicatsAUneValeur())).toEqual([]);
    // Et la partition est TOTALE : aucun prédicat ne peut produire deux questions
    // concurrentes, aucun n'échappe aux deux détecteurs.
    const melange = [
      ...doublonUnique,
      fourn("00000000-0000-0000-0000-00000000000c", "Marque", "document-tiers", "moteur-document-v1"),
      fourn("00000000-0000-0000-0000-00000000000d", "Marque", "app", "conversation-v1"),
    ];
    const aUneValeur = predicatsAUneValeur();
    const a = contradictions(melange, aUneValeur).map((x) => x.predicat);
    const b = doublonsExacts(melange, aUneValeur).map((x) => x.predicat);
    expect(a.filter((p) => b.includes(p))).toEqual([]);
    expect(b).toEqual(["contrat.fournisseur"]);
  });

  it("un seul fait, ou une valeur unique ⇒ rien", () => {
    expect(doublonExactDe([fourn("00000000-0000-0000-0000-00000000000a", "Marque", "app", "x")])).toBeNull();
    expect(doublonExactDe([])).toBeNull();
  });
});

describe("un modèle ne peut pas fabriquer d'options", () => {
  it("MUTATION — laisser `options` entrer par le schéma de question fait rougir ce cas", async () => {
    const { validerQuestion, CHAMPS_QUESTION } = await import("../lib/questions");
    // Le contrat d'entrée d'une question reste à TROIS champs. Si `options` y entrait, le chat
    // ou claude.ai pourraient faire pointer un choix vers le fait de leur choix — et le clic
    // de Marc validerait ce fait.
    expect([...CHAMPS_QUESTION].sort()).toEqual(["motif", "predicat_vise", "question"]);
    const r = validerQuestion(
      { question: "Laquelle ?", predicat_vise: "logement.bail.fin", motif: "test", options: [{ faitId: "x", valeur: "y", provenance: "z" }] },
      "chat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("champ_inconnu");
  });

  it("MUTATION — retirer la garde `optionChoisie` fait rougir ce cas", () => {
    const c = contradictionDe([f({}), f({ id: "00000000-0000-0000-0000-000000000002", valeur: "2027-12-31" })])!;
    const q = questionDeContradiction(c);
    // Un identifiant qui n'est pas dans les options n'autorise rien : sans cette garde, un
    // formulaire forgé validerait n'importe quel fait de la base, donc en périmerait un autre.
    expect(optionChoisie(q.options, "00000000-0000-0000-0000-0000000000ff")).toBeNull();
    expect(optionChoisie(q.options, "00000000-0000-0000-0000-000000000002")).not.toBeNull();
    // Et une question SANS options n'autorise rien du tout.
    expect(optionChoisie(undefined, "00000000-0000-0000-0000-000000000002")).toBeNull();
  });

  it("des options illisibles valent ABSENTES, jamais tronquées", () => {
    expect(lireOptions(null)).toBeUndefined();
    expect(lireOptions("pas du json")).toBeUndefined();
    expect(lireOptions("[]")).toBeUndefined();
    // ⚠️ Une entrée invalide fait tomber TOUTE la liste : un QCM amputé proposerait de choisir
    // entre moins d'options qu'il n'y en avait, et Marc n'aurait aucun moyen de le savoir.
    expect(lireOptions('[{"faitId":"a","valeur":"b","provenance":"c"},{"faitId":123}]')).toBeUndefined();
    expect(lireOptions('[{"faitId":"a","valeur":"b","provenance":"c","libelle":"b"}]')).toHaveLength(1);
    // Une option de DOUBLON porte `aRejeter` : elle doit passer.
    expect(lireOptions('[{"faitId":"a","valeur":"b","provenance":"c","libelle":"d","aRejeter":["e"]}]')).toHaveLength(1);
    // ⚠️ Mais un `aRejeter` mal typé fait tomber la liste ENTIÈRE : c'est lui qui décide quels
    // faits sont rejetés au clic, et rejeter « n'importe quoi » est pire que retomber en
    // texte libre.
    expect(lireOptions('[{"faitId":"a","valeur":"b","provenance":"c","libelle":"d","aRejeter":[1]}]')).toBeUndefined();
    expect(lireOptions('[{"faitId":"a","valeur":"b","provenance":"c","libelle":"d","aRejeter":"e"}]')).toBeUndefined();
  });
});

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const bail = (valeur: string, sourceRef: string, extracteur: string) => ({
  ...BON,
  predicat: "logement.bail.fin",
  valeur,
  valeur_type: "date" as const,
  provenance: { ...BON.provenance, source_ref: sourceRef, extracteur },
});

async function baseNeuve(migrations?: readonly string[]) {
  pg = new PGlite();
  const fichiers = readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort();
  for (const nom of migrations ?? fichiers) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", nom), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
}

describe("poser la question, sur une vraie Postgres", () => {
  beforeEach(async () => {
    await baseNeuve();
  });
  afterEach(async () => {
    await pg?.close();
  });

  const faitsEnConflit = async (): Promise<FaitEnConflit[]> => {
    const rows = await depotLectureDrizzle(db).faits({ statuts: ["valide", "propose"], limite: 500 });
    return rows.flatMap((r) => {
      try {
        const l = rendreLisible(r, cle);
        return [
          {
            id: l.id,
            predicat: l.predicat,
            valeur: l.valeur,
            fiabiliteSource: r.fait.fiabiliteSource,
            extracteur: r.provenance?.extracteur ?? null,
            statut: r.fait.statut === "valide" ? ("valide" as const) : ("propose" as const),
          },
        ];
      } catch {
        return [];
      }
    });
  };

  it("MUTATION — retirer l'appel à poserContradictions fait rougir ce cas", async () => {
    // L'état réel après la garde du lot 20 : un fait validé lu sur le document, et une
    // DIVERGENCE proposée par un modèle (une valeur identique n'entrerait plus).
    await ecrireLot([bail("2028-06-30", "drive|bail", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const [v] = await db.select().from(schema.faits);
    await depotAdminDrizzle(db).valider(v!.id, MAINTENANT);
    await ecrireLot([bail("2027-12-31", "conv|1", "conversation-v1")], MODELE, cle, depotDrizzle(db));

    const questions = depotQuestionsDrizzle(db);
    const r = await poserContradictions({ faits: await faitsEnConflit(), questions, maintenant: () => MAINTENANT });
    expect(r.detectees).toBe(1);
    expect(r.posees).toBe(1);

    const ouvertes = await questions.ouvertes(10);
    expect(ouvertes).toHaveLength(1);
    const options = lireOptions(ouvertes[0]!.options);
    expect(options).toHaveLength(2);
    expect(options!.map((o) => o.valeur).sort()).toEqual(["2027-12-31", "2028-06-30"]);
    expect(ouvertes[0]!.origine).toBe("regle");
  });

  it("MUTATION — retirer `predicatsDejaDemandes` fait rougir ce cas", async () => {
    await ecrireLot([bail("2028-06-30", "drive|bail", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const [v] = await db.select().from(schema.faits);
    await depotAdminDrizzle(db).valider(v!.id, MAINTENANT);
    await ecrireLot([bail("2027-12-31", "conv|1", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    const questions = depotQuestionsDrizzle(db);
    const faits = await faitsEnConflit();

    await poserContradictions({ faits, questions, maintenant: () => MAINTENANT });
    // Deuxième passe sur le MÊME état : la question ne se repose pas. Sans ça, chaque passe
    // quotidienne re-tenterait, le plafond de cinq écarterait les plus anciennes à chaque
    // tour, et la page changerait de contenu sans que la mémoire bouge.
    const r2 = await poserContradictions({ faits, questions, maintenant: () => MAINTENANT });
    expect(r2.detectees).toBe(1);
    expect(r2.posees).toBe(0);
    expect(r2.dejaDemandees).toBe(1);
    expect(await questions.ouvertes(10)).toHaveLength(1);
  });

  it("MUTATION — débrancher `doublonsExacts` de la passe fait rougir ce cas", async () => {
    // ⚠️ CE TEST EXISTE PARCE QUE SON ABSENCE A ÉTÉ MESURÉE. Les cas ci-dessus appellent
    // `doublonsExacts` EN DIRECT : débrancher son appel de `poserContradictions` les laissait
    // tous les dix-neuf VERTS. Le détecteur était juste, testé, et n'était appelé par rien —
    // un trou entre deux moitiés testées n'appartient à personne. Il faut donc une garde qui
    // TRAVERSE : de l'état en base jusqu'à la question posée.
    const fourn = (ref: string, extracteur: string) => ({
      ...BON,
      predicat: "contrat.fournisseur",
      valeur: "Marque Services Financiers",
      valeur_type: "texte" as const,
      provenance: { ...BON.provenance, source_ref: ref, extracteur },
    });
    const admin = depotAdminDrizzle(db);
    await ecrireLot([fourn("drive|contrat", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const [a] = await db.select().from(schema.faits);
    await admin.valider(a!.id, MAINTENANT);
    // ⚠️ La garde `doublon_valide` de `ecrireLot` ne bloque PAS ici : elle ne vise que les
    // prédicats à valeur unique. C'est précisément pourquoi ce doublon-là s'installe.
    const r = await ecrireLot([fourn("conv|1", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    expect(r.acceptes).toBe(1);
    await admin.valider(r.idsCrees[0]!, MAINTENANT);

    const questions = depotQuestionsDrizzle(db);
    const res = await poserContradictions({ faits: await faitsEnConflit(), questions, maintenant: () => MAINTENANT });
    expect(res.detectees).toBe(1);
    expect(res.posees).toBe(1);

    const ouvertes = await questions.ouvertes(10);
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0]!.predicatVise).toBe("contrat.fournisseur");
    const options = lireOptions(ouvertes[0]!.options);
    expect(options).toHaveLength(2);
    // Et le rejet croisé a bien traversé la sérialisation JSON de la base.
    expect(options!.map((o) => o.aRejeter?.length)).toEqual([1, 1]);
  });

  it("aucune divergence ⇒ aucune question, jamais une erreur — le contrôle négatif", async () => {
    await ecrireLot([bail("2028-06-30", "drive|bail", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const questions = depotQuestionsDrizzle(db);
    const r = await poserContradictions({ faits: await faitsEnConflit(), questions, maintenant: () => MAINTENANT });
    expect(r).toMatchObject({ detectees: 0, posees: 0 });
    expect(await questions.ouvertes(10)).toHaveLength(0);
  });
});

describe("le rattrapage du 17/09 (migration 0014)", () => {
  afterEach(async () => {
    await pg?.close();
  });

  /** Reconstitue l'état du 17/09 : un fait lu sur document, écrasé par une re-déduction. */
  async function etatDu17Septembre() {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([bail("2028-06-30", "drive|bail", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const [doc] = await db.select().from(schema.faits);
    await admin.valider(doc!.id, MAINTENANT);
    // ⚠️ La garde du lot 20 refuse une valeur IDENTIQUE ; le défaut du 17/09 portait aussi sur
    // des valeurs différentes (une d'elles était appauvrie). On rejoue ce cas-là.
    const r = await ecrireLot([bail("2027-12-31", "conv|1", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    const idModele = r.idsCrees[0]!;
    await admin.valider(idModele, MAINTENANT);
    return { idDoc: doc!.id, idModele };
  }

  it("MUTATION — vider la migration 0014 fait rougir ce cas", async () => {
    // Toutes les migrations SAUF 0014 : l'état d'avant le rattrapage.
    const toutes = readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort();
    await baseNeuve(toutes.filter((n) => !n.startsWith("0014")));
    const { idDoc, idModele } = await etatDu17Septembre();

    const avantDoc = (await db.select().from(schema.faits).where(eq(schema.faits.id, idDoc)))[0];
    expect(avantDoc!.statut).toBe("perime");

    // Le rattrapage, appliqué seul, sur cet état.
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", toutes.find((n) => n.startsWith("0014"))!), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }

    const doc = (await db.select().from(schema.faits).where(eq(schema.faits.id, idDoc)))[0];
    const modele = (await db.select().from(schema.faits).where(eq(schema.faits.id, idModele)))[0];
    expect(doc!.statut).toBe("valide");
    expect(modele!.statut).toBe("perime");
    // ⚠️ Exactement UN validé à la fin : l'échange est atomique, jamais deux ni zéro.
    const valides = (await db.select().from(schema.faits)).filter((x) => x.statut === "valide");
    expect(valides).toHaveLength(1);
  });

  it("elle est IDEMPOTENTE : rejouée, elle ne re-échange rien", async () => {
    await baseNeuve();
    const { idDoc, idModele } = await etatDu17Septembre();
    const chemin = resolve(process.cwd(), "drizzle", readdirSync(resolve(process.cwd(), "drizzle")).find((n) => n.startsWith("0014"))!);
    // Deux passages d'affilée. Au second, le fait de `conversation-v1` est `perime`, donc
    // l'ensemble `ecrasants` est vide : l'échange ne peut pas osciller.
    for (let i = 0; i < 2; i++) {
      for (const s of readFileSync(chemin, "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
    const doc = (await db.select().from(schema.faits).where(eq(schema.faits.id, idDoc)))[0];
    const modele = (await db.select().from(schema.faits).where(eq(schema.faits.id, idModele)))[0];
    expect(doc!.statut).toBe("valide");
    expect(modele!.statut).toBe("perime");
  });

  it("elle ne touche PAS un fait qu'aucune conversation n'a écrasé — le contrôle négatif", async () => {
    await baseNeuve();
    const admin = depotAdminDrizzle(db);
    // Deux faits du document, le second remplace le premier : un remplacement LÉGITIME, que
    // le rattrapage n'a aucune raison de défaire.
    await ecrireLot([bail("2026-06-30", "drive|bail-2025", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    const [ancien] = await db.select().from(schema.faits);
    await admin.valider(ancien!.id, MAINTENANT);
    const r = await ecrireLot([bail("2028-06-30", "drive|bail-2026", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
    await admin.valider(r.idsCrees[0]!, MAINTENANT);

    const chemin = resolve(process.cwd(), "drizzle", readdirSync(resolve(process.cwd(), "drizzle")).find((n) => n.startsWith("0014"))!);
    for (const s of readFileSync(chemin, "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
    // Rien n'a bougé : le remplaçant validé ne vient pas d'une conversation.
    expect((await db.select().from(schema.faits).where(eq(schema.faits.id, ancien!.id)))[0]!.statut).toBe("perime");
    expect((await db.select().from(schema.faits).where(eq(schema.faits.id, r.idsCrees[0]!)))[0]!.statut).toBe("valide");
  });
});
