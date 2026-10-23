// lib/memoire/depotApprentissage.ts — les lectures de l'onglet Apprentissage
// (`app/memoire/apprentissage`). Des COMPTES et les mesures du banc (des nombres seulement,
// `lib/db/schema.ts#bancMesures`) : aucune question du banc, aucun fait, rien de déchiffré.

import { and, count, desc, eq, isNull, like, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotApprentissage {
  /** Les mesures du banc, les plus récentes d'abord. */
  mesures(banc: string, limite: number): Promise<{ mesureLe: Date; chercheur: string; resultat: string }[]>;
  /** Les faits tirés des conversations (`extracteur` `conversation-*`), par statut. */
  faitsAppris(): Promise<{ statut: string; n: number }[]>;
  questionsParStatut(): Promise<{ statut: string; n: number }[]>;
}

export function depotApprentissageDrizzle(db: Base): DepotApprentissage {
  return {
    async mesures(banc, limite) {
      const m = schema.bancMesures;
      return db
        .select({ mesureLe: m.mesureLe, chercheur: m.chercheur, resultat: m.resultat })
        .from(m)
        .where(eq(m.banc, banc))
        .orderBy(desc(m.mesureLe), desc(m.id))
        .limit(limite);
    },
    async faitsAppris() {
      const f = schema.faits;
      const p = schema.provenances;
      // ⚠️ `count(distinct)` : un fait cité par deux conversations a deux provenances, mais
      // il n'a été appris qu'une fois.
      return db
        .select({ statut: f.statut, n: sql<number>`count(distinct ${f.id})::int` })
        .from(f)
        .innerJoin(p, eq(p.faitId, f.id))
        .where(and(isNull(f.supprimeLe), like(p.extracteur, "conversation-%")))
        .groupBy(f.statut);
    },
    async questionsParStatut() {
      const q = schema.questions;
      return db.select({ statut: q.statut, n: count() }).from(q).groupBy(q.statut);
    },
  };
}
