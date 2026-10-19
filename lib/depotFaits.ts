// lib/depotFaits.ts — l'accès à la base pour l'écriture des faits, derrière une interface.
//
// `ecrireLot` (`lib/ecrireFaits.ts`) ne connaît que `DepotFaits` : en test, une PGlite en
// mémoire sur les migrations committées ; en production, Neon. Même code, même SQL, même
// Drizzle — ce n'est pas une fausse version, c'est la vraie sur une autre Postgres.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import type { NouveauFait, Perimetre } from "./db/schema";
import { apresProposition, type Proposant, type StatutPredicat, STATUTS_PREDICAT } from "./vocabulaire/quarantaine";

export interface NouvelleProvenance {
  sourceType: (typeof schema.SOURCES)[number];
  sourceRef: string;
  extracteur: string;
  dateSource: string | null;
}

export interface DepotFaits {
  /** Parmi ces empreintes, celles qui figurent dans `oublis`. */
  oubliesParmi(empreintes: readonly string[]): Promise<Set<string>>;
  /** Parmi ces empreintes, celles qu'un fait porte déjà. */
  presentesParmi(empreintes: readonly string[]): Promise<Set<string>>;
  /** Insère un fait ET sa provenance. Si la provenance échoue, le fait est retiré. */
  inserer(fait: NouveauFait, provenance: NouvelleProvenance): Promise<void>;
  /** Compte un prédicat refusé pour cet appelant (jamais sa valeur). */
  compterRefus(predicat: string, appelant: string, versionVocabulaire: number): Promise<void>;
  /** Le périmètre déclaré par Marc pour une app, ou null. */
  perimetre(appId: string): Promise<Perimetre | null>;
  /**
   * Inscrit un prédicat hors vocabulaire à la file des propositions et rend son état APRÈS
   * cette proposition (ADR 0004 §2.3). Le calcul est PUR (`apresProposition`) ; ici il n'y a
   * que la lecture, l'écriture, et rien qui décide.
   */
  proposerPredicat(
    predicat: string,
    proposant: Proposant,
    maintenant: Date,
  ): Promise<{ statut: StatutPredicat; vientDeSortir: boolean }>;
  /**
   * Les faits `valide` VIVANTS de ce sujet et de ces prédicats — leur identifiant, leur
   * niveau et leur valeur encore CHIFFRÉE. Sert à la garde anti-doublon de `ecrireLot`.
   *
   * ⚠️ Rend la valeur chiffrée, jamais claire : ce module n'a pas la clé et ne doit pas
   * l'avoir (même règle que `lib/depotLecture.ts`). C'est l'appelant, qui la porte déjà, qui
   * déchiffre — l'AAD est `id|niveau`, donc les trois champs voyagent ensemble ou rien n'est
   * lisible.
   * ⚠️ Exclut les faits migrés en pièces : un papier n'affirme rien sur Marc, il ne peut donc
   * pas faire doublon avec un fait.
   */
  valeursValidees(
    sujet: string,
    predicats: readonly string[],
  ): Promise<{ id: string; predicat: string; niveau: number; valeur: string | null }[]>;
}

