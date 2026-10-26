// lib/monde/bornes.ts — les bornes de recharge proches que LIA montre (ADR 0028, tâche MemoryAI 234) :
// le fichier ouvert du Circuit électrique, publié sur Données Québec, licence CC BY 4.0 (attribution
// exigée), sans clé, régénéré chaque jour.
//
// ⚠️ RIEN DE MARC NE PART : la requête est l'adresse fixe du fichier, sans paramètre. Le fichier est
// lu EN ENTIER et la distance se calcule ICI, depuis le point de la ville de la météo (la
// `geometry` d'ECCC), jamais depuis une adresse ni la position du véhicule.
// ⚠️ UN NOM DE PARC EST UN TEXTE ÉCRIT PAR UN TIERS : il est coupé et débarrassé de toute balise.
// Rien n'est rendu à un modèle dans ce lot.
// ⚠️ PAS DE COÛT AFFICHÉ : son unité dépend du mode de tarification, et un tarif mal lu serait un
// faux chiffre.
//
// Fonctions pures d'un côté (`lireCsvBornes`, `bornesProches`), I/O de l'autre (`sourceBornes`).

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** L'attribution exigée par la licence. */
export const SOURCE_BORNES = "Source : Le Circuit électrique, Données Québec (licence CC BY 4.0)";
const URL_BORNES = "https://data.lecircuitelectrique.com/stations/export_sites_fr.csv";
/** Une lecture du fichier par jour au plus (ADR 0028 § 4). */
const FRAICHEUR_MS = 24 * 3_600_000;
const DELAI_MS = 10_000;
/** Le fichier fait environ 1,6 Mo (25/10/2026) ; au-delà de 8 Mo, ce n'est plus lui. */
const TAILLE_MAX = 8_000_000;
const LONGUEUR_MAX = 80;
/** « Proches » : 25 km, les 5 parcs les plus près (ADR 0028 § 3). */
export const RAYON_KM = 25;
const PARCS_MAX = 5;

export interface Point {
  lat: number;
  lon: number;
}

interface Borne {
  parc: string;
  ville: string | null;
  niveau: string | null;
  puissanceKw: number | null;
  lat: number;
  lon: number;
}

export interface Parc {
  parc: string;
  ville: string | null;
  distanceKm: number;
  bornes: number;
  niveaux: string[];
  puissanceMaxKw: number | null;
}

interface Bornes {
  /** La date du fichier (en-tête `Last-Modified`), ISO ; `null` : le serveur ne la dit pas. */
  fichierLe: string | null;
  parcs: Parc[];
}

export type LectureBornes = { ok: true; bornes: Bornes } | { ok: false; raison: "sans-position" | "indisponible" };

