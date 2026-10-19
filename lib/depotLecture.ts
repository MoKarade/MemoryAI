// lib/depotLecture.ts — l'accès à la base pour LIRE des faits et JOURNALISER, derrière une
// interface. Même patron que `lib/depotFaits.ts` : Neon en production, PGlite en test, même
// Drizzle. Ce module ne déchiffre rien et ne décide rien : c'est `lib/lecture.ts` qui
// applique les règles (statuts servis, niveaux, canari) sur ce qu'il rend.

import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import type { EntreeJournal, Fait, Provenance } from "./db/schema";

export interface FaitAvecProvenance {
  fait: Fait;
  provenance: Provenance | null;
}

/**
 * Les comptes de la mémoire. ⚠️ TOUS les champs qui suivent — sauf `migresEnPiece` — portent
 * sur les faits ENCORE SERVIS : ni supprimés, ni migrés en pièces (ADR 0004 §6.2).
 *
 * ⚠️ Pourquoi la migration doit sortir de ces comptes, et pourquoi c'est un correctif et pas
 * une préférence. Le lot 19 a écrit que `aValider` n'était plus un signal de fraîcheur (le
 * canal DriveAI entre directement en `valide`) et a désigné en remplacement le `nombre` du
 * prédicat `document.existe`. Deux heures plus tard, le lot 17 a migré ces faits en pièces —
 * sans les retirer d'ici. Le compteur est donc resté FIGÉ à 2 729 alors que ce qui arrive
 * désormais arrive dans `pieces` : le second signal de fraîcheur était mort comme le premier,
 * et pour la même raison. Un compteur agrégé rend toujours un nombre, donc rien ne rougit.
 *
 * ⚠️ Le compte des migrés est PUBLIÉ, jamais silencieux : 2 646 faits qui disparaissent d'un
 * total sans que rien ne dise où ils sont partis, c'est indiscernable d'une perte de données
 * (« une donnée illisible se COMPTE, elle ne se rabat pas sur zéro », CLAUDE.md §9 n° 4).
 */
export interface Comptes {
  parStatut: Record<string, number>;
  parNiveau: Record<string, number>;
  canaris: number;
  dernierValideLe: string | null;
  refus: { predicat: string; appelant: string; nombre: number; versionVocabulaire: number }[];
  parPredicat: Record<string, number>;
  /** Devenus des PIÈCES : gardés, réversibles, plus servis — donc hors de tous les champs ci-dessus. */
  migresEnPiece: number;
}

export interface NouvelleEntreeJournal {
  ts: Date;
  /** ADR 0014 : 1 = corpus historique, 2 = + idsPieces. Vient toujours du code appelant. */
  version: number;
  lecteur: string;
  outil: string;
  usage: (typeof schema.USAGES)[number];
  niveauMaxServi: number;
  idsFaits: string[];
  /** ADR 0014 (revue #72) : les papiers lus. */
  idsPieces: string[];
  questionEmpreinte: string | null;
  coutUsd: number | null;
  hmacPrecedent: string | null;
  hmac: string;
}

