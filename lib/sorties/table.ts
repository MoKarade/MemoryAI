// lib/sorties/table.ts — ce qui sort des apps (ADR 0031, migration 0035). Déclarée à côté de son
// code : `lib/db/schema.ts` ne bouge pas dans ce lot. La migration SQL fait foi (`drizzle/0035_sorties.sql`).
//
// `titre` et `resume` sont CHIFFRÉS au niveau retenu de la ligne (AAD `sorties|<id>|<colonne>|<niveau>`) ;
// `app` vient du jeton qui a écrit, jamais du corps.

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sorties = pgTable(
  "sorties",
  {
    id: text("id").primaryKey(),
    app: text("app").notNull(),
    type: text("type").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    niveau: integer("niveau").notNull(),
    empreinte: text("empreinte").notNull(),
    titre: text("titre").notNull(),
    resume: text("resume"),
    recuLe: timestamp("recu_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sorties_app_empreinte").on(t.app, t.empreinte),
    index("sorties_app_date").on(t.app, t.date),
    check("sorties_niveau_1_3", sql`${t.niveau} BETWEEN 1 AND 3`),
  ],
);
