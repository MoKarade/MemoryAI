import { EXTRACTEUR_MIGRATION } from "./migration";

/**
 * LA LIGNÉE DES EXTRACTEURS — ADR 0008.
 *
 * Elle vit ICI, jamais dans le lot reçu, et c'est tout ce qui sépare une permission POSÉE
 * d'une permission DEMANDÉE : un producteur qui annoncerait « je suis la v9 » sans que ce nom
 * figure ci-dessous ne remplace rien. Il ne peut pas s'auto-autoriser.
 *
 * ⚠️ L'ORDRE EST LA RÈGLE. Le rang d'un nom dit ce qu'il remplace ; ajouter un nom AILLEURS
 * qu'en queue réécrirait le passé. On ajoute en queue, jamais au milieu, jamais on ne retire.
 *
 * ⚠️ Pourquoi une liste plutôt qu'un numéro de version parsé dans le nom. Un comparateur de
 * versions dirait que « v10 » précède « v9 », et surtout il accepterait n'importe quel nom
 * bien formé — donc il rendrait la lignée ouverte, ce qui est exactement ce qu'on refuse.
 */
export const LIGNEE_EXTRACTEURS: readonly string[] = [
  // Rang 0 — l'inventaire. Il n'a jamais rien LU : il dérive le type et l'émetteur du nom de
  // fichier classé. C'est pour ça que tout extracteur de modèle le remplace (ADR 0006 §2).
  EXTRACTEUR_MIGRATION,
  // Rang 1 — la première vraie lecture (DriveAI, `EXTRACTEUR_PIECE_MEMOIRE`). Les papiers lus
  // sous ce nom l'ont été sans la consigne « date de naissance » (20/09/2026) et sans la porte
  // « lisible » (21/09) : c'est cette dette-là que l'ADR 0008 rend rattrapable.
  "haiku-4.5-piece-v1",
  // Rang 2 — le prompt du 21/09/2026. Deux changements le séparent du rang 1, et ce sont eux
  // qui justifient de pouvoir relire : la consigne « date de naissance » (20/09) et la porte
  // « lisible » (21/09, C49-7 de DriveAI), sans laquelle un OCR de bruit produit un papier
  // fabriqué. ⚠️ CE NOM DÉSIGNE LA VERSION DU PROMPT, pas celle du modèle : c'est le prompt
  // qui décide de ce qui est lu, et deux lectures du même modèle sous deux prompts n'ont pas
  // la même valeur.
  "haiku-4.5-piece-v2",
  // Rang 3 — ADR 0010 (24/09/2026). Deux changements de NATURE, pas de réglage : le modèle LIT
  // le document lui-même (l'image ou le PDF, plus l'OCR qui en avait été tiré), et le prompt
  // demande TOUT — chaque numéro, chaque date, la zone lisible par machine, l'apparence de Marc
  // sur sa photo. C'est la réponse à « il ne récupère pas assez d'info par document ». Une
  // lecture sous ce nom remplace une lecture v2, qui reste gardée (ADR 0008).
  "sonnet-5-vision-piece-v3",
];

/**
 * QUI écrit des papiers (ADR 0015 §2.1). Une liste FERMÉE, écrite ici : le jeton prouve l'app,
 * et seule une app de cette liste écrit, remplace ou lit la file des papiers. En ajouter une est
 * une décision de frontière (ADR + OK de Marc), jamais une ligne glissée dans un lot.
 */
export const APPS_PIECES: ReadonlySet<string> = new Set(["driveai"]);

/**
 * L'écrivain EN PROCESSUS de l'inventaire (`lib/pieces/migrerInventaire.ts`). Il n'a aucune
 * route et aucun jeton : ce nom n'est jamais déduit d'une requête.
 */
export const APP_INVENTAIRE = "migration-inventaire";

/**
 * La lignée PAR APP (ADR 0015 §2.2). Un nom d'extracteur n'a de rang que dans la lignée de
 * l'app que le JETON prouve : une autre app qui se déclare « sonnet-5-vision-piece-v3 » n'y a
 * aucun rang, donc ne remplace rien.
 */
const LIGNEE_PAR_APP: Readonly<Record<string, readonly string[]>> = { driveai: LIGNEE_EXTRACTEURS };

const RANGS_PAR_APP: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(
  Object.entries(LIGNEE_PAR_APP).map(([app, lignee]) => [app, new Map(lignee.map((nom, rang) => [nom, rang] as const))]),
);

/** Un papier tel que la règle le voit : QUI l'a écrit (l'app du jeton) et SOUS QUEL NOM. */
export interface AuteurPiece {
  /** `null` : papier écrit avant la migration 0020, jamais rempli (voir `estInventaire`). */
  app: string | null;
  extracteur: string;
}

/**
 * Le papier existant est-il un INVENTAIRE (rang 0, rien n'a été LU) ?
 *
 * ⚠️ Un papier sans app (antérieur à la migration 0020) n'est reconnu comme inventaire que par
 * son nom d'extracteur : c'était, avant l'ADR 0015, la seule façon de le dire. Tout autre papier
 * sans app ne se REMPLACE PAS tant que la migration 0021 ne l'a pas attribué : le côté sûr.
 */
function estInventaire(p: AuteurPiece): boolean {
  return p.app === APP_INVENTAIRE || (p.app === null && p.extracteur === EXTRACTEUR_MIGRATION);
}

/**
 * PURE. Cet ENTRANT a-t-il le droit de remplacer l'EXISTANT ? (ADR 0006 §2, 0008, 0015 §2.2)
 *
 * Deux sens autorisés, et rien d'autre :
 *
 *  1. ADR 0006 §2 — une app de `APPS_PIECES` remplace un INVENTAIRE, par une lecture.
 *     ⚠️ Y COMPRIS sous un nom absent de sa lignée : restreindre ici casserait l'import le jour
 *     où DriveAI change de modèle, et le symptôme serait « l'import n'avance plus », muet.
 *  2. ADR 0008 — la MÊME app remplace son propre papier par un rang STRICTEMENT supérieur de
 *     SA lignée.
 *
 * Tout le reste est `false` : autre app (ADR 0015), même rang, rang inférieur, nom inconnu
 * face à une vraie lecture, papier sans app qui n'est pas un inventaire.
 *
 * ⚠️ Ce prédicat ne lit NI la confiance (un modèle s'auto-évalue) NI une date (une re-lecture
 * ratée écraserait une bonne extraction). Il lit l'app PROUVÉE par le jeton, puis des noms dont
 * l'ordre est une décision humaine.
 */
export function peutRemplacer(existant: AuteurPiece, entrant: AuteurPiece): boolean {
  if (entrant.app === null || !APPS_PIECES.has(entrant.app)) return false;
  if (estInventaire(existant)) return entrant.extracteur !== EXTRACTEUR_MIGRATION;
  if (existant.app !== entrant.app) return false;
  const rangs = RANGS_PAR_APP.get(entrant.app);
  const rangExistant = rangs?.get(existant.extracteur);
  const rangEntrant = rangs?.get(entrant.extracteur);
  if (rangExistant === undefined || rangEntrant === undefined) return false;
  return rangEntrant > rangExistant;
}
