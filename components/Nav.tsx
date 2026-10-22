// components/Nav.tsx — l'en-tête commun des pages privées, et la table des sections du menu.
//
// [R1, MemoryAI#9] PLUS DE BARRE D'ONGLETS. L'en-tête porte le bouton du menu et le nom de
// l'app ; les sections vivent dans le menu (`MenuLia`), celui de `docs/REFONTE-INTERFACE.md` §4 :
// Lia · Mémoire (MemoryAI#74, le réseau en 3D) · Vrai ou faux · Ce qu'elle sait · Lecture des papiers · Dépenses · Anciennes
// conversations · Réglages. Chaque entrée est une SECTION, pas une page : un détail
// (`/fait/[id]`) ou un cadre embarqué (`/widget`) n'y figure pas.
//
// ⚠️ LES ANCIENNES CLÉS SONT GARDÉES, volontairement. Les pages passent encore `active="moi"`,
// `active="apps"`… : les faire toutes muter ici mélangerait le déplacement de la NAVIGATION avec
// la réécriture des PAGES (lots R2 à R6), et un lot qui fait les deux est un lot dont on ne peut
// plus dire lequel des deux a cassé quoi. La clé est donc traduite en section à UN seul endroit.
// `/a-valider` et `/graphe` existent encore : R3 et R7 les retirent.

import Link from "next/link";
import { MenuLia } from "@/components/MenuLia";

/**
 * Les sections du menu.
 *
 * ⚠️ EXPORTÉ : `app/manifest.ts` en DÉRIVE son `start_url`. Le point d'entrée de l'app installée
 * est la première section, et l'écrire deux fois a coûté un manifeste qui ouvrait la page de
 * PURGE (mesuré le 18/09). L'ORDRE compte donc : le premier élément est l'accueil, Lia.
 */
export const SECTIONS = [
  { cle: "parler", href: "/", libelle: "Lia" },
  { cle: "memoire", href: "/memoire", libelle: "Mémoire" },
  { cle: "vrai-faux", href: "/questions", libelle: "Vrai ou faux" },
  { cle: "savoir", href: "/pieces", libelle: "Ce qu'elle sait" },
  { cle: "lecture", href: "/avancement", libelle: "Lecture des papiers" },
  { cle: "depenses", href: "/depenses", libelle: "Dépenses" },
  { cle: "conversations", href: "/conversations", libelle: "Anciennes conversations" },
  { cle: "reglages", href: "/regler", libelle: "Réglages" },
] as const;

/** Toutes les clés qu'une page peut passer — anciennes comprises. */
export type CleNav =
  | "parler"
  | "chercher"
  | "regler"
  | "depenses"
  | "avancement"
  | "moi"
  | "a-valider"
  | "questions"
  | "chat"
  | "conversations"
  | "apps"
  | "graphe"
  | "fait"
  | "pieces"
  | "memoire";

/**
 * Où vit chaque ancienne page dans le menu. ⚠️ Écrit comme une table plutôt que deviné par une
 * heuristique de nom : `pieces` va dans « Ce qu'elle sait » et `a-valider` dans « Vrai ou faux »,
 * et rien dans leur nom ne le dit.
 */
const SECTION_DE: Record<CleNav, (typeof SECTIONS)[number]["cle"] | null> = {
  parler: "parler",
  chat: "parler",
  memoire: "memoire",
  questions: "vrai-faux",
  "a-valider": "vrai-faux",
  chercher: "savoir",
  pieces: "savoir",
  avancement: "lecture",
  depenses: "depenses",
  conversations: "conversations",
  regler: "reglages",
  moi: "reglages",
  apps: "reglages",
  graphe: "reglages",
  // Une FICHE n'est pas une section : elle s'ouvre depuis n'importe où, donc elle n'allume
  // rien. Allumer « Ce qu'elle sait » parce qu'on regarde un fait dirait que la fiche EST une
  // section, ce qui est faux.
  fait: null,
};

export function Nav({ active, droite }: { active: CleNav; droite?: React.ReactNode }) {
  return (
    <header className="nav">
      <MenuLia entrees={SECTIONS} allumee={SECTION_DE[active]} />
      <Link href="/" className="nav-marque">
        Lia
      </Link>
      {/* Une seule chose à droite, et c'est la page qui la choisit (l'accueil : « N à juger »). */}
      {droite ? <div className="nav-droite">{droite}</div> : null}
    </header>
  );
}
