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
  informations: number | null;
  gele: boolean;
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
    informations: totalInformations({ faits: valides, papiers: papiers.total }),
    gele,
  };
}
