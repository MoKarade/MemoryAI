// lib/pieces/depotMigration.ts — l'accès base de la migration `document.existe` → `pieces`.
//
// Même patron que les autres dépôts : l'orchestration (`./migrerInventaire.ts`) ne connaît
// que l'interface, donc elle se teste sur PGlite comme sur Neon. Ce module ne déchiffre rien
// et ne décide rien — il rend les lignes TELLES QUELLES, chiffrées.

import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { DepotMigration } from "./migrerInventaire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export function depotMigrationDrizzle(db: Base): DepotMigration {
  const restants = (predicat: string) => [
    eq(schema.faits.predicat, predicat),
    isNull(schema.faits.migreEnPiece),
    isNull(schema.faits.supprimeLe),
  ];

  return {
    async aMigrer(predicat, limite) {
      // Les plus ANCIENS d'abord : sur une file alimentée en continu par le tick de DriveAI,
      // repartir « du haut » à chaque passe laisserait le vieux stock stagner indéfiniment
      // pendant que le neuf passe devant (leçon DriveAI sur les files mouvantes).
      return db
        .select({
          id: schema.faits.id,
          predicat: schema.faits.predicat,
          valeurType: schema.faits.valeurType,
          niveau: schema.faits.niveau,
          domaine: schema.faits.domaine,
          valideDe: schema.faits.valideDe,
          creeLe: schema.faits.creeLe,
          valeur: schema.faits.valeur,
          attributs: schema.faits.attributs,
        })
        .from(schema.faits)
        .where(and(...restants(predicat)))
        .orderBy(schema.faits.creeLe)
        .limit(limite);
    },

    async resteAMigrer(predicat) {
      const [r] = await db.select({ n: count() }).from(schema.faits).where(and(...restants(predicat)));
      return r?.n ?? 0;
    },

    async marquerMigres(ids, maintenant) {
      if (ids.length === 0) return;
      await db
        .update(schema.faits)
        .set({ migreEnPiece: maintenant })
        .where(inArray(schema.faits.id, [...ids]));
    },

    async annuler() {
      // ⚠️ L'ORDRE EST L'INVERSE DE LA MIGRATION, et c'est voulu : on rend les faits D'ABORD,
      // on supprime les pièces ENSUITE. Une coupure entre les deux laisse un doublon visible
      // (le fait ET sa pièce), jamais un trou — alors que l'ordre inverse laisserait un
      // instant où le papier n'existe nulle part.
      const rendus = await db
        .update(schema.faits)
        .set({ migreEnPiece: null })
        .where(isNotNull(schema.faits.migreEnPiece))
        .returning({ id: schema.faits.id });
      // On ne supprime QUE ce que la migration a créé — c'est à ça que sert `origine_fait_id`.
      // Une pièce extraite par DriveAI sur le même papier n'est pas touchée.
      const retirees = await db
        .delete(schema.pieces)
        .where(sql`${schema.pieces.origineFaitId} IS NOT NULL`)
        .returning({ id: schema.pieces.id });
      return { faits: rendus.length, pieces: retirees.length };
    },
  };
}
