// tests/agenda.test.ts — l'agenda du jour envoyé par DriveAI (ADR 0029) : la lecture PURE du corps
// (envoi refusé entier, événement refusé seul, clés en trop nommées), l'écriture qui remplace le
// jour sur une VRAIE Postgres (PGlite), le titre chiffré, le ménage au-delà de la veille, et la porte
// HTTP et ses refus. Données FICTIVES : titres et heures inventés.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { EVENEMENTS_MAX, lireEnvoiAgenda, nettoyerTitre, TITRE_MAX, type EnvoiAgenda } from "../lib/agenda/contrat";
import { comptesAgenda, lireAgendaDuJour, remplacerJour } from "../lib/agenda/depot";
import { POST } from "../app/api/agenda/route";

/** 26/10/2026, 8 h à Québec (UTC−4). */
const MAINTENANT = new Date("2026-10-26T12:00:00Z");
const JOUR = "2026-10-26";

const evenement = (debut: string, titre: string, duree_min = 60, extra: Record<string, unknown> = {}) => ({ debut, duree_min, titre, ...extra });
const envoi = (evenements: unknown[], extra: Record<string, unknown> = {}) => ({ source: "agenda", jour: JOUR, lu_le: "2026-10-26T11:58:00Z", evenements, ...extra });

describe("la lecture du corps (pure)", () => {
  it("lit un envoi valide, garde la position de chaque événement et nomme les clés en trop", () => {
    const r = lireEnvoiAgenda(
      envoi([evenement("2026-10-26T13:30:00-04:00", "Rendez-vous fictif", 45, { lieu: "1 rue Fictive", invites: ["x"] }), evenement("2026-10-26T00:00:00-04:00", "Congé fictif", 1440, { journee_entiere: true })], { calendrier: "x" }),
      MAINTENANT,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.envoi.evenements).toEqual([
      { position: 0, debut: new Date("2026-10-26T17:30:00Z"), dureeMin: 45, titre: "Rendez-vous fictif", journeeEntiere: false },
      { position: 1, debut: new Date("2026-10-26T04:00:00Z"), dureeMin: 1440, titre: "Congé fictif", journeeEntiere: true },
    ]);
    // Le lieu et les invités n'entrent pas : leur NOM seul revient, pour que DriveAI le voie.
    expect(r.envoi.ignores).toEqual(["calendrier", "invites", "lieu"]);
    expect(r.envoi.refuses).toEqual([]);
  });

  it("refuse un événement seul, avec son index et un code fermé ; les autres passent", () => {
    const r = lireEnvoiAgenda(
      envoi([
        evenement("2026-10-26T13:30:00", "Sans fuseau"),
        evenement("2026-10-26T13:30:00-04:00", "Durée fausse", 1441),
        evenement("2026-10-26T13:30:00-04:00", "x".repeat(TITRE_MAX + 1)),
        evenement("2026-10-26T13:30:00-04:00", "Bon"),
        "pas un objet",
        evenement("2026-10-26T13:30:00-04:00", "Journée fausse", 60, { journee_entiere: "oui" }),
      ]),
      MAINTENANT,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.envoi.refuses).toEqual([
      { index: 0, code: "debut_invalide" },
      { index: 1, code: "duree_invalide" },
      { index: 2, code: "titre_invalide" },
      { index: 4, code: "forme_invalide" },
      { index: 5, code: "journee_invalide" },
    ]);
    expect(r.envoi.evenements.map((e) => [e.position, e.titre])).toEqual([[3, "Bon"]]);
  });

  it("un titre sort sur une ligne, sans balise ni caractère de contrôle ; vide ou trop long, il est refusé", () => {
    expect(nettoyerTitre("<b>Réunion</b>\n  fictive\u0007")).toBe("Réunion fictive");
    expect(nettoyerTitre("   ")).toBeNull();
    expect(nettoyerTitre(42)).toBeNull();
    expect(nettoyerTitre("x".repeat(TITRE_MAX))).toHaveLength(TITRE_MAX);
  });

  it("refuse l'envoi entier : source, jour, fenêtre, lu_le, liste, nombre", () => {
    const code = (corps: unknown) => {
      const r = lireEnvoiAgenda(corps, MAINTENANT);
      return r.ok ? "ok" : r.code;
    };
    expect(code(null)).toBe("corps_invalide");
    expect(code([])).toBe("corps_invalide");
    expect(code(envoi([], { source: "messenger" }))).toBe("source_inconnue");
    expect(code(envoi([], { jour: "2026-02-30" }))).toBe("jour_invalide");
    expect(code(envoi([], { jour: "2026-10-24" }))).toBe("jour_hors_fenetre");
    expect(code(envoi([], { jour: "2026-10-28" }))).toBe("jour_hors_fenetre");
    expect(code(envoi([], { jour: "2026-10-25" }))).toBe("ok");
    expect(code(envoi([], { jour: "2026-10-27" }))).toBe("ok");
    expect(code(envoi([], { lu_le: "2026-10-26T12:10:00Z" }))).toBe("lu_le_invalide");
    expect(code(envoi([], { lu_le: "hier" }))).toBe("lu_le_invalide");
    expect(code(envoi([], { evenements: {} }))).toBe("evenements_invalides");
    expect(code(envoi(Array.from({ length: EVENEMENTS_MAX + 1 }, () => evenement("2026-10-26T13:30:00-04:00", "x"))))).toBe("trop_d_evenements");
    // Une liste vide est un envoi valide : « rien de prévu ».
    expect(code(envoi([]))).toBe("ok");
  });
});

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

