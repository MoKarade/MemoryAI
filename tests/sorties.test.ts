// tests/sorties.test.ts — ce qui sort des apps (ADR 0031, tâche MemoryAI 281) : la lecture PURE du corps
// (envoi refusé entier, événement refusé seul, clés en trop nommées), le niveau qui ne descend jamais,
// l'écriture sur une VRAIE Postgres (PGlite) avec le texte scellé et le rejeu sans doublon, et les refus
// de la porte HTTP dans l'ordre. Données FICTIVES : titres, dates et références inventés.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { dechiffrer, deriverCle } from "../lib/chiffrement";
import {
  APPS_SORTIES,
  CORPS_MAX,
  empreinte,
  EVENEMENTS_MAX,
  lireEnvoiSorties,
  niveauRetenu,
  RESUME_MAX,
  TITRE_MAX,
  type EnvoiSorties,
  type LectureEnvoi,
  type SortieLue,
} from "../lib/sorties/contrat";
import { ecrireSorties, type ResultatSorties } from "../lib/sorties/depot";
import { POST } from "../app/api/sorties/route";

/** 26/10/2026, 8 h à Québec (UTC−4). */
const MAINTENANT = new Date("2026-10-26T12:00:00Z");

const evenement = (titre: string, extra: Record<string, unknown> = {}) => ({ type: "recharge", date: "2026-10-26T13:30:00-04:00", titre, ...extra });
const envoi = (evenements: unknown, extra: Record<string, unknown> = {}) => ({ source: "sorties", evenements, ...extra });

function lire(corps: unknown): EnvoiSorties {
  const r: LectureEnvoi = lireEnvoiSorties(corps, MAINTENANT);
  if (!r.ok) throw new Error(r.code);
  return r.envoi;
}
const code = (corps: unknown): string => {
  const r = lireEnvoiSorties(corps, MAINTENANT);
  return r.ok ? "ok" : r.code;
};

describe("la lecture du corps (pure)", () => {
  it("lit un envoi valide, garde la position de chaque événement et nomme les clés en trop", () => {
    const e = lire(
      envoi(
        [
          evenement("Recharge fictive", { resume: "42 kWh en 50 minutes", ref: "abc-123", niveau: 2, lieu: "1 rue Fictive" }),
          evenement("Autre fictif", { type: "batch", date: "2026-10-25T08:00:00Z" }),
        ],
        { app: "carai" },
      ),
    );
    expect(e.sorties).toEqual([
      { position: 0, type: "recharge", date: new Date("2026-10-26T17:30:00Z"), titre: "Recharge fictive", resume: "42 kWh en 50 minutes", ref: "abc-123", niveau: 2 },
      { position: 1, type: "batch", date: new Date("2026-10-25T08:00:00Z"), titre: "Autre fictif", resume: null, ref: null, niveau: null },
    ]);
    // L'app du corps est ignorée (elle vient du jeton) ; son NOM seul revient, comme le lieu.
    expect(e.ignores).toEqual(["app", "lieu"]);
    expect(e.refuses).toEqual([]);
  });

  it("un nom de clé mal formé ou trop long revient comme « ? », sans écho", () => {
    const e = lire(envoi([evenement("Clés fictives", { "a-b": 1, ["k".repeat(41)]: 1, lieu: 1 })]));
    expect(e.ignores).toEqual(["?", "lieu"]);
  });

  it("refuse un événement seul, avec son index et un code fermé ; les autres passent", () => {
    const e = lire(
      envoi([
        evenement("Type faux", { type: "Recharge!" }),
        evenement("Sans fuseau", { date: "2026-10-26T13:30:00" }),
        evenement("Trop ancien", { date: "2025-01-01T00:00:00Z" }),
        evenement("Trop loin devant", { date: "2026-10-28T00:00:00Z" }),
        evenement("Jour impossible", { date: "2026-13-45T10:00:00Z" }),
        evenement("x".repeat(TITRE_MAX + 1)),
        evenement("   "),
        evenement("Résumé trop long", { resume: "x".repeat(RESUME_MAX + 1) }),
        evenement("Réf avec espace", { ref: "abc 123" }),
        evenement("Niveau 4", { niveau: 4 }),
        evenement("Niveau texte", { niveau: "2" }),
        evenement("Niveau décimal", { niveau: 1.5 }),
        evenement("Bon fictif"),
        "pas un objet",
        null,
      ]),
    );
    expect(e.refuses).toEqual([
      { index: 0, code: "type_invalide" },
      { index: 1, code: "date_invalide" },
      { index: 2, code: "date_invalide" },
      { index: 3, code: "date_invalide" },
      { index: 4, code: "date_invalide" },
      { index: 5, code: "titre_invalide" },
      { index: 6, code: "titre_invalide" },
      { index: 7, code: "resume_invalide" },
      { index: 8, code: "ref_invalide" },
      { index: 9, code: "niveau_invalide" },
      { index: 10, code: "niveau_invalide" },
      { index: 11, code: "niveau_invalide" },
      { index: 13, code: "forme_invalide" },
      { index: 14, code: "forme_invalide" },
    ]);
    expect(e.sorties.map((s) => [s.position, s.titre])).toEqual([[12, "Bon fictif"]]);
  });

  it("un titre et un résumé sortent sur une ligne, sans balise ni caractère de contrôle ; aux bornes, ils passent", () => {
    const e = lire(
      envoi([
        evenement("<b>Recharge</b>\n  fictive\u0007", { resume: "   " }),
        evenement("x".repeat(TITRE_MAX), { resume: "y".repeat(RESUME_MAX), ref: "r".repeat(80) }),
        evenement("Nul fictif", { resume: null, ref: null, niveau: null }),
      ]),
    );
    expect(e.refuses).toEqual([]);
    expect(e.sorties[0]).toMatchObject({ titre: "Recharge fictive", resume: null });
    expect(e.sorties[1]!.titre).toHaveLength(TITRE_MAX);
    expect(e.sorties[1]!.resume).toHaveLength(RESUME_MAX);
    expect(e.sorties[2]).toMatchObject({ resume: null, ref: null, niveau: null });
  });

  it("refuse l'envoi entier : corps, source, liste, nombre", () => {
    expect(code(null)).toBe("corps_invalide");
    expect(code([])).toBe("corps_invalide");
    expect(code(envoi([evenement("x")], { source: "agenda" }))).toBe("source_inconnue");
    expect(code(envoi([]))).toBe("evenements_invalides");
    expect(code(envoi({}))).toBe("evenements_invalides");
    expect(code(envoi(Array.from({ length: EVENEMENTS_MAX + 1 }, () => evenement("x"))))).toBe("trop_d_evenements");
    expect(code(envoi(Array.from({ length: EVENEMENTS_MAX }, () => evenement("x"))))).toBe("ok");
  });
});

