// lib/pieces/depotRelecture.ts — l'accès base de la seconde lecture (ADR 0026), derrière une interface.

import { and, count, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { Perimetre, Piece } from "../db/schema";
import { sauvetageEnCours } from "../sauvetage/porte";

type NouvelleRelecture = typeof schema.relecturesPieces.$inferInsert;

export interface DepotRelecture {
  sauvetageEnCours?(): Promise<boolean>;
  perimetre(appId: string): Promise<Perimetre | null>;
  /** La pièce dont ce fichier est l'exemplaire PRINCIPAL, ou null. Un exemplaire secondaire ne suffit pas. */
  pieceParFichier(fileId: string): Promise<Piece | null>;
  /** Les doutes déjà placés en tête de la pile ce jour-là. */
  doutesEnPile(jour: string): Promise<number>;
  /** Faux si cette pièce a déjà été relue par ce même extracteur : rien n'est réécrit. */
  ecrire(ligne: NouvelleRelecture): Promise<boolean>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export function depotRelectureDrizzle(db: Base): DepotRelecture {
  return {
    sauvetageEnCours: () => sauvetageEnCours(db),

    async perimetre(appId) {
      const rows = await db.select().from(schema.perimetres).where(eq(schema.perimetres.appId, appId)).limit(1);
      return rows[0] ?? null;
    },

    async pieceParFichier(fileId) {
      const ex = await db
        .select({ pieceId: schema.pieceExemplaires.pieceId })
        .from(schema.pieceExemplaires)
        .where(and(eq(schema.pieceExemplaires.fileId, fileId), eq(schema.pieceExemplaires.principal, true)));
      if (ex.length === 0) return null;
      const rows = await db
        .select()
        .from(schema.pieces)
        .where(and(inArray(schema.pieces.id, ex.map((x) => x.pieceId)), eq(schema.pieces.statut, "active")));
      // ⚠️ Deux pièces vivantes pour un même principal : aucune n'est jugée, plutôt qu'une au hasard.
      return rows.length === 1 ? (rows[0] ?? null) : null;
    },

    async doutesEnPile(jour) {
      const [r] = await db
        .select({ n: count() })
        .from(schema.relecturesPieces)
        .where(and(eq(schema.relecturesPieces.jour, jour), eq(schema.relecturesPieces.enPile, true)));
      return r?.n ?? 0;
    },

    async ecrire(ligne) {
      const rows = await db
        .insert(schema.relecturesPieces)
        .values(ligne)
        .onConflictDoNothing()
        .returning({ id: schema.relecturesPieces.id });
      return rows.length > 0;
    },
  };
}
