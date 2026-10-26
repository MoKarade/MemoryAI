// tests/idees.test.ts — les idées de LIA pour les apps (ADR 0027, tâche MemoryAI 233) : la règle PURE
// (une demande faite deux jours, l'utilité estimée, le plan), la passe sur une VRAIE Postgres
// (PGlite) et les tuiles. Données FICTIVES : noms, apps et jours inventés.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { contenuEspaces } from "../lib/accueil/espaces";
import { tableauIdees } from "../lib/accueil/tableaux";
import { deriverCle, empreinte } from "../lib/chiffrement";
import * as schema from "../lib/db/schema";
import { depotDemandesDrizzle } from "../lib/demandes";
import { lireIdees, passeIdees } from "../lib/idees/depot";
import { calculerIdees, planifierIdees, REGLE_DEMANDE_REPETEE, utiliteEstimee, type IdeeAffichee } from "../lib/idees/regles";
import { idees } from "../lib/idees/table";
import { tableauIdeesLues } from "../lib/idees/tableau";

const demande = (jour: string, nom = "Budget fictif", genre = "tuile", app = "hub") => ({ app, genre, nom, demandeLe: new Date(`${jour}T16:00:00Z`) });

describe("l'utilité estimée", () => {
  it("va de 0 à 100 : cinq jours d'aujourd'hui font 100, un jour d'il y a 30 jours fait 0", () => {
    expect(utiliteEstimee(5, 0)).toBe(100);
    expect(utiliteEstimee(5, 30)).toBe(70);
    expect(utiliteEstimee(1, 30)).toBe(0);
    for (let jours = 1; jours <= 12; jours++) {
      for (let ilYA = 0; ilYA <= 60; ilYA += 5) {
        const u = utiliteEstimee(jours, ilYA);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(100);
      }
    }
  });

  it("croît avec les jours où la demande revient et décroît avec le temps depuis la dernière", () => {
    expect(utiliteEstimee(4, 3)).toBeGreaterThan(utiliteEstimee(2, 3));
    expect(utiliteEstimee(3, 0)).toBeGreaterThan(utiliteEstimee(3, 10));
    expect(utiliteEstimee(3, 10)).toBeGreaterThan(utiliteEstimee(3, 29));
  });
});

describe("la règle de la demande répétée (pure)", () => {
  const JOUR = "2026-10-26";

  it("deux jours différents font une idée, un seul jour non ; les raisons sont des nombres et un jour", () => {
    const r = calculerIdees([demande("2026-10-24"), demande("2026-10-25"), demande("2026-10-25", "Autre fictif")], JOUR);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ regle: REGLE_DEMANDE_REPETEE, app: "hub", genre: "tuile", nom: "Budget fictif", raisons: { jours: 2, fenetre: 30, derniere: "2026-10-25" } });
    expect(r[0]?.utilite).toBe(utiliteEstimee(2, 1));
  });

  it("la même demande dans une autre app ou un autre genre est une autre demande", () => {
    expect(calculerIdees([demande("2026-10-24"), demande("2026-10-25", "Budget fictif", "tuile", "jobai")], JOUR)).toEqual([]);
    expect(calculerIdees([demande("2026-10-24"), demande("2026-10-25", "Budget fictif", "bouton")], JOUR)).toEqual([]);
  });

  it("ne compte que les 30 derniers jours, et jamais un jour à venir", () => {
    expect(calculerIdees([demande("2026-09-27"), demande("2026-10-25")], JOUR)).toHaveLength(1);
    expect(calculerIdees([demande("2026-09-26"), demande("2026-10-25")], JOUR)).toEqual([]);
    expect(calculerIdees([demande("2026-10-27"), demande("2026-10-25")], JOUR)).toEqual([]);
  });

  it("classe la plus utile d'abord", () => {
    const r = calculerIdees([demande("2026-10-24", "Deux fictif"), demande("2026-10-25", "Deux fictif"), demande("2026-10-22", "Trois fictif"), demande("2026-10-24", "Trois fictif"), demande("2026-10-25", "Trois fictif")], JOUR);
    expect(r.map((i) => i.nom)).toEqual(["Trois fictif", "Deux fictif"]);
  });
});

