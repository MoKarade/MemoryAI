// lib/pieces/ecrire.ts — écrire un LOT de pièces : valider, oublier, dédoublonner, chiffrer.
//
// Jumeau de `lib/ecrireFaits.ts`, même ordre et mêmes garanties :
//   1. `validerPiece` (pure) — un refus est NOMMÉ, jamais un rejet muet ;
//   2. l'empreinte d'OUBLI, sur TOUS les chemins — une pièce oubliée ne revient ni par le
//      rejeu, ni par le rattrapage, ni par le flux vivant. C'est la règle non négociable de
//      l'ADR 0001, et la table `oublis` est partagée avec les faits : l'empreinte porte donc
//      son GENRE (`piece`), sinon oublier un document en tant que fait oublierait aussi sa
//      pièce, ou l'inverse — deux décisions distinctes de Marc, confondues par une clé ;
//   3. l'empreinte d'IDEMPOTENCE — une pièce déjà écrite n'est JAMAIS dupliquée. Elle est
//      `dejaPresentes`, SAUF le seul cas que l'ADR 0006 §2 autorise : une vraie lecture qui
//      arrive sur un INVENTAIRE la REMPLACE (l'ancienne est gardée, marquée `remplacee`).
//      ⚠⚠ Cette phrase disait « jamais réécrite » jusqu'au 18/09, et c'était VRAI — c'est
//      précisément ce qui rendait l'import de 2 645 papiers INERTE : DriveAI pouvait ouvrir
//      le document, appeler un modèle, PAYER l'appel, et la ligne restait celle du nom de
//      fichier. L'argent partait, rien ne changeait ;
//   4. le chiffrement, SELON LE RÉGIME (`./regime.ts`), puis l'insertion avec ses exemplaires.
//
// ⚠️ CE QUI EST CHIFFRÉ, ET CE QUI NE L'EST JAMAIS :
//   - `champs_structures` et `champs_libres` : TOUJOURS chiffrés, dans les deux régimes —
//     c'est là que vivent les numéros de référence, les montants, les numéros d'identité ;
//   - `type` et `emetteur` : chiffrés, avec leur clé keyée en clair pour compter (facettes) ;
//   - `resume` : clair ou chiffré selon le régime ; `recherche` n'existe qu'en clair, et
//     `validerPiece` ne le produit que si le régime l'autorise ;
//   - `chemin` d'un exemplaire : chiffré (un chemin Drive nomme les dossiers, donc parfois
//     le statut migratoire) ; le `fileId`, opaque, reste en clair — c'est la jointure.
//
// ⚠️ L'AAD EST `id|niveau`, comme pour un fait : rétrograder une pièce N3 en N1 « pour la
// lire » fait ÉCHOUER le déchiffrement. C'est la seule garde qui tient contre un UPDATE direct.

import { randomUUID } from "node:crypto";
import { chiffrer, empreinte, type Cle } from "../chiffrement";
import type { Ecrivain } from "../jetons";
import { cleFacette } from "./facettes";
import { validerPiece, type CodeRefusPiece, type PieceValidee } from "./validerPiece";
import type { DepotPieces } from "./depot";
import { APP_INVENTAIRE, APPS_PIECES, peutRemplacer } from "./lignee";

export const LOT_PIECES_MAX = 50;

export interface RefusPieceDansLot {
  index: number;
  code: CodeRefusPiece;
  raison: string;
  champ?: string;
}

export interface ResultatLotPieces {
  recus: number;
  acceptees: number;
  /**
   * Combien de pièces d'INVENTAIRE ont été remplacées par une vraie lecture (ADR 0006).
   *
   * ⚠️ SOUS-ENSEMBLE de `acceptees`, pas une catégorie à côté : un remplacement CRÉE bien une
   * ligne. Le compteur existe parce que sans lui l'appelant ne peut pas distinguer « le lot
   * a enrichi 40 papiers déjà connus » de « le lot a ajouté 40 papiers neufs » — et c'est
   * exactement la question que l'import de Marc pose.
   */
  remplacees: number;
  dejaPresentes: number;
  oubliees: number;
  refusees: RefusPieceDansLot[];
  idsCrees: string[];
}

