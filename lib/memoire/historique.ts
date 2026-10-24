// lib/memoire/historique.ts — l'onglet Historique de la page Mémoire (MemoryAI#74, maquette v5) :
// ce que LIA a écrit, lu et dépensé, jour par jour. Fonctions pures ; les lectures vivent dans
// `lib/memoire/depotHistorique.ts`.
//
// ⚠️ NO FAKE DATA : la maquette dessine aussi son humeur sur 14 jours et ses relances. Rien de
// cela n'est mesuré aujourd'hui (l'humeur de `lia-ui` n'est pas enregistrée) : ces tuiles sont
// dessinées VIDES, à leur place, et le disent (règle de Marc du 23/10), jamais remplies au jugé.

import { ligneLecture, type Corps } from "@/lib/accueil/tableaux";
import { FUSEAU } from "@/lib/fuseau";

/** Les jours `AAAA-MM-JJ` de la fenêtre, du plus ancien à `aujourdhui` compris. */
export function joursFenetre(aujourdhui: string, n: number): string[] {
  const fin = Date.parse(`${aujourdhui}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(fin - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Une série complète sur la fenêtre : un jour sans ligne en base vaut 0 (rien ce jour-là),
 * pas un trou. Les jours hors fenêtre sont ignorés.
 */
export function serieJours(comptes: readonly { jour: string; n: number }[], aujourdhui: string, n: number): { jour: string; n: number }[] {
  const par = new Map(comptes.map((c) => [c.jour, c.n]));
  return joursFenetre(aujourdhui, n).map((jour) => ({ jour, n: par.get(jour) ?? 0 }));
}

export interface GrilleEcritures {
  /** `semaines[s][j]` : le compte du jour `j` (0 = lundi) de la semaine `s`, `null` après aujourd'hui. */
  semaines: (number | null)[][];
  max: number;
  total: number;
}

/** La grille des écritures, une colonne par semaine (lundi en haut), la dernière finit aujourd'hui. */
export function grilleEcritures(comptes: readonly { jour: string; n: number }[], aujourdhui: string, nSemaines: number): GrilleEcritures {
  // Lundi = 0 : `getUTCDay` rend 0 pour dimanche.
  const jourSemaine = (new Date(`${aujourdhui}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nJours = (nSemaines - 1) * 7 + jourSemaine + 1;
  const serie = serieJours(comptes, aujourdhui, nJours);
  const semaines: (number | null)[][] = [];
  for (let s = 0; s < nSemaines; s++) {
    semaines.push(Array.from({ length: 7 }, (_, j) => serie[s * 7 + j]?.n ?? null));
  }
  const valeurs = serie.map((x) => x.n);
  return { semaines, max: Math.max(0, ...valeurs), total: valeurs.reduce((a, b) => a + b, 0) };
}

/** Les sources de conversation, en mots (`lib/db/schema.ts`, `SOURCES_CONVERSATION`). */
export const LIBELLE_SOURCE: Record<string, string> = {
  memoryai: "Ici, avec LIA",
  "claude-ai": "Claude",
  "claude-code": "Claude Code",
};

/** Le filtre de « Ce qu'elle a fait » (maquette). Seul « Fait » a une source : le journal d'accès. */
export const FILTRES_FAIT = [
  { cle: "tous", libelle: "Tout" },
  { cle: "fait", libelle: "Fait" },
  { cle: "plus-tard", libelle: "Plus tard" },
  { cle: "refuse", libelle: "Refusé" },
] as const;
export type FiltreFait = (typeof FILTRES_FAIT)[number]["cle"];

export function lireFiltreFait(brut: unknown): FiltreFait {
  return FILTRES_FAIT.find((f) => f.cle === brut)?.cle ?? "tous";
}

/** Ce qu'elle a fait : ses dernières lectures (le journal), ou ce que le filtre ne sait pas encore. */
export function corpsCeQuElleAFait(lectures: readonly { ts: Date; lecteur: string; outil: string }[], filtre: FiltreFait): Corps {
  if (filtre === "plus-tard") return { genre: "vide", texte: "Rien de remis à plus tard : elle ne note pas encore ce qu'elle reporte." };
  if (filtre === "refuse") return { genre: "vide", texte: "Rien de refusé : elle ne note pas encore ce qu'on lui refuse." };
  if (lectures.length === 0) return { genre: "vide", texte: "Elle n'a encore rien lu dans la mémoire." };
  return { genre: "liste", elements: lectures.map(ligneLecture) };
}

// Midi UTC tombe le même jour à Québec : le jour affiché est bien celui de la clé.
const JOUR_MOIS = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", timeZone: FUSEAU });

export interface Journee {
  jour: string;
  /** « 22 oct. » */
  etiquette: string;
  lectures: number;
  /** En $ US, tous postes confondus. */
  depense: number;
}

/** Ses journées, la plus récente d'abord : lectures et dépense de chaque jour de la fenêtre. */
export function journees(jours: readonly string[], lectures: readonly { jour: string; n: number }[], depenseParJour: ReadonlyMap<string, number>): Journee[] {
  const lu = new Map(lectures.map((l) => [l.jour, l.n]));
  return [...jours].reverse().map((jour) => ({
    jour,
    etiquette: JOUR_MOIS.format(new Date(`${jour}T12:00:00Z`)),
    lectures: lu.get(jour) ?? 0,
    depense: depenseParJour.get(jour) ?? 0,
  }));
}

/** Ce qu'elle a corrigé : les faits périmés, nommés par leur prédicat, jamais leur valeur. */
export function corpsCorrections(lignes: readonly { predicat: string }[]): Corps {
  if (lignes.length === 0) return { genre: "vide", texte: "Aucun fait corrigé pour l'instant." };
  return { genre: "liste", elements: lignes.map((l) => ({ libelle: l.predicat, detail: "remplacé par une valeur plus récente, ou dépassé" })) };
}
