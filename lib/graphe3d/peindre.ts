// lib/graphe3d/peindre.ts — peindre une scène du graphe 3D sur un contexte 2D (MemoryAI#74).
//
// Le contexte est un `Pinceau`, la seule partie de `CanvasRenderingContext2D` dont on se sert :
// le rendu se teste avec un pinceau qui ENREGISTRE ses gestes, sans navigateur.
//
// ⚠️ AUCUNE COULEUR ICI : les couleurs arrivent déjà lues des jetons de `globals.css` par le
// composant ; la transparence passe par `globalAlpha`, jamais par une couleur composée.

import type { Projete } from "@/lib/graphe3d/camera";
import type { Arete } from "@/lib/graphe3d/disposer";
import type { Impulsion, Scene } from "@/lib/graphe3d/scene";

export type Pinceau = Pick<
  CanvasRenderingContext2D,
  | "globalAlpha"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "font"
  | "textAlign"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "stroke"
  | "fill"
  | "roundRect"
  | "measureText"
  | "fillText"
>;

export interface Palette {
  texte: string;
  doux: string;
  fond: string;
  lien: string;
  /** Une couleur par nœud. */
  noeuds: readonly string[];
}

interface EntreePeinture {
  scene: Scene;
  proj: readonly Projete[];
  palette: Palette;
  centres: readonly boolean[];
  rayons: readonly number[];
  etiquettes: readonly (string | undefined)[];
  aretes: readonly Arete[];
  impulsions: readonly Impulsion[];
  vu: (i: number) => boolean;
}

const TOUR = 2 * Math.PI;

export function peindreScene(g: Pinceau, e: EntreePeinture): void {
  const { proj, palette } = e;

  g.lineCap = "round";
  g.strokeStyle = palette.lien;
  for (const t of e.scene.traits) {
    const pa = proj[t.a];
    const pb = proj[t.b];
    if (!pa || !pb) continue;
    g.globalAlpha = t.alpha;
    g.lineWidth = t.touche ? 1.6 : 0.7;
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
  }

  // Les impulsions : un point qui court le long d'un lien, et s'éteint aux deux bouts.
  g.fillStyle = palette.texte;
  for (const q of e.impulsions) {
    const [a, b] = e.aretes[q.k] ?? [0, 0];
    const pa = proj[a];
    const pb = proj[b];
    if (!pa || !pb || !e.vu(a) || !e.vu(b)) continue;
    g.globalAlpha = 0.85 * Math.sin(Math.PI * q.u);
    g.beginPath();
    g.arc(pa.x + (pb.x - pa.x) * q.u, pa.y + (pb.y - pa.y) * q.u, 1.6 * pa.echelle, 0, TOUR);
    g.fill();
  }

  for (const pt of e.scene.points) {
    const p = proj[pt.i];
    if (!p) continue;
    const couleur = palette.noeuds[pt.i] ?? palette.doux;
    g.fillStyle = couleur;
    g.strokeStyle = couleur;
    g.beginPath();
    g.arc(p.x, p.y, pt.rayon, 0, TOUR);
    if (e.centres[pt.i]) {
      // Un centre est un anneau sur un disque pâle : on le reconnaît sans lire l'étiquette.
      g.globalAlpha = pt.alpha * 0.25;
      g.fill();
      g.globalAlpha = pt.alpha;
      g.lineWidth = 1.6;
      g.stroke();
    } else {
      g.globalAlpha = pt.alpha;
      g.fill();
    }
    if (pt.cercle) {
      g.globalAlpha = 0.9;
      g.strokeStyle = palette.texte;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(p.x, p.y, pt.rayon + 4, 0, TOUR);
      g.stroke();
    }
  }

  // Les étiquettes en pilule sur le fond : lisibles par-dessus les traits.
  g.font = '600 11px "Outfit Variable", system-ui, sans-serif';
  g.textAlign = "center";
  for (const [i, sorte] of e.scene.etiquettes) {
    const texte = e.etiquettes[i];
    const p = proj[i];
    if (!texte || !p) continue;
    const y = p.y - (e.rayons[i] ?? 3) * p.echelle - 7;
    const w = g.measureText(texte).width + 12;
    g.globalAlpha = 0.82;
    g.fillStyle = palette.fond;
    g.beginPath();
    g.roundRect(p.x - w / 2, y - 13, w, 17, 8);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = sorte === "voisin" ? palette.doux : palette.texte;
    g.fillText(texte, p.x, y);
  }
  g.globalAlpha = 1;
}
