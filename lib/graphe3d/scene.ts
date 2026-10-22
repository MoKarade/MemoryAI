// lib/graphe3d/scene.ts — ce que le graphe 3D dessine et comment la caméra bouge, en fonctions
// PURES (MemoryAI#74). `components/Graphe3D.tsx` ne fait plus que peindre ce que ce module
// décide et brancher les gestes : la logique se teste sans canvas.

import { borner, lacetVers, TANGAGE_MAX, ZOOM_MAX, ZOOM_MIN, type Camera, type Projete } from "@/lib/graphe3d/camera";
import type { Arete, Point3 } from "@/lib/graphe3d/disposer";

interface Trait {
  a: number;
  b: number;
  alpha: number;
  /** Un trait qui touche le point choisi : plus épais, presque opaque. */
  touche: boolean;
}

interface PointPeint {
  i: number;
  alpha: number;
  rayon: number;
  /** Cerclé : le point choisi ou survolé. */
  cercle: boolean;
}

/** Centre (domaine), voisin du point choisi, ou point visé (survolé ou choisi). */
type SorteEtiquette = "centre" | "voisin" | "vise";

export interface Scene {
  traits: Trait[];
  points: PointPeint[];
  etiquettes: [number, SorteEtiquette][];
}

export interface EntreeScene {
  proj: readonly Projete[];
  /** Un indice par nœud, du plus lointain au plus proche (`ordreDuPeintre`). */
  ordre: readonly number[];
  aretes: readonly Arete[];
  rayons: readonly number[];
  centres: readonly boolean[];
  etiquetes: readonly boolean[];
  voisins: readonly ReadonlySet<number>[];
  vu: (i: number) => boolean;
  selection: number;
  survol: number;
}

/** Combien de voisins du point choisi reçoivent une étiquette : au-delà, elles se marchent dessus. */
export const MAX_ETIQUETTES_VOISINS = 15;

/** Les voisins d'un nœud, dans les deux sens : un lien n'a pas de direction à l'écran. */
export function voisinage(n: number, aretes: readonly Arete[]): Set<number>[] {
  const v = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b] of aretes) {
    v[a]?.add(b);
    v[b]?.add(a);
  }
  return v;
}

/**
 * La scène d'une image : quels traits, quels points, quelles étiquettes, à quelle opacité.
 * Rien n'est peint ici ; l'ordre des points est celui du peintre (du fond vers l'avant).
 */
export function composerScene(e: EntreeScene): Scene {
  const { proj, selection: sel, vu } = e;
  const proches = sel >= 0 ? new Set([sel, ...(e.voisins[sel] ?? [])]) : null;

  const traits: Trait[] = [];
  for (const [a, b, w = 1] of e.aretes) {
    const pa = proj[a];
    const pb = proj[b];
    if (!pa || !pb || !vu(a) || !vu(b)) continue;
    const touche = proches !== null && (a === sel || b === sel);
    const profondeur = 0.55 + 0.45 * (((pa.z + pb.z) / 2 + 1) / 2);
    let alpha = 0.2 * profondeur * Math.min(1, 0.25 + Math.abs(w) * 0.9);
    if (proches) alpha = touche ? 0.85 : alpha * 0.15;
    // Un trait presque invisible coûte un tracé pour rien.
    if (alpha < 0.015) continue;
    traits.push({ a, b, alpha, touche });
  }

  const points: PointPeint[] = [];
  const etiquettes: [number, SorteEtiquette][] = [];
  for (const i of e.ordre) {
    const p = proj[i];
    if (!p || !vu(i)) continue;
    let alpha = 0.9 * (0.5 + 0.5 * ((p.z + 1) / 2));
    if (proches) alpha = proches.has(i) ? Math.max(alpha, 0.95) : alpha * 0.18;
    points.push({ i, alpha, rayon: Math.max(0.8, (e.rayons[i] ?? 3) * p.echelle), cercle: i === sel || i === e.survol });
    // L'étiquette d'un centre reste lisible tant qu'il n'est ni derrière, ni éteint par un choix.
    if (e.centres[i] && e.etiquetes[i] && (!proches || proches.has(i)) && alpha > 0.3) etiquettes.push([i, "centre"]);
  }
  if (proches) {
    for (const i of [...proches].slice(0, MAX_ETIQUETTES_VOISINS)) if (i !== sel && vu(i)) etiquettes.push([i, "voisin"]);
  }
  if (e.survol >= 0) etiquettes.push([e.survol, "vise"]);
  if (sel >= 0) etiquettes.push([sel, "vise"]);
  // Une étiquette par nœud : la première sorte gagne (un centre voisin garde son style).
  const vues = new Set<number>();
  return { traits, points, etiquettes: etiquettes.filter(([i]) => (vues.has(i) ? false : (vues.add(i), true))) };
}