describe("le niveau ne descend jamais (pur)", () => {
  it("vaut le plus haut du niveau reçu et du plancher de l'app", () => {
    expect(niveauRetenu("financeai", null)).toBe(3);
    expect(niveauRetenu("financeai", 1)).toBe(3);
    expect(niveauRetenu("carai", 1)).toBe(2);
    expect(niveauRetenu("carai", 3)).toBe(3);
    expect(niveauRetenu("jobai", null)).toBe(2);
    expect(niveauRetenu("hubperso", null)).toBe(1);
    expect(niveauRetenu("hubperso", 2)).toBe(2);
    expect(niveauRetenu("driveai", 1)).toBe(2);
    expect(niveauRetenu("batchchef", null)).toBe(1);
    expect(niveauRetenu("batchchef", 2)).toBe(2);
  });

  it("une app hors de la liste, si elle arrivait jusqu'ici, retomberait au niveau le plus fermé", () => {
    expect(niveauRetenu("inconnue", null)).toBe(3);
    expect(niveauRetenu("inconnue", 1)).toBe(3);
  });

  it("la liste des apps de la porte est fermée, dans le code", () => {
    expect([...APPS_SORTIES].sort()).toEqual(["batchchef", "carai", "driveai", "financeai", "hubperso", "jobai"]);
  });
});

