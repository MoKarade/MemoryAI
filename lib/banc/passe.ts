// lib/banc/passe.ts — tirer le banc une fois, puis le MESURER chaque jour (MemoryAI#69).
//
// Appelée par le réveil de l'apprentissage (`/api/cron/apprentissage`), AVANT tout appel de
// modèle : elle ne coûte rien (Postgres seul) et ne dépend pas de la clé Anthropic.
//
// ⚠️ RIEN NE SORT EN CLAIR. Les questions sont chiffrées en base ; la mesure ne garde que des
// nombres ; aucune question ni identifiant de papier n'est journalisé ni rendu par la route.

import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { chiffrer, dechiffrer, type Cle } from "../chiffrement";
import type { DepotPiecesLecture } from "../pieces/depotLecture";
import { rendreServablesPieces } from "../pieces/lecture";
import { K_RAPPEL, noterBanc, tirerBanc, validerBanc, type Mesure, type PapierBanc, type QuestionBanc } from "./banc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- même alias que les autres dépôts
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le banc en vigueur. Un banc neuf (messages, courriels) prendra un AUTRE nom, jamais celui-ci. */
export const BANC_COURANT = "papiers-v1";
/** Ce qui cherche au lot 0 : la recherche plein texte des papiers, nourrie des mots-clés. */
const CHERCHEUR_LOT0 = "plein-texte-mots-cles";
/** Le réveil passe toutes les trois heures ; une mesure par jour suffit à suivre un lot. */
const INTERVALLE_MESURE_MS = 20 * 3600 * 1000;
/** Au-delà de ce parc, le tirage ne lit pas tout : il le dit au lieu de tirer en silence. */
const PARC_MAX = 10_000;
/** Niveau de chiffrement des questions : elles nomment des émetteurs, pas des numéros. */
const NIVEAU_QUESTION = 2;

export interface LigneBanc {
  id: string;
  rang: number;
  capacite: string;
  contenu: string;
}

export interface DepotBanc {
  questions(banc: string): Promise<LigneBanc[]>;
  figer(banc: string, lignes: readonly LigneBanc[]): Promise<void>;
  enregistrerMesure(banc: string, chercheur: string, resultat: Mesure): Promise<void>;
  derniereMesure(banc: string): Promise<{ chercheur: string; resultat: Mesure; mesureLe: Date } | null>;
  comptesParCapacite(banc: string): Promise<Record<string, number>>;
}

export function depotBancDrizzle(db: Base): DepotBanc {
  return {
    async questions(banc) {
      return db
        .select({ id: schema.bancQuestions.id, rang: schema.bancQuestions.rang, capacite: schema.bancQuestions.capacite, contenu: schema.bancQuestions.contenu })
        .from(schema.bancQuestions)
        .where(eq(schema.bancQuestions.banc, banc))
        .orderBy(schema.bancQuestions.rang);
    },
    async figer(banc, lignes) {
      // `onConflictDoNothing` sur (banc, rang) : deux réveils simultanés ne figent pas deux bancs.
      if (lignes.length) await db.insert(schema.bancQuestions).values(lignes.map((l) => ({ ...l, banc }))).onConflictDoNothing();
    },
    async enregistrerMesure(banc, chercheur, resultat) {
      await db.insert(schema.bancMesures).values({ banc, chercheur, resultat: JSON.stringify(resultat) });
    },
    async derniereMesure(banc) {
      const [r] = await db
        .select()
        .from(schema.bancMesures)
        .where(eq(schema.bancMesures.banc, banc))
        .orderBy(desc(schema.bancMesures.mesureLe), desc(schema.bancMesures.id))
        .limit(1);
      return r ? { chercheur: r.chercheur, resultat: JSON.parse(r.resultat) as Mesure, mesureLe: r.mesureLe } : null;
    },
    async comptesParCapacite(banc) {
      const rows = await db
        .select({ capacite: schema.bancQuestions.capacite, n: sql<number>`count(*)::int` })
        .from(schema.bancQuestions)
        .where(eq(schema.bancQuestions.banc, banc))
        .groupBy(schema.bancQuestions.capacite);
      return Object.fromEntries(rows.map((r) => [r.capacite, Number(r.n)]));
    },
  };
}

