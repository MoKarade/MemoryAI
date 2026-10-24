// lib/pieces/depotOubli.ts — RETIRER une pièce de la Mémoire.
//
// ⚠️ POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EXISTAIT PAS. `empreinteOubliPiece` est
// écrite, testée et commentée depuis C49-1 ; la table `oublis` porte le genre `piece` ; le
// dépôt sait LIRE les oublis (`oubliesParmi`). Mais personne ne pouvait en POSER un : pas de
// page, pas d'outil, et le bouton « oublier » de l'interface ne vise que les FAITS. Le
// mécanisme complet était donc inatteignable — c'est `UN-CHAMP-TYPE-SANS-PRODUCTEUR` appliqué
// à un chemin de repli, et c'est plus grave : un repli qu'on croit avoir est un repli qu'on
// n'a pas.
//
// Mesuré le 17/09, avant de bâtir le rattrapage : Marc a choisi de pousser `04 · Immigration`
// et `01 · Administratif & identité` EN PREMIER, « pour voir tout de suite ce que la Mémoire
// sait de mes papiers d'identité — et si c'est mauvais, on arrête avant d'avoir dépensé ».
// « Arrêter » empêche la SUITE de partir ; ça ne retire pas ce qui EST parti. Sans ce fichier,
// sa décision reposait sur une possibilité qui n'existait pas.
//
// ⚠️ L'oubli est DÉFINITIF par conception : l'empreinte reste après la suppression, donc la
// pièce ne revient ni par le rejeu, ni par le rattrapage, ni par le flux vivant. C'est la
// règle non négociable de l'ADR 0001, et c'est exactement ce qu'on veut ici — un retrait qui
// se ferait ré-écrire au tick suivant ne serait pas un retrait.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { Cle } from "../chiffrement";
import { empreinteOubliPiece } from "./ecrire";
import { effacerTraceSauvetage } from "../sauvetage/porte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export type ResultatOubliPiece = "ok" | "introuvable";

export interface DepotOubliPieces {
  /**
   * Oublie UNE pièce : pose l'empreinte d'oubli pour chacun de ses exemplaires, puis la marque
   * supprimée. Rend `introuvable` si elle n'existe pas ou si elle est déjà partie — jamais un
   * `ok` complaisant, sinon l'écran affirme un retrait qui n'a pas eu lieu.
   */
  oublier(pieceId: string, cle: Cle, raison: string, maintenant: Date): Promise<ResultatOubliPiece>;
}

export function depotOubliPiecesDrizzle(db: Base): DepotOubliPieces {
  return {
    async oublier(pieceId, cle, raison, maintenant) {
      const rows = await db
        .select({ id: schema.pieces.id, sujet: schema.pieces.sujet })
        .from(schema.pieces)
        .where(and(eq(schema.pieces.id, pieceId), isNull(schema.pieces.supprimeLe)))
        .limit(1);
      const piece = rows[0];
      if (!piece) return "introuvable";

      // ⚠️ TOUS les exemplaires, pas seulement le premier. L'écriture ne pose l'empreinte que
      // sur l'exemplaire PRINCIPAL (c'est lui qui identifie la pièce à l'entrée), mais un même
      // papier peut avoir été déposé deux fois dans le Drive : n'oublier que le principal
      // laisserait le doublon revenir au prochain rattrapage, sous une autre pièce. Un retrait
      // qui laisse rentrer la même chose par la porte d'à côté n'est pas un retrait.
      const exemplaires = await db
        .select({ fileId: schema.pieceExemplaires.fileId })
        .from(schema.pieceExemplaires)
        .where(eq(schema.pieceExemplaires.pieceId, pieceId));

      const empreintes = exemplaires.map((e) => empreinteOubliPiece(cle, piece.sujet, e.fileId));
      if (empreintes.length > 0) {
        await db
          .insert(schema.oublis)
          .values(empreintes.map((empreinte) => ({ empreinte, raison })))
          .onConflictDoNothing();
      }

      // ⚠️ L'EMPREINTE D'ABORD, LA SUPPRESSION ENSUITE. Dans l'autre ordre, une coupure entre
      // les deux laisse une pièce supprimée SANS oubli : elle revient au prochain rattrapage,
      // et Marc croit l'avoir retirée. Même règle que l'Index du moteur — l'écriture « c'est
      // fini » se pose en dernier.
      await db
        .update(schema.pieces)
        .set({ supprimeLe: maintenant })
        .where(eq(schema.pieces.id, pieceId));
      // ADR 0020 : un export oublié emporte les messages qu'on en a tirés, sinon on les retrouverait.
      const fileIds = exemplaires.map((e) => e.fileId);
      if (fileIds.length > 0) {
        await db
          .update(schema.evenements)
          .set({ supprimeLe: maintenant })
          .where(and(inArray(schema.evenements.sourceRef, fileIds), isNull(schema.evenements.supprimeLe)));
      }
      // ADR 0019 : l'archive du sauvetage garde les anciens scellés de ce papier ; un papier
      // oublié n'y reste pas (revue du 23/10).
      await effacerTraceSauvetage(db, "pieces", pieceId);
      return "ok";
    },
  };
}

/** Les pièces ACTIVES les plus récentes, pour l'écran de retrait. Métadonnées seulement. */
export interface LignePieceRetrait {
  id: string;
  domaine: string | null;
  niveau: number;
  annee: number | null;
  dateDocument: string | null;
  extracteur: string;
  creeLe: Date;
  fileIds: string[];
}

export async function listerPiecesRecentes(db: Base, limite: number): Promise<LignePieceRetrait[]> {
  const rows = await db
    .select({
      id: schema.pieces.id,
      domaine: schema.pieces.domaine,
      niveau: schema.pieces.niveau,
      annee: schema.pieces.annee,
      dateDocument: schema.pieces.dateDocument,
      extracteur: schema.pieces.extracteur,
      creeLe: schema.pieces.creeLe,
    })
    .from(schema.pieces)
    .where(isNull(schema.pieces.supprimeLe))
    .orderBy(desc(schema.pieces.creeLe))
    .limit(limite);
  if (rows.length === 0) return [];

  // ⚠️ Les exemplaires en UNE requête, jamais une par ligne : cet écran sert justement quand il
  // y en a beaucoup, et c'est le moment où une requête par ligne devient insupportable.
  const ids = rows.map((r) => r.id);
  const ex = await db
    .select({ pieceId: schema.pieceExemplaires.pieceId, fileId: schema.pieceExemplaires.fileId })
    .from(schema.pieceExemplaires)
    .where(inArray(schema.pieceExemplaires.pieceId, ids));
  const parPiece = new Map<string, string[]>();
  for (const e of ex) parPiece.set(e.pieceId, [...(parPiece.get(e.pieceId) ?? []), e.fileId]);

  return rows.map((r) => ({ ...r, fileIds: parPiece.get(r.id) ?? [] }));
}
