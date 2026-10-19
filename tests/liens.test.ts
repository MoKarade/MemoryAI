// tests/liens.test.ts — le graphe contre une vraie base (PGlite + les migrations committées).
//
// Ce que ces cas défendent, et que le test PUR ne peut pas voir :
//   1. le recalcul REMPLACE (il ne double pas), et il est idempotent ;
//   2. il ne touche JAMAIS les liens d'un modèle — une règle ne supprime pas ce qu'un
//      modèle a proposé ;
//   3. un fait oublié ne laisse pas de lien derrière lui ;
//   4. la base elle-même refuse une boucle, un poids hors bornes et une extrémité
//      « question » sur une règle qui n'est pas `cause-declaree` ;
//   5. un fait ILLISIBLE est compté et écarté, jamais rendu avec une valeur vide — sinon
//      tous les illisibles se grouperaient entre eux et fabriqueraient des liens faux.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { chiffrer, deriverCle } from "../lib/chiffrement";
import { depotLiensDrizzle } from "../lib/depotLiens";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-15T23:00:00Z");

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
  await db.delete(schema.liens);
  await db.delete(schema.questions);
  await db.delete(schema.faits);
});

/** Un fait en base, valeur chiffrée comme en production (AAD `id|niveau`). */
async function poser(p: {
  id: string;
  predicat?: string;
  valeur?: string;
  valeurType?: "texte" | "ref_document" | "date";
  niveau?: number;
  valideDe?: string | null;
  valideA?: string | null;
  remplaceId?: string | null;
  supprime?: boolean;
  valeurBrisee?: boolean;
}) {
  const niveau = p.niveau ?? 1;
  const brute = p.valeur ?? "une valeur";
  const valeur = p.valeurBrisee ? "ceci-n-est-pas-un-chiffre-valide" : niveau >= 1 ? chiffrer(cle, brute, p.id, niveau) : brute;
  await db.insert(schema.faits).values({
    id: p.id,
    sujet: "marc",
    predicat: p.predicat ?? "emploi.employeur",
    valeur,
    valeurType: p.valeurType ?? "texte",
    niveau,
    statut: "valide",
    fiabiliteSource: "marc",
    versionVocabulaire: 1,
    empreinte: randomUUID(),
    valideDe: p.valideDe ?? null,
    valideA: p.valideA ?? null,
    remplaceId: p.remplaceId ?? null,
    supprimeLe: p.supprime ? T0 : null,
    creeLe: T0,
  });
}

