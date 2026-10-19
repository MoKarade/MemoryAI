// lib/depotQuestions.ts — l'accès à la base pour les questions (ADR 0002 §5.1).
//
// Derrière une interface, comme `DepotFaits` : en test une PGlite en mémoire sur les
// migrations committées, en production Neon. Même code, même SQL.
//
// ⚠️ `poser` applique le plafond LUI-MÊME, juste après l'insertion. Le calculer au moment
// d'afficher la page ne protégerait rien : c'est l'écriture qui déborde, pas la lecture —
// et la garde qui décide doit être celle que le point d'écriture consulte (CLAUDE.md §1).

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import * as schema from "./db/schema";
import type { Question } from "./db/schema";
import { aEcarter, MAX_OUVERTES, type QuestionValide } from "./questions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export type ResultatPose =
  | { etat: "posee"; id: string; ecartees: string[] }
  /** Déjà posée (même prédicat, même texte) — ouverte, répondue ou écartée : on ne la repose pas. */
  | { etat: "deja-posee" };

export interface DepotQuestions {
  poser(q: QuestionValide, maintenant: Date, max?: number): Promise<ResultatPose>;
  ouvertes(limite: number): Promise<Question[]>;
  parId(id: string): Promise<Question | null>;
  /** Lie la question au fait né de la réponse et la ferme. */
  cloreAvecFait(id: string, faitId: string, maintenant: Date): Promise<"ok" | "introuvable">;
  /**
   * Les questions ouvertes posées par une RÈGLE, pour ne pas en reposer une identique.
   *
   * ⚠️ L'index unique `(predicat_vise, question)` le tient déjà côté base, mais le producteur
   * doit le savoir AVANT d'appeler : sans ça, chaque passe tenterait de reposer les mêmes
   * questions, le plafond de cinq écarterait les plus anciennes à chaque tour, et la page
   * changerait de contenu sans que rien ne bouge dans la mémoire.
   */
  predicatsDejaDemandes(): Promise<ReadonlySet<string>>;
  ecarter(id: string, maintenant: Date): Promise<"ok" | "introuvable">;
  comptes(): Promise<{ ouvertes: number; repondues: number; ecartees: number }>;
}

export function depotQuestionsDrizzle(db: Base): DepotQuestions {
  const ouverte = (id: string) => and(eq(schema.questions.id, id), eq(schema.questions.statut, "ouverte"));

  return {
    async poser(q, maintenant, max = MAX_OUVERTES) {
      const id = randomUUID();
      const insere = await db
        .insert(schema.questions)
        .values({
          id,
          question: q.question,
          predicatVise: q.predicatVise,
          motif: q.motif,
          origine: q.origine,
          statut: "ouverte",
          creeLe: maintenant,
          // ⚠️ `null` quand il n'y a pas d'options, jamais `"[]"` : la page distingue « à
          // texte libre » de « QCM vide », et un QCM vide ne se répondrait par rien.
          options: q.options ? JSON.stringify(q.options) : null,
        })
        // L'index unique `(predicat_vise, question)` est la garde : une question déjà posée
        // ne se repose pas, même si Marc l'a écartée. C'est la base qui le tient, pas un
        // `SELECT` préalable — deux poses simultanées passeraient entre les deux.
        .onConflictDoNothing({ target: [schema.questions.predicatVise, schema.questions.question] })
        .returning({ id: schema.questions.id });
      if (insere.length === 0) return { etat: "deja-posee" };

      const ouvertes = await db
        .select({ id: schema.questions.id, creeLe: schema.questions.creeLe })
        .from(schema.questions)
        .where(eq(schema.questions.statut, "ouverte"))
        .orderBy(asc(schema.questions.creeLe));
      const ecartees = aEcarter(ouvertes, max);
      if (ecartees.length > 0) {
        await db
          .update(schema.questions)
          .set({ statut: "ecartee", closeLe: maintenant })
          .where(inArray(schema.questions.id, ecartees));
      }
      return { etat: "posee", id, ecartees };
    },

    async predicatsDejaDemandes() {
      const rows = await db
        .select({ p: schema.questions.predicatVise })
        .from(schema.questions)
        .where(and(eq(schema.questions.origine, "regle"), eq(schema.questions.statut, "ouverte")));
      return new Set(rows.map((r) => r.p));
    },
    async ouvertes(limite) {
      return db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.statut, "ouverte"))
        .orderBy(desc(schema.questions.creeLe))
        .limit(limite);
    },

    async parId(id) {
      const rows = await db.select().from(schema.questions).where(eq(schema.questions.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async cloreAvecFait(id, faitId, maintenant) {
      const r = await db
        .update(schema.questions)
        .set({ statut: "repondue", faitId, closeLe: maintenant })
        .where(ouverte(id))
        .returning({ id: schema.questions.id });
      return r.length > 0 ? "ok" : "introuvable";
    },

    async ecarter(id, maintenant) {
      const r = await db
        .update(schema.questions)
        .set({ statut: "ecartee", closeLe: maintenant })
        .where(ouverte(id))
        .returning({ id: schema.questions.id });
      return r.length > 0 ? "ok" : "introuvable";
    },

    async comptes() {
      const rows = await db.select({ statut: schema.questions.statut }).from(schema.questions);
      const c = { ouvertes: 0, repondues: 0, ecartees: 0 };
      for (const r of rows) {
        if (r.statut === "ouverte") c.ouvertes++;
        else if (r.statut === "repondue") c.repondues++;
        else c.ecartees++;
      }
      return c;
    },
  };
}
