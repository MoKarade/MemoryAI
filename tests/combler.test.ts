// tests/combler.test.ts — les questions qui COMBLENT les trous, sans appel de modèle (L28).
//
// Ce que ces cas défendent :
//   1. l'ordre de Marc : santé, famille, goûts d'abord, puis le reste ;
//   2. le plafond de cinq est PARTAGÉ : on ne pose que dans les places libres, jamais au-dessus
//      (poser au-dessus écarterait une question que Marc n'a pas lue) ;
//   3. une question écartée ne revient pas, et son prédicat cède la place au suivant ;
//   4. ce qu'on ne demande JAMAIS (niveau 3, documents, identifiants de sujet, adresse) ;
//   5. aucun appel de modèle, et les questions arrivent bien dans la pile.
//
// Les mutations qui doivent rougir sont nommées dans les titres.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import type { ClientModele, ReponseModele } from "../lib/chat/agent";
import { passeApprentissage } from "../lib/apprentissage";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { comptesParPredicatValides, depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { composerPile } from "../lib/pile/composer";
import { chargerEntreesPile } from "../lib/pile/charger";
import { MAX_OUVERTES, LONGUEUR_MAX_QUESTION } from "../lib/questions";
import {
  comblerLesTrous,
  estDemandable,
  PREDICATS_JAMAIS_DEMANDES,
  questionDuTrou,
  questionsPourLesTrous,
  texteGenerique,
  trousAComblerEnOrdre,
} from "../lib/questions/combler";
import { vocabulaire } from "../lib/vocabulaire";

const MAINTENANT = new Date("2026-10-16T12:00:00Z");
const SANTE = ["sante.allergie", "sante.praticien", "sante.couverture", "sante.rendez_vous", "sante.condition"];

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM questions");
});

describe("quels trous, dans quel ordre (PUR)", () => {
  it("santé d'abord, puis famille, puis goûts, puis le reste dans l'ordre du vocabulaire", () => {
    const ordre = trousAComblerEnOrdre({}).map((p) => p.predicat);
    expect(ordre.slice(0, 6)).toEqual([...SANTE, "sante.pharmacie"]);
    const domaines = trousAComblerEnOrdre({}).map((p) => p.domaine);
    const dernier = (d: string) => domaines.lastIndexOf(d);
    const premier = (d: string) => domaines.indexOf(d);
    expect(dernier("sante")).toBeLessThan(Math.min(premier("famille"), premier("relation")));
    expect(Math.max(dernier("famille"), dernier("relation"))).toBeLessThan(premier("gout"));
    expect(dernier("gout")).toBeLessThan(premier("emploi"));
  });

  it("un prédicat qui porte déjà un fait validé n'est PAS un trou", () => {
    const ordre = trousAComblerEnOrdre({ "sante.allergie": 1 }).map((p) => p.predicat);
    expect(ordre).not.toContain("sante.allergie");
    expect(ordre[0]).toBe("sante.praticien");
  });

  it("déterministe : deux calculs rendent la même liste", () => {
    expect(questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(), places: 5 })).toEqual(
      questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(), places: 5 }),
    );
  });

  it("ce qu'on ne demande JAMAIS : niveau 3, documents, identifiants de sujet, adresse", () => {
    const demandes = new Set(trousAComblerEnOrdre({}).map((p) => p.predicat));
    for (const p of vocabulaire()) {
      if (p.niveauMin >= 3) expect(demandes.has(p.predicat), `${p.predicat} est N3`).toBe(false);
      if (p.types.every((t) => t === "ref_document")) expect(demandes.has(p.predicat), `${p.predicat} est un document`).toBe(false);
    }
    for (const exclu of ["relation.proche", "relation.lien", "famille.enfant", "logement.adresse"]) {
      expect(PREDICATS_JAMAIS_DEMANDES.has(exclu)).toBe(true);
      expect(demandes.has(exclu), exclu).toBe(false);
    }
    // Garde-fou de la garde : si le vocabulaire gagne un prédicat N3, il reste exclu SANS toucher
    // la liste ci-dessus — c'est le niveau qui décide, pas un nom recopié.
    expect(estDemandable({ predicat: "x.y", domaine: "x", niveauMin: 3, types: ["texte"], multi: false, description: "d" })).toBe(false);
    expect(estDemandable({ predicat: "x.y", domaine: "x", niveauMin: 1, types: ["ref_document"], multi: false, description: "d" })).toBe(false);
    expect(estDemandable({ predicat: "x.y", domaine: "x", niveauMin: 1, types: ["texte"], multi: false, description: "d", deprecie: "x.z" })).toBe(false);
  });

  it("CHAQUE trou demandable donne une question valide : '?', 200 caractères au plus, prédicat du vocabulaire", () => {
    for (const p of trousAComblerEnOrdre({})) {
      const q = questionDuTrou(p);
      expect(q, `question refusée pour ${p.predicat}`).not.toBeNull();
      expect(q!.question.endsWith("?"), p.predicat).toBe(true);
      expect(q!.question.length, p.predicat).toBeLessThanOrEqual(LONGUEUR_MAX_QUESTION);
      expect(q!.predicatVise).toBe(p.predicat);
      expect(q!.origine).toBe("regle");
      // Une question qui comble ne porte JAMAIS d'options : le QCM pointe vers un fait existant.
      expect(q!.options).toBeUndefined();
    }
  });

  it("un prédicat qui n'accepte que des dates demande le FORMAT, sinon l'écriture refuserait la réponse", () => {
    const finBail = vocabulaire().find((p) => p.predicat === "logement.bail.fin")!;
    expect(texteGenerique(finBail)).toContain("AAAA-MM-JJ");
    const employeur = vocabulaire().find((p) => p.predicat === "emploi.employeur")!;
    expect(texteGenerique(employeur)).not.toContain("AAAA-MM-JJ");
  });

  it("respecte `places` et saute les prédicats déjà demandés", () => {
    expect(questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(), places: 0 })).toEqual([]);
    const trois = questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(), places: 3 });
    expect(trois.map((q) => q.predicatVise)).toEqual(SANTE.slice(0, 3));
    const sans = questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(["sante.allergie"]), places: 2 });
    expect(sans.map((q) => q.predicatVise)).toEqual(["sante.praticien", "sante.couverture"]);
  });
});

