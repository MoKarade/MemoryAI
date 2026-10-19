// components/Nav.tsx — la barre commune des pages privées.
//
// ⚠️ Cette ligne disait « trois destinations, pas plus » jusqu'au 15/09, alors qu'il y en
// avait sept : une intention écrite au présent se périme au premier ajout, et personne ne
// relit le commentaire qu'elle contredit. Ce qui reste vrai : chaque entrée est une
// SECTION, pas une page — un détail (`/fait/[id]`) ou un cadre embarqué (`/widget`) n'y
// figure pas.
//
// ── [L26] DE HUIT À TROIS ──────────────────────────────────────────────────────────────────
//
// Marc, le 17/09 : « il y a beaucoup trop d'onglets ». Mesuré : **huit** (Moi, À valider,
// Questions, Chat, Conversations, Papiers, Graphe, Apps), là où l'ADR 0004 n° 42 en décidait
// quatre le 16/09 — décision jamais livrée. L'ADR 0005 §4 B1 les regroupe en Parler ·
// Chercher · Voir · Régler.
//
// ⚠️ TROIS, PAS QUATRE, ET C'EST DÉLIBÉRÉ. **Voir** demande la frise à trois bandes et les
// échéances à 90 jours ; aucune requête d'échéances n'existe encore dans ce dépôt (mesuré :
// zéro fonction, seule la clé d'attribut `echeance` existe). Un onglet qui ne mène nulle part
// est pire qu'un onglet en moins — il coûte un clic pour apprendre qu'il n'y a rien. Il arrive
// avec **L30**, qui le construit. La mesure du lot est « ≤ 2 clics sur les 10 questions du
// socle », pas « exactement quatre entrées ».
//
// ⚠️ LES ANCIENNES CLÉS SONT GARDÉES, volontairement. Les huit pages passent encore
// `active="moi"`, `active="apps"`… : les faire toutes muter dans ce lot mélangerait le
// déplacement de la NAVIGATION avec la réécriture des PAGES, et un lot qui fait les deux est
// un lot dont on ne peut plus dire lequel des deux a cassé quoi. La clé est donc traduite en
// section ici, à un seul endroit.

import Link from "next/link";

/**
 * Les sections réelles de la barre.
 *
 * ⚠️ EXPORTÉ depuis [L26b] : `app/manifest.ts` en DÉRIVE son `start_url`. Le point d'entrée
 * de l'app installée est la première section de la barre, et l'écrire deux fois a coûté un
 * manifeste qui ouvrait la page de PURGE (mesuré le 18/09). L'ORDRE compte donc : le premier
 * élément est l'accueil.
 */
export const SECTIONS = [
  { cle: "parler", href: "/", libelle: "Parler" },
  // [ADR 0009] CINQUIÈME entrée, demandée par Marc le 23/09 (« une interface pour dire
  // l'avancement »). ⚠️ En DEUXIÈME position et jamais en tête : `start_url` est dérivé de
  // `SECTIONS[0]`, et l'app installée doit continuer d'ouvrir sur Parler.
  { cle: "avancement", href: "/avancement", libelle: "Avancement" },
  { cle: "chercher", href: "/pieces", libelle: "Chercher" },
  { cle: "regler", href: "/regler", libelle: "Régler" },
  // ⚠️ QUATRIÈME entrée, demandée explicitement par Marc le 18/09 (« je veux aussi un
  // onglet dédié aux depenses a limport »). Ce n'est pas une rechute de L26a : celui-là a
  // retiré cinq onglets que Marc ne regardait pas, et il en demande un qu'il va regarder —
  // les deux seules choses qu'on surveille pendant qu'un import de ~2 645 documents tourne
  // sont ce qui se dépense et ce qui est lu. Un dépli ne conviendrait pas : on n'ouvre pas
  // un dépli toutes les dix minutes.
  // ⚠️ Et l'ORDRE compte : `manifest.ts` dérive `start_url` de `SECTIONS[0]`, donc Parler
  // doit rester PREMIER — une entrée ajoutée en tête changerait ce que l'app installée ouvre.
  { cle: "depenses", href: "/depenses", libelle: "Dépenses" },
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
  | "pieces";

/**
 * Où vit chaque ancienne page dans la nouvelle barre. ⚠️ Écrit comme une table plutôt que
 * deviné par une heuristique de nom : `pieces` va dans Chercher et `conversations` dans
 * Régler, et rien dans leur nom ne le dit.
 */
const SECTION_DE: Record<CleNav, (typeof SECTIONS)[number]["cle"] | null> = {
  parler: "parler",
  chercher: "chercher",
  regler: "regler",
  depenses: "depenses",
  avancement: "avancement",
  chat: "parler",
  questions: "parler",
  pieces: "chercher",
  moi: "regler",
  "a-valider": "regler",
  conversations: "regler",
  apps: "regler",
  graphe: "regler",
  // Une FICHE n'est pas une section : elle s'ouvre depuis n'importe où, donc elle n'allume
  // rien. Souligner « Chercher » parce qu'on regarde un fait dirait que la fiche EST une
  // section, ce qui est faux.
  fait: null,
};

export function Nav({ active }: { active: CleNav }) {
  const allumee = SECTION_DE[active];
  return (
    <header className="nav">
      <Link href="/" className="nav-marque">
        MemoryAI
      </Link>
      <nav aria-label="Sections">
        {SECTIONS.map((s) => (
          <Link
            key={s.cle}
            href={s.href}
            className={allumee === s.cle ? "nav-lien actif" : "nav-lien"}
            aria-current={allumee === s.cle ? "page" : undefined}
          >
            {s.libelle}
          </Link>
        ))}
      </nav>
    </header>
  );
}
