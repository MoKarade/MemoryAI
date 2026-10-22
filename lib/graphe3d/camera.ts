// lib/graphe3d/camera.ts — la caméra du graphe 3D : projection en perspective, tri du peintre,
// point sous le doigt. PUR : le composant `components/Graphe3D.tsx` dessine, ce module calcule.

import type { Point3 } from "@/lib/graphe3d/disposer";

export interface Camera {
  /** Rotation autour de l'axe vertical, en radians. */
  lacet: number;
  /** Inclinaison, bornée à ±1,35 rad pour ne jamais passer « par-dessus ». */
  tangage: number;
  zoom: number;
}

export const TANGAGE_MAX = 1.35;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

export interface Projete {
  x: number;
  y: number;
  /** Facteur de perspective : > 1 devant, < 1 derrière. Multiplie les rayons. */
  echelle: number;
  /** Profondeur après rotation : sert au tri du peintre et à l'atténuation. */
  z: number;
}

export const borner = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Projette chaque point dans un cadre de `largeur` × `hauteur` px, centre au milieu. */
export function projeter(points: readonly Point3[], c: Camera, largeur: number, hauteur: number, rayon = 1): Projete[] {
  const cy = Math.cos(c.lacet);
  const sy = Math.sin(c.lacet);
  const cp = Math.cos(c.tangage);
  const sp = Math.sin(c.tangage);
  const focale = (Math.min(largeur, hauteur * 1.25) * 0.5 * c.zoom) / rayon;
  const recul = 3.4 * rayon;
  return points.map((p) => {
    const x1 = cy * p.x + sy * p.z;
    const z1 = -sy * p.x + cy * p.z;
    const y1 = cp * p.y - sp * z1;
    const z2 = sp * p.y + cp * z1;
    const k = recul / (recul - z2);
    return { x: largeur / 2 + x1 * focale * k, y: hauteur / 2 + y1 * focale * k, echelle: k, z: z2 };
  });
}

/** Les indices du plus lointain au plus proche : on peint le fond d'abord. */
export function ordreDuPeintre(p: readonly Projete[]): number[] {
  return p.map((_, i) => i).sort((a, b) => p[a]!.z - p[b]!.z);
}

/**
 * Le nœud sous le point (mx, my), ou -1. Zone de toucher d'au moins 9 px de rayon : un doigt
 * rate un point de 3 px. À distance égale, le plus proche de la caméra gagne.
 */
export function trouver(p: readonly Projete[], rayons: readonly number[], mx: number, my: number, visible: (i: number) => boolean = () => true): number {
  let meilleur = -1;
  let dMin = Infinity;
  for (let i = 0; i < p.length; i++) {
    if (!visible(i)) continue;
    const q = p[i]!;
    const r = Math.max(9, (rayons[i] ?? 3) * q.echelle + 5);
    const d = (q.x - mx) ** 2 + (q.y - my) ** 2;
    if (d > r * r) continue;
    const devant = meilleur >= 0 && q.z > p[meilleur]!.z + 0.05;
    if (d < dMin || (devant && d < dMin * 1.6)) {
      dMin = d;
      meilleur = i;
    }
  }
  return meilleur;
}

/** Le lacet qui amène `p` face à la caméra par le plus court chemin depuis `depuis`. */
export function lacetVers(p: Point3, depuis: number): number {
  let cible = -Math.atan2(p.x, p.z);
  while (cible - depuis > Math.PI) cible -= 2 * Math.PI;
  while (cible - depuis < -Math.PI) cible += 2 * Math.PI;
  return cible;
}
