// lib/pile/charger.ts — lire ce qui NOURRIT la pile « vrai / faux », à UN seul endroit.
//
// La pile est composée par deux pages : `/questions` (qui la montre, une carte à la fois) et
// l'accueil (qui dit seulement combien il en reste). Les deux doivent voir EXACTEMENT les mêmes
// cartes, sinon le bandeau annonce « 3 à juger » devant une pile qui en montre 2 — d'où une
// seule lecture. Elle ne déchiffre rien : ids, dates et certitudes seulement (voir `depot.ts`).

import { depotAdminDrizzle } from "../depotAdmin";
import type { FaitAvecProvenance } from "../depotLecture";
import { depotQuestionsDrizzle } from "../depotQuestions";
import { MAX_OUVERTES } from "../questions";
import type { Question } from "../db/schema";
import { depotPileDrizzle } from "./depot";
import { composerPile, restantParGenre, type AvisEnVigueur, type CandidatPiece, type GenreCarte } from "./composer";

/** Au plus autant de faits proposés lus pour composer la pile — il y en a un aujourd'hui. */
export const LIMITE_DEDUCTIONS = 100;

type Db = Parameters<typeof depotPileDrizzle>[0];

export interface EntreesPile {
  candidats: CandidatPiece[];
  deductions: FaitAvecProvenance[];
  questions: Question[];
  avis: AvisEnVigueur[];
}

export async function chargerEntreesPile(db: Db): Promise<EntreesPile> {
  const pile = depotPileDrizzle(db);
  const [candidats, deductions, questions, avis] = await Promise.all([
    pile.candidatsPieces(),
    depotAdminDrizzle(db).aValider(LIMITE_DEDUCTIONS),
    depotQuestionsDrizzle(db).ouvertes(MAX_OUVERTES),
    pile.avis(),
  ]);
  return { candidats, deductions, questions, avis };
}

/**
 * Combien de cartes restent à juger, par genre, comme la pile de `/questions` les montrerait ce
 * jour-là. Une seule composition pour l'accueil et l'onglet Mémoire : leurs comptes ne divergent pas.
 */
export async function resteAJuger(db: Db, aujourdhui: string): Promise<Record<GenreCarte, number>> {
  const { candidats, deductions, questions, avis } = await chargerEntreesPile(db);
  const ordre = composerPile({
    pieces: candidats,
    faits: deductions.map((d) => ({ id: d.fait.id, creeLe: d.fait.creeLe })),
    questions: questions.map((q) => ({ id: q.id, creeLe: q.creeLe })),
    avis,
    aujourdhui,
  });
  return restantParGenre(ordre, avis);
}
