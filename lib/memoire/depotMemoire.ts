// lib/memoire/depotMemoire.ts — les lectures des tuiles de l'onglet Mémoire (maquette v5, écart C).
// Des COMPTES et des dates : aucune valeur de fait, rien de déchiffré.

import { and, count, countDistinct, eq, isNull, max } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { conditionServis } from "@/lib/depotLecture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotMemoire {
  /** Faits validés servis, par type de source, et la date de la plus récente provenance. */
  faitsParSource(): Promise<{ source: (typeof schema.SOURCES)[number]; n: number; dernier: Date | null }[]>;
  /** Les papiers gardés (non supprimés). */
  nombrePapiers(): Promise<number>;
}

export function depotMemoireDrizzle(db: Base): DepotMemoire {
  const f = schema.faits;
  const p = schema.provenances;
  return {
    async faitsParSource() {
      const lignes = await db
        .select({ source: p.sourceType, n: countDistinct(p.faitId), dernier: max(p.creeLe) })
        .from(p)
        .innerJoin(f, eq(f.id, p.faitId))
        .where(and(conditionServis(), eq(f.statut, "valide")))
        .groupBy(p.sourceType);
      return lignes.map((l) => ({ source: l.source, n: Number(l.n), dernier: l.dernier ? new Date(l.dernier) : null }));
    },
    async nombrePapiers() {
      const [r] = await db.select({ n: count() }).from(schema.pieces).where(isNull(schema.pieces.supprimeLe));
      return Number(r?.n ?? 0);
    },
  };
}