describe("comblerLesTrous — le plafond de cinq est partagé", () => {
  const poser = () =>
    comblerLesTrous({ comptes: {}, questions: depotQuestionsDrizzle(db), maintenant: () => MAINTENANT });

  it("file vide ⇒ cinq questions, les plus prioritaires", async () => {
    const r = await poser();
    expect(r.places).toBe(MAX_OUVERTES);
    expect(r.posees).toBe(MAX_OUVERTES);
    const ouvertes = await depotQuestionsDrizzle(db).ouvertes(20);
    expect(ouvertes.map((q) => q.predicatVise).sort()).toEqual([...SANTE].sort());
    expect(ouvertes.every((q) => q.origine === "regle")).toBe(true);
  });

  it("n'écarte JAMAIS une question ouverte : trois déjà là ⇒ deux posées, les trois restent", async () => {
    const depot = depotQuestionsDrizzle(db);
    for (const [i, predicat] of ["emploi.employeur", "gout.cuisine", "projet.souhait"].entries()) {
      const q = questionsPourLesTrous({ comptes: {}, dejaOuverts: new Set(), places: 200 }).find((x) => x.predicatVise === predicat)!;
      await depot.poser(q, new Date(MAINTENANT.getTime() - (10 - i) * 60_000));
    }
    const r = await poser();
    expect(r.places).toBe(2);
    expect(r.posees).toBe(2);
    const ouvertes = await depot.ouvertes(20);
    expect(ouvertes).toHaveLength(MAX_OUVERTES);
    for (const predicat of ["emploi.employeur", "gout.cuisine", "projet.souhait"]) {
      expect(ouvertes.map((q) => q.predicatVise)).toContain(predicat);
    }
    expect((await depot.comptes()).ecartees).toBe(0);
  });

  it("file pleine ⇒ rien n'est posé et rien n'est écarté", async () => {
    await poser();
    const avant = await depotQuestionsDrizzle(db).comptes();
    const r = await poser();
    expect(r).toMatchObject({ places: 0, posees: 0 });
    expect(await depotQuestionsDrizzle(db).comptes()).toEqual(avant);
  });

  it("une question ÉCARTÉE ne revient pas, et le prédicat suivant prend la place", async () => {
    const depot = depotQuestionsDrizzle(db);
    await poser();
    const allergie = (await depot.ouvertes(20)).find((q) => q.predicatVise === "sante.allergie")!;
    await depot.ecarter(allergie.id, MAINTENANT);

    const r = await poser();
    expect(r.places).toBe(1);
    expect(r.posees).toBe(1);
    const ouvertes = (await depot.ouvertes(20)).map((q) => q.predicatVise);
    expect(ouvertes).not.toContain("sante.allergie");
    expect(ouvertes).toContain("sante.pharmacie");
    expect(ouvertes).toHaveLength(MAX_OUVERTES);
  });

  it("une question ÉCARTÉE ne consomme pas de place : on essaie le candidat d'après", async () => {
    const depot = depotQuestionsDrizzle(db);
    await poser();
    // Deux écartées : l'index unique en garde le souvenir, deux places se libèrent.
    for (const p of ["sante.allergie", "sante.praticien"]) {
      const q = (await depot.ouvertes(20)).find((x) => x.predicatVise === p)!;
      await depot.ecarter(q.id, MAINTENANT);
    }
    const r = await poser();
    expect(r.posees).toBe(2);
    expect((await depot.ouvertes(20)).map((q) => q.predicatVise).sort()).toEqual(
      ["sante.condition", "sante.couverture", "sante.pharmacie", "sante.rendez_vous", "relation.statut"].sort(),
    );
  });

  it("aucun trou ⇒ aucune écriture", async () => {
    const comptes = Object.fromEntries(vocabulaire().map((p) => [p.predicat, 1]));
    const r = await comblerLesTrous({ comptes, questions: depotQuestionsDrizzle(db), maintenant: () => MAINTENANT });
    expect(r).toEqual({ trous: 0, places: MAX_OUVERTES, posees: 0 });
    expect(await depotQuestionsDrizzle(db).comptes()).toEqual({ ouvertes: 0, repondues: 0, ecartees: 0 });
  });
});

