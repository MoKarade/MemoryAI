// lib/avancement/comptesMemoire.ts — ce que la MÉMOIRE mesure pour l'onglet « Avancement ».
//
// Deux lectures, et une fonction pure au milieu :
//   - les papiers par dossier, lus ou non ;
//   - ce qu'on a tiré des papiers LUS : dates, montants, numéros, personnes, lieux.
//
// ⚠️ LE CONTENU EST DÉCHIFFRÉ ICI, MAIS SEULS DES NOMBRES EN SORTENT. Les champs structurés sont
// toujours chiffrés (`lib/pieces/ecrire.ts`) ; pour compter ce qu'ils portent, il faut les ouvrir,
// côté serveur. `compterExtraits` rend des compteurs et rien d'autre — aucune valeur, aucun
// libellé — et c'est ce que la page affiche. Le déchiffreur est INJECTÉ : la fonction se teste
// sans clé, et la garde « aucune valeur ne sort » se vérifie sur ce qu'elle rend.
//
// ⚠️ LE VERROU DE LECTURE S'APPLIQUE AVANT LE DÉCHIFFREMENT, PAS APRÈS (revue sécurité, 23/09).
// Ne sortir que des nombres ne suffit pas : ce que l'ADR 0007 garde est le geste d'OUVRIR les
// colonnes chiffrées d'un papier N2/N3, pas seulement leur affichage. Chaque papier passe donc
// par `sortDeLaPiece` — la même règle que la liste et la fiche : « complete » s'ouvre, un N3 en
// « sommaire » ne compte que ses dates (colonnes en clair, déjà montrées par la liste), et un
// papier « retenu » n'est compté que comme PROTÉGÉ. Une seconde écriture de la règle ici
// divergerait au premier réglage.
//
// ⚠️ UN PAPIER ILLISIBLE SE COMPTE, IL NE DEVIENT PAS « SANS EXTRAIT ». Un déchiffrement qui
// échoue (clé tournée, ligne altérée) est dit à l'écran ; le rabattre sur zéro amputerait le
// total en silence, et un cumul amputé se présente comme une mesure.

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { Piece } from "../db/schema";
import type { PolitiqueLecture } from "../lecture";
import { sortDeLaPiece } from "../pieces/lecture";
import { EXTRACTEUR_MIGRATION } from "../pieces/migration";
import { FAMILLES_STRUCTUREES, type FamilleStructuree } from "../pieces/validerPiece";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- même type de base que `depotLecture`
type Base = PgDatabase<PgQueryResultHKT, any>;

const vivante = () => [isNull(schema.pieces.supprimeLe), eq(schema.pieces.statut, "active")];

/** Les papiers par dossier (code à deux chiffres), lus ou non. Les domaines sans code sont ignorés. */
export async function comptesParDossier(db: Base): Promise<{ code: string; lus: number; connus: number }[]> {
  const code = sql<string>`left(${schema.pieces.domaine}, 2)`;
  const rows = await db
    .select({
      code,
      connus: sql<number>`count(*)::int`,
      lus: sql<number>`(count(*) filter (where ${schema.pieces.extracteur} <> ${EXTRACTEUR_MIGRATION}))::int`,
    })
    .from(schema.pieces)
    .where(and(...vivante(), sql`${schema.pieces.domaine} ~ '^[0-9]{2}'`))
    .groupBy(code);
  return rows.map((r) => ({ code: r.code, lus: Number(r.lus), connus: Number(r.connus) }));
}

export interface LigneExtrait {
  id: string;
  niveau: number;
  statut: Piece["statut"];
  supprimeLe: Date | null;
  dateDocument: string | null;
  dateEcheance: string | null;
  champsStructures: string | null;
}

/** Les papiers LUS, avec ce qu'il faut pour compter leurs extraits. Contenu encore chiffré. */
export async function lignesExtraits(db: Base): Promise<LigneExtrait[]> {
  return db
    .select({
      id: schema.pieces.id,
      niveau: schema.pieces.niveau,
      statut: schema.pieces.statut,
      supprimeLe: schema.pieces.supprimeLe,
      dateDocument: schema.pieces.dateDocument,
      dateEcheance: schema.pieces.dateEcheance,
      champsStructures: schema.pieces.champsStructures,
    })
    .from(schema.pieces)
    .where(and(...vivante(), ne(schema.pieces.extracteur, EXTRACTEUR_MIGRATION)));
}

export interface Extraits {
  /** Papiers lus examinés. */
  papiers: number;
  avecDate: number;
  avecEcheance: number;
  /** Nombre d'ENTRÉES trouvées, par famille (un relevé peut porter douze montants). */
  entrees: Record<FamilleStructuree, number>;
  /** Nombre de PAPIERS qui portent au moins une entrée de la famille. */
  papiersAvec: Record<FamilleStructuree, number>;
  /**
   * Papiers que la politique de lecture ne laisse pas ouvrir (N3 sans `MEMORYAI_N3_CHAT`, N2
   * sans `MEMORYAI_N2_CHAT`) : COMPTÉS à part, jamais ouverts — leurs extraits ne sont donc pas
   * dans les totaux, et l'écran le dit.
   */
  proteges: number;
  /** Déchiffrement ou lecture impossible : COMPTÉS, jamais rabattus sur « rien trouvé ». */
  illisibles: number;
}

const zeroParFamille = (): Record<FamilleStructuree, number> =>
  Object.fromEntries(FAMILLES_STRUCTUREES.map((f) => [f, 0])) as Record<FamilleStructuree, number>;

/**
 * PURE (le déchiffreur est injecté). Ne rend que des compteurs.
 *
 * ⚠️ `politique` est REQUISE : optionnelle, son défaut serait soit « tout ouvrir » (le défaut
 * qu'on corrige), soit une règle de plus à tenir à jour. Le compilateur énumère les appelants.
 */
export function compterExtraits(
  lignes: readonly LigneExtrait[],
  dechiffrer: (scelle: string, id: string, niveau: number) => string,
  politique: PolitiqueLecture,
): Extraits {
  const r: Extraits = {
    papiers: lignes.length,
    avecDate: 0,
    avecEcheance: 0,
    entrees: zeroParFamille(),
    papiersAvec: zeroParFamille(),
    proteges: 0,
    illisibles: 0,
  };
  for (const l of lignes) {
    const sort = sortDeLaPiece(l, politique);
    if (sort === "retenue") {
      r.proteges++;
      continue;
    }
    if (l.dateDocument) r.avecDate++;
    if (l.dateEcheance) r.avecEcheance++;
    if (sort === "sommaire") {
      r.proteges++;
      continue;
    }
    if (l.champsStructures === null) continue;
    let champs: unknown;
    try {
      champs = JSON.parse(dechiffrer(l.champsStructures, l.id, l.niveau));
    } catch {
      r.illisibles++;
      continue;
    }
    if (!champs || typeof champs !== "object") continue;
    for (const f of FAMILLES_STRUCTUREES) {
      const liste = (champs as Record<string, unknown>)[f];
      if (!Array.isArray(liste) || liste.length === 0) continue;
      r.entrees[f] += liste.length;
      r.papiersAvec[f]++;
    }
  }
  return r;
}
