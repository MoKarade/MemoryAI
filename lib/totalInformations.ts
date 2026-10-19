// lib/totalInformations.ts — « combien la mémoire sait de choses sur moi », en UN chiffre.
//
// ── POURQUOI CE MODULE EXISTE ─────────────────────────────────────────────────────────────
//
// Marc, le 21/09/2026 : « j'ai toujours seulement 100 faits validés, pourquoi ? », puis
// « je veux un compteur pour avoir genre le nombre d'info que l'app a sur moi EN TOUT ».
//
// Les deux phrases sont le même défaut. La mémoire portait DEUX compteurs qui se ressemblent
// et qui ne comptent pas la même chose — 100 faits validés, 2 748 papiers — et l'écran mettait
// le premier en avant. Or c'est le SECOND qui bouge quand la campagne de lecture tourne : le
// chiffre que Marc regardait était structurellement incapable de monter, et rien ne le disait.
//
// ── CE QUE CE TOTAL EST, ET CE QU'IL N'EST PAS ────────────────────────────────────────────
//
// Un fait et un papier ne sont PAS la même chose : le premier est une phrase sur Marc qu'il a
// confirmée, le second un document dont la mémoire sait au moins qu'il existe et où il est.
// Les sommer est légitime pour répondre à « combien de choses sais-tu sur moi » — et ce n'est
// honnête qu'à UNE condition, non négociable : **la décomposition s'affiche PARTOUT où le
// total s'affiche.** Un total seul redeviendrait le compteur trompeur qu'on vient de retirer,
// dans l'autre sens.
//
// D'où {@link phraseInformations}, et d'où le fait que le hub publie « Informations » ET
// « Faits validés » ET « Papiers » — jamais le total tout seul.
//
// ⚠️ Un poste NON MESURÉ (base injoignable, lecture en échec) ne vaut pas zéro : le total rend
// `null`. Un cumul discrètement amputé est pire qu'une absence, parce qu'il se présente comme
// une mesure (CLAUDE.md §9 : « une donnée illisible se COMPTE, elle ne se rabat pas sur zéro »).
//
// PURE : aucune lecture, aucune horloge. Les comptes sont des paramètres.

/**
 * L'ORDRE de la somme ET l'ordre d'affichage — une seule liste.
 *
 * ⚠️ Deux listes (une pour sommer, une pour nommer) dérivent au premier poste ajouté, et
 * personne ne le voit : le total monte, la phrase garde ses anciens noms. C'est exactement la
 * panne « un compteur ajouté LAISSE son libellé derrière » payée sur DriveAI le 21/09.
 */
export const POSTES_INFORMATIONS = ["faits", "papiers"] as const;

export type ClePoste = (typeof POSTES_INFORMATIONS)[number];

/**
 * Ce que chaque poste compte, en français.
 *
 * ⚠️ `Record<ClePoste, …>` est EXHAUSTIF : ajouter un poste à {@link POSTES_INFORMATIONS} sans
 * lui donner un nom ne compile pas. C'est le compilateur qui tient la règle, pas la vigilance.
 */
export const NOM_POSTE: Record<ClePoste, string> = {
  faits: "faits",
  papiers: "papiers",
};

/** Les comptes bruts. `null` = « pas mesuré », jamais « zéro ». */
export type PostesInformations = Record<ClePoste, number | null>;

/** Vrai si la valeur est un compte utilisable — ni absente, ni non finie, ni négative. */
function estCompte(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * PURE. Le total, ou `null` si UN SEUL poste n'a pas pu être mesuré.
 *
 * ⚠️ Le refus est total et pas partiel : rendre la somme des postes lisibles afficherait un
 * chiffre plus petit que la réalité sous l'étiquette « en tout ».
 */
export function totalInformations(p: PostesInformations): number | null {
  let t = 0;
  for (const cle of POSTES_INFORMATIONS) {
    const v = p[cle];
    if (!estCompte(v)) return null;
    t += v;
  }
  return t;
}

/**
 * PURE. La décomposition, DÉRIVÉE des mêmes postes que la somme.
 *
 * Un poste non mesuré s'écrit « — », jamais « 0 » : « je ne sais pas » et « il n'y en a
 * aucun » n'appellent pas le même geste.
 */
export function phraseInformations(p: PostesInformations): string {
  return POSTES_INFORMATIONS.map((cle) => {
    const v = p[cle];
    return `${estCompte(v) ? v : "—"} ${NOM_POSTE[cle]}`;
  }).join(" · ");
}