describe("dans la passe d'apprentissage : sans modèle, et dans la pile", () => {
  /** Un modèle qui COMPTE ses appels : c'est le compteur qui prouve « aucun appel ». */
  function faussaire() {
    let appels = 0;
    const client: ClientModele = {
      async create() {
        appels++;
        return { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } as ReponseModele;
      },
    };
    return { client, appels: () => appels };
  }
  const cle = deriverCle(randomBytes(32).toString("base64"));
  const passe = (client: ClientModele, extra: { comblerLesTrous?: boolean } = {}) =>
    passeApprentissage({
      client,
      modele: "claude-sonnet-5",
      cle,
      conversations: depotConversationsDrizzle(db),
      ecriture: depotDrizzle(db),
      admin: depotAdminDrizzle(db),
      questions: depotQuestionsDrizzle(db),
      faitsEnConflit: async () => [],
      maintenant: () => new Date("2026-11-20T12:00:00Z"),
      comptesParPredicat: () => comptesParPredicatValides(db),
      ...extra,
    });

  it("la passe pose cinq questions SANS appeler le modèle, et le publie à part", async () => {
    const { client, appels } = faussaire();
    const r = await passe(client);
    expect(r.questionsPosees).toBe(MAX_OUVERTES);
    expect(r.comblement).toMatchObject({ places: MAX_OUVERTES, posees: MAX_OUVERTES });
    expect(r.comblement!.trous).toBeGreaterThan(MAX_OUVERTES);
    // La file est pleine : le producteur par modèle ne dépense rien.
    expect(appels()).toBe(0);
    expect(r.coutUsd).toBe(0);
    expect(r.fin).toBe("termine");
  });

  it("la passe suivante ne repose rien tant que Marc n'a pas répondu", async () => {
    const { client } = faussaire();
    await passe(client);
    const r = await passe(client);
    expect(r.questionsPosees).toBe(0);
    expect(r.comblement).toMatchObject({ places: 0, posees: 0 });
  });

  it("`comblerLesTrous: false` éteint le producteur (réservé aux tests du producteur par modèle)", async () => {
    const { client } = faussaire();
    const r = await passe(client, { comblerLesTrous: false });
    expect(r.comblement).toBeUndefined();
  });

  it("ces questions arrivent dans la PILE, à côté des papiers", async () => {
    const { client } = faussaire();
    await passe(client);
    const entrees = await chargerEntreesPile(db);
    const pile = composerPile({
      pieces: entrees.candidats,
      faits: [],
      questions: entrees.questions,
      avis: entrees.avis,
      aujourdhui: "2026-11-20",
    });
    const cartesQuestion = pile.filter((c) => c.genre === "question");
    expect(cartesQuestion).toHaveLength(MAX_OUVERTES);
    expect(entrees.questions.map((q) => q.predicatVise).sort()).toEqual([...SANTE].sort());
  });
});
