// lib/grapheDisposition.ts — où placer les nœuds et comment tracer les traits. PURE :
// aucune horloge, aucun aléa, aucun DOM. Les mêmes entrées donnent toujours la même image.
//
// ⚠️ PAS DE SIMULATION DE FORCES, ET C'EST UN CHOIX. Un layout à forces est joli et
// NON DÉTERMINISTE : deux affichages du même graphe donnent deux images, on ne peut pas le
// tester, et Marc ne peut pas dire « le nœud d'en haut à gauche » deux fois de suite. Ici les
// nœuds sont posés sur un CERCLE, groupés par domaine, dans un ordre stable — la position
// d'un fait ne bouge que si la mémoire change.
//
// ⚠️ ET ON BORNE. Au-delà de `MAX_NOEUDS`, un cercle devient une couronne de texte illisible :
// on garde les faits les plus CONNECTÉS (ceux qui portent le plus de liens — les autres n'ont
// rien à montrer dans un graphe), et on DIT combien sont laissés de côté. La liste en dessous,
// elle, reste complète : le dessin est un résumé, jamais la source.

export const MAX_NOEUDS = 48;

export interface NoeudEntree {
  id: string;
  domaine: string;
  /** Ce qui s'écrit à côté du point. Jamais une VALEUR de fait — un prédicat. */
  etiquette: string;
}

export interface LienEntree {
  faitA: string;
  faitB: string;
  type: string;
  poids: number;
}

export interface NoeudPlace extends NoeudEntree {
  x: number;
  y: number;
  /** L'angle sur le cercle, en radians — sert à orienter l'étiquette vers l'extérieur. */
  angle: number;
  degre: number;
}

export interface TraitPlace {
  faitA: string;
  faitB: string;
  type: string;
  poids: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Le chemin SVG, une courbe qui passe par le centre — deux traits ne se superposent pas. */
  d: string;
}

export interface Disposition {
  noeuds: NoeudPlace[];
  traits: TraitPlace[];
  /** Combien de faits n'ont PAS été dessinés. Affiché, jamais tu. */
  noeudsOmis: number;
  /** Combien de liens tombent hors du dessin parce qu'une extrémité n'y est pas. */
  traitsOmis: number;
  /** Les domaines dessinés, dans l'ordre du cercle — la légende s'en dérive. */
  domaines: string[];
  taille: number;
  rayon: number;
}

/** Le degré d'un nœud : combien de liens le touchent. C'est lui qui décide qui reste. */
export function degres(noeuds: readonly NoeudEntree[], liens: readonly LienEntree[]): Map<string, number> {
  const d = new Map<string, number>(noeuds.map((n) => [n.id, 0]));
  for (const l of liens) {
    if (d.has(l.faitA)) d.set(l.faitA, (d.get(l.faitA) as number) + 1);
    if (d.has(l.faitB)) d.set(l.faitB, (d.get(l.faitB) as number) + 1);
  }
  return d;
}

/**
 * ⚠️ UN NŒUD SANS AUCUN LIEN N'EST PAS DESSINÉ. Il n'apprend rien dans un graphe — il
 * occuperait une place sur le cercle et éloignerait les nœuds qui, eux, se parlent. Il n'est
 * pas perdu pour autant : il est COMPTÉ dans `noeudsOmis`, et il vit dans `/moi`.
 */
export function disposer(
  noeuds: readonly NoeudEntree[],
  liens: readonly LienEntree[],
  options: { taille?: number; max?: number } = {},
): Disposition {
  const taille = options.taille ?? 640;
  const max = options.max ?? MAX_NOEUDS;
  const rayon = taille / 2 - 90; // la marge porte les étiquettes

  const d = degres(noeuds, liens);
  const connectes = noeuds.filter((n) => (d.get(n.id) ?? 0) > 0);

  // Le tri décide QUI reste, et il doit être total : à degré égal, l'identifiant tranche —
  // sinon deux affichages du même graphe peuvent garder des nœuds différents.
  const ordonnes = [...connectes].sort((a, b) => {
    const da = d.get(a.id) ?? 0;
    const db = d.get(b.id) ?? 0;
    if (da !== db) return db - da;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const gardes = ordonnes.slice(0, max);
  const noeudsOmis = noeuds.length - gardes.length;

  // Sur le cercle, on regroupe par DOMAINE : c'est la seule structure que l'œil peut suivre
  // sans légende, et elle rend visibles les liens qui TRAVERSENT deux domaines — exactement
  // ceux que `meme-periode` existe pour trouver.
  const parDomaine = new Map<string, NoeudEntree[]>();
  for (const n of gardes) {
    const liste = parDomaine.get(n.domaine);
    if (liste) liste.push(n);
    else parDomaine.set(n.domaine, [n]);
  }
  const domaines = [...parDomaine.keys()].sort();

  const places: NoeudPlace[] = [];
  const total = gardes.length;
  let i = 0;
  for (const dom of domaines) {
    const groupe = (parDomaine.get(dom) as NoeudEntree[]).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const n of groupe) {
      // On part à midi et on tourne dans le sens horaire : lu comme une horloge.
      const angle = total === 0 ? 0 : (i / total) * Math.PI * 2 - Math.PI / 2;
      places.push({
        ...n,
        angle,
        x: taille / 2 + rayon * Math.cos(angle),
        y: taille / 2 + rayon * Math.sin(angle),
        degre: d.get(n.id) ?? 0,
      });
      i++;
    }
  }

  const parId = new Map(places.map((p) => [p.id, p]));
  const traits: TraitPlace[] = [];
  let traitsOmis = 0;
  for (const l of liens) {
    const a = parId.get(l.faitA);
    const b = parId.get(l.faitB);
    // Une extrémité hors du dessin (nœud omis, ou une QUESTION qui n'est pas un fait) : le
    // trait ne se dessine pas à moitié — un trait qui part vers le vide se lit comme un bug.
    if (!a || !b) {
      traitsOmis++;
      continue;
    }
    // La courbe tire vers le CENTRE : deux traits entre les mêmes secteurs restent
    // distinguables, et une corde droite d'un bout à l'autre couperait le cercle en deux.
    const cx = taille / 2;
    const cy = taille / 2;
    traits.push({
      faitA: l.faitA,
      faitB: l.faitB,
      type: l.type,
      poids: l.poids,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      d: `M ${arrondi(a.x)} ${arrondi(a.y)} Q ${cx} ${cy} ${arrondi(b.x)} ${arrondi(b.y)}`,
    });
  }

  return { noeuds: places, traits, noeudsOmis, traitsOmis, domaines, taille, rayon };
}

/** Deux décimales : un SVG lisible dans le diff, et une image identique à l'œil. */
function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Le texte que lit une synthèse vocale. Il dit la MÊME chose que l'image, en une phrase. */
export function resume(d: Disposition): string {
  if (d.noeuds.length === 0) return "Aucun fait relié : il n'y a rien à dessiner.";
  const parDomaine = d.domaines
    .map((dom) => `${dom} (${d.noeuds.filter((n) => n.domaine === dom).length})`)
    .join(", ");
  const omis = d.noeudsOmis > 0 ? ` ${d.noeudsOmis} fait(s) sans lien ou hors du dessin ne sont pas représentés.` : "";
  return `${d.noeuds.length} faits reliés par ${d.traits.length} traits, répartis en ${d.domaines.length} domaine(s) : ${parDomaine}.${omis}`;
}
