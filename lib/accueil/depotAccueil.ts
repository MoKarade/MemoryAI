// lib/accueil/depotAccueil.ts — les lectures des panneaux de la maison qui n'existaient nulle part
// ailleurs (maquette v5, écart B). Des SOMMES et des COMPTES : aucun texte, aucune valeur de fait,
// rien de déchiffré.

import { count, desc, gte, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotAccueil {
  /** Dépense par modèle depuis ce jour (`AAAA-MM-JJ` de Québec, inclus), la plus forte d'abord. */
  depenseParModeleDepuis(jour: string): Promise<{ modele: string; usd: number }[]>;
  /** Les lectures journalisées depuis cet instant (heure, lecteur, outil), la plus récente d'abord. */
  lecturesDepuis(depuis: Date, limite: number): Promise<{ ts: Date; lecteur: string; outil: string }[]>;
  /** Appels journalisés par outil depuis cet instant, le plus appelé d'abord. */
  appelsParOutilDepuis(depuis: Date): Promise<{ outil: string; n: number }[]>;
}

export function depotAccueilDrizzle(db: Base): DepotAccueil {
  const j = schema.accesJournal;
  const d = schema.depensesChat;
  return {
    async depenseParModeleDepuis(jour) {
      const lignes = await db.select({ modele: d.modele, usd: sum(d.coutUsd) }).from(d).where(gte(d.jour, jour)).groupBy(d.modele).orderBy(desc(sum(d.coutUsd)));
      // Un `sum` nul (aucune ligne chiffrée) vaut 0, jamais `NaN` dans une part.
      return lignes.map((l) => ({ modele: l.modele, usd: Number(l.usd ?? 0) || 0 }));
    },
    async lecturesDepuis(depuis, limite) {
      return db.select({ ts: j.ts, lecteur: j.lecteur, outil: j.outil }).from(j).where(gte(j.ts, depuis)).orderBy(desc(j.id)).limit(limite);
    },
    async appelsParOutilDepuis(depuis) {
      const lignes = await db.select({ outil: j.outil, n: count() }).from(j).where(gte(j.ts, depuis)).groupBy(j.outil).orderBy(desc(count()));
      return lignes.map((l) => ({ outil: l.outil, n: Number(l.n) }));
    },
  };
}