describe("l'empreinte d'une sortie (pure)", () => {
  const base = { type: "recharge", date: new Date("2026-10-26T17:30:00Z"), titre: "A fictif", ref: "r1" as string | null };

  it("avec une réf, c'est le type et la réf : le titre et la date ne comptent pas", () => {
    const e = empreinte(base);
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinte({ ...base, titre: "Autre titre", date: new Date("2026-10-27T00:00:00Z") })).toBe(e);
    expect(empreinte({ ...base, ref: "r2" })).not.toBe(e);
    expect(empreinte({ ...base, type: "batch" })).not.toBe(e);
  });

  it("sans réf, c'est le type, l'instant et le titre", () => {
    const sans = { ...base, ref: null };
    const e = empreinte(sans);
    expect(empreinte({ ...sans })).toBe(e);
    expect(empreinte({ ...sans, titre: "B fictif" })).not.toBe(e);
    expect(empreinte({ ...sans, date: new Date("2026-10-26T17:31:00Z") })).not.toBe(e);
    expect(e).not.toBe(empreinte(base));
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
beforeEach(async () => {
  await pg.exec("delete from sorties");
});
afterAll(async () => pg?.close());

const lues = (...evenements: unknown[]): SortieLue[] => lire(envoi(evenements)).sorties;
const ecrire = (app: string, lot: SortieLue[]): Promise<ResultatSorties> => ecrireSorties(db as never, cle, app, lot);

describe("l'écriture (PGlite)", () => {
  it("retient le niveau le plus haut du reçu et du plancher de l'app", async () => {
    expect(await ecrire("batchchef", lues(evenement("Un fictif", { ref: "n-1" }), evenement("Deux fictif", { ref: "n-2", niveau: 2 })))).toEqual({ ecrits: 2, doublons: 0 });
    await ecrire("financeai", lues(evenement("Bas fictif", { ref: "n-1", niveau: 1 })));
    const r = await pg.query<{ app: string; niveau: number }>("select app, niveau from sorties order by app, niveau");
    expect(r.rows).toEqual([
      { app: "batchchef", niveau: 1 },
      { app: "batchchef", niveau: 2 },
      { app: "financeai", niveau: 3 },
    ]);
  });

  it("scelle le titre et le résumé au niveau retenu, chacun avec sa propre donnée associée", async () => {
    await ecrire("carai", lues(evenement("Recharge fictive", { resume: "42 kWh fictifs", ref: "s-1", niveau: 2 }), evenement("Sans résumé fictif", { ref: "s-2" })));
    const lignes = (await pg.query<{ id: string; titre: string; resume: string | null; niveau: number; app: string }>("select id, titre, resume, niveau, app from sorties order by titre")).rows;
    const avec = lignes.find((l) => l.resume !== null)!;
    const sans = lignes.find((l) => l.resume === null)!;
    expect(avec.app).toBe("carai");
    // En base, rien ne se lit en clair.
    expect(avec.titre.startsWith("v2:")).toBe(true);
    expect(avec.titre).not.toContain("fictive");
    expect(avec.resume).not.toContain("fictifs");
    expect(dechiffrer(cle, avec.titre, `sorties|${avec.id}|titre`, avec.niveau)).toBe("Recharge fictive");
    expect(dechiffrer(cle, avec.resume!, `sorties|${avec.id}|resume`, avec.niveau)).toBe("42 kWh fictifs");
    expect(dechiffrer(cle, sans.titre, `sorties|${sans.id}|titre`, sans.niveau)).toBe("Sans résumé fictif");
    // Un texte déplacé d'une colonne à l'autre, ou lu à un autre niveau, ne se déchiffre pas.
    expect(() => dechiffrer(cle, avec.titre, `sorties|${avec.id}|resume`, avec.niveau)).toThrow();
    expect(() => dechiffrer(cle, avec.titre, `sorties|${avec.id}|titre`, 3)).toThrow();
  });

  it("un événement renvoyé ne se double jamais, et deux apps ne se mélangent pas", async () => {
    const lot = lues(evenement("A fictif", { ref: "d-1" }), evenement("B fictif", { ref: "d-2" }));
    expect(await ecrire("jobai", lot)).toEqual({ ecrits: 2, doublons: 0 });
    expect(await ecrire("jobai", lot)).toEqual({ ecrits: 0, doublons: 2 });
    expect(await ecrire("jobai", [...lot, ...lues(evenement("C fictif", { ref: "d-3" }))])).toEqual({ ecrits: 1, doublons: 2 });
    // Le même événement chez une autre app est une autre sortie.
    expect(await ecrire("carai", lot)).toEqual({ ecrits: 2, doublons: 0 });
    expect((await pg.query("select 1 from sorties")).rows).toHaveLength(5);
  });

  it("deux fois le même événement dans un seul envoi : une ligne, un doublon", async () => {
    expect(await ecrire("driveai", lues(evenement("E1 fictif", { ref: "d-9" }), evenement("E2 autre titre", { ref: "d-9" })))).toEqual({ ecrits: 1, doublons: 1 });
    // Sans réf, c'est le type, l'instant et le titre qui font l'identité.
    expect(await ecrire("driveai", lues(evenement("Sans réf fictif")))).toEqual({ ecrits: 1, doublons: 0 });
    expect(await ecrire("driveai", lues(evenement("Sans réf fictif")))).toEqual({ ecrits: 0, doublons: 1 });
  });

  it("un envoi sans événement lu n'écrit rien", async () => {
    expect(await ecrire("carai", [])).toEqual({ ecrits: 0, doublons: 0 });
  });

  it("la base refuse un niveau hors de 1-3, quoi que le code ait laissé passer", async () => {
    const inserer = (niveau: number) =>
      pg.query("insert into sorties (id, app, type, date, niveau, empreinte, titre) values ($1,'carai','t', now(), $2, $1, 't')", [`n-${niveau}`, niveau]);
    await expect(inserer(0)).rejects.toThrow(/sorties_niveau_1_3/);
    await expect(inserer(4)).rejects.toThrow(/sorties_niveau_1_3/);
    await expect(inserer(3)).resolves.toBeDefined();
  });
});

describe("POST /api/sorties — les refus, dans l'ordre", () => {
  const JETON = "jeton-financeai-ecriture-0123456789"; // gitleaks:allow (factice)
  const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_FINANCEAI_ECRITURE", "MEMORYAI_TOKEN_DRIVEAI_LECTURE", "MEMORYAI_TOKEN_CLAUDECODE_ECRITURE", "MEMORYAI_CHIFFREMENT", "DATABASE_URL"] as const;
  const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  afterEach(() => {
    for (const v of VARS) {
      if (sauvegarde[v] === undefined) delete process.env[v];
      else process.env[v] = sauvegarde[v];
    }
  });
  function configurer() {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_FINANCEAI_ECRITURE = JETON;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = "jeton-driveai-lecture-00123456789"; // gitleaks:allow (factice)
    process.env.MEMORYAI_TOKEN_CLAUDECODE_ECRITURE = "jeton-claudecode-ecriture-0123456"; // gitleaks:allow (factice)
    process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
    process.env.DATABASE_URL = "postgres://jamais-appelee.invalid/x";
  }
  const envoyer = (corps: string | object, jeton: string | null = JETON) =>
    POST(
      new Request("http://memoryai.test/api/sorties", {
        method: "POST",
        headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
        body: typeof corps === "string" ? corps : JSON.stringify(corps),
      }),
    );

  it("503 memoire_gelee avant même le jeton", async () => {
    configurer();
    process.env.MEMORYAI_GEL = "1";
    const r = await envoyer(envoi([evenement("x")]), null);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("401 sans jeton, jeton inconnu, jeton de LECTURE, ou écrivain d'une app hors de la liste : la même réponse", async () => {
    configurer();
    for (const j of [null, "jeton-inconnu-00123456789012345", "jeton-driveai-lecture-00123456789", "jeton-claudecode-ecriture-0123456"]) {
      const r = await envoyer(envoi([evenement("x")]), j);
      expect(r.status, String(j)).toBe(401);
      expect(await r.json()).toEqual({ error: "non_autorise" });
    }
  });

  it("503 cle_absente et base_absente : des pannes, jamais des refus", async () => {
    configurer();
    delete process.env.MEMORYAI_CHIFFREMENT;
    expect((await (await envoyer(envoi([evenement("x")]))).json()).error).toBe("cle_absente");
    configurer();
    delete process.env.DATABASE_URL;
    expect((await (await envoyer(envoi([evenement("x")]))).json()).error).toBe("base_absente");
  });

  it("413 au-delà de la taille, 400 hors JSON ou hors objet, 422 sur un envoi refusé ; jamais en cache", async () => {
    configurer();
    const gros = await envoyer(envoi([evenement("x")], { remplissage: "x".repeat(CORPS_MAX) }));
    expect(gros.status).toBe(413);
    expect((await envoyer("{pas du json")).status).toBe(400);
    const nul = await envoyer("null");
    expect(nul.status).toBe(400);
    expect((await nul.json()).error).toBe("corps_invalide");
    const source = await envoyer(envoi([evenement("x")], { source: "agenda" }));
    expect(source.status).toBe(422);
    expect((await source.json()).error).toBe("source_inconnue");
    expect(source.headers.get("cache-control")).toBe("no-store");
    const vide = await envoyer(envoi([]));
    expect(vide.status).toBe(422);
    expect((await vide.json()).error).toBe("evenements_invalides");
    const trop = await envoyer(envoi(Array.from({ length: EVENEMENTS_MAX + 1 }, () => evenement("x"))));
    expect(trop.status).toBe(422);
    expect((await trop.json()).error).toBe("trop_d_evenements");
  });
});
