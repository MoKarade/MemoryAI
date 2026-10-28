// lib/etatPublic.ts — ce que la mémoire répond à une app qui l'alimente, en NOMBRES.
//
// PUR : aucune lecture, aucune horloge, aucune base. On lui donne les comptes, il rend le
// corps de `GET /api/etat`. C'est ce qui permet de perturber chaque décision sans monter
// Postgres — et chaque nombre publié ici est une affirmation qu'un autre dépôt affichera.
//
// ⚠️ LA FRONTIÈRE N'EST PAS ÉLARGIE. Rien de ce qui sort ne vient du CONTENU d'un fait ou
// d'un papier : ni valeur, ni prédicat, ni nom de fichier, ni domaine, ni date lue dans un
// document. `dernierValideLe` est un horodatage de TRAITEMENT — quand la mémoire a validé,
// pas ce qu'elle a validé.

import { totalInformations } from "./totalInformations";

/** Ce que `depotLecture.comptes()` donne, réduit à ce qui sort d'ici. */
export interface ComptesFaitsPublies {
  parStatut: Record<string, number>;
  canaris: number;
  dernierValideLe: string | null;
  migresEnPiece: number;
}

export interface EtatPublic {
  app: "memoryai";
  faits: {
    valides: number;
    aValider: number;
    canaris: number;
    migresEnPiece: number;
    dernierValideLe: string | null;
  };
  papiers: {
    total: number;
    lus: number;
    importesSeulement: number;
  };
  /**
   * Marc ne juge plus rien (25/10/2026, tâche MemoryAI 231) : `aJugerParMarc` vaut TOUJOURS 0, et
   * ce que LIA a tranché seule se compte (faits validés par sa relecture, papiers « vrai par LIA »
   * par la seconde lecture de DriveAI). Le reste n'est ni vrai ni posé à Marc : « non confirmé ».
   */
  jugement: {
    aJugerParMarc: 0;
    faitsParLia: number;
    papiersParLia: number;
  };
  informations: number | null;
  gele: boolean;
  /**
   * L'agenda du jour envoyé par DriveAI (ADR 0029) : le compte et l'heure de lecture, jamais un
   * titre. `null` : rien reçu aujourd'hui. Absent : la route ne l'a pas lu.
   */
  agenda?: { jour: string; evenements: number; luLe: string } | null;
  /**
   * Ce qui sort des apps (ADR 0031 § 5) : combien de sorties gardées et combien de refus sur 7 jours,
   * deux nombres GLOBAUX — jamais par app. Absent : la route ne l'a pas lu.
   */
  sorties?: { gardees: number; refusSur7Jours: number };
  /**
   * Les notes de LIA au coordinateur (ADR 0022) : le NOMBRE de non lues, jamais le contenu, le genre
   * ni l'app d'une note. Absent : le compte n'a pas pu être lu (jamais un 0 inventé).
   */
  notesLia?: { nonLues: number };
}

/**
 * PUR. Le corps de la réponse.
 *
 * ⚠️ `migresEnPiece` est PUBLIÉ, jamais tu. 2 646 faits devenus des pièces manquent à
 * `valides` sans qu'aucun autre champ ne dise où ils sont partis : un appelant qui compare
 * deux relevés verrait une chute de 94 % et conclurait à une perte de données. C'est la même
 * raison qui a rendu `papiers` REQUIS sur la carte du hub.
 *
 * ⚠️ `lus` et `importesSeulement` sont la distinction que Marc a demandée en toutes lettres
 * le 23/09 (« lu vs importé ») : un papier importé n'est qu'un nom de fichier que la mémoire
 * sait exister, un papier lu a été ouvert par un modèle. Le critère vient de
 * `comptesParExtracteur`, qui porte la raison de ne PAS le déduire de `domaine IS NULL`.
 *
 * ⚠️ `informations` peut être `null` — c'est {@link totalInformations} qui refuse une somme
 * dont un poste n'a pas été mesuré, plutôt que de publier un cumul amputé sous une étiquette
 * qui dit « en tout ».
 */
export function composerEtatPublic(
  faits: ComptesFaitsPublies,
  papiers: { total: number },
  extracteurs: { lus: number; nonLus: number },
  gele: boolean,
  parLia: { faits: number; papiers: number },
  agenda?: EtatPublic["agenda"],
  sorties?: EtatPublic["sorties"],
  notesLia?: EtatPublic["notesLia"],
): EtatPublic {
  const valides = faits.parStatut.valide ?? 0;
  return {
    app: "memoryai",
    faits: {
      valides,
      aValider: faits.parStatut.propose ?? 0,
      canaris: faits.canaris,
      migresEnPiece: faits.migresEnPiece,
      dernierValideLe: faits.dernierValideLe,
    },
    papiers: {
      total: papiers.total,
      lus: extracteurs.lus,
      importesSeulement: extracteurs.nonLus,
    },
    jugement: { aJugerParMarc: 0, faitsParLia: parLia.faits, papiersParLia: parLia.papiers },
    informations: totalInformations({ faits: valides, papiers: papiers.total }),
    gele,
    ...(agenda !== undefined ? { agenda } : {}),
    ...(sorties !== undefined ? { sorties } : {}),
    ...(notesLia !== undefined ? { notesLia } : {}),
  };
}
