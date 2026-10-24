// lib/accueil/orbite.ts — la géométrie de la maison de LIA (MemoryAI#74, maquette v5) : elle au
// centre, les espaces sur une ellipse qui tourne lentement. PUR : aucune lecture du DOM, aucune
// horloge ; le client passe la taille de l'écran et l'angle courant.
//
// Les formules sont celles de la maquette validée par Marc (fonction `dims`) : un écran étroit
// (< 900 px) resserre l'ellipse en largeur et l'allonge en hauteur pour garder huit cibles de
// 60 px sans chevauchement.

export interface Orbite {
  /** Centre de la maison, en pixels CSS. */
  cx: number;
  cy: number;
  /** Demi-axes de l'ellipse des espaces. */
  rx: number;
  ry: number;
  /** Rayon du corps de LIA au repos. */
  rayon: number;
}

export const LARGEUR_ETROITE = 900;

const borne = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function orbite(largeur: number, hauteur: number): Orbite {
  const L = Math.max(1, largeur);
  const H = Math.max(1, hauteur);
  const etroit = L < LARGEUR_ETROITE;
  return {
    cx: L / 2,
    cy: H / 2,
    rx: etroit ? Math.min(L * 0.36, 150) : Math.min(L * 0.31, 380),
    ry: etroit ? Math.min(H * 0.3, 250) : Math.min(H * 0.34, 310),
    rayon: Math.round(borne(Math.min(L, H) * 0.2, 56, 176)),
  };
}

/**
 * La place de chaque espace : le premier en haut, puis dans le sens des aiguilles d'une montre,
 * à intervalles égaux, décalés de `rotation` (radians).
 */
export function placerEspaces(n: number, rotation: number, o: Orbite): { x: number; y: number }[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + rotation;
    return { x: o.cx + o.rx * Math.cos(a), y: o.cy + o.ry * Math.sin(a) };
  });
}

/**
 * La zone où LIA erre. Au repos : le cœur de l'orbite, jamais sur les espaces. Panneau ouvert :
 * la place qu'il laisse (à gauche sur PC, en haut sur téléphone), comme dans la maquette.
 */
export function zoneDeVie(o: Orbite, panneauOuvert = false): { x: number; y: number; w: number; h: number } {
  if (panneauOuvert) {
    const L = o.cx * 2;
    const H = o.cy * 2;
    return L >= LARGEUR_ETROITE ? { x: 0, y: 0, w: L - Math.min(640, L * 0.56) - 28, h: H } : { x: 0, y: 0, w: L, h: H * 0.32 };
  }
  const w = Math.max(o.rayon * 2.4, o.rx * 1.1);
  const h = Math.max(o.rayon * 2.4, o.ry * 1.1);
  return { x: o.cx - w / 2, y: o.cy - h / 2, w, h };
}

/** Vitesse de rotation de l'orbite (radians par seconde) : un tour en trois minutes environ. */
export const VITESSE_ORBITE = 0.035;
