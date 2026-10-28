// tests/admin.test.ts — les gestes de Marc (valider, rejeter, oublier, purger), sur PGlite,
// et le summary du hub composé depuis les comptes réels.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { validateSummary } from "@mokarade/hub-contract";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { comptesParDomaine, depotAdminDrizzle, MOT_DE_PURGE } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";

import { ecrireLot } from "../lib/ecrireFaits";
import { composerSummary, SEUIL_A_VALIDER_FORT } from "../lib/hubSummary";
import type { Ecrivain } from "../lib/jetons";
import { BON } from "./fixtures/faits";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };
const src = (ref: string, extra: Record<string, unknown> = {}) => ({ ...BON, ...extra, provenance: { ...BON.provenance, source_ref: ref } });
const MAINTENANT = new Date("2026-09-15T21:00:00Z");

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
});
afterAll(async () => pg?.close());

const idDe = async (predicat: string, valeurChiffree?: boolean) => {
  const rows = await db.select().from(schema.faits).where(eq(schema.faits.predicat, predicat));
  return valeurChiffree === undefined ? rows.map((r) => r.id) : rows.map((r) => r.id);
};

describe("valider / rejeter / oublier", () => {
  it("valider pose valide + valideLe ; un prédicat non multi périme l'ancien fait validé", async () => {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([src("e1")], DRIVEAI, cle, depotDrizzle(db));
    const [id1] = await idDe("emploi.employeur");
    expect(await admin.valider(id1!, MAINTENANT)).toBe("ok");
    let [f1] = await db.select().from(schema.faits).where(eq(schema.faits.id, id1!));
    expect(f1).toMatchObject({ statut: "valide", valideLe: MAINTENANT });

    await ecrireLot([{ ...src("e2"), valeur: "Ville Exemple" }], DRIVEAI, cle, depotDrizzle(db));
    const id2 = (await idDe("emploi.employeur")).find((x) => x !== id1)!;
    expect(await admin.valider(id2, MAINTENANT)).toBe("ok");
    [f1] = await db.select().from(schema.faits).where(eq(schema.faits.id, id1!));
    expect(f1!.statut).toBe("perime");
    expect(await admin.valider("00000000-0000-0000-0000-000000000000", MAINTENANT)).toBe("introuvable");
  });

  it("un prédicat MULTI ne périme rien", async () => {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([src("g1", { predicat: "gout.cuisine", valeur: "Mexicaine" }), src("g2", { predicat: "gout.cuisine", valeur: "Thaïe" })], DRIVEAI, cle, depotDrizzle(db));
    for (const id of await idDe("gout.cuisine")) await admin.valider(id, MAINTENANT);
    const rows = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "gout.cuisine"));
    expect(rows.every((r) => r.statut === "valide")).toBe(true);
  });

  it("rejeter garde la ligne (jamais servie) — un rejeu de la même source ne la re-propose pas", async () => {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([src("r1", { predicat: "gout.musique", valeur: "Jazz" })], DRIVEAI, cle, depotDrizzle(db));
    const [id] = await idDe("gout.musique");
    expect(await admin.rejeter(id!)).toBe("ok");
    const r = await ecrireLot([src("r1", { predicat: "gout.musique", valeur: "Jazz" })], DRIVEAI, cle, depotDrizzle(db));
    expect(r.dejaPresents).toBe(1);
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.id, id!));
    expect(f!.statut).toBe("rejete");
  });

  // LA garde de l'ADR, côté Marc : oublier écrit `oublis`, et le fait ne revient plus — même sous une autre valeur.
  it("oublier supprime logiquement ET empêche tout retour de la source", async () => {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([src("o1", { predicat: "gout.boisson", valeur: "Thé vert" })], DRIVEAI, cle, depotDrizzle(db));
    const [id] = await idDe("gout.boisson");
    expect(await admin.oublier(id!, cle, "test", MAINTENANT)).toBe("ok");
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.id, id!));
    expect(f!.supprimeLe).toEqual(MAINTENANT);
    expect((await db.select().from(schema.oublis)).length).toBe(1);
    const r = await ecrireLot([src("o1", { predicat: "gout.boisson", valeur: "Café" })], DRIVEAI, cle, depotDrizzle(db));
    expect(r.refuses[0]?.code).toBe("oublie");
    expect(await admin.parId(id!)).toBeNull();
  });

  it("aValider ne rend que les proposés vivants ; comptesParDomaine ne compte que les validés", async () => {
    const admin = depotAdminDrizzle(db);
    await ecrireLot([src("p1", { predicat: "projet.souhait", valeur: "Apprendre le piano" })], DRIVEAI, cle, depotDrizzle(db));
    const file = await admin.aValider(50);
    expect(file.map((f) => f.fait.predicat)).toEqual(["projet.souhait"]);
    expect(await comptesParDomaine(db)).toEqual({ emploi: 1, gout: 2 });
  });
});