const lu = (corps: unknown, maintenant = MAINTENANT): EnvoiAgenda => {
  const r = lireEnvoiAgenda(corps, maintenant);
  if (!r.ok) throw new Error(r.code);
  return r.envoi;
};

describe("l'écriture qui remplace le jour (PGlite)", () => {
  it("écrit, chiffre le titre, et relit dans l'ordre des heures", async () => {
    const r = await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-26T15:00:00-04:00", "Deuxième fictif", 30), evenement("2026-10-26T09:00:00-04:00", "Premier fictif", 90)])), "driveai", JOUR, MAINTENANT);
    expect(r).toEqual({ ecrits: 2, remplaces: 0 });
    // En base, le titre est scellé : il ne se lit pas en clair.
    const brut = await pg.query<{ titre: string }>("select titre from agenda_evenements");
    expect(brut.rows.every((l) => !l.titre.includes("fictif"))).toBe(true);
    const a = await lireAgendaDuJour(db as never, cle, JOUR);
    expect(a?.evenements.map((e) => [e.titre, e.dureeMin])).toEqual([
      ["Premier fictif", 90],
      ["Deuxième fictif", 30],
    ]);
    expect(a?.luLe.toISOString()).toBe("2026-10-26T11:58:00.000Z");
    expect(a?.illisibles).toBe(0);
  });

  it("un nouvel envoi du même jour remplace le précédent ; un envoi vide dit « rien de prévu »", async () => {
    const r = await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-26T10:00:00-04:00", "Seul fictif")])), "driveai", JOUR, MAINTENANT);
    expect(r).toEqual({ ecrits: 1, remplaces: 2 });
    expect((await lireAgendaDuJour(db as never, cle, JOUR))?.evenements.map((e) => e.titre)).toEqual(["Seul fictif"]);
    expect((await pg.query("select 1 from agenda_evenements where jour = $1", [JOUR])).rows).toHaveLength(1);

    expect(await remplacerJour(db as never, cle, lu(envoi([])), "driveai", JOUR, MAINTENANT)).toEqual({ ecrits: 0, remplaces: 1 });
    const vide = await lireAgendaDuJour(db as never, cle, JOUR);
    expect(vide?.evenements).toEqual([]);
    expect(await comptesAgenda(db as never, JOUR)).toEqual({ jour: JOUR, evenements: 0, luLe: "2026-10-26T11:58:00.000Z" });
  });

  it("rien reçu pour un jour : `null`, et le compte public aussi", async () => {
    expect(await lireAgendaDuJour(db as never, cle, "2026-10-27")).toBeNull();
    expect(await comptesAgenda(db as never, "2026-10-27")).toBeNull();
  });

  it("garde deux jours au plus : la veille reste, l'avant-veille s'efface au prochain envoi", async () => {
    const hier = new Date("2026-10-25T12:00:00Z");
    await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-25T10:00:00-04:00", "Hier fictif")], { jour: "2026-10-25", lu_le: "2026-10-25T11:00:00Z" }), hier), "driveai", "2026-10-25", hier);
    await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-24T10:00:00-04:00", "Avant-hier fictif")], { jour: "2026-10-24", lu_le: "2026-10-24T11:00:00Z" }), new Date("2026-10-24T12:00:00Z")), "driveai", "2026-10-24", new Date("2026-10-24T12:00:00Z"));
    await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-26T10:00:00-04:00", "Aujourd'hui fictif")])), "driveai", JOUR, MAINTENANT);
    const jours = (await pg.query<{ jour: string }>("select distinct jour from agenda_envois order by jour")).rows.map((l) => l.jour);
    expect(jours).toEqual(["2026-10-25", "2026-10-26"]);
    expect((await pg.query("select 1 from agenda_evenements where jour = '2026-10-24'")).rows).toHaveLength(0);
  });

  it("un titre qui ne se déchiffre pas est compté, jamais montré", async () => {
    await remplacerJour(db as never, cle, lu(envoi([evenement("2026-10-26T10:00:00-04:00", "Lisible fictif"), evenement("2026-10-26T11:00:00-04:00", "Abîmé fictif")])), "driveai", JOUR, MAINTENANT);
    await pg.query("update agenda_evenements set titre = 'v2:abime' where jour = $1 and position = 1", [JOUR]);
    const a = await lireAgendaDuJour(db as never, cle, JOUR);
    expect(a?.evenements.map((e) => e.titre)).toEqual(["Lisible fictif"]);
    expect(a?.illisibles).toBe(1);
  });
});

