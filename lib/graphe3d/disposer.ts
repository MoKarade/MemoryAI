// lib/graphe3d/disposer.ts — placer un graphe en 3D (page Mémoire et réseau de LIA, MemoryAI#74).
// PUR : ni DOM, ni horloge. L'aléa vient d'une graine, donc les mêmes entrées donnent toujours
// la même image.
//
// ⚠️ DES FORCES, MAIS DÉTERMINISTES. `lib/grapheDisposition.ts` a refusé les forces parce
// qu'un layout à forces change d'image à chaque affichage (Marc ne peut pas dire « le nœud d'en
// haut » deux fois). Ici la graine fixe le point de départ et le nombre d'itérations est fixe :
// même mémoire, même nuage. Ce qui bouge à l'écran, c'est la caméra, jamais les nœuds.
//
// ⚠️ C'EST QUADRATIQUE (chaque paire se repousse). Au-delà de quelques centaines de nœuds le
// calcul se compte en secondes : l'appelant borne, et le dit (`MAX_NOEUDS_3D`).

export const MAX_NOEUDS_3D = 400;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface NoeudADisposer {
  /** Le groupe : les nœuds d'un groupe sont tirés vers la même ancre. */
  groupe: number;
  /** Déjà placé et immobile (un centre, une source). */
  fixe?: Point3;
}

/** [i, j, poids]. Le poids règle la raideur du ressort, 1 par défaut. */
export type Arete = readonly [number, number, number?];

export interface OptionsDisposition {
  graine?: number;
  iterations?: number;
  /** Une ancre par groupe ; un groupe sans ancre est tiré vers l'origine. */
  ancres?: readonly Point3[];
}

/** Générateur de Park et Miller : simple, reproductible, assez bon pour disperser des points. */
export function generateur(graine: number): () => number {
  let s = Math.max(1, Math.floor(Math.abs(graine)) % 2147483647);
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Des ancres de groupe régulièrement réparties sur une sphère (spirale de Fibonacci). */
export function ancresSphere(n: number, rayon = 0.62): Point3[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, z: 0 }];
  const or = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * i) / (n - 1);
    const r = Math.sqrt(1 - y * y);
    return { x: Math.cos(or * i) * r * rayon, y: y * rayon, z: Math.sin(or * i) * r * rayon };
  });
}

/**
 * Rend une position par nœud. Répulsion entre voisins proches, ressorts sur les arêtes,
 * attraction vers l'ancre du groupe, léger rappel vers l'origine ; le pas refroidit.
 */
export function disposer(noeuds: readonly NoeudADisposer[], aretes: readonly Arete[], o: OptionsDisposition = {}): Point3[] {
  const n = noeuds.length;
  const alea = generateur(o.graine ?? 7);
  const iterations = o.iterations ?? 220;
  const ancres = o.ancres ?? [];
  const p: Point3[] = noeuds.map((nd) => {
    if (nd.fixe) return { ...nd.fixe };
    const a = ancres[nd.groupe] ?? { x: 0, y: 0, z: 0 };
    return { x: a.x + (alea() - 0.5) * 0.5, y: a.y + (alea() - 0.5) * 0.5, z: a.z + (alea() - 0.5) * 0.5 };
  });
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const vz = new Float64Array(n);
  const libre = (i: number) => !noeuds[i]?.fixe;
  const pas = (v: number) => Math.max(-0.05, Math.min(0.05, v));

  for (let it = 0; it < iterations; it++) {
    const refroidi = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      if (!libre(i)) continue;
      const a = p[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = p[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.0004;
        if (d2 > 0.9) continue;
        const f = 0.0016 / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        dz /= d;
        vx[i]! += dx * f;
        vy[i]! += dy * f;
        vz[i]! += dz * f;
        if (libre(j)) {
          vx[j]! -= dx * f;
          vy[j]! -= dy * f;
          vz[j]! -= dz * f;
        }
      }
      const ancre = ancres[noeuds[i]!.groupe];
      if (ancre) {
        vx[i]! += (ancre.x - a.x) * 0.012;
        vy[i]! += (ancre.y - a.y) * 0.012;
        vz[i]! += (ancre.z - a.z) * 0.012;
      }
      vx[i]! -= a.x * 0.004;
      vy[i]! -= a.y * 0.004;
      vz[i]! -= a.z * 0.004;
    }
    for (const [i, j, w = 1] of aretes) {
      const a = p[i];
      const b = p[j];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      const f = (d - 0.16) * 0.02 * w;
      if (libre(i)) {
        vx[i]! += (dx / d) * f;
        vy[i]! += (dy / d) * f;
        vz[i]! += (dz / d) * f;
      }
      if (libre(j)) {
        vx[j]! -= (dx / d) * f;
        vy[j]! -= (dy / d) * f;
        vz[j]! -= (dz / d) * f;
      }
    }
    for (let i = 0; i < n; i++) {
      if (!libre(i)) continue;
      const a = p[i]!;
      a.x += pas(vx[i]!) * refroidi;
      a.y += pas(vy[i]!) * refroidi;
      a.z += pas(vz[i]!) * refroidi;
      vx[i]! *= 0.55;
      vy[i]! *= 0.55;
      vz[i]! *= 0.55;
    }
  }
  return p;
}
