// lib/sorties/retention.ts — garder peu, compter ce qui est refusé, publier deux nombres (ADR 0031 §§ 4-5). I/O.
//
// ⚠️ LA PURGE EST PAR APP ET LA PLUS ANCIENNE D'ABORD : 180 jours de réception, puis au plus 2 000 lignes par app
// (les plus récentes par date). Une app bavarde ne chasse donc jamais les sorties d'une autre.
// ⚠️ LES REFUS SE COMPTENT, ILS NE SE RACONTENT PAS : un nombre par (jour, code fermé). Ni texte, ni app.
// ⚠️ LES DEUX NOMBRES PUBLIÉS SONT GLOBAUX, jamais par app : `GET /api/etat` reste ouvert à tout jeton connu.

import { count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { jourQuebec } from "../coutChat";
import { APPS_SORTIES } from "./contrat";
import { sorties, sortiesRefus } from "./table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export const RETENTION_JOURS = 180;
export const PLAFOND_PAR_APP = 2000;
const FENETRE_REFUS_JOURS = 7;
const JOUR_MS = 86_400_000;

export interface ResultatPurge {
  /** Effacées parce que reçues il y a plus de `RETENTION_JOURS`. */
  anciennes: number;
  /** Effacées parce qu'une app dépassait `PLAFOND_PAR_APP`. */
  enTrop: number;
}

/** Ajoute les refus d'un envoi au compteur du jour : un code, un nombre. Un code est borné, il ne peut pas porter un texte. */
export async function noterRefus(db: Base, jour: string, codes: readonly string[]): Promise<void> {
  const parCode = new Map<string, number>();
  for (const c of codes) {
    const k = c.slice(0, 40);
    parCode.set(k, (parCode.get(k) ?? 0) + 1);
  }
  if (parCode.size === 0) return;
  await db
    .insert(sortiesRefus)
    .values([...parCode].map(([code, n]) => ({ jour, code, n })))
    .onConflictDoUpdate({ target: [sortiesRefus.jour, sortiesRefus.code], set: { n: sql`${sortiesRefus.n} + excluded.n` } });
}

/** Efface ce qui dépasse la rétention. Le plafond est un argument pour que le test n'ait pas à écrire 2 000 lignes. */
export async function purgerSorties(db: Base, maintenant: Date, plafond: number = PLAFOND_PAR_APP): Promise<ResultatPurge> {
  const limite = new Date(maintenant.getTime() - RETENTION_JOURS * JOUR_MS);
  const vieilles = await db.delete(sorties).where(lt(sorties.recuLe, limite)).returning({ id: sorties.id });
  let enTrop = 0;
  for (const app of APPS_SORTIES) {
    const exces = await db
      .select({ id: sorties.id })
      .from(sorties)
      .where(eq(sorties.app, app))
      .orderBy(desc(sorties.date), desc(sorties.recuLe))
      .offset(plafond);
    if (exces.length === 0) continue;
    const parties = await db
      .delete(sorties)
      .where(
        inArray(
          sorties.id,
          exces.map((x) => x.id),
        ),
      )
      .returning({ id: sorties.id });
    enTrop += parties.length;
  }
  return { anciennes: vieilles.length, enTrop };
}

/** Les deux nombres de `GET /api/etat` : combien de sorties gardées, combien de refus sur les 7 derniers jours. */
export async function comptesSorties(db: Base, maintenant: Date): Promise<{ gardees: number; refusSur7Jours: number }> {
  const depuis = jourQuebec(new Date(maintenant.getTime() - (FENETRE_REFUS_JOURS - 1) * JOUR_MS));
  const [g] = await db.select({ n: count() }).from(sorties);
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${sortiesRefus.n}), 0)::int` })
    .from(sortiesRefus)
    .where(gte(sortiesRefus.jour, depuis));
  return { gardees: g?.n ?? 0, refusSur7Jours: r?.n ?? 0 };
}