describe("recalculer", () => {
  it("écrit les liens que les règles donnent, et rend ce qu'il a fait", async () => {
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurType: "ref_document", valeur: "doc-1" });
    const r = await depotLiensDrizzle(db).recalculer(cle, T0);
    expect(r.faitsLus).toBe(2);
    expect(r.liensEcrits).toBe(1);
    expect(r.illisibles).toBe(0);
    const rows = await db.select().from(schema.liens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("meme-document");
    expect(rows[0]?.origine).toBe("regle");
  });

  it("REMPLACE au lieu d'ajouter : deux recalculs donnent le même nombre de liens", async () => {
    // ⚠️ Sans la suppression préalable, le second recalcul échouerait sur l'index unique —
    // l'échec serait bruyant, mais le cas le plus fréquent (rien n'a changé) serait cassé.
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurType: "ref_document", valeur: "doc-1" });
    const depot = depotLiensDrizzle(db);
    await depot.recalculer(cle, T0);
    await depot.recalculer(cle, T0);
    expect(await db.select().from(schema.liens)).toHaveLength(1);
  });

  it("un fait OUBLIÉ ne laisse aucun lien derrière lui", async () => {
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurType: "ref_document", valeur: "doc-1" });
    const depot = depotLiensDrizzle(db);
    await depot.recalculer(cle, T0);
    expect(await db.select().from(schema.liens)).toHaveLength(1);

    // Suppression LOGIQUE, comme « oublier » dans l'interface.
    await db.update(schema.faits).set({ supprimeLe: T0 }).where(eq(schema.faits.id, "b"));
    const r = await depot.recalculer(cle, T0);
    expect(r.faitsLus).toBe(1);
    expect(await db.select().from(schema.liens)).toHaveLength(0);
  });

  it("ne touche JAMAIS un lien d'origine « modele »", async () => {
    await poser({ id: "a" });
    await poser({ id: "b" });
    await db.insert(schema.liens).values({
      id: randomUUID(),
      faitA: "a",
      faitB: "b",
      cibleB: "fait",
      type: "meme-periode",
      poids: 0.3,
      origine: "modele",
      regle: "modele-v0",
      pourquoi: "un modèle l'a proposé",
      creeLe: T0,
    });
    await depotLiensDrizzle(db).recalculer(cle, T0);
    const restants = await db.select().from(schema.liens);
    expect(restants).toHaveLength(1);
    expect(restants[0]?.origine).toBe("modele");
  });

  it("un fait ILLISIBLE est compté et ÉCARTÉ, jamais lié par sa valeur vide", async () => {
    // Deux faits illisibles auraient tous deux une valeur « » : les garder les grouperait
    // ensemble et fabriquerait un lien entre deux faits sans rapport.
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurBrisee: true, valeurType: "ref_document" });
    await poser({ id: "c", valeurBrisee: true, valeurType: "ref_document" });
    const r = await depotLiensDrizzle(db).recalculer(cle, T0);
    expect(r.illisibles).toBe(2);
    expect(r.faitsLus).toBe(1);
    expect(r.liensEcrits).toBe(0);
  });

  it("seules les questions RÉPONDUES posent un lien de cause", async () => {
    await poser({ id: "f1" });
    await db.insert(schema.questions).values([
      { id: "q-ouverte", question: "Ton bail ?", predicatVise: "logement.bail", motif: "m", origine: "chat", statut: "ouverte", faitId: null, creeLe: T0 },
      { id: "q-repondue", question: "Ton employeur ?", predicatVise: "emploi.employeur", motif: "m", origine: "chat", statut: "repondue", faitId: "f1", creeLe: T0 },
    ]);
    await depotLiensDrizzle(db).recalculer(cle, T0);
    const rows = await db.select().from(schema.liens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("cause-declaree");
    expect(rows[0]?.faitB).toBe("q-repondue");
    expect(rows[0]?.cibleB).toBe("question");
  });

  it("apercu ne change RIEN en base — c'est ce qui permet de montrer l'écart", async () => {
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurType: "ref_document", valeur: "doc-1" });
    const depot = depotLiensDrizzle(db);
    const vue = await depot.apercu(cle);
    expect(vue.liens).toHaveLength(1);
    expect(await db.select().from(schema.liens)).toHaveLength(0);
    expect((await depot.comptes()).total).toBe(0);
  });

  it("comptes rend le nombre par type", async () => {
    await poser({ id: "a", valeurType: "ref_document", valeur: "doc-1" });
    await poser({ id: "b", valeurType: "ref_document", valeur: "doc-1" });
    const depot = depotLiensDrizzle(db);
    await depot.recalculer(cle, T0);
    expect(await depot.comptes()).toEqual({ total: 1, parType: { "meme-document": 1 } });
  });
});

describe("ce que la BASE refuse, quoi que le code fasse", () => {
  const lien = (p: Partial<schema.NouveauLien>) => ({
    id: randomUUID(),
    faitA: "a",
    faitB: "b",
    cibleB: "fait" as const,
    type: "meme-document" as const,
    poids: 1,
    origine: "regle" as const,
    regle: "r",
    pourquoi: "p",
    creeLe: T0,
    ...p,
  });

  beforeEach(async () => {
    await poser({ id: "a" });
    await poser({ id: "b" });
  });

  it("une boucle", async () => {
    await expect(db.insert(schema.liens).values(lien({ faitB: "a" }))).rejects.toThrow();
  });

  it("un poids hors [0, 1]", async () => {
    await expect(db.insert(schema.liens).values(lien({ poids: 1.5 }))).rejects.toThrow();
  });

  it("une extrémité « question » sur une règle qui n'est pas cause-declaree", async () => {
    await expect(db.insert(schema.liens).values(lien({ cibleB: "question" }))).rejects.toThrow();
  });

  it("la même paire deux fois pour le même type", async () => {
    await db.insert(schema.liens).values(lien({}));
    await expect(db.insert(schema.liens).values(lien({}))).rejects.toThrow();
  });

  it("mais la même paire pour DEUX types est légitime", async () => {
    await db.insert(schema.liens).values(lien({}));
    await db.insert(schema.liens).values(lien({ type: "meme-periode", poids: 0.5 }));
    expect(await db.select().from(schema.liens)).toHaveLength(2);
  });
});
