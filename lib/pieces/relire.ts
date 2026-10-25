// lib/pieces/relire.ts — la seconde lecture d'un lot de papiers, de bout en bout (ADR 0026).
//
// Mêmes gardes que `ecrireLotPieces`, puis par papier : la pièce de l'exemplaire principal, sa
// lecture déchiffrée EN MÉMOIRE, `deciderPapier`, et des EMPREINTES seulement en base.
// ⚠️ Le MÊME extracteur referait la même erreur au même endroit : refusé, jamais une concordance.
// ⚠️ Le même CANAL aussi (deux lectures du même texte OCR, ou deux visions du même modèle) :
// l'erreur d'OCR tromperait les deux lectures de la même façon (DriveAI, 25/10).

import { empreinte, type Cle } from "../chiffrement";
import { jourQuebec } from "../coutChat";
import type { Ecrivain } from "../jetons";
import { SauvetageEnCoursError } from "../sauvetage/porte";
import { EcriturePiecesRetireeError } from "./ecrire";
import { APPS_PIECES } from "./lignee";
import type { DepotRelecture } from "./depotRelecture";
import { ouvrirFacette } from "./lecture";
import { CHAMPS_COMPARES, deciderPapier, forme, lecturesIndependantes, LOT_MAX_RELECTURES, schemaRelecture, type Lecture } from "./secondeLecture";

/** Les doutes qui passent en tête de la pile de Marc, par jour (ADR 0026 §6). */
export const DOUTES_PAR_JOUR = 5;

export class LotRelecturesTropGrandError extends Error {
  override name = "LotRelecturesTropGrandError";
  constructor(n: number) {
    super(`${n} relectures dans le lot : ${LOT_MAX_RELECTURES} au plus, rien n'est écrit.`);
  }
}

type CodeRefusRelecture = "invalide" | "inconnu" | "meme_extracteur" | "meme_canal";

export interface ResultatRelectures {
  recus: number;
  vrais: number;
  doutes: number;
  /** Jamais jugés seuls : niveau 2-3, canari, inactif, rien à comparer. Restent à Marc. */
  exclus: number;
  dejaRelus: number;
  refusees: { index: number; code: CodeRefusRelecture }[];
}

function empreinteLecture(cle: Cle, l: Lecture): string {
  return empreinte(cle, "relecture-piece", ...CHAMPS_COMPARES.map((c) => (l[c] === null ? "" : forme(l[c]))));
}

export async function relireLot(
  entrees: readonly unknown[],
  ecrivain: Ecrivain,
  cle: Cle,
  depot: DepotRelecture,
  maintenant: Date = new Date(),
): Promise<ResultatRelectures> {
  if (entrees.length > LOT_MAX_RELECTURES) throw new LotRelecturesTropGrandError(entrees.length);
  if (ecrivain.role !== "ecriture" || !APPS_PIECES.has(ecrivain.appId)) throw new EcriturePiecesRetireeError(ecrivain.appId);
  const perimetre = await depot.perimetre(ecrivain.appId);
  if (perimetre && perimetre.role !== "ecriture") throw new EcriturePiecesRetireeError(ecrivain.appId);
  if (await depot.sauvetageEnCours?.()) throw new SauvetageEnCoursError();

  const jour = jourQuebec(maintenant);
  const r: ResultatRelectures = { recus: entrees.length, vrais: 0, doutes: 0, exclus: 0, dejaRelus: 0, refusees: [] };
  for (const [index, brut] of entrees.entries()) {
    const v = schemaRelecture.safeParse(brut);
    if (!v.success) {
      r.refusees.push({ index, code: "invalide" });
      continue;
    }
    const e = v.data;
    const p = await depot.pieceParFichier(e.file_id);
    if (!p) {
      r.refusees.push({ index, code: "inconnu" });
      continue;
    }
    if (p.extracteur === e.extracteur) {
      r.refusees.push({ index, code: "meme_extracteur" });
      continue;
    }
    if (!lecturesIndependantes(p.extracteur, e.extracteur)) {
      r.refusees.push({ index, code: "meme_canal" });
      continue;
    }
    // Le même chemin que l'écran : la facette d'un niveau 0 est scellée, sauf ancienne ligne.
    const ouvrir = (v: string | null) => ouvrirFacette(cle, v, p.id, p.niveau);
    const premiere: Lecture = {
      titulaire: ouvrir(p.titulaire),
      emetteur: ouvrir(p.emetteur),
      dateDocument: p.dateDocument,
      dateEcheance: p.dateEcheance,
    };
    const seconde: Lecture = { titulaire: e.titulaire, emetteur: e.emetteur, dateDocument: e.date_document, dateEcheance: e.date_echeance };
    const d = deciderPapier({ niveau: p.niveau, statut: p.statut, supprime: p.supprimeLe !== null }, premiere, seconde);
    if (d.genre === "exclu") {
      r.exclus += 1;
      continue;
    }
    const enPile = d.genre === "doute" && (await depot.doutesEnPile(jour)) < DOUTES_PAR_JOUR;
    const ecrite = await depot.ecrire({
      pieceId: p.id,
      decision: d.genre,
      divergents: d.genre === "doute" ? d.champs.join(",") : null,
      empreintePremiere: empreinteLecture(cle, premiere),
      empreinteSeconde: empreinteLecture(cle, seconde),
      extracteurPremiere: p.extracteur,
      extracteurSeconde: e.extracteur,
      jour,
      enPile,
    });
    if (!ecrite) r.dejaRelus += 1;
    else if (d.genre === "vrai") r.vrais += 1;
    else r.doutes += 1;
  }
  return r;
}
