// lib/accueil/depotAccueil.ts — les lectures des panneaux de la maison qui n'existaient nulle part
// ailleurs (maquette v5, écart B). Des SOMMES, des COMPTES et des HEURES : aucun texte, aucune
// valeur de fait, rien de déchiffré.

import { count, desc, eq, gte, like, max, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { POSTES, type Poste } from "@/lib/coutChat";
import type { ActiviteDuJour } from "./tableaux";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotAccueil {
  /** Dépense par modèle depuis ce jour (`AAAA-MM-JJ` de Québec, inclus), la plus forte d'abord. */
  depenseParModeleDepuis(jour: string): Promise<{ modele: string; usd: number }[]>;
  /** Les lectures journalisées depuis cet instant (heure, lecteur, outil), la plus récente d'abord. */
  lecturesDepuis(depuis: Date, limite: number): Promise<{ ts: Date; lecteur: string; outil: string }[]>;
  /** Appels journalisés par outil depuis cet instant, le plus appelé d'abord. */
  appelsParOutilDepuis(depuis: Date): Promise<{ outil: string; n: number }[]>;
  /** Ce qu'elle a fait ce jour (`AAAA-MM-JJ` de Québec), compté, et ses dernières vérifications (tâche MemoryAI 232). */
  activiteDuJour(jour: string): Promise<ActiviteDuJour>;
}

/** Un `max` de colonne horodatée : une date, ou `null` quand la table n'a rien. */
const date = (v: Date | string | null | undefined): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

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
    async activiteDuJour(jour) {
      const v = schema.validationsLia;
      const r = schema.relecturesPieces;
      const m = schema.mondeCache;
      const parPoste = await db.select({ poste: d.poste, n: count() }).from(d).where(eq(d.jour, jour)).groupBy(d.poste);
      const appels = Object.fromEntries(POSTES.map((p) => [p, 0])) as Record<Poste, number>;
      for (const l of parPoste) appels[l.poste] = Number(l.n);
      const [faits] = await db.select({ n: count() }).from(v).where(eq(v.jour, jour));
      const [papiers] = await db.select({ n: count() }).from(r).where(eq(r.jour, jour));
      const [meteo] = await db.select({ t: max(m.luLe) }).from(m).where(like(m.cle, "meteo|%"));
      const [actualite] = await db.select({ t: max(m.luLe) }).from(m).where(like(m.cle, "actualite|%"));
      const [budget] = await db.select({ t: max(d.creeLe) }).from(d);
      const [relu] = await db.select({ t: max(v.reluLe) }).from(v);
      const [second] = await db.select({ t: max(r.reluLe) }).from(r);
      const [lu] = await db.select({ t: max(j.ts) }).from(j);
      return {
        jour,
        appels,
        faitsRelus: Number(faits?.n ?? 0),
        papiersRelus: Number(papiers?.n ?? 0),
        dernieres: {
          meteo: date(meteo?.t),
          actualite: date(actualite?.t),
          budget: date(budget?.t),
          faits: date(relu?.t),
          papiers: date(second?.t),
          lectures: date(lu?.t),
        },
      };
    },
  };
}
