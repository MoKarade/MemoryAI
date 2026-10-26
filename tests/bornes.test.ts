// tests/bornes.test.ts — les bornes de recharge proches (ADR 0028) : la lecture PURE du fichier du
// Circuit électrique (par le nom des colonnes, lignes hors forme ignorées), les parcs les plus
// proches dans le rayon, le cache d'un jour sur une VRAIE Postgres (PGlite), la panne qui dit
// « indisponible », le point de la ville lu dans la réponse d'ECCC, et la tuile de l'espace Monde.
// Données FICTIVES : parcs, villes et points inventés.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { bornesProches, distanceKm, lireCsvBornes, SOURCE_BORNES, sourceBornes } from "../lib/monde/bornes";
import { lireMeteoEccc } from "../lib/monde/meteo";
import { tableauMonde, type Tableau } from "../lib/accueil/tableaux";
import { avecBornes } from "../lib/accueil/tuileBornes";

/** Le point de référence du test : un point quelconque, pas la ville de Marc. */
const ICI = { lat: 47, lon: -70 };
/** Environ 1,1 km par 0,01° de latitude. */
const auNord = (km: number) => (ICI.lat + km / 111.2).toFixed(5);

const ENTETE =
  '"Nom de la borne de recharge","Nom du parc","Adresse","Rue","Suite","Ville","Province","Code Postal","Région","Niveau de recharge","Latitude","Longitude","Coût","Mode de tarification","Type d’emplacement","Puissance (kW)"';
const ligne = (borne: string, parc: string, ville: string, niveau: string, lat: string, lon: string, kw: string) =>
  `"${borne}","${parc.replace(/"/g, '""')}","1 rue Fictive","1 rue Fictive",,"${ville}","QC","Z0Z 0Z0","Fictive","${niveau}",${lat},${lon},1,"par heure","",${kw}`;

const CSV = [
  ENTETE,
  ligne("B-1", "Parc du Lac", "Villefictive", "Niveau 2", auNord(1.2), "-70", "7.2"),
  ligne("B-2", "Parc du Lac", "Villefictive", "Niveau 2", auNord(1.2), "-70", "7.2"),
  ligne("B-3", "Halte, \"rapide\"", "Villefictive", "Recharge rapide", auNord(3), "-70", "100"),
  ligne("B-4", "Trop loin", "Autreville", "Niveau 2", auNord(40), "-70", "7.2"),
  ligne("B-5", "<b>Parc balisé</b>", "Villefictive", "Niveau 2", auNord(0.5), "-70", ""),
  ligne("B-6", "Sans position", "Villefictive", "Niveau 2", "", "", "7.2"),
  ligne("B-7", "Hors limites", "Villefictive", "Niveau 2", "95", "-70", "7.2"),
].join("\r\n");

describe("la lecture du fichier du Circuit électrique", () => {
  it("lit les bornes par le nom des colonnes et ignore les lignes hors forme", () => {
    const b = lireCsvBornes(CSV)!;
    // Un texte du fichier sort sans balise ; « Sans position » et « Hors limites » sont ignorées.
    expect(b.map((x) => x.parc)).toEqual(["Parc du Lac", "Parc du Lac", 'Halte, "rapide"', "Trop loin", "b Parc balisé /b"]);
    expect(b[4]?.puissanceKw).toBeNull();
    expect(b[2]).toMatchObject({ niveau: "Recharge rapide", puissanceKw: 100 });
  });

  it("un fichier sans les colonnes attendues n'est pas le fichier connu", () => {
    expect(lireCsvBornes('"a","b"\n1,2')).toBeNull();
    expect(lireCsvBornes("")).toBeNull();
  });

  it("la distance à vol d'oiseau est celle du calcul de haversine", () => {
    expect(distanceKm(ICI, { lat: ICI.lat + 1, lon: ICI.lon })).toBeCloseTo(111.2, 0);
    expect(distanceKm(ICI, ICI)).toBe(0);
  });

  it("les parcs les plus proches dans le rayon, les bornes d'un même parc sur une ligne", () => {
    const parcs = bornesProches(lireCsvBornes(CSV)!, ICI);
    expect(parcs.map((p) => [p.parc, p.bornes])).toEqual([
      ["b Parc balisé /b", 1],
      ["Parc du Lac", 2],
      ['Halte, "rapide"', 1],
    ]);
    expect(parcs[1]?.distanceKm).toBeCloseTo(1.2, 1);
    expect(parcs[1]).toMatchObject({ niveaux: ["Niveau 2"], puissanceMaxKw: 7.2 });
    expect(bornesProches(lireCsvBornes(CSV)!, ICI, 25, 1)).toHaveLength(1);
  });
});

describe("le point de la ville que rend ECCC", () => {
  // La forme minimale d'une réponse d'ECCC, avec des valeurs inventées.
  const eccc = (coordinates?: unknown) => ({
    ...(coordinates !== undefined && { geometry: { type: "Point", coordinates } }),
    properties: { name: { fr: "Villefictive" }, currentConditions: { timestamp: { fr: "2026-10-24T19:00:00Z" } } },
  });

  it("garde le point (longitude, latitude), et rien s'il est absent, hors limites ou de mauvaise forme", () => {
    expect(lireMeteoEccc(eccc([-70.5, 47.25]))?.position).toEqual({ lat: 47.25, lon: -70.5 });
    expect(lireMeteoEccc(eccc([-70.5, 147]))?.position).toBeUndefined();
    expect(lireMeteoEccc(eccc("pas un point"))?.position).toBeUndefined();
    expect(lireMeteoEccc(eccc())?.position).toBeUndefined();
  });
});

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
});
afterAll(async () => pg?.close());