/** Un texte du fichier : une ligne, sans balise, coupé. `null` s'il ne reste rien. */
function texte(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.replace(/[<>\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, LONGUEUR_MAX) : null;
}

/** Les lignes d'un CSV (virgules, guillemets doublés, retours à la ligne entre guillemets). PURE. */
function lignesCsv(csv: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let entre = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (entre) {
      if (c === '"' && csv[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') entre = false;
      else champ += c;
    } else if (c === '"') entre = true;
    else if (c === ",") {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  if (champ || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes;
}

const nombre = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Les bornes du fichier, lues par le NOM des colonnes (un ordre changé ne trompe pas). PURE.
 * `null` : les colonnes attendues manquent, ce n'est pas le fichier connu. Une ligne hors forme
 * (coordonnées absentes ou hors limites, parc sans nom) est ignorée.
 */
export function lireCsvBornes(csv: string): Borne[] | null {
  const [entete, ...lignes] = lignesCsv(csv.replace(/^﻿/, ""));
  if (!entete) return null;
  const col = (nom: string) => entete.findIndex((e) => e.trim() === nom);
  const c = { parc: col("Nom du parc"), ville: col("Ville"), niveau: col("Niveau de recharge"), lat: col("Latitude"), lon: col("Longitude"), puissance: col("Puissance (kW)") };
  if (c.parc < 0 || c.lat < 0 || c.lon < 0) return null;
  return lignes.flatMap((l): Borne[] => {
    const parc = texte(l[c.parc]);
    const lat = nombre(l[c.lat]);
    const lon = nombre(l[c.lon]);
    if (!parc || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const puissance = c.puissance < 0 ? null : nombre(l[c.puissance]);
    return [
      {
        parc,
        ville: c.ville < 0 ? null : texte(l[c.ville]),
        niveau: c.niveau < 0 ? null : texte(l[c.niveau]),
        puissanceKw: puissance !== null && puissance > 0 && puissance < 2_000 ? puissance : null,
        lat,
        lon,
      },
    ];
  });
}

/** La distance à vol d'oiseau, en km (haversine). PURE. */
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Les parcs les plus proches du point, dans le rayon ; les bornes d'un même parc sur une ligne. PURE. */
export function bornesProches(bornes: readonly Borne[], point: Point, rayonKm = RAYON_KM, max = PARCS_MAX): Parc[] {
  const parcs = new Map<string, Parc>();
  for (const b of bornes) {
    const d = distanceKm(point, b);
    if (d > rayonKm) continue;
    const cle = `${b.parc}|${b.ville ?? ""}`;
    const p = parcs.get(cle) ?? { parc: b.parc, ville: b.ville, distanceKm: d, bornes: 0, niveaux: [], puissanceMaxKw: null };
    p.distanceKm = Math.min(p.distanceKm, d);
    p.bornes++;
    if (b.niveau && !p.niveaux.includes(b.niveau)) p.niveaux.push(b.niveau);
    if (b.puissanceKw !== null) p.puissanceMaxKw = Math.max(p.puissanceMaxKw ?? 0, b.puissanceKw);
    parcs.set(cle, p);
  }
  return [...parcs.values()]
    .map((p) => ({ ...p, niveaux: [...p.niveaux].sort() }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.parc.localeCompare(b.parc))
    .slice(0, max);
}

export interface SourceBornes {
  lire(maintenant: Date, point: Point | null): Promise<LectureBornes>;
}

interface Fichier {
  texte: string;
  modifieLe: string | null;
}

/**
 * Le fichier du Circuit électrique derrière un cache en base (`monde_cache`) : le cache garde les
 * parcs proches, pas le fichier. Une panne (réseau, délai, taille, forme) rend « indisponible ».
 */
export function sourceBornes(db: Base, lireFichier: (url: string, signal: AbortSignal) => Promise<Fichier> = lireCsv): SourceBornes {
  return {
    async lire(maintenant, point) {
      if (!point) return { ok: false, raison: "sans-position" };
      const cle = `bornes|${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
      const [cache] = await db.select().from(schema.mondeCache).where(eq(schema.mondeCache.cle, cle));
      if (cache && maintenant.getTime() - cache.luLe.getTime() < FRAICHEUR_MS) {
        return { ok: true, bornes: JSON.parse(cache.corps) as Bornes };
      }
      let fichier: Fichier;
      try {
        fichier = await lireFichier(URL_BORNES, AbortSignal.timeout(DELAI_MS));
      } catch (err) {
        console.warn(`[monde_bornes] Circuit électrique injoignable : ${err instanceof Error ? err.name : "erreur"}`);
        return { ok: false, raison: "indisponible" };
      }
      const toutes = lireCsvBornes(fichier.texte);
      if (!toutes) {
        console.warn("[monde_bornes] fichier du Circuit électrique de forme inattendue");
        return { ok: false, raison: "indisponible" };
      }
      const modifie = fichier.modifieLe ? Date.parse(fichier.modifieLe) : Number.NaN;
      const bornes: Bornes = { fichierLe: Number.isNaN(modifie) ? null : new Date(modifie).toISOString(), parcs: bornesProches(toutes, point) };
      const corps = JSON.stringify(bornes);
      await db
        .insert(schema.mondeCache)
        .values({ cle, corps, luLe: maintenant })
        .onConflictDoUpdate({ target: schema.mondeCache.cle, set: { corps, luLe: maintenant } });
      return { ok: true, bornes };
    },
  };
}

async function lireCsv(url: string, signal: AbortSignal): Promise<Fichier> {
  const r = await fetch(url, { signal, headers: { accept: "text/csv, application/csv" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const taille = Number(r.headers.get("content-length") ?? 0);
  if (taille > TAILLE_MAX) throw new Error("trop grand");
  const texte = await r.text();
  if (texte.length > TAILLE_MAX) throw new Error("trop grand");
  return { texte, modifieLe: r.headers.get("last-modified") };
}
