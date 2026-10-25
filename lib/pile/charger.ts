// lib/pile/charger.ts — lire ce qui NOURRIT la pile « vrai / faux », à UN seul endroit.
//
// La pile est composée par `/questions`. L'accueil et l'onglet Mémoire ne disent plus « N à
// juger » : Marc ne juge plus rien (tâche MemoryAI 231). Elle ne déchiffre rien : ids, dates et certitudes seulement (voir `depot.ts`).

import { depotAdminDrizzle } from "../depotAdmin";
import type { FaitAvecProvenance } from "../depotLecture";
import { depotQuestionsDrizzle } from "../depotQuestions";
import { MAX_OUVERTES } from "../questions";
import type { Question } from "../db/schema";
import { doutesEnTete } from "../relectureLia";
import { papiersEnTete } from "../pieces/depotRelecture";
import { depotPileDrizzle } from "./depot";
import type { AvisEnVigueur, CandidatPiece } from "./composer";

/** Au plus autant de faits proposés lus pour composer la pile — il y en a un aujourd'hui. */
export const LIMITE_DEDUCTIONS = 100;

type Db = Parameters<typeof depotPileDrizzle>[0];

export interface EntreesPile {
  candidats: CandidatPiece[];
  deductions: FaitAvecProvenance[];
  questions: Question[];
  avis: AvisEnVigueur[];
  /** Les doutes de LIA, en tête de la pile (ADR 0025). */
  faitsEnTete: string[];
  /** Les papiers dont la seconde lecture doute, en tête aussi (ADR 0026). */
  piecesEnTete: string[];
}

export async function chargerEntreesPile(db: Db): Promise<EntreesPile> {
  const pile = depotPileDrizzle(db);
  const [candidats, deductions, questions, avis, faitsEnTete, piecesEnTete] = await Promise.all([
    pile.candidatsPieces(),
    depotAdminDrizzle(db).aValider(LIMITE_DEDUCTIONS),
    depotQuestionsDrizzle(db).ouvertes(MAX_OUVERTES),
    pile.avis(),
    doutesEnTete(db),
    papiersEnTete(db),
  ]);
  return { candidats, deductions, questions, avis, faitsEnTete, piecesEnTete };
}
