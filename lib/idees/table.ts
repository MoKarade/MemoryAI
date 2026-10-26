// lib/idees/table.ts — la table des idées de LIA (ADR 0027, migration 0033). Déclarée à côté de son
// code : `lib/db/schema.ts` ne bouge pas dans ce lot. La migration SQL fait foi (`drizzle/0033_idees.sql`).
//
// `cible` est le nom de la demande, CHIFFRÉ au niveau 1 (AAD `idee|<id>`) ; `raisons` ne porte que
// des nombres et un jour (`Raisons`), jamais du texte libre.

import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Raisons } from "./regles";

export const idees = pgTable(
  "idees",
  {
    id: text("id").primaryKey(),
    regle: text("regle").notNull(),
    app: text("app").notNull(),
    genre: text("genre").notNull(),
    cible: text("cible").notNull(),
    empreinte: text("empreinte").notNull(),
    etat: text("etat").notNull().default("proposee"),
    utilite: integer("utilite").notNull(),
    raisons: jsonb("raisons").$type<Raisons>().notNull(),
    /** L'adresse de l'issue GitHub liée, ou rien (lot suivant : le bouton « En faire une tâche »). */
    issue: text("issue"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    majLe: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idees_empreinte").on(t.empreinte),
    index("idees_etat_utilite").on(t.etat, t.utilite),
    check("idees_utilite_0_100", sql`${t.utilite} BETWEEN 0 AND 100`),
    check("idees_etat", sql`${t.etat} IN ('proposee', 'retenue', 'faite', 'ecartee')`),
    check("idees_regle", sql`${t.regle} IN ('demande-repetee')`),
  ],
);