describe("le plan de la passe (pur)", () => {
  const calculee = (nom: string, jours: number, derniere: string) => ({
    regle: REGLE_DEMANDE_REPETEE,
    app: "hub",
    genre: "tuile",
    nom,
    utilite: utiliteEstimee(jours, 0),
    raisons: { jours, fenetre: 30, derniere },
    empreinte: `e-${nom}`,
  });

  it("crée l'idée neuve, sauf celle que Marc a oubliée", () => {
    const plan = planifierIdees([calculee("a", 2, "2026-10-26"), calculee("b", 2, "2026-10-26")], [], new Set(["e-b"]), "2026-10-26");
    expect(plan.creer.map((c) => c.nom)).toEqual(["a"]);
    expect(plan.majs).toEqual([]);
  });

  it("ne retouche jamais une idée faite ou écartée, même si la demande revient", () => {
    const stockee = (etat: "faite" | "ecartee") => ({ empreinte: "e-a", etat, utilite: 1, raisons: { jours: 2, fenetre: 30, derniere: "2026-10-20" } });
    for (const etat of ["faite", "ecartee"] as const) {
      const plan = planifierIdees([calculee("a", 4, "2026-10-26")], [stockee(etat)], new Set(), "2026-10-26");
      expect(plan).toEqual({ creer: [], majs: [] });
    }
  });

  it("met à jour une idée en jeu quand ses comptes changent, et ne fait rien si rien n'a changé", () => {
    const c = calculee("a", 3, "2026-10-26");
    const pareille = { empreinte: "e-a", etat: "proposee" as const, utilite: c.utilite, raisons: c.raisons };
    expect(planifierIdees([c], [pareille], new Set(), "2026-10-26")).toEqual({ creer: [], majs: [] });
    const plan = planifierIdees([c], [{ ...pareille, utilite: 10, raisons: { jours: 2, fenetre: 30, derniere: "2026-10-25" } }], new Set(), "2026-10-26");
    expect(plan.majs).toEqual([{ empreinte: "e-a", utilite: c.utilite, raisons: c.raisons }]);
  });

  it("une idée dont la demande sort de la fenêtre vieillit avec ses dernières raisons connues", () => {
    const raisons = { jours: 3, fenetre: 30, derniere: "2026-09-01" };
    const plan = planifierIdees([], [{ empreinte: "e-a", etat: "retenue", utilite: 90, raisons }], new Set(), "2026-10-26");
    expect(plan.majs).toEqual([{ empreinte: "e-a", utilite: utiliteEstimee(3, 55), raisons }]);
  });
});

