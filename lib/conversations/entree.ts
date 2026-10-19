// lib/conversations/entree.ts — ce qu'une source extérieure a le droit d'envoyer (ADR 0002 §3).
//
// PURE. Deux sources écrivent ici sans être le chat de MemoryAI :
//   - **claude.ai**, par l'outil MCP `memoryai_consigner` — le modèle appelle, ou n'appelle
//     pas : c'est « au mieux », et l'écran le dit plutôt que de laisser croire à l'exhaustivité ;
//   - **Claude Code**, par `POST /api/conversations` et un jeton dédié.
//
// ══ LA CONTRAINTE QUI VIENT DE LA DÉCISION DE MARC ═══════════════════════════════════════
// Il a choisi (ADR 0002 §4, question C) que Claude Code pousse AUTOMATIQUEMENT, contre ma
// recommandation. Personne ne relit avant l'envoi. Deux conséquences codées ici :
//
//   1. **Seuls les MESSAGES partent.** Un `tool_result` porte le contenu de fichiers lus, des
//      diffs, des sorties de commandes — donc le code des huit dépôts et, un jour, un secret
//      qu'aucun scan ne reconnaîtra. Un corps qui en contient un est REFUSÉ, il n'est pas
//      nettoyé : nettoyer laisserait croire que la limite est floue.
//   2. **Le refus est nommé.** Un envoi silencieusement tronqué serait pire qu'un envoi
//      refusé : la session suivante croirait que tout est passé.

import { z } from "zod";
import { SOURCES_CONVERSATION } from "../db/schema";
import type { MessageAConsigner, SourceConversation } from "./depot";

/** Au plus autant de messages par envoi. Un lot, pas une session entière d'un coup. */
export const MAX_MESSAGES_PAR_ENVOI = 200;
export const LONGUEUR_MAX_MESSAGE = 50_000;

export const CODES_REFUS_ENTREE = [
  "corps_invalide",
  "champ_inconnu",
  "source_inconnue",
  "resultat_outil_interdit",
  "message_vide",
  "message_trop_long",
  "lot_trop_grand",
] as const;
export type CodeRefusEntree = (typeof CODES_REFUS_ENTREE)[number];

export interface RefusEntree {
  ok: false;
  code: CodeRefusEntree;
  raison: string;
}

export interface EntreeValide {
  ok: true;
  source: SourceConversation;
  conversationId: string | null;
  messages: MessageAConsigner[];
}

/**
 * Les clés qui trahissent un résultat d'outil. Ce n'est pas une liste de politesse : chacune
 * est une forme que Claude Code produit, et laquelle qu'on oublie fait entrer un diff entier.
 */
export const CLES_INTERDITES = ["tool_result", "tool_use", "toolResult", "toolUse", "content_block", "diff", "patch"] as const;

const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    contenu: z.string(),
  })
  .strict();

const entreeSchema = z
  .object({
    source: z.string(),
    conversation_id: z.string().optional(),
    messages: z.array(z.unknown()),
  })
  .strict();

function refus(code: CodeRefusEntree, raison: string): RefusEntree {
  return { ok: false, code, raison };
}

/**
 * Cherche une clé interdite N'IMPORTE OÙ dans la structure reçue, y compris imbriquée.
 * Un scan du premier niveau laisserait passer `{ messages: [{ contenu: { tool_result: … } }] }`
 * — et c'est exactement la forme qu'un client mal réglé produirait.
 */
export function porteUnResultatDOutil(valeur: unknown, profondeur = 0): string | null {
  if (profondeur > 8 || valeur === null || typeof valeur !== "object") return null;
  if (Array.isArray(valeur)) {
    for (const v of valeur) {
      const trouve = porteUnResultatDOutil(v, profondeur + 1);
      if (trouve) return trouve;
    }
    return null;
  }
  for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
    if ((CLES_INTERDITES as readonly string[]).includes(k)) return k;
    const trouve = porteUnResultatDOutil(v, profondeur + 1);
    if (trouve) return trouve;
  }
  return null;
}

/**
 * Valide un envoi. `source` vient du CORPS pour `POST /api/conversations` (Claude Code n'a
 * qu'un chemin) mais reste bornée à l'énumération ; pour le MCP, l'appelant l'impose et le
 * corps ne la porte pas.
 */
export function validerEntree(brut: unknown, sourceImposee?: SourceConversation): EntreeValide | RefusEntree {
  // La garde des résultats d'outils passe AVANT le schéma : un corps refusé pour sa FORME
  // dirait « corps invalide » là où la vraie raison est « tu m'envoies un diff », et la
  // prochaine session corrigerait le mauvais problème.
  const interdite = porteUnResultatDOutil(brut);
  if (interdite) {
    return refus(
      "resultat_outil_interdit",
      `« ${interdite} » : seuls les MESSAGES sont consignés, jamais les résultats d'outils ni les diffs.`,
    );
  }

  const parsed = entreeSchema.safeParse(brut);
  if (!parsed.success) {
    const inconnu = parsed.error.issues.find((i) => i.code === "unrecognized_keys");
    if (inconnu) return refus("champ_inconnu", `champ hors du contrat : ${inconnu.message}`);
    return refus("corps_invalide", parsed.error.issues[0]?.message ?? "corps illisible");
  }

  const source = sourceImposee ?? parsed.data.source;
  if (!(SOURCES_CONVERSATION as readonly string[]).includes(source)) {
    return refus("source_inconnue", `source inconnue : ${source}`);
  }

  if (parsed.data.messages.length > MAX_MESSAGES_PAR_ENVOI) {
    return refus("lot_trop_grand", `${parsed.data.messages.length} messages : le maximum est ${MAX_MESSAGES_PAR_ENVOI}.`);
  }

  const messages: MessageAConsigner[] = [];
  for (const [i, m] of parsed.data.messages.entries()) {
    const v = messageSchema.safeParse(m);
    if (!v.success) return refus("corps_invalide", `message ${i} : ${v.error.issues[0]?.message ?? "forme inattendue"}`);
    const contenu = v.data.contenu.trim();
    if (contenu.length === 0) return refus("message_vide", `message ${i} : vide`);
    if (contenu.length > LONGUEUR_MAX_MESSAGE) {
      return refus("message_trop_long", `message ${i} : plus de ${LONGUEUR_MAX_MESSAGE} caractères`);
    }
    messages.push({ role: v.data.role, contenu });
  }

  const id = parsed.data.conversation_id;
  return {
    ok: true,
    source: source as SourceConversation,
    conversationId: id !== undefined && /^[0-9a-f-]{36}$/.test(id) ? id : null,
    messages,
  };
}
