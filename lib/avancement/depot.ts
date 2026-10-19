// lib/avancement/depot.ts — ranger et relire l'avancement qu'une app publie (ADR 0009).
//
// ⚠️ CE DÉPÔT N'EST IMPORTÉ NI PAR `lib/chat/` NI PAR `lib/mcp/` — `tests/avancement.test.ts`
// l'impose. Un compteur n'est pas une affirmation sur Marc, et rien ici ne doit pouvoir finir
// dans le contexte d'un modèle.

import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { validerAvancement, type Avancement } from "./contrat";

type Base = PgDatabase<PgQueryResultHKT, typeof schema>;

type AvancementLu =
  | { etat: "absent" }
  /**
   * ⚠️ Une ligne qui ne passe plus le schéma (écrite par une version plus ancienne, ou altérée
   * à la main) est DITE, jamais rabattue sur « absent » : « DriveAI n'a rien envoyé » et « ce
   * qu'il a envoyé est illisible » appellent deux gestes différents.
   */
  | { etat: "illisible"; recuLe: Date }
  | { etat: "present"; avancement: Avancement; mesureLe: Date; recuLe: Date };

export interface DepotAvancement {
  /** Écrase la ligne de l'app. `recu_le` est posé par le SERVEUR, jamais par l'appelant. */
  enregistrer(appId: string, avancement: Avancement): Promise<void>;
  lire(appId: string): Promise<AvancementLu>;
}

export function depotAvancementDrizzle(db: Base): DepotAvancement {
  return {
    async enregistrer(appId, avancement) {
      const ligne = {
        appId,
        mesureLe: new Date(avancement.mesureLe),
        corps: JSON.stringify(avancement),
      };
      // ⚠️ UNE requête, pas une transaction : le pilote de production (`neon-http`) n'en
      // supporte aucune (leçon n° 42). Un upsert est atomique à lui seul.
      await db
        .insert(schema.avancementSources)
        .values(ligne)
        .onConflictDoUpdate({
          target: schema.avancementSources.appId,
          set: { mesureLe: ligne.mesureLe, corps: ligne.corps, recuLe: sql`now()` },
        });
    },

    async lire(appId) {
      const [r] = await db
        .select()
        .from(schema.avancementSources)
        .where(eq(schema.avancementSources.appId, appId))
        .limit(1);
      if (!r) return { etat: "absent" };
      let brut: unknown;
      try {
        brut = JSON.parse(r.corps);
      } catch {
        return { etat: "illisible", recuLe: r.recuLe };
      }
      const v = validerAvancement(brut);
      if (!v.ok) return { etat: "illisible", recuLe: r.recuLe };
      return { etat: "present", avancement: v.avancement, mesureLe: r.mesureLe, recuLe: r.recuLe };
    },
  };
}