/** Accélère puis freine (quadratique) : u ∈ [0, 1] → [0, 1]. */
export const adoucir = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** Durée d'une bascule de caméra vers le point choisi, en ms. */
export const DUREE_BASCULE = 700;

interface Bascule {
  t0: number;
  de: number;
  vers: number;
  tDe: number;
  tVers: number;
}

/** Où la caméra doit aller pour mettre `p` face à soi, en partant de `lacet`. */
export function viser(p: Point3, lacet: number): { lacet: number; tangage: number } {
  const vers = lacetVers(p, lacet);
  const profondeur = Math.max(0.05, -Math.sin(vers) * p.x + Math.cos(vers) * p.z);
  return { lacet: vers, tangage: borner(Math.atan2(p.y, profondeur) * 0.6, -1.2, 1.2) };
}

export interface Mouvement {
  bascule: Bascule | null;
  vLacet: number;
  vTangage: number;
}

/**
 * Avance la caméra d'une image. Priorité : la bascule vers un point choisi, puis l'élan d'un
 * glissé, puis la rotation lente (seulement si rien n'est choisi, survolé ni tenu, et jamais
 * sous `prefers-reduced-motion`). Rend `true` si l'image a changé.
 */
export function avancer(cam: Camera, m: Mouvement, o: { maintenant: number; dt: number; tenu: boolean; calme: boolean; reduit: boolean }): boolean {
  if (m.bascule) {
    const b = m.bascule;
    const u = Math.min(1, (o.maintenant - b.t0) / DUREE_BASCULE);
    const e = adoucir(u);
    cam.lacet = b.de + (b.vers - b.de) * e;
    cam.tangage = b.tDe + (b.tVers - b.tDe) * e;
    if (u >= 1) m.bascule = null;
    return true;
  }
  if (!o.tenu && (Math.abs(m.vLacet) > 1e-4 || Math.abs(m.vTangage) > 1e-4)) {
    cam.lacet += m.vLacet;
    cam.tangage = borner(cam.tangage + m.vTangage, -TANGAGE_MAX, TANGAGE_MAX);
    m.vLacet *= 0.93;
    m.vTangage *= 0.93;
    return true;
  }
  if (!o.reduit && !o.tenu && o.calme) {
    cam.lacet += o.dt * 0.09;
    return true;
  }
  return false;
}

/** Tourne la caméra d'un glissé de (dx, dy) px et rend l'élan à garder au lâcher. */
export function glisser(cam: Camera, m: Mouvement, dx: number, dy: number, reduit: boolean): void {
  cam.lacet += dx * 0.008;
  cam.tangage = borner(cam.tangage + dy * 0.006, -TANGAGE_MAX, TANGAGE_MAX);
  m.vLacet = reduit ? 0 : dx * 0.0025;
  m.vTangage = reduit ? 0 : dy * 0.0018;
}

/** Multiplie le zoom, borné. */
export function zoomer(cam: Camera, facteur: number): void {
  cam.zoom = borner(cam.zoom * facteur, ZOOM_MIN, ZOOM_MAX);
}

/**
 * Une touche du clavier : flèches pour tourner, + et - pour zoomer, Échap pour ne plus rien
 * choisir. Rend `"rien"` si la touche ne concerne pas le graphe (le navigateur la garde).
 */
export function toucheClavier(cam: Camera, cle: string): "tourne" | "deselectionne" | "rien" {
  if (cle === "ArrowLeft") cam.lacet -= 0.12;
  else if (cle === "ArrowRight") cam.lacet += 0.12;
  else if (cle === "ArrowUp") cam.tangage = borner(cam.tangage - 0.1, -TANGAGE_MAX, TANGAGE_MAX);
  else if (cle === "ArrowDown") cam.tangage = borner(cam.tangage + 0.1, -TANGAGE_MAX, TANGAGE_MAX);
  else if (cle === "+" || cle === "=") zoomer(cam, 1.12);
  else if (cle === "-") zoomer(cam, 1 / 1.12);
  else if (cle === "Escape") return "deselectionne";
  else return "rien";
  return "tourne";
}

export interface Impulsion {
  /** L'arête parcourue. */
  k: number;
  /** Avancement sur l'arête, 0 à 1. */
  u: number;
  /** Vitesse, en arête par seconde. */
  v: number;
}

/**
 * Fait avancer les impulsions ; une impulsion arrivée repart d'une autre arête tirée par
 * `hasard` (injecté : `Math.random` au rendu, un générateur fixe en test).
 */
export function avancerImpulsions(train: Impulsion[], dt: number, nAretes: number, hasard: () => number): void {
  for (const q of train) {
    q.u += dt * q.v;
    if (q.u > 1) {
      q.k = Math.floor(hasard() * nAretes);
      q.u = 0;
    }
  }
}
