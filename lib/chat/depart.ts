// lib/chat/depart.ts — ce que le chat reprend de l'onglet à l'ouverture.
//
// Fonction PURE : le chat lisait `sessionStorage` dans des effets qui rappelaient `setState`
// (règle `react-hooks/set-state-in-effect` de React 19 : un rendu de plus, avec un premier
// écran vide qui clignote). Il lit maintenant UNE fois, à l'état initial, et passe les deux
// chaînes brutes ici. Rien n'est lu ni écrit dans cette fonction : elle se teste sans navigateur.

export interface MessageRepris {
  role: "user" | "assistant";
  content: string;
  coutUsd?: number;
  outils?: string[];
}

export interface DepartChat {
  messages: MessageRepris[];
  /** Le modèle de la session, seulement s'il figure encore dans la liste offerte. */
  modele: string | null;
  conversationId: string | null;
  /** Le texte laissé par `/partage` : prérempli, jamais envoyé. */
  brouillon: string | null;
}

export const DEPART_VIDE: DepartChat = { messages: [], modele: null, conversationId: null, brouillon: null };

export function departDeSession(
  brutSession: string | null,
  brouillon: string | null,
  idsModeles: readonly string[],
): DepartChat {
  const depart: DepartChat = { ...DEPART_VIDE, brouillon: brouillon || null };
  if (!brutSession) return depart;
  try {
    const s = JSON.parse(brutSession) as { messages?: unknown; modele?: unknown; conversationId?: unknown };
    if (Array.isArray(s.messages)) depart.messages = s.messages as MessageRepris[];
    // ⚠️ [L2] L'identifiant survit au rechargement AVEC les messages. Sans lui, recharger
    // l'onglet puis écrire ouvrait une conversation NEUVE en base pour la suite d'une
    // conversation existante — deux entrées d'historique pour un seul échange.
    if (typeof s.conversationId === "string") depart.conversationId = s.conversationId;
    if (typeof s.modele === "string" && idsModeles.includes(s.modele)) depart.modele = s.modele;
  } catch {
    // Une session illisible repart vide : rien à perdre, rien n'est persisté ailleurs.
    return { ...DEPART_VIDE, brouillon: depart.brouillon };
  }
  return depart;
}