const aad = (id: string) => `banc|${id}`;

export type FinPasseBanc = "fige-et-mesure" | "mesure" | "deja-mesure" | "banc-invalide";

export interface ResultatPasseBanc {
  fin: FinPasseBanc;
  /** Ce qui empêche de figer, en mots qui ne nomment aucun papier. */
  erreurs: string[];
}

/**
 * Ce que la passe lit des papiers, séparé d'elle : le parc (déjà déchiffré, N0 à N2) et la
 * recherche mesurée. Les tests passent un parc fictif ; la route passe celui de la base.
 */
export interface SourcesBanc {
  lireParc(): Promise<PapierBanc[]>;
  /** Les identifiants rendus pour ces mots, dans l'ordre servi, `K_RAPPEL` au plus. */
  chercher(motsCles: string): Promise<string[]>;
}

export function sourcesPapiers(pieces: DepotPiecesLecture, cle: Cle): SourcesBanc {
  return {
    async lireParc() {
      // Le tirage lit les papiers N0 à N2 : le N3 (identité, santé) entrera par son propre banc,
      // avec le lot qui sait le lire (lot 6), jamais en douce par celui-ci.
      const rows = await pieces.chercher({ niveaux: [0, 1, 2], limite: PARC_MAX });
      if (rows.length === PARC_MAX) throw new Error(`parc tronqué à ${PARC_MAX} papiers : le tirage ne verrait pas tout`);
      const lu = rendreServablesPieces(rows, { inclureN2: true, n2Autorise: true, inclureN3: false, n3Autorise: false, inclureProposes: true }, cle);
      return lu.pieces.filter((x) => x.forme === "complete");
    },
    async chercher(motsCles) {
      return (await pieces.chercher({ texte: motsCles, limite: K_RAPPEL })).map((r) => r.piece.id);
    },
  };
}

export async function passeBanc(p: { depot: DepotBanc; sources: SourcesBanc; cle: Cle; maintenant: () => Date }): Promise<ResultatPasseBanc> {
  let lignes = await p.depot.questions(BANC_COURANT);
  let fige = false;

  if (lignes.length === 0) {
    const tirees = tirerBanc(await p.sources.lireParc());
    const erreurs = validerBanc(tirees);
    if (erreurs.length) return { fin: "banc-invalide", erreurs };
    const neuves = tirees.map((q, rang) => {
      const id = randomUUID();
      return { id, rang, capacite: q.capacite, contenu: chiffrer(p.cle, JSON.stringify(q), aad(id), NIVEAU_QUESTION) };
    });
    await p.depot.figer(BANC_COURANT, neuves);
    lignes = await p.depot.questions(BANC_COURANT);
    fige = true;
  }

  const derniere = await p.depot.derniereMesure(BANC_COURANT);
  if (!fige && derniere && p.maintenant().getTime() - derniere.mesureLe.getTime() < INTERVALLE_MESURE_MS) {
    return { fin: "deja-mesure", erreurs: [] };
  }

  // ⚠️ Une question illisible fait ÉCHOUER la passe : la sauter changerait le banc sans le dire.
  const questions = lignes.map((l) => JSON.parse(dechiffrer(p.cle, l.contenu, aad(l.id), NIVEAU_QUESTION)) as QuestionBanc);
  const trouves: string[][] = [];
  for (const q of questions) trouves.push(await p.sources.chercher(q.motsCles));
  await p.depot.enregistrerMesure(BANC_COURANT, CHERCHEUR_LOT0, noterBanc(questions, trouves));
  return { fin: fige ? "fige-et-mesure" : "mesure", erreurs: [] };
}
