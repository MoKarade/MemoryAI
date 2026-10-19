// lib/conversations/depot.ts — écrire et lire les conversations (ADR 0002 §5.2).
//
// TROIS RÈGLES QUI GOUVERNENT CE FICHIER, et chacune a son test :
//
// 1. LE SCAN DE SECRETS TOURNE AVANT LE CHIFFREMENT, ici et nulle part ailleurs. Un appelant
//    qui consignerait sans passer par `consigner` contournerait la seule garde du lot.
// 2. L'AAD SCELLE LA POSITION : `conversation_id|source|index|2`. Déplacer un message d'une
//    conversation à l'autre, ou changer son rang, fait échouer le déchiffrement — comme
//    l'AAD `id|niveau` empêche de rétrograder un fait pour le lire.
// 3. AUCUN PÉRIMÈTRE D'APP N'ATTEINT CE MODULE. Il n'est importé ni par `lib/mcp/outils.ts`,
//    ni par `lib/depotFaits.ts` : une conversation ne sort pas vers une app, par construction
//    et pas par vigilance. `tests/conversations.test.ts` le vérifie sur les fichiers réels.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { chiffrer, dechiffrer, DechiffrementError, type Cle } from "../chiffrement";
import * as schema from "../db/schema";
import type { Conversation } from "../db/schema";
import { masquerSecrets } from "./secrets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export type SourceConversation = (typeof schema.SOURCES_CONVERSATION)[number];
export type RoleMessage = (typeof schema.ROLES_MESSAGE)[number];

/**
 * Une conversation est du N2 : privée, jamais servie sans la bascule de l'ADR 0001 §5.3.
 * Le niveau ENTRE dans l'AAD, donc il est aussi ce qui scelle le message à sa position.
 */
export const NIVEAU_CONVERSATION = 2;

/** Le plafond de Neon sur le plan gratuit, en octets. Sert l'alerte, jamais une purge. */
export const PLAFOND_NEON_OCTETS = 500 * 1024 * 1024;
/** À partir d'où on le DIT à Marc. La décision de rétention se prend sur un chiffre réel. */
export const SEUIL_ALERTE = 0.6;

export interface MessageAConsigner {
  role: RoleMessage;
  contenu: string;
}

export interface ResultatConsignation {
  conversationId: string;
  ecrits: number;
  secretsRetires: number;
}

export interface MessageLisible {
  index: number;
  role: RoleMessage;
  contenu: string;
  secretsRetires: number;
  creeLe: Date;
}

export interface MesureConversations {
  nombre: number;
  messages: number;
  octets: number;
  secretsRetires: number;
  /** `octets / PLAFOND_NEON_OCTETS`, entre 0 et 1. */
  partDuPlafond: number;
  alerte: boolean;
}

export interface DepotConversations {
  /** Crée une conversation vide et rend son identifiant. */
  demarrer(source: SourceConversation, maintenant: Date): Promise<string>;
  /**
   * Ajoute des messages à la SUITE de ce qui est déjà là. L'index est calculé en base, jamais
   * fourni par l'appelant : deux consignations concurrentes ne peuvent pas se donner le même.
   */
  consigner(
    conversationId: string,
    messages: readonly MessageAConsigner[],
    cle: Cle,
    maintenant: Date,
  ): Promise<ResultatConsignation>;
  liste(limite: number): Promise<Conversation[]>;
  parId(id: string): Promise<Conversation | null>;
  /** Les messages déchiffrés d'une conversation. Le SEUL endroit qui déchiffre. */
  messages(conversationId: string, cle: Cle): Promise<MessageLisible[]>;
  /** Suppression logique, comme un fait oublié : la conversation ne revient pas. */
  oublier(id: string, maintenant: Date): Promise<"ok" | "introuvable">;
  /** Note jusqu'où l'extraction est allée (lot 9). Un RANG, jamais un drapeau. */
  marquerExtraite(id: string, jusqua: number): Promise<void>;
  mesure(): Promise<MesureConversations>;
  /**
   * [L2, ADR 0011] Les conversations d'UNE source, les plus récentes d'abord, avec leur
   * PREMIER message de Marc comme titre — de quoi les reconnaître dans l'historique du chat.
   * ⚠️ Un seul déchiffrement par conversation, jamais leur contenu entier : l'historique est
   * une liste, pas une relecture ; la conversation s'ouvre ensuite par `messages`.
   */
  apercus(source: SourceConversation, limite: number, cle: Cle): Promise<ApercuConversation[]>;
}

interface ApercuConversation {
  id: string;
  finLe: Date;
  nbMessages: number;
  /** Le premier message de Marc, tronqué. `null` s'il est illisible — jamais une chaîne vide. */
  titre: string | null;
}

/** La longueur d'un titre d'historique. Au-delà, la barre latérale d'un téléphone déborde. */
const LONGUEUR_TITRE_APERCU = 80;

/** L'AAD d'un message : sa conversation, sa source, son rang, son niveau. */
export function aadMessage(conversationId: string, source: SourceConversation, index: number): string {
  return `${conversationId}|${source}|${index}`;
}