const T0 = new Date("2026-10-25T12:00:00Z");

describe("la source des bornes, derrière un cache d'un jour", () => {
  it("sans position, rien n'est lu : « sans-position »", async () => {
    let appels = 0;
    const r = await sourceBornes(db as never, async () => (appels++, { texte: CSV, modifieLe: null })).lire(T0, null);
    expect(r).toEqual({ ok: false, raison: "sans-position" });
    expect(appels).toBe(0);
  });

  it("lit le fichier une fois, sans paramètre, puis sert le cache pendant un jour", async () => {
    const urls: string[] = [];
    const source = sourceBornes(db as never, async (u) => (urls.push(u), { texte: CSV, modifieLe: "Sat, 24 Oct 2026 06:00:06 GMT" }));
    const r = await source.lire(T0, ICI);
    if (!r.ok) throw new Error("lecture attendue");
    expect(r.bornes.fichierLe).toBe("2026-10-24T06:00:06.000Z");
    expect(r.bornes.parcs).toHaveLength(3);
    expect(await source.lire(new Date(T0.getTime() + 3_600_000), ICI)).toEqual(r);
    expect(urls).toEqual(["https://data.lecircuitelectrique.com/stations/export_sites_fr.csv"]);
    // Rien de Marc ne part : l'adresse ne porte ni position, ni ville.
    expect(urls[0]).not.toMatch(/\?/);
  });

  it("une panne ou un fichier de forme inattendue disent « indisponible », sans écrire", async () => {
    const autre = { lat: 10, lon: 10 };
    const panne = sourceBornes(db as never, async () => {
      throw new Error("réseau");
    });
    expect(await panne.lire(T0, autre)).toEqual({ ok: false, raison: "indisponible" });
    const forme = sourceBornes(db as never, async () => ({ texte: "<html>autre chose</html>", modifieLe: null }));
    expect(await forme.lire(T0, autre)).toEqual({ ok: false, raison: "indisponible" });
    const lignes = await db.select().from(schema.mondeCache);
    expect(lignes.filter((l) => l.cle === "bornes|10.00,10.00")).toHaveLength(0);
  });
});

describe("la tuile « Bornes proches »", () => {
  const base = tableauMonde();
  const corps = (b: Parameters<typeof avecBornes>[1], cle = "bornes") => avecBornes(base, b).tuiles.find((t) => t.cle === cle)?.corps;
  const fichier: Parameters<typeof avecBornes>[1] = { ok: true, bornes: { fichierLe: null, parcs: [] } };

  it("une ligne par parc, avec la distance, le niveau, la puissance, le réseau et la date du fichier", () => {
    const c = corps({
      ok: true,
      bornes: { fichierLe: "2026-10-24T06:00:06.000Z", parcs: [{ parc: "Parc du Lac", ville: "Villefictive", distanceKm: 1.23, bornes: 2, niveaux: ["Niveau 2"], puissanceMaxKw: 7.2 }] },
    });
    expect(c).toEqual([
      { genre: "liste", elements: [{ libelle: "Parc du Lac · à 1,2 km", detail: "Niveau 2, 7,2 kW · 2 bornes" }] },
      { genre: "texte", texte: "Les plus proches de ta ville, à vol d'oiseau. Réseau du Circuit électrique seulement. Fichier du 24 oct." },
    ]);
    expect(corps(fichier, "sources")).toEqual([{ genre: "texte", texte: `${SOURCE_BORNES}.` }]);
  });

  it("l'attribution s'ajoute aux sources déjà là, sans les effacer", () => {
    const t: Tableau = { question: "q", tuiles: [{ cle: "sources", largeur: 6, icone: "shield", titre: "Sources", corps: [{ genre: "texte", texte: "Source de la météo." }] }] };
    expect(avecBornes(t, fichier).tuiles[0]?.corps).toEqual([
      { genre: "texte", texte: "Source de la météo." },
      { genre: "texte", texte: `${SOURCE_BORNES}.` },
    ]);
  });

  it("vide, en panne, sans position ou non lue : chaque cas le dit", () => {
    expect(avecBornes(base, undefined)).toBe(base);
    expect(corps(null)).toEqual([{ genre: "vide", texte: "La base ne répond pas : les bornes ne sont pas lisibles." }]);
    expect(corps({ ok: false, raison: "sans-position" })).toEqual([{ genre: "vide", texte: "Pas de bornes : la ville de la météo n'a pas de position." }]);
    expect(corps({ ok: false, raison: "indisponible" })).toEqual([{ genre: "vide", texte: "Bornes indisponibles : le Circuit électrique ne répond pas." }]);
    expect(corps(fichier)).toEqual([{ genre: "vide", texte: "Aucune borne du Circuit électrique à moins de 25 km de ta ville." }]);
  });
});
