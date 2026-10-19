// lib/pieces/depot.ts — l'accès base des pièces, derrière une interface.
//
// Même patron que `lib/depotFaits.ts` : l'orchestration (`./ecrire.ts`) ne connaît que cette
// interface, donc elle se teste sur PGlite comme sur Neon, et une fausse implémentation ne
// peut pas mentir sur ce qui a été ÉCRIT — elle doit le porter.

import { inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { NouvellePiece, Perimetre } from "../db/schema";

export type NouvelExemplaire = typeof schema.pieceExemplaires.$inferInsert;

export interface DepotPieces {
  /** Parmi ces empreintes, celles qui figurent dans `oublis`. */
  oubliesParmi(empreintes: readonly string[]): Promise<Set<string>>;
  /**
   * Parmi ces empreintes, CE QUE porte la pièce existante — son id et son extracteur.
   *
   * ⚠️ Rendait un `Set<string>` jusqu'à [L39] : on savait qu'une pièce existait, jamais
   * laquelle. Or le verdict de l'ADR 0006 §2 dépend de SON extracteur (seule une vraie
   * lecture remplace un inventaire), donc un booléen ne suffisait plus — et c'est ce booléen
   * qui rendait l'import inerte : `dejaPresentes`, sans savoir quoi.
   */
  existantesParmi(
    empreintes: readonly string[],
  ): Promise<Map<string, { id: string; extracteur: string; ecrivainApp: string | null }>>;
  /** Insère la pièce ET ses exemplaires. Si les exemplaires échouent, la pièce est retirée. */
  inserer(piece: NouvellePiece, exemplaires: readonly NouvelExemplaire[]): Promise<void>;
  /**
   * REMPLACE une pièce d'inventaire par une vraie lecture (ADR 0006 §3). [L39].
   *
   * ⚠⚠ LES DEUX ÉCRITURES SONT DANS LA MÊME TRANSACTION, et ce n'est pas du zèle :
   * `pieces.empreinte` est `notNull` ET sous `uniqueIndex`. L'ancienne doit donc CÉDER
   * l'empreinte canonique avant que la neuve la prenne — et un échec entre les deux
   * laisserait le document sans identité vivante, donc invisible à l'idempotence : la passe
   * suivante en créerait une SECONDE copie.
   *
   * ⚠️ L'ancienne n'est pas supprimée : son statut passe à `remplacee`, et son empreinte est
   * réécrite sous une forme qui ne peut pas collisionner (`remplacee:<id>`, unique par
   * construction puisque `id` est la clé primaire). L'empreinte est l'identité POUR
   * L'IDEMPOTENCE, et une pièce remplacée n'est plus l'identité vivante de son document.
   */
  remplacer(ancienId: string, piece: NouvellePiece, exemplaires: readonly NouvelExemplaire[]): Promise<void>;
  /** Le périmètre déclaré par Marc pour une app, ou null. */
  perimetre(appId: string): Promise<Perimetre | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export function depotPiecesDrizzle(db: Base): DepotPieces {
  return {
    async oubliesParmi(empreintes) {
      if (empreintes.length === 0) return new Set();
      const rows = await db
        .select({ e: schema.oublis.empreinte })
        .from(schema.oublis)
        .where(inArray(schema.oublis.empreinte, [...empreintes]));
      return new Set(rows.map((r) => r.e));
    },

    async existantesParmi(empreintes) {
      if (empreintes.length === 0) return new Map();
      const rows = await db
        .select({
          e: schema.pieces.empreinte,
          id: schema.pieces.id,
          extracteur: schema.pieces.extracteur,
          ecrivainApp: schema.pieces.ecrivainApp,
        })
        .from(schema.pieces)
        .where(inArray(schema.pieces.empreinte, [...empreintes]));
      return new Map(rows.map((r) => [r.e, { id: r.id, extracteur: r.extracteur, ecrivainApp: r.ecrivainApp }]));
    },

    async remplacer(ancienId, piece, exemplaires) {
      // ⚠⚠ PAS DE `db.transaction`, ET CE N'EST PAS UN OUBLI. Mesuré le 21/09/2026 DANS le
      // pilote : `drizzle-orm/neon-http` lève `No transactions support in neon-http driver`.
      // La production tourne sur ce pilote ; les tests tournent sur PGlite, qui les supporte.
      // Le remplacement, mergé le matin même, a donc été vert sur 821 tests et a rendu
      // **HTTP 500** au premier appel réel — DriveAI a suspendu son canal après UN document,
      // et la campagne de lecture est restée à l'arrêt. Même classe que les migrations
      // multi-commandes du 16/09 : un test qui valide un contrat que la production n'a pas.
      //
      // ⚠️ `db.batch` EXISTE sur neon-http et ferait l'affaire — mais PAS sur PGlite, donc
      // aucun test ne pourrait l'exercer. On échoue plutôt en SÉQUENCE, dans l'ordre qui
      // rend chaque état intermédiaire RÉPARABLE.
      //
      // ⚠️ L'ORDRE COMPTE, pour deux raisons désormais. (1) L'ancienne cède l'empreinte
      // canonique AVANT que la neuve la prenne, sinon l'index unique la refuse. (2) Chaque
      // coupure laisse un état que la passe suivante RATTRAPE, jamais un doublon vivant :
      //   • après l'UPDATE seul — le document n'a plus de pièce vivante, la passe suivante
      //     en recrée une ; coût : un appel de modèle re-payé, et une ligne morte ;
      //   • après l'INSERT de la pièce — elle porte l'empreinte, donc l'idempotence tient ;
      //     il lui manque son lien Drive, ce que `inserer` traite déjà pour son propre cas.
      // L'inverse (insérer d'abord) est le seul ordre qui ne se rattrape pas : l'index unique
      // refuserait la neuve, et l'ancienne resterait la pièce vivante — donc jamais relue.
      await db
        .update(schema.pieces)
        .set({ statut: "remplacee", empreinte: `remplacee:${ancienId}` })
        .where(inArray(schema.pieces.id, [ancienId]));
      await db.insert(schema.pieces).values(piece);
      if (exemplaires.length > 0) await db.insert(schema.pieceExemplaires).values([...exemplaires]);
    },

    async inserer(piece, exemplaires) {
      await db.insert(schema.pieces).values(piece);
      if (exemplaires.length === 0) return;
      try {
        await db.insert(schema.pieceExemplaires).values([...exemplaires]);
      } catch (err) {
        // ⚠️ Une pièce sans exemplaire ne se retrouve JAMAIS : elle n'a ni fileId, ni chemin,
        // donc rien qui la relie à un document. Mieux vaut la retirer que la laisser
        // orpheline — le même arbitrage que `depotFaits.inserer` fait pour la provenance.
        await db.delete(schema.pieces).where(inArray(schema.pieces.id, [piece.id]));
        throw err;
      }
    },

    async perimetre(appId) {
      const rows = await db
        .select()
        .from(schema.perimetres)
        .where(inArray(schema.perimetres.appId, [appId]))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