export interface DepotLecture {
  /** Les faits NON supprimés d'un statut donné, provenance jointe, bornés. */
  faits(filtre: {
    statuts: readonly (typeof schema.STATUTS)[number][];
    domaines?: readonly string[];
    limite: number;
  }): Promise<FaitAvecProvenance[]>;
  /**
   * Les prédicats que la quarantaine RETIENT — `en_quarantaine` et `refuse` (ADR 0004 §2.3).
   *
   * ⚠️ On lit ce qui est RETENU, pas ce qui est permis. L'ensemble permis serait tout le
   * vocabulaire fermé plus les acceptés : long, et surtout sa polarité est mauvaise — un
   * prédicat que la table ne connaît pas encore en serait ABSENT, donc traité comme retenu,
   * alors qu'un prédicat du vocabulaire fermé n'a jamais eu de ligne ici. La bonne question
   * est « qu'est-ce qui est retenu ? », et la réponse par défaut d'une table vide est « rien »,
   * ce qui est exactement vrai.
   */
  predicatsRetenus(): Promise<ReadonlySet<string>>;
  comptes(): Promise<Comptes>;
  derniereEntreeJournal(): Promise<EntreeJournal | null>;
  journaliser(e: NouvelleEntreeJournal): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le domaine d'un prédicat est son premier segment (`emploi.employeur` → `emploi`). */
const domaineDe = sql<string>`split_part(${schema.faits.predicat}, '.', 1)`;

/**
 * ⚠️⚠️ LE PRÉDICAT « ENCORE SERVI », ÉCRIT UNE FOIS, CONSOMMÉ PARTOUT.
 *
 * Ni supprimé, ni migré en pièce. `comptes()` le portait déjà, avec un commentaire disant
 * que les deux conditions vont « ENSEMBLE partout » — mais il était écrit DANS `comptes()`,
 * donc `faits()` ne l'a jamais eu. Classe
 * `CORRIGER-UN-PRODUCTEUR-N-EST-PAS-CORRIGER-LA-CLASSE` : le lot qui a réparé les COMPTEURS a
 * laissé la requête que le MODÈLE lit.
 *
 * ⚠️ Et pourquoi `estServable` ne suffisait pas, alors qu'il exclut bien ces faits : il les
 * exclut **après** le `LIMIT` du SQL. Les ~2 729 `document.existe` migrés sont les plus
 * RÉCENTS, donc `orderBy(desc(creeLe)).limit(500)` leur donnait toute la fenêtre — ils ne
 * sont pas servis, ils **prennent la place**. Mesuré sur la production le 18/09/2026 :
 * `memoryai_contexte` sans filtre de domaine servait **2 faits sur 99 validés** ; avec un
 * filtre qui exclut le domaine `document`, **27**. C'était la plainte de Marc du 17/09
 * (« on dirait qu'elle a pas beaucoup d'info sur moi »).
 *
 * **Exclure un fait de ce qui est servi ne suffit pas s'il occupe la place avant d'être
 * exclu.** Un filtre de lecture qui vit dans un prédicat TypeScript et pas dans le SQL est
 * une garde qui tire trop tard. Garde : `tests/evictionMigres.test.ts`.
 */
export const conditionServis = () => and(isNull(schema.faits.supprimeLe), isNull(schema.faits.migreEnPiece));

export function depotLectureDrizzle(db: Base): DepotLecture {
  return {
    async faits({ statuts, domaines, limite }) {
      const conditions = [conditionServis(), inArray(schema.faits.statut, [...statuts])];
      if (domaines && domaines.length > 0) conditions.push(inArray(domaineDe, [...domaines]));
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.faits)
        .leftJoin(schema.provenances, eq(schema.provenances.faitId, schema.faits.id))
        .where(and(...conditions))
        .orderBy(desc(schema.faits.creeLe))
        .limit(limite);
      // Un fait peut porter plusieurs provenances : on garde la première rencontrée.
      const vus = new Map<string, FaitAvecProvenance>();
      for (const r of rows) if (!vus.has(r.fait.id)) vus.set(r.fait.id, { fait: r.fait, provenance: r.provenance });
      return [...vus.values()];
    },
    async predicatsRetenus() {
      const rows = await db
        .select({ p: schema.predicatsProposes.predicat })
        .from(schema.predicatsProposes)
        .where(sql`${schema.predicatsProposes.statut} <> 'accepte'`);
      return new Set(rows.map((r) => r.p));
    },

    async comptes() {
      // `servis` : ni supprimé, ni migré en pièce. Les deux conditions vont ENSEMBLE partout
      // ci-dessous — une seule requête qui n'en porterait qu'une remettrait le défaut, et
      // c'est pour ça que le prédicat est écrit UNE fois plutôt que recopié cinq.
      const servis = conditionServis();
      const parStatut = await db
        .select({ k: schema.faits.statut, n: count() })
        .from(schema.faits)
        .where(servis)
        .groupBy(schema.faits.statut);
      const parNiveau = await db
        .select({ k: schema.faits.niveau, n: count() })
        .from(schema.faits)
        .where(servis)
        .groupBy(schema.faits.niveau);
      const parPredicat = await db
        .select({ k: schema.faits.predicat, n: count() })
        .from(schema.faits)
        .where(servis)
        .groupBy(schema.faits.predicat);
      const [canaris] = await db
        .select({ n: count() })
        .from(schema.faits)
        .where(and(servis, eq(schema.faits.canari, true)));
      const [migres] = await db
        .select({ n: count() })
        .from(schema.faits)
        .where(and(isNull(schema.faits.supprimeLe), isNotNull(schema.faits.migreEnPiece)));
      const [dernier] = await db
        .select({ d: schema.faits.valideLe })
        .from(schema.faits)
        .where(and(servis, eq(schema.faits.statut, "valide")))
        .orderBy(desc(schema.faits.valideLe))
        .limit(1);
      const refus = await db
        .select({
          predicat: schema.predicatsRefuses.predicat,
          appelant: schema.predicatsRefuses.appelant,
          nombre: schema.predicatsRefuses.nombre,
          versionVocabulaire: schema.predicatsRefuses.versionVocabulaire,
        })
        .from(schema.predicatsRefuses)
        .orderBy(desc(schema.predicatsRefuses.nombre))
        .limit(100);
      return {
        parStatut: Object.fromEntries(parStatut.map((r) => [r.k, Number(r.n)])),
        parNiveau: Object.fromEntries(parNiveau.map((r) => [String(r.k), Number(r.n)])),
        parPredicat: Object.fromEntries(parPredicat.map((r) => [r.k, Number(r.n)])),
        canaris: Number(canaris?.n ?? 0),
        migresEnPiece: Number(migres?.n ?? 0),
        dernierValideLe: dernier?.d ? dernier.d.toISOString() : null,
        refus,
      };
    },
    async derniereEntreeJournal() {
      const [e] = await db.select().from(schema.accesJournal).orderBy(desc(schema.accesJournal.id)).limit(1);
      return e ?? null;
    },
    async journaliser(e) {
      await db.insert(schema.accesJournal).values({
        ts: e.ts,
        version: e.version,
        lecteur: e.lecteur,
        outil: e.outil,
        usage: e.usage,
        niveauMaxServi: e.niveauMaxServi,
        idsFaits: JSON.stringify(e.idsFaits),
        idsPieces: JSON.stringify(e.idsPieces),
        questionEmpreinte: e.questionEmpreinte,
        coutUsd: e.coutUsd,
        hmacPrecedent: e.hmacPrecedent,
        hmac: e.hmac,
      });
    },
  };
}
