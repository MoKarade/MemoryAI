// app/rafraichirCompteurs.ts — [L26b] OÙ les compteurs s'affichent, écrit à UN seul endroit.
//
// ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────────────────
//
// Dix Server Actions appelaient `revalidatePath("/moi")` parce que c'est là que vivaient les
// compteurs. La fusion de L26b les a déplacés dans **Régler → État** — et les dix listes sont
// restées sur `/moi`. Mesuré au moment du déplacement : **10 sites invalidaient `/moi`, zéro
// invalidait `/regler`**.
//
// ⚠️ Rien n'aurait rougi. Ces pages sont `force-dynamic`, donc le serveur les re-rend à chaque
// requête ; le défaut ne se voit qu'en navigation CÔTÉ CLIENT, où Next sert le payload RSC
// gardé en cache. Marc valide un fait, revient sur Régler par la barre, et lit un compteur
// d'avant son geste. **Déplacer du contenu déplace son invalidation**, et `revalidatePath` est
// une liste écrite à la main qui ne suit aucun refactor.
//
// ⚠️ D'où une SOURCE UNIQUE plutôt que dix corrections : la prochaine fois qu'un compteur
// change de surface, il y a un seul endroit à éditer. Dix listes à tenir à jour, c'est une
// garantie qui repose sur la vigilance — et « un commentaire qui réclame de la vigilance est
// une source unique manquante » (CLAUDE.md §9).
//
// ⚠️ Ce fichier vit dans `app/` et non dans `lib/`, délibérément : `next/cache` n'existe que
// dans Next, et `lib/` est aussi importé par le serveur MCP et par les tests. Un import de
// `next/cache` là-bas casserait les deux. Et il ne porte AUCUN nom spécial de Next
// (`page`/`route`/`actions`), donc ce n'est pas une route — juste un module partagé.

import { revalidatePath } from "next/cache";

/**
 * Les surfaces qui affichent des compteurs AGRÉGÉS de la mémoire (nombres de faits par statut,
 * par domaine, dépenses, vocabulaire). ⚠️ Pas les surfaces qui affichent un FAIT : celles-là
 * s'invalident par leur propre chemin (`/fait/<id>`), que l'appelant connaît et nous pas.
 */
export const SURFACES_COMPTEURS = [
  // Régler → État, depuis L26b. C'était `/moi` avant.
  "/regler",
  // L'ACCUEIL : son bandeau « Lia a N questions » est un agrégat. Mesuré le 18/09,
  // **aucune** Server Action n'invalidait `"/"` — pas même celles qui répondent à une
  // question. Marc répond, revient sur Parler, et le bandeau lui redemande la question qu'il
  // vient de fermer. Trou ANTÉRIEUR à L26b, fermé ici parce que c'est désormais l'endroit où
  // la question « quelles surfaces portent un compteur ? » a UNE réponse.
  "/",
  // Les quatre suivantes sont arrivées par la MESURE, pas par la réflexion : un scan des
  // `page.tsx` qui appellent un lecteur d'agrégat (`comptes()`, `mesure()`,
  // `comptesParDomaine(`, `depense*(`) en sort SIX, et cette liste n'en portait que DEUX.
  // Chacune est invalidée par ses propres actions, jamais par celles des autres — or un
  // compte de faits bouge aussi quand on retire un papier, et un compte de liens quand on
  // oublie un fait. `tests/reglerFusion.test.ts` DÉRIVE la liste du code et exige les deux
  // sens : rien d'oublié, rien de fantôme.
  "/a-valider",
  // `/questions` en est sorti le 25/10 (tâche MemoryAI 231) : sans la pile vrai / faux, elle ne
  // montre plus de compte, seulement la question du dessus.
  "/conversations",
  "/graphe",
  // ⚠⚠ [L34] Ajouté parce que la garde de L26b a ROUGI sur la page neuve, une heure après
  // avoir été écrite : `/depenses` lit la dépense du jour, la dépense totale et le compte des
  // papiers. C'est exactement ce qu'elle existait pour attraper — une surface à compteur
  // ajoutée sans que personne ne pense à l'invalidation. Elle a dérivé la liste du code au
  // lieu de l'épingler entrée par entrée, et c'est ce qui lui a permis de voir celle-ci.
  "/depenses",
  // [ADR 0009] L'onglet Avancement lit les comptes des papiers (`comptes()`), la dépense ne s'y
  // affiche pas, mais un papier retiré ou relu change son entonnoir.
  "/avancement",
  // ⚠⚠ [L40] Ajoutée parce que la même garde a ROUGI une seconde fois, sur le même
  // mécanisme : l'écran des papiers refait le 21/09 affiche « N lus / M pas encore lus »
  // et les comptes par dossier, donc il porte désormais un agrégat. Retirer un papier
  // déplaçait ces deux chiffres sans jamais les rafraîchir en navigation client. Deux fois
  // sur deux, la garde a vu ce que la relecture n'avait pas vu — c'est ce qu'on attend
  // d'une liste DÉRIVÉE plutôt qu'écrite.
  "/pieces",
] as const;

/**
 * À appeler depuis toute Server Action qui change un compte de la mémoire.
 *
 * ⚠️ Elle NE remplace pas les `revalidatePath` propres à l'appelant : une action qui modifie
 * la file invalide aussi `/a-valider`, une correction invalide aussi sa fiche. Ce helper ne
 * connaît que les surfaces d'AGRÉGAT — celles que l'appelant ne devrait pas avoir à savoir.
 */
export function rafraichirCompteurs(): void {
  for (const s of SURFACES_COMPTEURS) revalidatePath(s);
}