describe("la passe sur une vraie Postgres", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const cle = deriverCle(randomBytes(32).toString("base64"));

  beforeAll(async () => {
    pg = new PGlite();
    const dossier = resolve(process.cwd(), "drizzle");
    for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
    }
    db = drizzle(pg, { schema });
  });
  afterAll(async () => pg?.close());
  beforeEach(async () => {
    await pg.exec("DELETE FROM idees; DELETE FROM demandes; DELETE FROM oublis;");
  });

  const demander = (jour: string, nom = "Budget fictif", genre: "tuile" | "bouton" = "tuile", app: "hub" | "jobai" = "hub") =>
    depotDemandesDrizzle(db, cle).ecrire({ type: "changer", app, genre, nom, demandeLe: `${jour}T12:00:00-04:00` });
  const passe = (jour: string) => passeIdees(db, cle, new Date(`${jour}T16:00:00Z`));
  /** Budget fictif demandé les 24 et 25 octobre : une idée au 26. */
  const deuxJours = async () => {
    await demander("2026-10-24");
    await demander("2026-10-25");
  };

  it("deux jours de demande font une idée chiffrée ; la même demande deux fois le même jour n'en fait qu'une", async () => {
    await demander("2026-10-24");
    await demander("2026-10-24");
    await demander("2026-10-25", "Autre fictif");
    await demander("2026-10-25");
    expect(await passe("2026-10-26")).toEqual({ demandes: 3, illisibles: 0, creees: 1, majs: 0 });
    const lignes = await db.select().from(idees);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ etat: "proposee", regle: REGLE_DEMANDE_REPETEE, app: "hub", genre: "tuile", raisons: { jours: 2, fenetre: 30, derniere: "2026-10-25" } });
    // En base, le nom est scellé : il ne se lit pas en clair.
    expect(lignes[0]?.cible).not.toContain("Budget");
    const lues = await lireIdees(db, cle);
    expect(lues).toHaveLength(1);
    expect(lues[0]).toMatchObject({ nom: "Budget fictif", etat: "proposee", utilite: utiliteEstimee(2, 1) });
  });

  it("la même passe le même jour n'écrit rien", async () => {
    await deuxJours();
    await passe("2026-10-26");
    expect(await passe("2026-10-26")).toEqual({ demandes: 2, illisibles: 0, creees: 0, majs: 0 });
    expect(await db.select().from(idees)).toHaveLength(1);
  });

  it("le temps qui passe fait baisser l'utilité, même quand la demande sort de la fenêtre", async () => {
    await deuxJours();
    await passe("2026-10-26");
    const lue = async () => (await lireIdees(db, cle))[0]?.utilite ?? -1;
    const initiale = await lue();
    expect(await passe("2026-11-05")).toMatchObject({ creees: 0, majs: 1 });
    const apres = await lue();
    expect(apres).toBeLessThan(initiale);
    // Fin décembre, les demandes sont hors de la fenêtre de lecture : l'idée reste et vieillit encore.
    expect(await passe("2026-12-30")).toMatchObject({ demandes: 0, creees: 0, majs: 1 });
    expect(await lue()).toBeLessThan(apres);
    expect(await db.select().from(idees)).toHaveLength(1);
  });

  it("une idée écartée n'est jamais reproposée ni retouchée, même si la demande revient", async () => {
    await deuxJours();
    await passe("2026-10-26");
    await pg.exec("UPDATE idees SET etat = 'ecartee', utilite = 1");
    await demander("2026-10-26");
    expect(await passe("2026-10-26")).toMatchObject({ creees: 0, majs: 0 });
    const lignes = await db.select().from(idees);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ etat: "ecartee", utilite: 1, raisons: { jours: 2 } });
  });

  it("une idée que Marc a oubliée ne naît pas", async () => {
    await db.insert(schema.oublis).values({ empreinte: empreinte(cle, "idee", REGLE_DEMANDE_REPETEE, "hub", "tuile", "Budget fictif") });
    await deuxJours();
    expect(await passe("2026-10-26")).toMatchObject({ creees: 0 });
    expect(await db.select().from(idees)).toHaveLength(0);
  });

  it("un nom de demande illisible est compté, jamais deviné", async () => {
    await deuxJours();
    await demander("2026-10-25", "Abîmé fictif", "tuile", "jobai");
    await pg.exec("UPDATE demandes SET nom = 'v2:abime' WHERE app = 'jobai'");
    expect(await passe("2026-10-26")).toEqual({ demandes: 2, illisibles: 1, creees: 1, majs: 0 });
  });

  it("une cible illisible n'est pas montrée", async () => {
    await deuxJours();
    await passe("2026-10-26");
    await pg.exec("UPDATE idees SET cible = 'v2:abime'");
    expect(await lireIdees(db, cle)).toEqual([]);
  });
});