describe("POST /api/agenda — les refus, dans l'ordre", () => {
  const JETON = "jeton-driveai-ecriture-0123456789"; // gitleaks:allow (factice)
  const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "MEMORYAI_TOKEN_DRIVEAI_LECTURE", "MEMORYAI_TOKEN_CARAI_ECRITURE", "MEMORYAI_CHIFFREMENT", "DATABASE_URL"] as const;
  const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  afterEach(() => {
    for (const v of VARS) {
      if (sauvegarde[v] === undefined) delete process.env[v];
      else process.env[v] = sauvegarde[v];
    }
  });
  function configurer() {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = "jeton-driveai-lecture-00123456789"; // gitleaks:allow (factice)
    process.env.MEMORYAI_TOKEN_CARAI_ECRITURE = "jeton-carai-ecriture-001234567890"; // gitleaks:allow (factice)
    process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
    process.env.DATABASE_URL = "postgres://jamais-appelee.invalid/x";
  }
  const envoyer = (corps: string | object, jeton: string | null = JETON) =>
    POST(
      new Request("http://memoryai.test/api/agenda", {
        method: "POST",
        headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
        body: typeof corps === "string" ? corps : JSON.stringify(corps),
      }),
    );

  it("503 memoire_gelee avant même le jeton", async () => {
    configurer();
    process.env.MEMORYAI_GEL = "1";
    const r = await envoyer(envoi([]), null);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("401 sans jeton, avec le jeton de LECTURE de DriveAI, ou l'écrivain d'une autre app", async () => {
    configurer();
    for (const j of [null, "jeton-driveai-lecture-00123456789", "jeton-carai-ecriture-001234567890"]) {
      const r = await envoyer(envoi([]), j);
      expect(r.status, String(j)).toBe(401);
      expect(await r.json()).toEqual({ error: "non_autorise" });
    }
  });

  it("503 cle_absente et base_absente : des pannes, jamais des refus", async () => {
    configurer();
    delete process.env.MEMORYAI_CHIFFREMENT;
    expect((await (await envoyer(envoi([]))).json()).error).toBe("cle_absente");
    configurer();
    delete process.env.DATABASE_URL;
    expect((await (await envoyer(envoi([]))).json()).error).toBe("base_absente");
  });

  it("413 au-delà de la taille, 400 hors JSON, 422 sur un envoi refusé ; jamais en cache", async () => {
    configurer();
    const gros = await envoyer(envoi([evenement("2026-10-26T10:00:00-04:00", "x")], { remplissage: "x".repeat(40_000) }));
    expect(gros.status).toBe(413);
    const pasJson = await envoyer("{pas du json");
    expect(pasJson.status).toBe(400);
    const source = await envoyer(envoi([], { source: "messenger" }));
    expect(source.status).toBe(422);
    expect((await source.json()).error).toBe("source_inconnue");
    expect(source.headers.get("cache-control")).toBe("no-store");
  });
});
