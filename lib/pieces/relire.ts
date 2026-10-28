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
import type { Piece } from "../db/schema";
import type { DepotRelecture } from "./depotRelecture";
import { ouvrirFacette } from "./lecture";
import { CHAMPS_COMPARES, deciderPapier, departager, forme, lecturesIndependantes, lecturesIndependantesTroisieme, lectureVide, LOT_MAX_RELECTURES, schemaRelecture, type Lecture } from "./secondeLecture";

/** Les doutes qui passent en tête de la pile de Marc, par jour (ADR 0026 §6). */
export const DOUTES_PAR_JOUR = 5;

export class LotRelecturesTropGrandError extends Error {
  override name = "LotRelecturesTropGrandError";
  constructor(n: number) {
    super(`${n} relectures dans le lot : ${LOT_MAX_RELECTURES} au plus, rien n'est écrit.`);
  }
}

type CodeRefusRelecture = "invalide" | "inconnu" | "meme_extracteur" | "meme_canal" | "pas_en_doute" | "deja_departage";

export interface ResultatRelectures {
  recus: number;
  vrais: number;
  doutes: number;
  /** Rang 3 : les doutes devenus « vrai par LIA » grâce à la troisième lecture (déjà comptés dans `vrais`). */
  departages: number;
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
  rang: 2 | 3 = 2,
): Promise<ResultatRelectures> {
  if (entrees.length > LOT_MAX_RELECTURES) throw new LotRelecturesTropGrandError(entrees.length);
  if (ecrivain.role !== "ecriture" || !APPS_PIECES.has(ecrivain.appId)) throw new EcriturePiecesRetireeError(ecrivain.appId);
  const perimetre = await depot.perimetre(ecrivain.appId);
  if (perimetre && perimetre.role !== "ecriture") throw new EcriturePiecesRetireeError(ecrivain.appId);
  if (await depot.sauvetageEnCours?.()) throw new SauvetageEnCoursError();

  const jour = jourQuebec(maintenant);
  const r: ResultatRelectures = { recus: entrees.length, vrais: 0, doutes: 0, departages: 0, exclus: 0, dejaRelus: 0, refusees: [] };
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
    if (rang === 3) {
      await troisiemeLecture(index, e, p, cle, depot, maintenant, r);
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

type EntreeRelecture = ReturnType<typeof schemaRelecture.parse>;

/** Le rang 3 d'une entrée (ADR 0026, amendement du 28/10/2026) : mêmes verrous, puis le départage. */
async function troisiemeLecture(index: number, e: EntreeRelecture, p: Piece, cle: Cle, depot: DepotRelecture, maintenant: Date, r: ResultatRelectures): Promise<void> {
  const etat = await depot.doutePourDepartage(p.id);
  const ligne = etat === null || etat === "deja_departage" ? null : etat;
  if (e.extracteur === p.extracteur || (ligne && e.extracteur === ligne.extracteurSeconde)) {
    r.refusees.push({ index, code: "meme_extracteur" });
    return;
  }
  if (etat === null) {
    r.refusees.push({ index, code: "pas_en_doute" });
    return;
  }
  if (etat === "deja_departage") {
    r.refusees.push({ index, code: "deja_departage" });
    return;
  }
  if (!lecturesIndependantesTroisieme(etat.extracteurPremiere, etat.extracteurSeconde, e.extracteur)) {
    r.refusees.push({ index, code: "meme_canal" });
    return;
  }
  // Niveau 2 ou 3, papier inactif ou oublié : exclu AVANT tout déchiffrement.
  if (p.supprimeLe !== null || p.statut !== "active" || p.niveau >= 2) {
    r.exclus += 1;
    return;
  }
  const ouvrir = (v: string | null) => ouvrirFacette(cle, v, p.id, p.niveau);
  const premiere: Lecture = { titulaire: ouvrir(p.titulaire), emetteur: ouvrir(p.emetteur), dateDocument: p.dateDocument, dateEcheance: p.dateEcheance };
  const tierce: Lecture = { titulaire: e.titulaire, emetteur: e.emetteur, dateDocument: e.date_document, dateEcheance: e.date_echeance };
  // Niveau, canari (première déchiffrée ou tierce), papier inactif : jamais jugés seuls. Une tierce vide ne départage rien.
  if (deciderPapier({ niveau: p.niveau, statut: p.statut, supprime: p.supprimeLe !== null }, premiere, tierce).genre === "exclu" || lectureVide(tierce)) {
    r.exclus += 1;
    return;
  }
  const egale = departager(etat.empreintePremiere, etat.empreinteSeconde, empreinteLecture(cle, tierce));
  const ecrite = await depot.departager({
    id: etat.id,
    pieceId: p.id,
    egale,
    empreinteTierce: empreinteLecture(cle, tierce),
    extracteurTierce: e.extracteur,
    tierceLe: maintenant,
  });
  if (!ecrite) r.dejaRelus += 1;
  else if (egale) {
    r.vrais += 1;
    r.departages += 1;
  } else r.doutes += 1;
}
