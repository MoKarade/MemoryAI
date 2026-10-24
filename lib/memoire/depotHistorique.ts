// lib/memoire/depotHistorique.ts — les lectures de l'onglet Historique (`app/memoire/historique`).
// Des COMPTES par jour et par source : aucun texte, aucune valeur, rien de déchiffré.
//
// ⚠️ Le jour est celui de Québec, calculé par Postgres avec le fuseau écrit une fois
// (`lib/fuseau.ts`) : un `date(cree_le)` nu compterait en UTC, et une écriture de 21 h tomberait
// le lendemain.

import { count, gte, isNull, max, sql, sum } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { FUSEAU } from "@/lib/fuseau";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface SourceConversations {
  source: string;
  conversations: number;
  messages: number;
  derniere: Date | null;
}

export interface DepotHistorique {
  faitsParJour(depuis: Date): Promise<{ jour: string; n: number }[]>;
  lecturesParJour(depuis: Date): Promise<{ jour: string; n: number }[]>;
  conversationsParSource(): Promise<SourceConversations[]>;
}

const jourDe = (col: PgColumn) => sql<string>`to_char(${col} at time zone ${FUSEAU}, 'YYYY-MM-DD')`;
// ⚠️ On groupe par la POSITION de la colonne, jamais en répétant `jour` : le fuseau y est un
// paramètre, deux fois écrit il devient $1 et $3, deux expressions pour Postgres (42803, prod du
// 23/10). Verrou : `tests/memoireHistoriqueBase.test.ts`, sur une vraie base.
const PREMIERE_COLONNE = sql`1`;

export function depotHistoriqueDrizzle(db: Base): DepotHistorique {
  return {
    async faitsParJour(depuis) {
      const jour = jourDe(schema.faits.creeLe);
      const lignes = await db.select({ jour, n: count() }).from(schema.faits).where(gte(schema.faits.creeLe, depuis)).groupBy(PREMIERE_COLONNE);
      return lignes.map((l) => ({ jour: l.jour, n: l.n }));
    },
    async lecturesParJour(depuis) {
      const j = schema.accesJournal;
      const jour = jourDe(j.ts);
      const lignes = await db.select({ jour, n: count() }).from(j).where(gte(j.ts, depuis)).groupBy(PREMIERE_COLONNE);
      return lignes.map((l) => ({ jour: l.jour, n: l.n }));
    },
    async conversationsParSource() {
      const c = schema.conversations;
      const lignes = await db
        .select({ source: c.source, conversations: count(), messages: sum(c.nbMessages), derniere: max(c.finLe) })
        .from(c)
        .where(isNull(c.supprimeLe))
        .groupBy(c.source);
      return lignes.map((l) => ({ source: l.source, conversations: l.conversations, messages: Number(l.messages ?? 0), derniere: l.derniere }));
    },
  };
}
