// tests/avancement.test.ts — l'avancement que DriveAI publie (ADR 0009), de la route à l'écran.
//
// Ce que ces cas défendent, et la mutation qui doit rougir est nommée dans chaque titre :
//   1. le CONTRAT : des nombres, des dates, des codes — aucune chaîne libre ne passe, et un refus
//      nomme le CHAMP sans jamais renvoyer la VALEUR ;
//   2. la ROUTE : un jeton d'écriture, un 401 indiscernable pour tout le reste, le gel qui refuse ;
//   3. l'ÉCRAN : « non mesuré » n'est jamais zéro, chaque écart s'explique dans les deux sens, et
//      il n'y a PAS d'étage « faits » qui vaudrait zéro pour toujours ;
//   4. ce qui touche au CONTENU chiffré ne rend que des compteurs ;
//   5. aucun modèle ne lit cette table.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { POST } from "../app/api/avancement/route";
import { validerAvancement, JOURS_MAX, TAILLE_MAX_OCTETS, type Avancement } from "../lib/avancement/contrat";
import { depotAvancementDrizzle } from "../lib/avancement/depot";
import { comptesParDossier, compterExtraits, lignesExtraits } from "../lib/avancement/comptesMemoire";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import {
  composerDossiers,
  composerEntonnoir,
  etatSource,
  libelleDossier,
  serieReste,
  SEUIL_RETARD_MIN,
} from "../lib/avancement/vue";
import { ROUTES_A_AUTH_PROPRE, isPublicPath } from "../lib/authGuard";

const valide = (): Avancement => ({
  version: 1,
  mesureLe: "2026-09-23T21:14:00.000Z",
  classes: { lignes: 26550, distincts: 3100, sansFileId: 383, candidats: 2900 },
  envoi: { acceptes: 2974 },
  fileLecture: [
    { code: "04", lus: 48, restants: 0, enCours: false },
    { code: "05", lus: 3, restants: 528, enCours: true },
  ],
  joursLus: [
    { jour: "2026-09-22", restants: 12, extraits: 60, acceptes: 60, illisibles: 3, sansTexte: 1, echecs: 0, tag: "c49-5-b" },
    { jour: "2026-09-23", restants: 2841, extraits: 5, acceptes: 5, illisibles: 0, sansTexte: 0, echecs: 0, tag: "c49-5-b" },
  ],
});

/* ───────────────────────────── 1. le contrat ───────────────────────────── */

