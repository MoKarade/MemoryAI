// lib/accueil/depotAccueil.ts — les lectures des panneaux de la maison qui n'existaient nulle part
// ailleurs (maquette v5, écart B). Des COMPTES : aucun texte, aucune valeur de fait, rien de déchiffré.

import { count, desc, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotAccueil {
  /** Appels journalisés par outil depuis cet instant, le plus appelé d'abord. */
  appelsParOutilDepuis(depuis: Date): Promise<{ outil: string; n: number }[]>;
}

export function depotAccueilDrizzle(db: Base): DepotAccueil {
  const j = schema.accesJournal;
  return {
    async appelsParOutilDepuis(depuis) {
      const lignes = await db.select({ outil: j.outil, n: count() }).from(j).where(gte(j.ts, depuis)).groupBy(j.outil).orderBy(desc(count()));
      return lignes.map((l) => ({ outil: l.outil, n: Number(l.n) }));
    },
  };
}
