// lib/pieces/lecture.ts — ce qu'une PIÈCE laisse sortir, et ce qu'elle garde. PURE.
//
// Une pièce n'affirme rien sur Marc : elle rapporte ce qu'un PAPIER contient. C'est ce qui
// lui vaut des champs libres sans rouvrir la porte d'injection des faits — et c'est aussi ce
// qui oblige à décider, ici, ce qu'un modèle a le droit d'en lire.
//
// ⚠️ TROIS SORTS, ET AUCUN N'EST LE SILENCE. Une pièce qui ne sort pas se COMPTE : « aucune
// pièce » et « des pièces, mais leur niveau ne sort pas ici » ne disent pas la même chose, et
// seule la seconde désigne un geste (ouvrir la bascule, ou aller la lire dans l'app).
//
//   1. `niveau <= niveauMaxServi` ⇒ COMPLÈTE — type, émetteur, résumé, champs, exemplaires.
//      ⚠️ Depuis le 19/09/2026, ce plafond peut valoir 3 (décision de Marc, `n3Autorise` +
//      `inclure_n3`) : un papier d'identité sort alors COMPLET, et le sommaire du cas 2 ne
//      lui est plus appliqué. C'est la seule façon de répondre à « j'ai quel âge » quand la
//      date de naissance vit dans les champs chiffrés d'un passeport.
//   2. `niveau === 3` ⇒ SOMMAIRE — le domaine, l'année et les DATES, rien d'autre. Ces
//      colonnes-là sont en clair par conception (un millésime seul n'identifie personne), et
//      elles suffisent à répondre « ton statut expire le … » sans dire lequel. Le type et
//      l'émetteur d'un papier N3, eux, DISENT le statut migratoire : ils restent dedans.
//   3. `niveau === 2` sans la bascule ⇒ RIEN, mais compté.
//
// ⚠️ Le sommaire n'est pas une demi-fuite : il ne déchiffre RIEN. Ce qu'il rend est ce que la
// base porte déjà en clair, et qui y est en clair parce qu'on l'a décidé (`lib/db/schema.ts`).

import { dechiffrer, DechiffrementError, estScelleAncien, longueurClaire, type Cle } from "../chiffrement";
import { lienDrive, niveauMaxServi, type PolitiqueLecture } from "../lecture";
import type { Piece, PieceExemplaire } from "../db/schema";

export interface ExemplaireLisible {
  fileId: string;
  chemin: string | null;
  lien: string;
  principal: boolean;
}

export interface PieceLisible {
  id: string;
  /** `complete` ou `sommaire` — le lecteur DOIT pouvoir le dire, sinon il croit tout avoir. */
  forme: "complete" | "sommaire";
  domaine: string | null;
  annee: number | null;
  langue: string | null;
  dateDocument: string | null;
  dateEcheance: string | null;
  niveau: number;
  statut: string;
  confiance: number;
  extracteur: string;
  /** Absents d'un sommaire — et c'est une décision, pas une donnée manquante. */
  type: string | null;
  emetteur: string | null;
  titulaire: string | null;
  titulaireConfiance: number | null;
  resume: string | null;
  champsStructures: Record<string, unknown> | null;
  champsLibres: Record<string, string> | null;
  exemplaires: ExemplaireLisible[];
  /**
   * Ce que Marc a dit de CETTE lecture (ADR 0012) : `confirme` (vrai), `conteste` (faux), ou
   * absent. Un papier contesté reste servi — Marc a choisi « contesté, relu », pas « retiré » —
   * et c'est cette marque qui interdit au chat de présenter sa lecture comme sûre.
   */
  avisMarc?: "confirme" | "conteste" | null;
}

export interface PieceAvecExemplaires {
  piece: Piece;
  exemplaires: readonly PieceExemplaire[];
  /** Le dernier avis de Marc sur ce papier (ADR 0012), lu À CÔTÉ de la pièce, jamais dedans. */
  avisMarc?: "vrai" | "faux" | "passe" | null;
}

/** Le sort d'une pièce sous cette politique. PURE, et c'est elle qu'on perturbe. */
export function sortDeLaPiece(
  p: Pick<Piece, "supprimeLe" | "statut" | "niveau">,
  politique: PolitiqueLecture,
): "complete" | "sommaire" | "retenue" {
  if (p.supprimeLe) return "retenue";
  if (p.statut !== "active") return "retenue";
  if (p.niveau <= niveauMaxServi(politique)) return "complete";
  // ⚠️ L'ORDRE compte : un N3 rend un sommaire, un N2 non autorisé ne rend RIEN. Les inverser
  // ferait sortir moins pour le niveau le plus bas, ce qui est absurde et passerait inaperçu.
  if (p.niveau === 3) return "sommaire";
  return "retenue";
}