describe("purger", () => {
  it("refuse sans le mot exact, efface faits et provenances avec, garde oublis et journal", async () => {
    const admin = depotAdminDrizzle(db);
    expect(await admin.purger("supprimer")).toBe("refuse");
    expect(await admin.purger("")).toBe("refuse");
    expect(MOT_DE_PURGE).toBe("SUPPRIMER");
    const avant = (await db.select().from(schema.faits)).length;
    expect(avant).toBeGreaterThan(0);
    expect(await admin.purger(MOT_DE_PURGE)).toEqual({ faits: avant });
    expect((await db.select().from(schema.faits)).length).toBe(0);
    expect((await db.select().from(schema.provenances)).length).toBe(0);
    expect((await db.select().from(schema.oublis)).length).toBe(1);
  });
});

describe("dépenses du chat", () => {
  it("somme par jour et au total", async () => {
    const admin = depotAdminDrizzle(db);
    expect(await admin.depenseDuJourUsd("2026-09-15", "chat")).toBe(0);
    await admin.enregistrerDepense({ jour: "2026-09-15", poste: "chat", modele: "claude-sonnet-5-5", entree: 100, sortie: 50, coutUsd: 0.4 });
    await admin.enregistrerDepense({ jour: "2026-09-15", poste: "chat", modele: "claude-sonnet-5-5", entree: 100, sortie: 50, coutUsd: 0.35 });
    await admin.enregistrerDepense({ jour: "2026-09-15", poste: "apprentissage", modele: "claude-haiku-5-5", entree: 100, sortie: 50, coutUsd: 0.6 });
    await admin.enregistrerDepense({ jour: "2026-09-14", poste: "chat", modele: "claude-haiku-5-5", entree: 100, sortie: 50, coutUsd: 0.1 });
    // Le poste du chat ne voit PAS ce que l'apprentissage a dépensé — c'est l'invariant qui
    // empêche une passe d'extraction de couper le chat de Marc pour la journée.
    expect(await admin.depenseDuJourUsd("2026-09-15", "chat")).toBeCloseTo(0.75);
    expect(await admin.depenseDuJourUsd("2026-09-15", "apprentissage")).toBeCloseTo(0.6);
    expect(await admin.depenseDuJourParPoste("2026-09-15")).toEqual({ chat: expect.closeTo(0.75, 5), apprentissage: expect.closeTo(0.6, 5) });
    // Un poste sans une seule ligne rend 0, jamais `undefined` (leçon DriveAI n° 3).
    expect(await admin.depenseDuJourParPoste("2026-09-14")).toEqual({ chat: expect.closeTo(0.1, 5), apprentissage: 0 });
    expect(await admin.depenseTotaleUsd()).toEqual({ total: expect.closeTo(1.45, 5), appels: 4 });
  });
});

