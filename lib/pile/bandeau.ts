// lib/pile/bandeau.ts — ce que le bandeau « à juger » de l'accueil dit. PUR.
//
// Le compte vient de la pile elle-même (`restantParGenre`), pas des seules questions ouvertes :
// avant, un papier lu ou une déduction à juger ne comptaient pas, donc la pile n'était
// atteignable qu'en tapant `/questions` (MemoryAI#90).
//
// Les cartes PASSÉES ne comptent pas : `restantParGenre` les écarte, comme l'écran de la pile
// (« plus N passée(s) »). Une pile qui ne contient que des cartes passées n'a rien « à juger »,
// donc pas de bandeau — un bandeau permanent qui dit « 0 » est du décor qu'on cesse de lire.

import type { GenreCarte } from "./composer";

export interface BandeauAJuger {
  total: number;
  /** Le résumé replié : « 3 à juger ». */
  titre: string;
  /** Le détail dans le dépli : « 1 papier lu, 1 déduction, 1 question ». */
  detail: string;
}

const NOMS: Record<GenreCarte, [string, string]> = {
  piece: ["papier lu", "papiers lus"],
  fait: ["déduction", "déductions"],
  question: ["question", "questions"],
};

export function bandeauAJuger(reste: Readonly<Record<GenreCarte, number>>): BandeauAJuger | null {
  const total = reste.piece + reste.fait + reste.question;
  if (total <= 0) return null;
  const detail = (["piece", "fait", "question"] as const)
    .filter((g) => reste[g] > 0)
    .map((g) => `${reste[g]} ${NOMS[g][reste[g] > 1 ? 1 : 0]}`)
    .join(", ");
  return { total, titre: `${total} à juger`, detail };
}
