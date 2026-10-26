// lib/memoire/reseau.ts — la mémoire en réseau 3D pour la page Mémoire (MemoryAI#74). PUR.
//
// Un point par fait validé, un centre par domaine (`emploi`, `logement`…), un trait par lien
// des règles (`lib/graphe.ts`). Couleur = niveau du fait (N0 à N3).
//
// ⚠️ AUCUNE VALEUR DE FAIT ICI, seulement des prédicats : le réseau montre la STRUCTURE de la
// mémoire. Depuis le 26/10/2026 (tâche MemoryAI 323), la carte d'un point ne mène plus à
// l'ancienne fiche `/fait/[id]` : elle liste les faits auquel il est relié (`voisinsDe`).
//
// ⚠️ ON BORNE, ET ON LE DIT. Au-delà de `MAX_NOEUDS_3D`, on garde les faits les plus reliés
// (les autres n'ont rien à montrer dans un réseau) et `omis` compte le reste.

import { ancresSphere, disposer, MAX_NOEUDS_3D, type Arete, type NoeudADisposer, type Point3 } from "@/lib/graphe3d/disposer";

export interface FaitReseau {
  id: string;
  predicat: string;
  niveau: number;
}

export interface LienReseau {
  faitA: string;
  faitB: string;
  poids: number;
}

interface NoeudReseau {
  /** L'id du fait ; `null` pour un centre de domaine. */
  id: string | null;
  pos: Point3;
  jeton: string;
  rayon: number;
  etiquette: string;
  centre: boolean;
  domaine: string;
  niveau: number | null;
  degre: number;
}

export interface Reseau {
  noeuds: NoeudReseau[];
  aretes: [number, number, number][];
  domaines: string[];
  omis: number;
}

/** Couleur d'un niveau : le même code partout (pastilles, réseau, légende). */
export const JETON_NIVEAU: Readonly<Record<number, string>> = {
  0: "--succes-texte",
  1: "--accent",
  2: "--alerte-texte",
  3: "--erreur-texte",
};

export const domaineDe = (predicat: string) => predicat.split(".")[0] || predicat;
const etiquetteDe = (predicat: string) => predicat.split(".").slice(1).join(".") || predicat;

export function construireReseau(faits: readonly FaitReseau[], liens: readonly LienReseau[], max = MAX_NOEUDS_3D): Reseau {
  const degre = new Map<string, number>();
  for (const l of liens) {
    degre.set(l.faitA, (degre.get(l.faitA) ?? 0) + 1);
    degre.set(l.faitB, (degre.get(l.faitB) ?? 0) + 1);
  }
  // Tri stable : les plus reliés d'abord, puis l'ordre du prédicat et de l'id (même mémoire,
  // même choix).
  const tries = [...faits].sort(
    (a, b) => (degre.get(b.id) ?? 0) - (degre.get(a.id) ?? 0) || a.predicat.localeCompare(b.predicat) || a.id.localeCompare(b.id),
  );
  const domaines = [...new Set(tries.map((f) => domaineDe(f.predicat)))].sort();
  const places = Math.max(0, max - domaines.length);
  const gardes = tries.slice(0, places);
  const indexDomaine = new Map(domaines.map((d, i) => [d, i]));
  const ancres = ancresSphere(domaines.length);

  const aDisposer: NoeudADisposer[] = [
    ...domaines.map((_, k) => ({ groupe: k, fixe: ancres[k] })),
    ...gardes.map((f) => ({ groupe: indexDomaine.get(domaineDe(f.predicat)) ?? 0 })),
  ];
  const indexFait = new Map(gardes.map((f, i) => [f.id, domaines.length + i]));
  const aretes: [number, number, number][] = [];
  // Chaque fait tient à son domaine : sans ce fil, un fait sans lien flotterait loin de tout.
  gardes.forEach((f, i) => aretes.push([indexDomaine.get(domaineDe(f.predicat)) ?? 0, domaines.length + i, 0.4]));
  for (const l of liens) {
    const a = indexFait.get(l.faitA);
    const b = indexFait.get(l.faitB);
    if (a !== undefined && b !== undefined) aretes.push([a, b, l.poids]);
  }
  const pos = disposer(aDisposer, aretes as Arete[], { ancres });

  const noeuds: NoeudReseau[] = [
    ...domaines.map((d, k) => ({
      id: null,
      pos: pos[k]!,
      jeton: "--repere",
      rayon: 7,
      etiquette: d,
      centre: true,
      domaine: d,
      niveau: null,
      degre: gardes.filter((f) => domaineDe(f.predicat) === d).length,
    })),
    ...gardes.map((f, i) => ({
      id: f.id,
      pos: pos[domaines.length + i]!,
      jeton: JETON_NIVEAU[f.niveau] ?? "--texte-doux",
      rayon: 2.6 + Math.min(3, (degre.get(f.id) ?? 0) * 0.4),
      etiquette: etiquetteDe(f.predicat),
      centre: false,
      domaine: domaineDe(f.predicat),
      niveau: f.niveau,
      degre: degre.get(f.id) ?? 0,
    })),
  ];
  return { noeuds, aretes, domaines, omis: faits.length - gardes.length };
}

/** Un fait relié au point choisi : son rang dans `Reseau.noeuds`, de quoi le nommer, et la force du lien. */
export interface Voisin {
  index: number;
  etiquette: string;
  domaine: string;
  poids: number;
}

/**
 * Les faits reliés au point `i`, du lien le plus fort au plus faible (puis par étiquette). Les
 * fils vers les centres de domaine ne comptent pas : ce sont des attaches du dessin, pas des liens
 * de la mémoire. Un centre n'a pas de voisins au sens des liens, donc `[]`. Structurel : aucune
 * valeur de fait.
 */
export function voisinsDe(r: Pick<Reseau, "noeuds" | "aretes">, i: number): Voisin[] {
  if (r.noeuds[i]?.centre !== false) return [];
  const force = new Map<number, number>();
  for (const [a, b, poids] of r.aretes) {
    const autre = a === i ? b : b === i ? a : -1;
    if (r.noeuds[autre]?.centre !== false) continue;
    force.set(autre, Math.max(force.get(autre) ?? 0, poids));
  }
  return [...force]
    .map(([index, poids]) => ({ index, etiquette: r.noeuds[index]!.etiquette, domaine: r.noeuds[index]!.domaine, poids }))
    .sort((x, y) => y.poids - x.poids || x.etiquette.localeCompare(y.etiquette) || x.index - y.index);
}

/**
 * Ce que montrent les filtres de la page : un niveau décoché éteint ses faits, une recherche
 * garde les faits dont l'étiquette ou le domaine la contient. Un centre de domaine reste
 * toujours allumé : c'est le repère qui dit où l'on est.
 */
export function filtrerVisibles(noeuds: readonly Pick<NoeudReseau, "centre" | "niveau" | "etiquette" | "domaine">[], niveaux: ReadonlySet<number>, recherche: string): boolean[] {
  const q = recherche.trim().toLowerCase();
  return noeuds.map(
    (n) => n.centre || ((n.niveau === null || niveaux.has(n.niveau)) && (!q || n.etiquette.toLowerCase().includes(q) || n.domaine.includes(q))),
  );
}