export class LotPiecesTropGrandError extends Error {
  constructor(n: number) {
    super(`lot de ${n} pièces : le maximum est ${LOT_PIECES_MAX}`);
    this.name = "LotPiecesTropGrandError";
  }
}

export class EcriturePiecesRetireeError extends Error {
  constructor(appId: string) {
    super(`le périmètre de « ${appId} » ne permet plus l'écriture`);
    this.name = "EcriturePiecesRetireeError";
  }
}

/** L'exemplaire qui IDENTIFIE la pièce : le premier déclaré. */
export function exemplairePrincipal(p: PieceValidee): string {
  return p.exemplaires[0]!.fileId;
}

/**
 * ⚠️ LE GENRE ENTRE DANS LES DEUX EMPREINTES. `oublis` est une table partagée avec les
 * faits : sans `piece`, oublier le fait `document.existe` d'un fichier oublierait aussi sa
 * pièce — or ce sont deux gestes différents (« ne me redis plus qu'il existe » ≠ « ne garde
 * plus ce qu'il contient »), et Marc doit pouvoir faire l'un sans l'autre.
 */
export function empreinteOubliPiece(cle: Cle, sujet: string, fileId: string): string {
  return empreinte(cle, "oubli", "piece", fileId, sujet);
}

export function empreintePiece(cle: Cle, sujet: string, fileId: string): string {
  return empreinte(cle, "piece", sujet, fileId);
}