describe("composerSummary — pur, conforme au contrat", () => {
  // `papiers: 0` par défaut : ces cas parlent des FAITS. Le comportement propre aux papiers
  // (la métrique publiée, et « en construction » qui exige le vide des deux côtés) vit dans
  // `tests/comptesMigres.test.ts`, avec son contrôle négatif.
  const base = { valides: 0, aValider: 0, canaris: 0, dernierValideLe: null, parDomaine: {}, chat: { totalUsd: 0, appels: 0 }, gele: false, papiers: 0 };

  it("building sans fait validé, même avec des proposés — et le dit", () => {
    const s = validateSummary(composerSummary({ ...base, aValider: 3 }));
    expect(s.status).toBe("building");
    expect(s.alerts[0]?.label).toContain("3 fait(s) attendent");
    expect(s.usage).toBeUndefined();
  });

  it("ok avec des validés : dataAsOf = dernier validé, métrique principale, détails par domaine, coût du chat", () => {
    const s = validateSummary(
      composerSummary({ ...base, valides: 12, aValider: 2, dernierValideLe: "2026-09-15T21:00:00.000Z", parDomaine: { emploi: 5, gout: 7 }, chat: { totalUsd: 0.123456, appels: 4 } }),
    );
    expect(s.status).toBe("ok");
    expect(s.dataAsOf).toBe("2026-09-15T21:00:00.000Z");
    expect(s.expectedMaxAgeSec).toBeUndefined();
    // [L41] La métrique PRINCIPALE est le TOTAL, plus « Faits validés » : c'est en lisant ce
    // dernier isolé que Marc a cru la mémoire à l'arrêt (il ne bouge pas quand la campagne de
    // lecture tourne). Les deux postes restent publiés — un total sans sa décomposition
    // redeviendrait le compteur trompeur qu'on retire.
    expect(s.metrics[0]).toMatchObject({ label: "Informations", value: 12, primary: true });
    expect(s.metrics.map((m) => m.label)).toContain("Faits validés");
    expect(s.metrics.map((m) => m.label)).toContain("Papiers");
    expect(s.details?.[0]?.items.map((i) => i.label)).toEqual(["gout", "emploi"]);
    expect(s.usage?.cost).toEqual({ currency: "USD", amount: 0.1235, period: "total" });
    expect(s.recommendation?.label).toBe("Valider 2 fait(s)");
  });

  it("zéro appel de chat ⇒ pas de bloc usage (une absence admet, un 0 affirme)", () => {
    const s = validateSummary(composerSummary({ ...base, valides: 1 }));
    expect(s.usage).toBeUndefined();
    expect(s.recommendation).toBeUndefined();
  });

  // ── Le plafond du contrat, et pourquoi ces cas existent ────────────────────────────
  //
  // Le 15/09/2026, `/hub/summary` est passé en `500` dès que Marc a validé ses 98 premiers
  // faits : le code coupait la liste des domaines à 12, le contrat en accepte 8, et il
  // REFUSE le summary entier plutôt que de tronquer. La carte du hub affichait une erreur
  // alors que la mémoire allait parfaitement bien.
  //
  // Les tests d'alors ne pouvaient pas le voir : ils passaient DEUX domaines. La branche
  // fautive n'était atteignable qu'avec des données réelles. Ces cas-ci exercent donc la
  // frontière, et la vraie garde est `validateSummary` — remettre 12 la fait lever.
  it("une section de détails tient dans le plafond du contrat, à la frontière", () => {
    const aDomaines = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`domaine${i}`, n - i]));

    const huit = validateSummary(composerSummary({ ...base, valides: 36, parDomaine: aDomaines(8) }));
    expect(huit.details?.[0]?.items).toHaveLength(8);
    expect(huit.details?.[0]?.items.some((i) => i.label.includes("autres"))).toBe(false);

    const neuf = validateSummary(composerSummary({ ...base, valides: 45, parDomaine: aDomaines(9) }));
    expect(neuf.details?.[0]?.items).toHaveLength(8);
    expect(neuf.details?.[0]?.items[7]).toMatchObject({ label: "2 autres domaines", value: 3 });
  });

  it("aucun fait ne disparaît de la liste : la somme des lignes égale le total validé", () => {
    // Vingt domaines, l'ordre de grandeur de la production au 15/09. Tronquer en silence
    // ferait afficher moins que la métrique « Faits validés » juste à côté — un écran qui
    // se contredit lui-même, et personne ne saurait lequel des deux chiffres croire.
    const parDomaine = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`d${i}`, i + 1]));
    const total = Object.values(parDomaine).reduce((t, n) => t + n, 0);
    const s = validateSummary(composerSummary({ ...base, valides: total, parDomaine }));
    const items = s.details?.[0]?.items ?? [];
    expect(items).toHaveLength(8);
    expect(items.reduce((t, i) => t + (i.value as number), 0)).toBe(total);
    expect(items[7]?.label).toBe("13 autres domaines");
    // Les libellés restent uniques : le contrat refuse deux lignes de même nom.
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
  });

  it("degraded quand la file déborde ou quand la mémoire est gelée", () => {
    expect(composerSummary({ ...base, valides: 1, aValider: SEUIL_A_VALIDER_FORT }).status).toBe("degraded");
    expect(composerSummary({ ...base, valides: 1, gele: true }).status).toBe("degraded");
    expect(composerSummary({ ...base, valides: 1, aValider: 150 }).alerts[0]?.severity).toBe("warn");
  });

  // ── [L41] « Informations » : le compteur que Marc voulait voir dans le hub ───────────────
  //
  // Ce qui est défendu ici n'est pas un libellé mais une RELATION : le total publié est la
  // somme des DEUX postes publiés à côté de lui. Un lot futur qui ajouterait un poste au
  // total sans le publier ferait rougir ce test — c'est exactement ce qu'on veut, parce que
  // la carte afficherait alors un « en tout » que rien sur la carte n'explique.
  it("publie le TOTAL, et il vaut la somme des postes publiés à côté", () => {
    const s = validateSummary(composerSummary({ ...base, valides: 100, papiers: 2748 }));
    const valeur = (label: string) => s.metrics.find((m) => m.label === label)?.value as number;
    expect(valeur("Informations")).toBe(2848);
    expect(valeur("Informations")).toBe(valeur("Faits validés") + valeur("Papiers"));
  });

  // ⚠️ Le contrat refuse DEUX `primary` (et plus de six métriques) en mettant tout le summary
  // en erreur : déplacer le `primary` sans retirer l'ancien aurait éteint la carte entière.
  it("une seule métrique principale, et le plafond du contrat tient", () => {
    const s = validateSummary(composerSummary({ ...base, valides: 100, papiers: 2748, parDomaine: { emploi: 3 } }));
    expect(s.metrics.filter((m) => m.primary)).toHaveLength(1);
    expect(s.metrics.length).toBeLessThanOrEqual(6);
  });

  // Un papier SANS aucun fait validé doit quand même compter : c'est l'état RÉEL du 21/09
  // (2 748 papiers, 100 faits) vu depuis l'autre bout — et `building` exige le vide des deux
  // côtés, donc la carte est bien servie.
  it("compte les papiers même quand aucun fait n'est validé", () => {
    const s = validateSummary(composerSummary({ ...base, valides: 0, papiers: 42 }));
    expect(s.status).not.toBe("building");
    expect(s.metrics.find((m) => m.label === "Informations")?.value).toBe(42);
  });
});
