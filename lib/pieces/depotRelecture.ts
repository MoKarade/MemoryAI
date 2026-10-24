// lib/pieces/depotRelecture.ts — l'accès base de la seconde lecture (ADR 0026), derrière une interface.

import { and, count, countDistinct, desc, eq, inArray, isNull } from "drizzle-orm";
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

const R = schema.relecturesPieces;
const vivante = and(eq(schema.pieces.statut, "active"), isNull(schema.pieces.supprimeLe));

/** Les papiers dont la seconde lecture doute, à mettre en tête de la pile : les plus récents d'abord. */
export async function papiersEnTete(db: Base): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: R.pieceId, le: R.reluLe })
    .from(R)
    .innerJoin(schema.pieces, eq(schema.pieces.id, R.pieceId))
    .where(and(eq(R.enPile, true), eq(R.decision, "doute"), vivante))
    .orderBy(desc(R.reluLe));
  return [...new Set(rows.map((r) => r.id))];
}

/** Combien de papiers vivants sont jugés « vrai » par LIA : l'onglet Apprentissage le dit. */
export async function papiersVraisParLia(db: Base): Promise<number> {
  const [r] = await db
    .select({ n: countDistinct(R.pieceId) })
    .from(R)
    .innerJoin(schema.pieces, eq(schema.pieces.id, R.pieceId))
    .where(and(eq(R.decision, "vrai"), vivante));
  return r?.n ?? 0;
}

/** La dernière seconde lecture d'UN papier : sa décision et les champs qui divergent ; `null` si jamais relu. */
export async function relecturePapier(db: Base, pieceId: string): Promise<{ decision: "vrai" | "doute"; champs: string[] } | null> {
  const [t] = await db.select({ decision: R.decision, divergents: R.divergents }).from(R).where(eq(R.pieceId, pieceId)).orderBy(desc(R.reluLe)).limit(1);
  return t ? { decision: t.decision, champs: (t.divergents ?? "").split(",").filter(Boolean) } : null;
}