/**
 * Le niveau de ce qui est RÉELLEMENT sorti d'un papier, pour le journal d'accès (BACKLOG, revue
 * #72). Un papier N3 servi en sommaire ne montre que le domaine, l'année et les dates : le
 * journal ne doit pas l'inscrire « niveau 3 servi », il paraîtrait plus grave qu'il n'est.
 * Un sommaire vaut donc au plus 2 ; un papier complet garde son niveau. PURE.
 */
export function niveauServi(niveau: number, forme: "complete" | "sommaire"): number {
  return forme === "sommaire" ? Math.min(niveau, 2) : niveau;
}

function dechiffrerSi(cle: Cle, valeur: string | null, id: string, niveau: number, enClair: boolean): string | null {
  if (valeur === null) return null;
  return enClair ? valeur : dechiffrer(cle, valeur, id, niveau);
}

/**
 * Une facette (type, émetteur, titulaire, chemin). ⚠️ `ecrireLotPieces` les scelle à TOUT
 * niveau, 0 compris : on suit donc la FORME de la valeur, comme `rescellerPiece`, pas le niveau.
 * Au niveau 0, seul un texte nu (ancienne ligne) est le clair ; au-delà, tout se déchiffre.
 */
export function ouvrirFacette(cle: Cle, valeur: string | null, id: string, niveau: number): string | null {
  if (valeur === null) return null;
  const scelleCourant = longueurClaire(valeur) !== null && !estScelleAncien(valeur);
  return niveau === 0 && !scelleCourant ? valeur : dechiffrer(cle, valeur, id, niveau);
}

function jsonChiffre(cle: Cle, valeur: string | null, id: string, niveau: number): Record<string, never> | null {
  if (valeur === null) return null;
  return JSON.parse(dechiffrer(cle, valeur, id, niveau)) as Record<string, never>;
}


/** Ce qu'une LISTE montre d'un papier : de quoi le reconnaitre, jamais ce qu'il contient. */
export interface FacettesPiece {
  id: string;
  forme: "complete" | "sommaire";
  type: string | null;
  emetteur: string | null;
  titulaire: string | null;
  domaine: string | null;
  annee: number | null;
  dateDocument: string | null;
  dateEcheance: string | null;
  niveau: number;
  extracteur: string;
  creeLe: Date;
  /** Le premier exemplaire : de quoi ouvrir le document dans le Drive. */
  fileId: string | null;
  lien: string | null;
  nbExemplaires: number;
}

/**
 * Dechiffre les FACETTES d'un papier — type, emetteur, titulaire — et RIEN d'autre.
 *
 * ⚠️ POURQUOI ELLE EXISTE, a cote de `rendreLisiblePiece`. L'ecran des papiers en montre
 * cent d'un coup. Les passer toutes par `rendreLisiblePiece` deposerait cent resumes et cent
 * jeux de champs en clair dans le HTML a chaque affichage — exactement ce que le regime de
 * chiffrement protege, pour un ecran qui n'a besoin que de savoir DE QUOI on parle. Le
 * contenu s'ouvre papier par papier, a la demande.
 *
 * ⚠️ La REGLE de ce qui sort reste `sortDeLaPiece`, appelee ici comme partout : deux
 * implementations du meme arbitrage divergeraient, et c'est l'ecran qui porterait la
 * divergence. Un N3 rend donc un sommaire — sans type ni emetteur — et le DIT par sa `forme`.
 */
export function rendreFacettesPiece(
  r: PieceAvecExemplaires,
  politique: PolitiqueLecture,
  cle: Cle,
): FacettesPiece | null {
  const p = r.piece;
  const sort = sortDeLaPiece(p, politique);
  if (sort === "retenue") return null;
  const principal = r.exemplaires.find((x) => x.principal) ?? r.exemplaires[0] ?? null;
  const n = p.niveau;
  const complet = sort === "complete";
  return {
    id: p.id,
    forme: sort,
    type: complet ? ouvrirFacette(cle, p.type, p.id, n) : null,
    emetteur: complet ? ouvrirFacette(cle, p.emetteur, p.id, n) : null,
    titulaire: complet ? ouvrirFacette(cle, p.titulaire, p.id, n) : null,
    domaine: p.domaine,
    annee: p.annee,
    dateDocument: p.dateDocument,
    dateEcheance: p.dateEcheance,
    niveau: p.niveau,
    extracteur: p.extracteur,
    creeLe: p.creeLe,
    fileId: principal ? principal.fileId : null,
    lien: principal ? lienDrive(principal.fileId) : null,
    nbExemplaires: r.exemplaires.length,
  };
}

