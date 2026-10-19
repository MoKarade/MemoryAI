// lib/fuseau.ts — le fuseau de Marc, écrit UNE fois.
//
// ⚠️ VERCEL TOURNE EN UTC. Sans `timeZone`, `Intl` prend le fuseau de la machine — et tout ce
// que l'app AFFICHE ou DATE serait faux de 4 ou 5 heures selon la saison, sans aucun signe
// extérieur. Une heure fausse est pire qu'une heure absente : on la croit.
//
// La valeur vivait en dur dans `lib/coutChat.ts` (le jour que le plafond du chat protège) ;
// la recopier ailleurs aurait fait diverger le jour de la dépense et les dates affichées, un
// jour d'été où seul l'un des deux aurait été corrigé. `tests/fuseau.test.ts` interdit
// désormais tout `timeZone:` littéral hors de ce fichier.

/** Québec. `America/Toronto` porte les mêmes règles d'heure avancée que `America/Montreal`. */
export const FUSEAU = "America/Toronto";
