// lib/accueil/raccourcis.ts — les raccourcis clavier de l'accueil (maquette v5). PUR : l'écouteur
// vit dans `app/AccueilClient.tsx`, la décision ici.

/** Ce qu'on lit d'un `KeyboardEvent` (testable sans navigateur). */
interface Touche {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** Ce qu'on lit de la cible : `closest` suffit. */
interface Cible {
  closest(selecteur: string): unknown;
}

/** Là où `/` est un caractère tapé, jamais un raccourci. */
const SAISIE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * `/` ouvre la conversation, comme dans la maquette, sauf quand Marc écrit (champ, zone de texte,
 * bulle de LIA), qu'une touche de modification est tenue, ou qu'un autre écouteur l'a déjà prise.
 */
export function estRaccourciParler(e: Touche, cible: Cible | null): boolean {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return false;
  return !cible?.closest(SAISIE);
}