/**
 * Déchiffre et met en forme UNE pièce. Lève `DechiffrementError` si une valeur est altérée —
 * jamais une chaîne vide, qui serait une donnée inventée.
 */
export function rendreLisiblePiece(
  r: PieceAvecExemplaires,
  politique: PolitiqueLecture,
  cle: Cle,
): PieceLisible | null {
  const p = r.piece;
  const sort = sortDeLaPiece(p, politique);
  if (sort === "retenue") return null;

  const socle = {
    id: p.id,
    forme: sort,
    domaine: p.domaine,
    annee: p.annee,
    langue: p.langue,
    dateDocument: p.dateDocument,
    dateEcheance: p.dateEcheance,
    niveau: p.niveau,
    statut: p.statut,
    confiance: p.confiance,
    extracteur: p.extracteur,
    avisMarc: r.avisMarc === "vrai" ? ("confirme" as const) : r.avisMarc === "faux" ? ("conteste" as const) : null,
  };

  if (sort === "sommaire") {
    return {
      ...socle,
      type: null,
      emetteur: null,
      titulaire: null,
      titulaireConfiance: null,
      resume: null,
      champsStructures: null,
      champsLibres: null,
      // ⚠️ Même l'exemplaire est réduit : le `fileId` est opaque et sert à retrouver le
      // papier, mais le CHEMIN porte le nom des dossiers — donc le domaine, donc parfois le
      // statut migratoire. Il reste dedans.
      exemplaires: r.exemplaires.map((x) => ({
        fileId: x.fileId,
        chemin: null,
        lien: lienDrive(x.fileId),
        principal: x.principal,
      })),
    };
  }

  const n = p.niveau;
  return {
    ...socle,
    type: ouvrirFacette(cle, p.type, p.id, n),
    emetteur: ouvrirFacette(cle, p.emetteur, p.id, n),
    titulaire: ouvrirFacette(cle, p.titulaire, p.id, n),
    titulaireConfiance: p.titulaireConfiance,
    resume: dechiffrerSi(cle, p.resume, p.id, n, p.resumeEnClair),
    champsStructures: jsonChiffre(cle, p.champsStructures, p.id, n),
    champsLibres: jsonChiffre(cle, p.champsLibres, p.id, n) as Record<string, string> | null,
    exemplaires: r.exemplaires.map((x) => ({
      fileId: x.fileId,
      chemin: ouvrirFacette(cle, x.chemin, p.id, n),
      lien: lienDrive(x.fileId),
      principal: x.principal,
    })),
  };
}

/**
 * Filtre, déchiffre, et COMPTE ce qui n'est pas sorti. Un compte à part par raison : une
 * pièce retenue par son niveau et une pièce illisible (clé tournée, ligne altérée) appellent
 * des gestes opposés — l'une une bascule, l'autre une enquête.
 */
export function rendreServablesPieces(
  rows: readonly PieceAvecExemplaires[],
  politique: PolitiqueLecture,
  cle: Cle,
): { pieces: PieceLisible[]; retenues: number; illisibles: number; sommaires: number } {
  const pieces: PieceLisible[] = [];
  let retenues = 0;
  let illisibles = 0;
  // ⚠️ LE TROISIÈME SORT SE COMPTE AUSSI. L'en-tête de ce module dit « aucun n'est le
  // silence », et le compte s'arrêtait pourtant à deux : une pièce servie en SOMMAIRE
  // arrivait dans `pieces` comme une pièce complète, donc un modèle lisait « ce papier
  // existe, sans contenu » et concluait que la Mémoire ne sait rien de plus. Elle sait.
  let sommaires = 0;
  for (const r of rows) {
    try {
      const l = rendreLisiblePiece(r, politique, cle);
      if (l === null) retenues++;
      else {
        if (l.forme === "sommaire") sommaires++;
        pieces.push(l);
      }
    } catch (err) {
      if (err instanceof DechiffrementError) illisibles++;
      else throw err;
    }
  }
  return { pieces, retenues, illisibles, sommaires };
}
