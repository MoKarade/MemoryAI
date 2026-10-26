// lib/lia/journal.ts — le journal de ce que LIA fait seule, et son frein (ADR 0032, migration 0037). I/O : les
// règles sont dans `lib/lia/autonomie.ts`, qui reste pur. Déclaré à côté de son code : `lib/db/schema.ts` ne
// bouge pas. La migration SQL fait foi (`drizzle/0037_actions_lia.sql`).
//
// ⚠️ LE FREIN SE LIT AVANT CHAQUE ACTION, pas une fois au début de la passe : posé au milieu, la suivante ne
// part pas. Une ligne absente vaut « en marche » ; un frein ILLISIBLE (base en panne) fait échouer l'action,
// il ne la laisse jamais partir (échec fermé).
// ⚠️ ÉCRIRE LE JOURNAL NE BLOQUE JAMAIS L'ACTION : un journal en panne se voit dans le journal serveur.
// ⚠️ Des COMPTES seulement : aucune valeur de fait, aucun contenu n'entre ici.

import { randomUUID } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { boolean, check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { jourQuebec } from "../coutChat";
import { ligneJournal, RETENTION_JOURNAL_JOURS, type CleAction, type Issue } from "./autonomie";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

const actionsLia = pgTable(
  "actions_lia",
  {
    id: text("id").primaryKey(),
    jour: text("jour").notNull(),
    instant: timestamp("instant", { withTimezone: true }).notNull().defaultNow(),
    action: text("action").notNull(),
    niveau: text("niveau").notNull(),
    raison: text("raison").notNull(),
    n: integer("n").notNull().default(0),
    issue: text("issue").notNull(),
  },
  (t) => [
    index("actions_lia_jour").on(t.jour, t.instant),
    check("actions_lia_niveau", sql`${t.niveau} IN ('lecture', 'ecriture-interne')`),
    check("actions_lia_issue", sql`${t.issue} IN ('faite', 'echec', 'frein', 'budget')`),
    check("actions_lia_raison_200", sql`char_length(${t.raison}) <= 200`),
    check("actions_lia_n_positif", sql`${t.n} >= 0`),
  ],
);

/** Le frein : UNE ligne (`id = 'frein'`). Absente, LIA est en marche. */
const freinLia = pgTable(
  "lia_frein",
  {
    id: text("id").primaryKey().default("frein"),
    enPause: boolean("en_pause").notNull().default(false),
    changeLe: timestamp("change_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("lia_frein_une_ligne", sql`${t.id} = 'frein'`)],
);

const JOUR_MS = 86_400_000;

/** Vrai : le frein est posé, rien ne part seul. */
export async function lireFrein(db: Base): Promise<boolean> {
  const [r] = await db.select({ pause: freinLia.enPause }).from(freinLia).where(eq(freinLia.id, "frein"));
  return r?.pause ?? false;
}

/** Une ligne au journal. Ne lève jamais : l'action a eu lieu (ou non) quoi que dise le journal. */
export async function consigner(db: Base, maintenant: Date, action: CleAction, issue: Issue, n: number): Promise<void> {
  try {
    await db.insert(actionsLia).values({ id: randomUUID(), jour: jourQuebec(maintenant), instant: maintenant, ...ligneJournal(action, issue, n) });
  } catch (err) {
    console.error("[autonomie] journal non écrit", err instanceof Error ? err.name : "erreur");
  }
}

/**
 * Une action autonome : le frein d'abord, puis l'action, puis sa ligne au journal. `compter` dit combien
 * d'éléments elle a touchés. Un échec est noté PUIS relancé, pour que la passe le montre à sa façon.
 */
export async function agirSeule<T>(db: Base, maintenant: Date, action: CleAction, faire: () => Promise<T>, compter: (r: T) => number): Promise<T | "frein"> {
  if (await lireFrein(db)) {
    await consigner(db, maintenant, action, "frein", 0);
    return "frein";
  }
  let r: T;
  try {
    r = await faire();
  } catch (err) {
    await consigner(db, maintenant, action, "echec", 0);
    throw err;
  }
  await consigner(db, maintenant, action, "faite", compter(r));
  return r;
}

/** Efface les lignes de plus de `RETENTION_JOURNAL_JOURS` jours. Rend combien. */
export async function purgerJournal(db: Base, maintenant: Date): Promise<number> {
  const limite = new Date(maintenant.getTime() - RETENTION_JOURNAL_JOURS * JOUR_MS);
  const parties = await db.delete(actionsLia).where(lt(actionsLia.instant, limite)).returning({ id: actionsLia.id });
  return parties.length;
}