describe("les tuiles de l'espace « Idées »", () => {
  const idee = (o: Partial<IdeeAffichee> = {}): IdeeAffichee => ({
    id: "i",
    app: "hub",
    genre: "tuile",
    nom: "Budget fictif",
    etat: "proposee",
    utilite: 47,
    raisons: { jours: 3, fenetre: 30, derniere: "2026-10-24" },
    ...o,
  });

  it("non lues : les tuiles vides d'avant, sans rien changer", () => {
    expect(tableauIdeesLues(undefined)).toEqual(tableauIdees());
  });

  it("sans base, chaque tuile le dit ; sans idée, la boîte dit pourquoi", () => {
    const panne = tableauIdeesLues(null);
    expect(panne.tuiles.every((t) => t.corps.length === 1 && t.corps[0]?.genre === "vide")).toBe(true);
    expect(panne.tuiles[0]?.corps[0]).toEqual({ genre: "vide", texte: "La base ne répond pas : les idées ne sont pas lisibles." });
    expect(tableauIdeesLues([]).tuiles[0]?.corps).toEqual([{ genre: "vide", texte: "Aucune idée : tu n'as encore rien demandé deux fois au hub." }]);
  });

  it("les quatre tuiles de la maquette gardent leur titre, leur place et leur repli", () => {
    const base = tableauIdees();
    const t = tableauIdeesLues([idee()]);
    expect(t.question).toBe(base.question);
    expect(t.tuiles.map((x) => [x.cle, x.titre, x.largeur, x.repliee])).toEqual(base.tuiles.map((x) => [x.cle, x.titre, x.largeur, x.repliee]));
  });

  it("la boîte, les étapes, l'utilité estimée et les écartées montrent les vraies idées", () => {
    const t = tableauIdeesLues([
      idee({ id: "a", utilite: 40, nom: "Petit fictif" }),
      idee({ id: "b", utilite: 80, etat: "retenue" }),
      idee({ id: "c", etat: "ecartee", nom: "Écarté fictif", genre: "bouton", app: "jobai" }),
      idee({ id: "d", etat: "faite" }),
      idee({ id: "e" }),
    ]);
    const [boite, etapes, utilite, refusees] = t.tuiles;
    expect(boite?.corps[0]).toEqual({
      genre: "liste",
      elements: [
        { libelle: "Revoir la tuile « Budget fictif » dans le hub", detail: "Retenue · demandé 3 jours sur 30, la dernière fois le 24 oct." },
        { libelle: "Revoir la tuile « Budget fictif » dans le hub", detail: "demandé 3 jours sur 30, la dernière fois le 24 oct." },
        { libelle: "Revoir la tuile « Petit fictif » dans le hub", detail: "demandé 3 jours sur 30, la dernière fois le 24 oct." },
      ],
    });
    expect(etapes?.corps[0]).toMatchObject({
      genre: "barres",
      barres: [
        { libelle: "Proposées", valeur: "2", part: 1 },
        { libelle: "Retenues", valeur: "1", part: 0.5 },
        { libelle: "Faites", valeur: "1", part: 0.5 },
        { libelle: "Écartées", valeur: "1", part: 0.5 },
      ],
    });
    const barres = utilite?.corps[0];
    if (barres?.genre !== "barres") throw new Error("barres attendues");
    expect(barres.barres.map((b) => b.valeur)).toEqual(["≈ 80 / 100", "≈ 47 / 100", "≈ 40 / 100"]);
    expect(barres.barres[0]?.part).toBeCloseTo(0.8);
    // L'utilité se dit estimation : jamais présentée comme une mesure.
    expect(utilite?.corps[1]).toMatchObject({ genre: "texte", texte: expect.stringContaining("Estimation, pas une mesure") });
    expect(refusees?.corps).toEqual([{ genre: "liste", elements: [{ libelle: "Revoir le bouton « Écarté fictif » dans JobAI", detail: "Écartée : elle ne la reproposera pas." }] }]);
  });

  it("au-delà de huit idées en attente, la boîte dit combien d'autres suivent", () => {
    const toutes = Array.from({ length: 10 }, (_, i) => idee({ id: `i${i}`, nom: `Idée ${i} fictive`, utilite: 90 - i }));
    const liste = tableauIdeesLues(toutes).tuiles[0]?.corps[0];
    if (liste?.genre !== "liste") throw new Error("liste attendue");
    expect(liste.elements).toHaveLength(9);
    expect(liste.elements[8]).toEqual({ libelle: "Et 2 autres" });
  });

  it("l'espace dit ce qui est vrai : non lues, panne, aucune idée, des idées, toutes closes", () => {
    const entrees = { budget: null, outils: [], formes: [] };
    const espace = (idees: Parameters<typeof contenuEspaces>[0]["idees"]) => contenuEspaces({ ...entrees, idees }).idees;
    expect(espace(undefined)).toMatchObject({ phrase: "Elle ne propose pas encore d'idées pour tes apps.", vide: true });
    expect(espace(null)).toMatchObject({ phrase: "La base ne répond pas : ses idées ne sont pas lisibles.", vide: true });
    expect(espace([])).toMatchObject({ phrase: "Aucune idée : tu n'as encore rien demandé deux fois au hub.", vide: true });
    expect(espace([idee()])).toMatchObject({ phrase: "1 idée en attente pour tes apps, nées de tes demandes au hub.", dit: "J'ai 1 idée pour tes apps, nées de tes demandes au hub.", vide: false });
    expect(espace([idee({ id: "a" }), idee({ id: "b", etat: "retenue" }), idee({ id: "c", etat: "faite" })])?.phrase).toBe("2 idées en attente pour tes apps, nées de tes demandes au hub.");
    expect(espace([idee({ etat: "ecartee" })])).toMatchObject({ phrase: "Toutes ses idées sont faites ou écartées.", vide: false });
  });
});