export async function ecrireLotPieces(
  entrees: readonly unknown[],
  ecrivain: Ecrivain,
  cle: Cle,
  depot: DepotPieces,
  /**
   * L'`id` du fait d'origine, PAR ENTRÉE, pour la migration des `document.existe` (ADR 0004
   * §6.2). ⚠️ Il n'est PAS dans le contrat de `POST /api/pieces`, et il ne doit pas y être :
   * c'est un lien INTERNE, celui qui rend l'annulation de la migration exacte. Un écrivain
   * externe n'a aucune raison de le poser — lui ouvrir le champ, c'est lui laisser rattacher
   * une pièce à un fait qui n'est pas le sien.
   *
   * Ce paramètre existe pour qu'il n'y ait qu'UN chemin d'écriture. Deux implémentations de
   * la même règle, c'est une règle et demie : la seconde oublierait le régime de chiffrement
   * ou la clé de facette, et ça ne se verrait qu'en lisant une ligne déjà écrite.
   */
  origines?: readonly (string | null)[],
): Promise<ResultatLotPieces> {
  if (entrees.length > LOT_PIECES_MAX) throw new LotPiecesTropGrandError(entrees.length);
  if (ecrivain.role !== "ecriture") throw new EcriturePiecesRetireeError(ecrivain.appId);
  // ADR 0015 §2.1 — re-vérifié ICI, au point d'écriture, et pas seulement dans la route : seules
  // les apps de `APPS_PIECES` écrivent des papiers, plus l'inventaire EN PROCESSUS (sans route).
  if (!APPS_PIECES.has(ecrivain.appId) && ecrivain.appId !== APP_INVENTAIRE) {
    throw new EcriturePiecesRetireeError(ecrivain.appId);
  }
  const perimetre = await depot.perimetre(ecrivain.appId);
  if (perimetre && perimetre.role !== "ecriture") throw new EcriturePiecesRetireeError(ecrivain.appId);

  const resultat: ResultatLotPieces = {
    recus: entrees.length,
    acceptees: 0,
    remplacees: 0,
    dejaPresentes: 0,
    oubliees: 0,
    refusees: [],
    idsCrees: [],
  };

  const valides: { index: number; piece: PieceValidee }[] = [];
  for (const [index, entree] of entrees.entries()) {
    const r = validerPiece(entree);
    if (!r.ok) {
      resultat.refusees.push({ index, code: r.code, raison: r.message, ...(r.champ ? { champ: r.champ } : {}) });
      continue;
    }
    valides.push({ index, piece: r });
  }
  if (valides.length === 0) return resultat;

  // Les deux consultations se font EN LOT, avant toute écriture : une pièce oubliée ne doit
  // pas être écrite puis retirée — elle ne doit jamais entrer.
  const oublis = valides.map((v) => empreinteOubliPiece(cle, v.piece.sujet, exemplairePrincipal(v.piece)));
  const empreintes = valides.map((v) => empreintePiece(cle, v.piece.sujet, exemplairePrincipal(v.piece)));
  const [oubliees, existantes] = await Promise.all([
    depot.oubliesParmi(oublis),
    depot.existantesParmi(empreintes),
  ]);

  for (const [rang, { piece }] of valides.entries()) {
    if (oubliees.has(oublis[rang]!)) {
      resultat.oubliees += 1;
      continue;
    }
    // ── LE VERDICT — ADR 0006 §2, AMENDÉ PAR L'ADR 0008 ────────────────────────────
    //
    // Deux sens autorisés, et le prédicat est la SEULE écriture de la règle : un extracteur
    // de modèle remplace l'inventaire, et un rang strictement supérieur de la lignée remplace
    // un rang inférieur. ⚠️ Toujours PAS « la meilleure confiance gagne » (un modèle
    // s'AUTO-évalue) ni « la plus récente gagne » (une re-lecture par la MÊME version reste
    // `dejaPresentes`, donc ce cas n'est jamais atteint).
    const existant = existantes.get(empreintes[rang]!);
    const idARemplacer =
      existant &&
      peutRemplacer(
        { app: existant.ecrivainApp, extracteur: existant.extracteur },
        // L'app est celle du JETON (ADR 0015 §2.2), jamais un nom lu dans le lot.
        { app: ecrivain.appId, extracteur: piece.extracteur },
      )
        ? existant.id
        : null;
    if (existant && idARemplacer === null) {
      resultat.dejaPresentes += 1;
      continue;
    }

    const id = randomUUID();
    const niveau = piece.regime.niveau;
    const sceller = (v: string | null) => (v === null ? null : chiffrer(cle, v, id, niveau));

    const nouvelle = {
        id,
        sujet: piece.sujet,
        type: sceller(piece.type),
        typeCle: cleFacette(cle, "type", piece.type),
        emetteur: sceller(piece.emetteur),
        emetteurCle: cleFacette(cle, "emetteur", piece.emetteur),
        // Un titulaire nomme une personne : chiffré comme un nom de proche l'est déjà.
        titulaire: sceller(piece.titulaire),
        titulaireCle: cleFacette(cle, "titulaire", piece.titulaire),
        titulaireConfiance: piece.titulaireConfiance,
        annee: piece.annee,
        domaine: piece.domaine,
        langue: piece.langue,
        dateDocument: piece.dateDocument,
        dateEcheance: piece.dateEcheance,
        niveau,
        resumeEnClair: piece.regime.resumeEnClair,
        // Le régime décide, et il décide ICI comme au point de validation : la contrainte
        // SQL `pieces_chiffre_sans_recherche` n'est que le filet.
        resume: piece.regime.resumeEnClair ? piece.resume : sceller(piece.resume),
        recherche: piece.recherche,
        champsStructures: sceller(piece.champsStructures ? JSON.stringify(piece.champsStructures) : null),
        champsLibres: sceller(piece.champsLibres ? JSON.stringify(piece.champsLibres) : null),
        confiance: piece.confiance,
        extracteur: piece.extracteur,
        ecrivainApp: ecrivain.appId,
        empreinte: empreintes[rang]!,
        origineFaitId: origines?.[valides[rang]!.index] ?? null,
        // ⚠️ C'est CE champ qui rend l'ancienne retrouvable — sans lui, « gardée » ne veut
        // rien dire : la ligne existerait encore sans que personne ne puisse la relier au
        // papier. Il existait au schéma depuis des lots, sans aucun producteur.
        remplaceId: idARemplacer,
    };
    const exemplaires = piece.exemplaires.map((x, i) => ({
        pieceId: id,
        fileId: x.fileId,
        chemin: x.chemin === null ? null : chiffrer(cle, x.chemin, id, niveau),
        principal: i === 0,
    }));

    if (idARemplacer !== null) {
      await depot.remplacer(idARemplacer, nouvelle, exemplaires);
      resultat.remplacees += 1;
    } else {
      await depot.inserer(nouvelle, exemplaires);
    }

    // ⚠️ Un remplacement compte AUSSI comme accepté : une ligne est créée, et son id est
    // dans `idsCrees`. `remplacees` le qualifie, il ne l'exclut pas.
    resultat.acceptees += 1;
    resultat.idsCrees.push(id);
  }

  return resultat;
}
