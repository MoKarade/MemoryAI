// lib/accueil/decor.ts — le décor de la maison de LIA (maquette v5, fonction `decor`) : la lumière du
// haut, le sol en perspective, le tapis rond qui marque l'heure, la poussière. Peint sur un contexte
// 2D reçu ; les couleurs arrivent des jetons (`--accent`, `--texte`), la transparence par
// `globalAlpha` : aucune couleur n'est écrite ici (`tests/couleurs.test.ts`).
// `maintenant` est passé (et non lu) pour que le tapis soit testable à une heure donnée.

import type { Orbite } from "./orbite";

/** Le sous-ensemble du contexte 2D employé : un faux le remplace dans les tests. */
export type Pinceau = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "createRadialGradient" | "fillRect" | "beginPath" | "moveTo" | "lineTo" | "stroke" | "save" | "restore" | "translate" | "scale" | "arc" | "fill"
> & { globalAlpha: number; fillStyle: unknown; strokeStyle: unknown; lineWidth: number };

/** L'heure du tapis allumée : celle dont la graduation est à moins d'une demi-heure de `heure`. */
export function heureAllumee(h: number, heure: number): boolean {
  return Math.abs(((heure - h + 36) % 24) - 12) < 0.5;
}

/** Le sol, le tapis des heures, la lumière et la poussière (repris de la maquette, `decor`). */
export function peindreDecor(c: Pinceau, L: number, H: number, o: Orbite, t: number, accent: string, texte: string, maintenant: Date = new Date()) {
  c.clearRect(0, 0, L, H);
  const lumiere = c.createRadialGradient(L / 2, -H * 0.1, 0, L / 2, -H * 0.1, H * 1.05);
  lumiere.addColorStop(0, accent);
  lumiere.addColorStop(1, "transparent");
  c.globalAlpha = 0.14;
  c.fillStyle = lumiere;
  c.fillRect(0, 0, L, H);
  const horizon = H * 0.46;
  c.strokeStyle = accent;
  c.lineWidth = 1;
  for (let i = 1; i <= 14; i++) {
    const u = i / 14;
    const y = horizon + Math.pow(u, 2.1) * (H - horizon);
    c.globalAlpha = 0.02 + 0.07 * u;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(L, y);
    c.stroke();
  }
  for (let i = -14; i <= 14; i++) {
    c.globalAlpha = 0.07 * (1 - Math.abs(i) / 16);
    c.beginPath();
    c.moveTo(L / 2 + i * 8, horizon);
    c.lineTo(L / 2 + i * L * 0.12, H);
    c.stroke();
  }
  // Le tapis : vingt-quatre heures, l'heure courante en plein.
  const ex = o.cx;
  const ey = o.cy + o.rayon * 0.62;
  const rx = o.rayon * 2.15;
  const ry = o.rayon * 0.66;
  c.save();
  c.translate(ex, ey);
  c.scale(1, ry / rx);
  const tapis = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  tapis.addColorStop(0, accent);
  tapis.addColorStop(1, "transparent");
  c.globalAlpha = 0.16;
  c.fillStyle = tapis;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.16;
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, 0, rx * 0.98, 0, Math.PI * 2);
  c.stroke();
  const heure = maintenant.getHours() + maintenant.getMinutes() / 60;
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const actuelle = heureAllumee(h, heure);
    const r1 = rx * (actuelle ? 1.06 : h % 6 === 0 ? 0.99 : 0.95);
    c.globalAlpha = actuelle ? 0.95 : h % 6 === 0 ? 0.4 : 0.2;
    c.lineWidth = actuelle ? 3 : 1.4;
    c.beginPath();
    c.moveTo(Math.cos(a) * rx * 0.9, Math.sin(a) * rx * 0.9);
    c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    c.stroke();
  }
  c.restore();
  // La poussière dans la lumière.
  c.fillStyle = texte;
  for (let i = 0; i < 60; i++) {
    const h = (k: number) => {
      const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const v = 0.005 + h(4) * 0.012;
    const x = ((h(1) + Math.sin(t * v * 6 + h(5) * 6.28) * 0.015 + 1) % 1) * L;
    const y = ((h(2) - t * v * 0.6 + 1000) % 1) * H;
    c.globalAlpha = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(t * 0.7 + h(5) * 6.28));
    c.beginPath();
    c.arc(x, y, 0.5 + h(3) * 1.3, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}
