// lib/sensProche.ts — les liens DEVINÉS (tâche MemoryAI 186, partie B). PUR : on lui donne des
// vecteurs déjà calculés, il rend les paires de sens proche. Le modèle, lui, vit dans
// `lib/plongement.ts` ; le séparer est ce qui rend la règle testable sans télécharger 130 Mo.
//
// ⚠️ UN LIEN DEVINÉ N'EST PAS UN LIEN ÉTABLI. Il s'écrit avec `origine: "modele"` et la règle
// `sens-proche-v1`, et l'écran le dit « deviné ». Une règle dit « ces deux faits viennent du même
// papier » ; un modèle dit « ces deux faits parlent d'à peu près la même chose ». Les confondre
// ferait passer une ressemblance pour un fait (décision de Marc du 15/09 : règles d'abord, et ce
// qui est deviné reste distinct).
//
// ⚠️ LE `pourquoi` NE CITE JAMAIS UN TEXTE. Il n'est pas chiffré : il dit la ressemblance, en
// pourcentage, rien de ce qui a été comparé.

import type { Abstention, FaitPourGraphe, LienCalcule } from "./graphe";

/** Le nom de la règle, écrit sur chaque lien : il dit quel modèle et quel seuil l'ont posé. */
const REGLE_SENS = "sens-proche-v1";
/**
 * La ressemblance minimale (cosinus, vecteurs normés). [Supposition] calée sur onze phrases
 * FICTIVES le 26/10, pas sur la mémoire de Marc : avec le modèle de `lib/plongement.ts`, les vraies
 * paires donnent 0,79, 0,60 et 0,47, la plus haute paire sans rapport 0,44. Le relevé de production
 * dira s'il faut la bouger, et la bouger est une décision écrite ici.
 */
export const SEUIL_SENS = 0.45;
/** Au plus K voisins devinés par fait : un modèle qui relie tout à tout ne dit plus rien. */
export const VOISINS_MAX = 5;
/** Au-delà, la comparaison de toutes les paires coûte trop pour une passe : abstention dite. */
export const FAITS_MAX_SENS = 6000;

export interface Plonge {
  id: string;
  /** Le texte comparé. Il sert à écarter deux textes IDENTIQUES, déjà liés par les règles. */
  texte: string;
  /** Normé (longueur 1) : le cosinus est alors un simple produit scalaire. */
  vecteur: readonly number[];
}

/**
 * Le texte d'un fait pour le modèle, ou `null` s'il n'y a rien à comparer. Un pointeur de document
 * se compare par son type et son émetteur (sa valeur est un identifiant Drive opaque) ; une date
 * seule ne dit rien de son sens.
 */
export function texteAPlonger(f: FaitPourGraphe, description: string | null): string | null {
  if (f.valeurType === "ref_document") {
    const morceaux = [f.attributs?.type, f.attributs?.emetteur].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return morceaux.length ? morceaux.join(" ").trim() : null;
  }
  if (f.valeurType !== "texte" || !f.valeur.trim()) return null;
  return description ? `${description} : ${f.valeur.trim()}` : f.valeur.trim();
}

function produit(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Les liens de sens proche : pour chaque fait, ses `VOISINS_MAX` plus proches au-dessus du seuil.
 * La paire est normalisée (`faitA < faitB`), donc un voisinage réciproque ne fait qu'un lien.
 * Déterministe : à ressemblance égale, l'identifiant départage.
 */
export function liensDeSens(items: readonly Plonge[]): { liens: LienCalcule[]; abstentions: Abstention[] } {
  if (items.length > FAITS_MAX_SENS) {
    return { liens: [], abstentions: [{ regle: "sens-proche", motif: `plus de ${FAITS_MAX_SENS} faits à comparer`, taille: items.length }] };
  }
  const tries = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parPaire = new Map<string, LienCalcule>();
  let ecartesIdentiques = 0;
  for (let i = 0; i < tries.length; i++) {
    const a = tries[i]!;
    const candidats: { j: number; s: number }[] = [];
    for (let j = 0; j < tries.length; j++) {
      if (j === i) continue;
      const b = tries[j]!;
      if (a.texte === b.texte) {
        if (j > i) ecartesIdentiques++;
        continue;
      }
      const s = produit(a.vecteur, b.vecteur);
      if (s >= SEUIL_SENS) candidats.push({ j, s });
    }
    candidats.sort((x, y) => y.s - x.s || x.j - y.j);
    for (const { j, s } of candidats.slice(0, VOISINS_MAX)) {
      const b = tries[j]!;
      const [faitA, faitB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const cle = `${faitA}|${faitB}`;
      if (parPaire.has(cle)) continue;
      const poids = Math.min(1, Math.max(0, Math.round(s * 100) / 100));
      parPaire.set(cle, {
        faitA,
        faitB,
        cibleB: "fait",
        type: "sens-proche",
        poids,
        regle: REGLE_SENS,
        pourquoi: `Sens proche, deviné par un petit modèle (ressemblance ${Math.round(poids * 100)} %).`,
      });
    }
  }
  const abstentions: Abstention[] = ecartesIdentiques
    ? [{ regle: "sens-proche", motif: "textes identiques, déjà liés par les règles", taille: ecartesIdentiques }]
    : [];
  return { liens: [...parPaire.values()], abstentions };
}