describe("contrat — des nombres, jamais du texte", () => {
  it("un envoi complet et réaliste passe", () => {
    expect(validerAvancement(valide()).ok).toBe(true);
  });

  it("« non mesuré » est accepté comme tel : `distincts` et un reste de jour peuvent valoir null", () => {
    const a = valide();
    a.classes!.distincts = null;
    a.joursLus[0]!.restants = null;
    expect(validerAvancement(a).ok).toBe(true);
    expect(validerAvancement({ ...valide(), classes: null, envoi: null }).ok).toBe(true);
  });

  it("une clé INCONNUE est refusée et NOMMÉE (mutation : retirer `.strict()`)", () => {
    const v = validerAvancement({ ...valide(), nomFichier: "Passeport Marc.pdf" });
    expect(v.ok).toBe(false);
    if (v.ok || v.code !== "schema_refuse") throw new Error("attendu schema_refuse");
    expect(v.chemins).toContain("nomFichier");
    // Le refus nomme le CHAMP, jamais la valeur : rien ne revient en écho.
    expect(JSON.stringify(v)).not.toContain("Passeport");
  });

  it("un texte libre glissé dans un code de dossier, un tag ou une date est refusé", () => {
    const a1 = valide();
    (a1.fileLecture[0] as { code: string }).code = "04 · Immigration";
    const a2 = valide();
    (a2.joursLus[0] as { tag: string }).tag = "Relevé de Marc";
    const a3 = valide();
    (a3.joursLus[0] as { jour: string }).jour = "hier";
    const a4 = valide();
    (a4 as { mesureLe: string }).mesureLe = "2026-09-23 21:14"; // sans fuseau : lue à l'heure du SERVEUR
    for (const a of [a1, a2, a3, a4]) expect(validerAvancement(a).ok).toBe(false);
  });

  it("un compte négatif, décimal ou absurde est refusé — ce n'est pas une mesure", () => {
    for (const n of [-1, 1.5, 1e9]) {
      const a = valide();
      a.envoi!.acceptes = n;
      expect(validerAvancement(a).ok).toBe(false);
    }
  });

  it(`au plus ${JOURS_MAX} jours : la série ne sert pas de porte à un corps sans fond`, () => {
    const a = valide();
    a.joursLus = Array.from({ length: JOURS_MAX + 1 }, (_, i) => ({ ...a.joursLus[0]!, jour: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }));
    expect(validerAvancement(a).ok).toBe(false);
  });

  it("une version PLUS RÉCENTE dit que c'est la Mémoire qui est en retard (mutation : tout rabattre sur schema_refuse)", () => {
    const v = validerAvancement({ ...valide(), version: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("version_inconnue");
  });
});

/* ───────────────────────────── 2. la route ───────────────────────────── */

const JETON = "jeton-driveai-ecriture-0123456789";
const LECTURE = "jeton-driveai-lecture-0123456789ab";
const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "MEMORYAI_TOKEN_DRIVEAI_LECTURE", "DATABASE_URL"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

const requete = (jeton: string | null, corps: string = JSON.stringify(valide())) =>
  new Request("http://memoryai.test/api/avancement", {
    method: "POST",
    headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: corps,
  });

describe("POST /api/avancement — qui entre, et ce qui est refusé", () => {
  it("401 INDISCERNABLE : absent, faux, ou jeton de LECTURE (mutation : accepter la lecture)", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = LECTURE;
    const corps: string[] = [];
    for (const j of [null, "faux-jeton-0123456789abcdef", LECTURE]) {
      const r = await POST(requete(j));
      expect(r.status).toBe(401);
      corps.push(await r.text());
    }
    expect(new Set(corps).size).toBe(1);
  });

  it("le GEL refuse : cette route écrit (contrairement à GET /api/etat)", async () => {
    process.env.MEMORYAI_GEL = "1";
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    const r = await POST(requete(JETON));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("503 base_absente — une panne se dit, elle ne s'avale pas", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    delete process.env.DATABASE_URL;
    const r = await POST(requete(JETON));
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("413 au-delà de la taille maximale, sans même analyser le corps", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.DATABASE_URL = "postgres://x";
    const r = await POST(requete(JETON, "x".repeat(TAILLE_MAX_OCTETS + 1)));
    expect(r.status).toBe(413);
  });

  it("422 nomme les CHAMPS refusés, jamais leurs valeurs", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE = JETON;
    process.env.DATABASE_URL = "postgres://x";
    const r = await POST(requete(JETON, JSON.stringify({ ...valide(), secret: "NAS 123 456 789" })));
    expect(r.status).toBe(422);
    const t = await r.text();
    expect(t).toContain("secret");
    expect(t).not.toContain("123 456 789");
  });

  it("la route est hors du garde de session, par ÉGALITÉ, et dans le matcher (piège n° 1)", () => {
    expect(ROUTES_A_AUTH_PROPRE).toContain("/api/avancement");
    expect(isPublicPath("/api/avancement")).toBe(true);
    expect(isPublicPath("/api/avancement/autre")).toBe(false);
    expect(readFileSync("middleware.ts", "utf8")).toContain("api/avancement$");
  });
});

/* ───────────────────────────── 3. l'écran ───────────────────────────── */

describe("l'entonnoir — non mesuré n'est jamais zéro, et chaque écart s'explique", () => {
  const memoire = { connus: 2782, lus: 613, tentees: 40 };

  it("DriveAI muet ⇒ ses deux étages sont NULL, et l'écart est « inconnu » (mutation : `?? 0`)", () => {
    const { etages, ecarts } = composerEntonnoir(null, memoire);
    expect(etages.map((e) => e.valeur)).toEqual([null, null, 2782, 613]);
    expect(ecarts[0]!.valeur).toBeNull();
    expect(ecarts[1]!.valeur).toBeNull();
    expect(ecarts[0]!.explication).toMatch(/inconnu/);
    // L'écart entre les deux étages de la Mémoire, lui, se mesure.
    expect(ecarts[2]!.valeur).toBe(2169);
    expect(ecarts[2]!.explication).toMatch(/dont 40 déjà essayé/);
  });

  it("un écart NÉGATIF se dit comme une différence de définition, jamais rabattu à zéro", () => {
    const a = valide();
    a.classes!.distincts = 2900; // moins que les 2 974 envoyés : l'envoi est un cumul
    const { ecarts } = composerEntonnoir(a, memoire);
    expect(ecarts[0]!.valeur).toBe(-74);
    expect(ecarts[0]!.explication).toMatch(/CUMUL/);
  });

  it("il n'y a PAS d'étage « faits » : la lecture écrit des papiers, pas des faits (leçon n° 43)", () => {
    const { etages } = composerEntonnoir(valide(), memoire);
    expect(etages.map((e) => e.cle)).toEqual(["classes", "envoyes", "connus", "lus"]);
    expect(etages.every((e) => !/fait/i.test(e.libelle))).toBe(true);
  });

  it("chaque étage nomme sa SOURCE", () => {
    const { etages } = composerEntonnoir(valide(), memoire);
    expect(etages.map((e) => e.source)).toEqual(["DriveAI", "DriveAI", "Mémoire", "Mémoire"]);
  });

  it("des documents pas encore recomptés se disent en LIGNES, jamais comme des documents", () => {
    const a = valide();
    a.classes!.distincts = null;
    const { etages } = composerEntonnoir(a, memoire);
    expect(etages[0]!.valeur).toBeNull();
    expect(etages[0]!.note).toMatch(/26550 lignes/);
  });

  it("fraîcheur : jamais, illisible, frais, en retard au-delà du seuil", () => {
    const t = new Date("2026-09-23T22:00:00Z");
    expect(etatSource({ etat: "absent" }, t)).toEqual({ etat: "jamais" });
    expect(etatSource({ etat: "illisible", recuLe: new Date("2026-09-23T21:50:00Z") }, t)).toMatchObject({ etat: "illisible", recuIlYaMin: 10 });
    const frais = etatSource({ etat: "present", recuLe: new Date("2026-09-23T21:30:00Z"), mesureLe: new Date("2026-09-23T21:29:00Z") }, t);
    expect(frais).toMatchObject({ etat: "present", enRetard: false, recuIlYaMin: 30, mesureIlYaMin: 31 });
    const vieux = etatSource(
      { etat: "present", recuLe: new Date(t.getTime() - (SEUIL_RETARD_MIN + 1) * 60_000), mesureLe: new Date(0) },
      t,
    );
    expect(vieux).toMatchObject({ enRetard: true });
  });

  it("les dossiers fusionnent DEUX sources sans les additionner", () => {
    const d = composerDossiers(
      [
        { code: "04", lus: 48, connus: 48 },
        { code: "05", lus: 3, connus: 531 },
      ],
      valide(),
    );
    const cinq = d.find((x) => x.code === "05")!;
    expect(cinq).toMatchObject({ lus: 3, connus: 531, resteDriveai: 528, enCours: true, libelle: "Carrière" });
    // Un dossier que seule la Mémoire connaît n'a pas de reste « selon DriveAI » — pas zéro.
    const sansDriveai = composerDossiers([{ code: "07", lus: 0, connus: 4 }], null);
    expect(sansDriveai[0]!.resteDriveai).toBeNull();
    expect(libelleDossier("42")).toBe("Dossier 42");
  });

  it("la série du reste ne traverse pas un bump de tag et saute les jours inconnus", () => {
    const a = valide();
    a.joursLus = [
      { ...a.joursLus[0]!, jour: "2026-09-20", tag: "c49-5-a", restants: 5 },
      { ...a.joursLus[0]!, jour: "2026-09-21", restants: null },
      { ...a.joursLus[0]!, jour: "2026-09-22", restants: 900 },
      { ...a.joursLus[0]!, jour: "2026-09-23", restants: 880 },
    ];
    expect(serieReste(a.joursLus)).toEqual([
      { jour: "2026-09-22", reste: 900 },
      { jour: "2026-09-23", reste: 880 },
    ]);
  });
});

/* ─────────────────────── 4. le contenu chiffré ne rend que des compteurs ─────────────────────── */

describe("compterExtraits — ce qu'on tire des papiers, en nombres seulement", () => {
  const SECRET = "Passeport AB1234567";
  const base = { statut: "active" as const, supprimeLe: null };
  const lignes = [
    {
      ...base,
      id: "p1",
      niveau: 3,
      dateDocument: "2024-01-02",
      dateEcheance: "2034-01-02",
      champsStructures: JSON.stringify({ numeros: [{ libelle: "passeport", valeur: SECRET }], personnes: [{ libelle: "titulaire", valeur: "Marc" }] }),
    },
    { ...base, id: "p2", niveau: 1, dateDocument: null, dateEcheance: null, champsStructures: JSON.stringify({ montants: [{ libelle: "a", valeur: "1" }, { libelle: "b", valeur: "2" }] }) },
    { ...base, id: "p3", niveau: 1, dateDocument: "2025-05-05", dateEcheance: null, champsStructures: null },
    { ...base, id: "p4", niveau: 1, dateDocument: null, dateEcheance: null, champsStructures: "corrompu" },
  ];
  const TOUT = { inclureN2: true, n2Autorise: true, inclureN3: true, n3Autorise: true, inclureProposes: true };
  const SANS_N3 = { ...TOUT, n3Autorise: false };
  const SANS_N2 = { ...TOUT, n2Autorise: false, n3Autorise: false };
  const ouverts: string[] = [];
  const dechiffrer = (s: string, id: string) => {
    ouverts.push(id);
    if (s === "corrompu") throw new Error("tag GCM invalide");
    return s;
  };

  it("tout autorisé : compte dates, échéances, entrées et papiers par famille", () => {
    const r = compterExtraits(lignes, dechiffrer, TOUT);
    expect(r).toMatchObject({ papiers: 4, avecDate: 2, avecEcheance: 1, illisibles: 1, proteges: 0 });
    expect(r.entrees).toMatchObject({ montants: 2, numeros: 1, personnes: 1, lieux: 0 });
    expect(r.papiersAvec).toMatchObject({ montants: 1, numeros: 1, personnes: 1, lieux: 0 });
  });

  it("N3 NON autorisé : le papier N'EST PAS OUVERT, compté protégé, ses dates en clair restent (mutation : ignorer la politique)", () => {
    ouverts.length = 0;
    const r = compterExtraits(lignes, dechiffrer, SANS_N3);
    expect(ouverts).not.toContain("p1");
    expect(ouverts).toContain("p2"); // anti-vacuité : le déchiffreur sert bien pour ce qui est permis
    expect(r).toMatchObject({ proteges: 1, avecDate: 2, avecEcheance: 1 });
    expect(r.entrees).toMatchObject({ numeros: 0, personnes: 0, montants: 2 });
  });

  it("N2 NON autorisé : un papier retenu n'est ni ouvert ni compté ailleurs que « protégé »", () => {
    ouverts.length = 0;
    const n2 = { ...lignes[1]!, id: "n2", niveau: 2, dateDocument: "2023-03-03" };
    const r = compterExtraits([n2], dechiffrer, SANS_N2);
    expect(ouverts).toEqual([]);
    expect(r).toMatchObject({ papiers: 1, proteges: 1, avecDate: 0 });
    expect(r.entrees.montants).toBe(0);
  });

  it("un papier illisible se COMPTE, il ne devient pas « rien trouvé » (mutation : l'ignorer)", () => {
    expect(compterExtraits([lignes[3]!], dechiffrer, TOUT).illisibles).toBe(1);
  });

  it("AUCUNE valeur ne sort : seulement des compteurs", () => {
    const r = compterExtraits(lignes, dechiffrer, TOUT);
    expect(JSON.stringify(r)).not.toContain("AB1234567");
    expect(JSON.stringify(r)).not.toContain("Marc");
  });
});

/* ─────────────────────── 5. aucun modèle ne lit cette table ─────────────────────── */

describe("isolation — un compteur n'est pas une affirmation sur Marc", () => {
  const fichiersDe = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: false })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => join(dir, f));

  it("aucun module qui parle à un modèle n'importe l'avancement (mutation : l'importer)", () => {
    // ⚠️ Tout ce qui construit un prompt ou répond à un modèle (ADR 0009 §2.2, revue du 23/09 :
    // le scan ne couvrait que trois chemins, et l'ADR en promet davantage).
    const fichiers = [
      ...fichiersDe("lib/chat"),
      ...fichiersDe("lib/mcp"),
      ...fichiersDe("lib/questions"),
      ...fichiersDe("app/api/mcp"),
      ...fichiersDe("app/api/chat"),
      ...fichiersDe("app/chat"),
      "lib/lecture.ts",
      "lib/apprentissage.ts",
      "lib/questions.ts",
    ];
    expect(fichiers.length).toBeGreaterThan(5); // anti-vacuité : le scan voit bien des fichiers
    for (const f of fichiers) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/avancement|avancementSources/);
    }
  });
});