export function depotConversationsDrizzle(db: Base): DepotConversations {
  const vivante = (id: string) => and(eq(schema.conversations.id, id), isNull(schema.conversations.supprimeLe));

  return {
    async demarrer(source, maintenant) {
      const id = randomUUID();
      await db.insert(schema.conversations).values({ id, source, debutLe: maintenant, finLe: maintenant });
      return id;
    },

    async consigner(conversationId, aEcrire, cle, maintenant) {
      const rows = await db.select().from(schema.conversations).where(vivante(conversationId)).limit(1);
      const conv = rows[0];
      // Une conversation oubliée ne se remplit pas : ce serait la faire revenir par la porte
      // de service, exactement ce que `oublis` interdit côté faits.
      if (!conv) return { conversationId, ecrits: 0, secretsRetires: 0 };

      let index = conv.nbMessages;
      let octets = 0;
      let secrets = 0;

      for (const m of aEcrire) {
        const masque = masquerSecrets(m.contenu);
        const contenu = chiffrer(
          cle,
          masque.texte,
          aadMessage(conversationId, conv.source, index),
          NIVEAU_CONVERSATION,
        );
        await db.insert(schema.messages).values({
          id: randomUUID(),
          conversationId,
          index,
          role: m.role,
          contenu,
          secretsRetires: masque.retires,
          creeLe: maintenant,
        });
        octets += Buffer.byteLength(masque.texte, "utf8");
        secrets += masque.retires;
        index++;
      }

      await db
        .update(schema.conversations)
        .set({
          nbMessages: index,
          octets: conv.octets + octets,
          secretsRetires: conv.secretsRetires + secrets,
          finLe: maintenant,
        })
        .where(eq(schema.conversations.id, conversationId));

      return { conversationId, ecrits: aEcrire.length, secretsRetires: secrets };
    },

    async liste(limite) {
      return db
        .select()
        .from(schema.conversations)
        .where(isNull(schema.conversations.supprimeLe))
        .orderBy(desc(schema.conversations.finLe))
        .limit(limite);
    },

    async parId(id) {
      const rows = await db.select().from(schema.conversations).where(vivante(id)).limit(1);
      return rows[0] ?? null;
    },

    async messages(conversationId, cle) {
      const rows = await db.select().from(schema.conversations).where(vivante(conversationId)).limit(1);
      const conv = rows[0];
      if (!conv) return [];
      const msgs = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(schema.messages.index);
      return msgs.map((m) => ({
        index: m.index,
        role: m.role,
        contenu: dechiffrer(cle, m.contenu, aadMessage(conversationId, conv.source, m.index), NIVEAU_CONVERSATION),
        secretsRetires: m.secretsRetires,
        creeLe: m.creeLe,
      }));
    },

    async oublier(id, maintenant) {
      const r = await db
        .update(schema.conversations)
        .set({ supprimeLe: maintenant })
        .where(vivante(id))
        .returning({ id: schema.conversations.id });
      return r.length > 0 ? "ok" : "introuvable";
    },

    async marquerExtraite(id, jusqua) {
      await db.update(schema.conversations).set({ extraiteJusqua: jusqua }).where(vivante(id));
    },

    async apercus(source, limite, cle) {
      const convs = await db
        .select()
        .from(schema.conversations)
        .where(and(eq(schema.conversations.source, source), isNull(schema.conversations.supprimeLe)))
        .orderBy(desc(schema.conversations.finLe))
        .limit(limite);
      if (convs.length === 0) return [];
      const premiers = await db
        .select()
        .from(schema.messages)
        .where(and(inArray(schema.messages.conversationId, convs.map((c) => c.id)), eq(schema.messages.index, 0)));
      const parConv = new Map(premiers.map((m) => [m.conversationId, m]));
      return convs.map((c) => {
        const m = parConv.get(c.id);
        let titre: string | null = null;
        if (m) {
          try {
            const brut = dechiffrer(cle, m.contenu, aadMessage(c.id, c.source, 0), NIVEAU_CONVERSATION).replace(/\s+/g, " ").trim();
            titre = brut.length > LONGUEUR_TITRE_APERCU ? `${brut.slice(0, LONGUEUR_TITRE_APERCU - 1)}…` : brut || null;
          } catch (err) {
            // Un message illisible (clé tournée, ligne altérée) laisse la conversation dans la
            // liste SANS titre : la cacher la ferait passer pour oubliée.
            if (!(err instanceof DechiffrementError)) throw err;
          }
        }
        return { id: c.id, finLe: c.finLe, nbMessages: c.nbMessages, titre };
      });
    },

    async mesure() {
      const [r] = await db
        .select({
          nombre: sql<number>`count(*)::int`,
          messages: sql<number>`coalesce(sum(${schema.conversations.nbMessages}), 0)::int`,
          octets: sql<number>`coalesce(sum(${schema.conversations.octets}), 0)::int`,
          secrets: sql<number>`coalesce(sum(${schema.conversations.secretsRetires}), 0)::int`,
        })
        .from(schema.conversations)
        .where(isNull(schema.conversations.supprimeLe));
      const octets = r?.octets ?? 0;
      const part = octets / PLAFOND_NEON_OCTETS;
      return {
        nombre: r?.nombre ?? 0,
        messages: r?.messages ?? 0,
        octets,
        secretsRetires: r?.secrets ?? 0,
        partDuPlafond: part,
        alerte: part >= SEUIL_ALERTE,
      };
    },
  };
}