// Le schéma générique de Drizzle est `Record<string, unknown>` ; `any` ici ne désactive
// aucune vérification sur nos tables, qui sont typées par `schema`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** L'implémentation Drizzle, valable pour Neon (prod) comme pour PGlite (tests). */
export function depotDrizzle(db: Base): DepotFaits {
  return {
    async oubliesParmi(empreintes) {
      if (empreintes.length === 0) return new Set();
      const rows = await db
        .select({ e: schema.oublis.empreinte })
        .from(schema.oublis)
        .where(inArray(schema.oublis.empreinte, [...empreintes]));
      return new Set(rows.map((r) => r.e));
    },
    async presentesParmi(empreintes) {
      if (empreintes.length === 0) return new Set();
      const rows = await db
        .select({ e: schema.faits.empreinte })
        .from(schema.faits)
        .where(inArray(schema.faits.empreinte, [...empreintes]));
      return new Set(rows.map((r) => r.e));
    },
    async inserer(fait, provenance) {
      await db.insert(schema.faits).values(fait);
      try {
        await db.insert(schema.provenances).values({ faitId: fait.id, ...provenance });
      } catch (err) {
        await db.delete(schema.faits).where(eq(schema.faits.id, fait.id));
        throw err;
      }
    },
    async proposerPredicat(predicat, proposant, maintenant) {
      // ⚠️ Lecture PUIS écriture, et la décision est calculée entre les deux par une fonction
      // PURE. Une course entre deux écrivains sur le même prédicat neuf ne peut ici que
      // SOUS-compter les proposants (une liste écrase l'autre), jamais sur-compter : le pire
      // cas laisse le prédicat en quarantaine un tour de plus, ce qui est le côté sûr.
      const [ligne] = await db
        .select({
          statut: schema.predicatsProposes.statut,
          extracteurs: schema.predicatsProposes.extracteurs,
          apps: schema.predicatsProposes.apps,
        })
        .from(schema.predicatsProposes)
        .where(eq(schema.predicatsProposes.predicat, predicat))
        .limit(1);

      // Une liste illisible se COMPTE comme vide, jamais comme « trois sources » : le repli doit
      // tomber du côté qui garde le prédicat en quarantaine.
      const extracteursActuels = listeDeTextes(ligne?.extracteurs);
      const appsActuelles = listeDeTextes(ligne?.apps);
      // Un statut que le code ne connaît pas ne se lit JAMAIS comme « accepté ».
      const statutLu = (STATUTS_PREDICAT as readonly string[]).includes(ligne?.statut ?? "")
        ? (ligne!.statut as StatutPredicat)
        : "en_quarantaine";

      const apres = apresProposition({ statut: statutLu, extracteurs: extracteursActuels, apps: appsActuelles }, proposant);
      await db
        .insert(schema.predicatsProposes)
        .values({
          predicat,
          statut: apres.statut,
          extracteurs: JSON.stringify(apres.extracteurs),
          apps: JSON.stringify(apres.apps),
          nombre: 1,
          premiereVue: maintenant,
          derniereVue: maintenant,
          sortieLe: apres.statut === "accepte" ? maintenant : null,
          sortiePar: apres.statut === "accepte" ? (apres.vientDeSortir ? "sources" : "marc") : null,
        })
        .onConflictDoUpdate({
          target: schema.predicatsProposes.predicat,
          set: {
            statut: apres.statut,
            extracteurs: JSON.stringify(apres.extracteurs),
            apps: JSON.stringify(apres.apps),
            nombre: sql`${schema.predicatsProposes.nombre} + 1`,
            derniereVue: maintenant,
            // ⚠️ `sortieLe`/`sortiePar` ne s'écrasent QUE lors de la sortie : un prédicat déjà
            // accepté par Marc ne doit pas voir sa trace réécrite en « sources » au prochain
            // fait qui l'emploie. La contrainte de la base exige la paire, pas sa fraîcheur.
            ...(apres.vientDeSortir ? { sortieLe: maintenant, sortiePar: "sources" } : {}),
          },
        });
      return { statut: apres.statut, vientDeSortir: apres.vientDeSortir };
    },

    async compterRefus(predicat, appelant, versionVocabulaire) {
      await db
        .insert(schema.predicatsRefuses)
        .values({ predicat, appelant, versionVocabulaire })
        .onConflictDoUpdate({
          target: [schema.predicatsRefuses.predicat, schema.predicatsRefuses.appelant],
          set: {
            nombre: sql`${schema.predicatsRefuses.nombre} + 1`,
            versionVocabulaire,
            derniereVue: sql`now()`,
          },
        });
    },
    async perimetre(appId) {
      const rows = await db.select().from(schema.perimetres).where(eq(schema.perimetres.appId, appId)).limit(1);
      return rows[0] ?? null;
    },
    async valeursValidees(sujet, predicats) {
      if (predicats.length === 0) return [];
      return db
        .select({
          id: schema.faits.id,
          predicat: schema.faits.predicat,
          niveau: schema.faits.niveau,
          valeur: schema.faits.valeur,
        })
        .from(schema.faits)
        .where(
          and(
            eq(schema.faits.sujet, sujet),
            inArray(schema.faits.predicat, [...predicats]),
            eq(schema.faits.statut, "valide"),
            isNull(schema.faits.supprimeLe),
            isNull(schema.faits.migreEnPiece),
          ),
        );
    },
  };
}

/** Une liste JSON de textes, lue sans confiance : illisible ⇒ vide (le côté qui garde en quarantaine). */
function listeDeTextes(brut: string | null | undefined): string[] {
  if (!brut) return [];
  try {
    const v: unknown = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}
