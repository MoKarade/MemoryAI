// lib/memoire/tuilesMemoire.ts — les tuiles de l'onglet Mémoire autour du réseau (maquette v5,
// écart C) : Thèmes et Sources. PUR : la page lit la base, ce module compose, `CorpsTuile` dessine.
//
// ⚠️ Des COMPTES et des dates, jamais une valeur de fait : comme le réseau, ces tuiles montrent la
// forme de la mémoire, pas son contenu.

import type { Corps } from "@/lib/accueil/tableaux";
import type { SOURCES } from "@/lib/db/schema";
import { domaineDe } from "./reseau";

type Source = (typeof SOURCES)[number];

/** Les thèmes : un domaine (le préfixe du prédicat) et son nombre de faits validés, le plus gros d'abord. */
export function corpsThemes(faits: readonly { predicat: string }[]): Corps {
  const comptes = new Map<string, number>();
  for (const f of faits) comptes.set(domaineDe(f.predicat), (comptes.get(domaineDe(f.predicat)) ?? 0) + 1);
  const bulles = [...comptes].map(([libelle, valeur]) => ({ libelle, valeur })).sort((a, b) => b.valeur - a.valeur || a.libelle.localeCompare(b.libelle));
  if (bulles.length === 0) return { genre: "vide", texte: "Aucun fait validé : aucun thème pour l'instant." };
  return { genre: "bulles", bulles, resume: `Thèmes de la mémoire : ${bulles.map((b) => `${b.libelle} ${b.valeur}`).join(", ")}.` };
}

const LIBELLE_SOURCE: Record<Source, string> = { document: "Papiers", mail: "Courriels", app: "Apps", seed: "Amorce", marc: "Toi" };

/** Depuis quand, en mots courts : « 12 min », « 3 h », « 4 j ». */
export function depuis(quand: Date, maintenant: Date): string {
  const minutes = Math.max(0, Math.round((maintenant.getTime() - quand.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} j`;
}

/** Les sources : combien de faits validés chacune a apportés, et depuis quand la dernière. */
export function corpsSources(parSource: readonly { source: Source; n: number; dernier: Date | null }[], maintenant: Date): Corps {
  const lignes = parSource.filter((s) => s.n > 0).sort((a, b) => b.n - a.n);
  if (lignes.length === 0) return { genre: "vide", texte: "Aucune source n'a encore apporté de fait validé." };
  const max = lignes[0]?.n ?? 1;
  const libelle = (s: (typeof lignes)[number]) => LIBELLE_SOURCE[s.source] ?? s.source;
  return {
    genre: "barres",
    barres: lignes.map((s) => ({ libelle: libelle(s), valeur: s.dernier ? `${s.n.toLocaleString("fr-CA")} · ${depuis(s.dernier, maintenant)}` : s.n.toLocaleString("fr-CA"), part: s.n / max })),
    resume: `Faits validés par source : ${lignes.map((s) => `${libelle(s)} ${s.n}`).join(", ")}.`,
  };
}