/* ─────────────────────── 6. le dépôt, sur une vraie base ─────────────────────── */

describe("dépôt — une ligne par app, écrasée, relue à travers le schéma", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
    db = drizzle(pg, { schema });
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("absent ⇒ « absent », jamais un avancement vide", async () => {
    expect(await depotAvancementDrizzle(db).lire("driveai")).toEqual({ etat: "absent" });
  });

  it("enregistrer puis relire ; un second envoi ÉCRASE, il n'ajoute pas", async () => {
    const d = depotAvancementDrizzle(db);
    await d.enregistrer("driveai", valide());
    const deux = { ...valide(), envoi: { acceptes: 3000 } };
    await d.enregistrer("driveai", deux);
    const lu = await d.lire("driveai");
    expect(lu.etat).toBe("present");
    if (lu.etat === "present") expect(lu.avancement.envoi?.acceptes).toBe(3000);
    const n = await db.execute(sql`select count(*)::int as n from avancement_sources`);
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });

  it("une ligne qui ne passe plus le schéma est DITE illisible, pas « absente »", async () => {
    await db.execute(sql`update avancement_sources set corps = '{"version":1,"inconnu":true}' where app_id = 'driveai'`);
    expect((await depotAvancementDrizzle(db).lire("driveai")).etat).toBe("illisible");
  });

  it("la base refuse un app_id qui n'a pas la forme d'une app", async () => {
    await expect(
      db.execute(sql`insert into avancement_sources (app_id, mesure_le, corps) values ('Drive AI; drop', now(), '{}')`),
    ).rejects.toThrow();
  });

  it("les papiers par dossier : lus contre connus, et un papier supprimé ou remplacé ne compte pas", async () => {
    const papier = (id: string, domaine: string | null, extracteur: string) => ({
      id,
      sujet: "marc",
      niveau: 1,
      resumeEnClair: true,
      extracteur,
      empreinte: `empreinte-${id}`,
      domaine,
    });
    await db.insert(schema.pieces).values([
      papier("d1", "04 · Immigration", "haiku-4.5-piece-v1"),
      papier("d2", "04 · Immigration", EXTRACTEUR_MIGRATION),
      papier("d3", "05 · Carrière", EXTRACTEUR_MIGRATION),
      papier("d4", "05 · Carrière", "haiku-4.5-piece-v1"),
      papier("d5", null, "haiku-4.5-piece-v1"), // sans code de dossier : ignoré
    ]);
    await db.update(schema.pieces).set({ supprimeLe: new Date() }).where(eq(schema.pieces.id, "d4"));
    const r = (await comptesParDossier(db)).sort((a, b) => a.code.localeCompare(b.code));
    expect(r).toEqual([
      { code: "04", lus: 1, connus: 2 },
      { code: "05", lus: 0, connus: 1 },
    ]);
    // Les papiers LUS seulement, vivants, avec ce que la politique de lecture consulte.
    const lignes = await lignesExtraits(db);
    expect(lignes.map((l) => l.id).sort()).toEqual(["d1", "d5"]);
    expect(lignes[0]).toMatchObject({ statut: "active", supprimeLe: null, niveau: 1 });
  });
});
