"use client";
// app/chat/ChatAtelier.tsx — `/chat` est LIA, en pleine page (mode `atelier` de `@mokarade/lia-ui`).
//
// Plus aucune interface de chat propre à MemoryAI (tâche MemoryAI 367, choix A de Marc, 28/10/2026) : LIA
// dessine la discussion, l'hôte garde ses verrous. ⚠️ Une seule LIA par page : sur `/chat`, la bulle
// n'est pas montée (`components/LiaMaison.tsx`), et celle-ci la remplace. Le backend est celui de
// toujours (`/api/chat`) : mêmes gardes, mêmes plafonds, même consignation chiffrée (ADR 0002).
// ⚠️ ADR 0011 : le niveau 2 (`MEMORYAI_N2_CHAT`) et le niveau 3 (`MEMORYAI_N3_CHAT`) restent des
// réglages PAR CONVERSATION, grisés quand la variable manque ; la route les revérifie à chaque tour
// et les journalise. Cet écran n'en décide aucun.

import { useRef, useState } from "react";
import { Lia } from "@mokarade/lia-ui/react";
import type { OptionAtelier, ReglagesAtelier } from "@mokarade/lia-ui";
import { historiqueChatAction, ouvrirConversationAction } from "./actions";
import { decouperAnnotation } from "@/lib/chat/liens";
import { messageDeReponse } from "@/lib/chat/messageDeReponse";
import { FUSEAU } from "@/lib/fuseau";
import { etatLiaMaison } from "@/components/LiaMaison";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  modeles: { id: string; nom: string }[];
  modeleDefaut: string;
  n2Possible: boolean;
  n3Possible: boolean;
  plafondUsd: number;
  configure: boolean;
  /**
   * La question venue de « Demander à Lia là-dessus » ([L33a]) : AFFICHÉE, jamais envoyée. Une
   * navigation ne dépense pas d'appel payant ; Marc la pose lui-même.
   */
  saisieInitiale?: string;
}

/** Le texte d'une réponse de modèle, sans balises d'annotation : LIA affiche du texte, rien d'autre. */
function texteSansAnnotation(contenu: string): string {
  return decouperAnnotation(contenu)
    .map((s) => (s.type === "lien" ? "" : s.type === "document" ? "papier" : s.texte))
    .join("");
}

export function ChatAtelier({ modeles, modeleDefaut, n2Possible, n3Possible, plafondUsd, configure, saisieInitiale }: Props) {
  const [conteneur, setConteneur] = useState<HTMLElement | null>(null);
  const messages = useRef<Message[]>([]);
  const conversationId = useRef<string | null>(null);

  const options: readonly OptionAtelier[] = [
    {
      id: "modele",
      libelle: "Modèle",
      type: "liste",
      choix: modeles.map((m) => ({ valeur: m.id, libelle: m.nom })),
      valeur: modeleDefaut,
    },
    {
      id: "n2",
      libelle: "Niveau 2 pour cette conversation",
      type: "case",
      valeur: false,
      desactive: !n2Possible,
      aide: n2Possible
        ? "Autorise, pour cette conversation, les faits de niveau 2 (domicile, santé, relations, famille, finances). Journalisé."
        : "MEMORYAI_N2_CHAT n'est pas posée : le niveau 2 n'est jamais servi.",
    },
    {
      id: "n3",
      libelle: "Papiers d’identité (niveau 3)",
      type: "case",
      valeur: n3Possible,
      desactive: !n3Possible,
      aide: n3Possible
        ? "Ouvert par défaut : le CONTENU de tes papiers d'identité et d'immigration (niveau 3), numéros compris, pour cette conversation. Jamais servi au connecteur claude.ai. Journalisé."
        : "MEMORYAI_N3_CHAT n'est pas posée : le contenu des papiers d'identité n'est jamais servi.",
    },
  ];

  async function poser(question: string, signal: AbortSignal, reglages?: ReglagesAtelier) {
    const suivants: Message[] = [...messages.current, { role: "user", content: question }];
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        modele: typeof reglages?.modele === "string" ? reglages.modele : modeleDefaut,
        inclureN2: n2Possible && reglages?.n2 === true,
        inclureN3: n3Possible && (reglages?.n3 ?? n3Possible) === true,
        conversationId: conversationId.current,
        messages: suivants,
      }),
    });
    // ⚠️ Le TEXTE d'abord : un `r.json()` sur un corps vide levait « Unexpected end of JSON input ».
    const brut = await r.text();
    if (!r.ok) return { text: messageDeReponse(r.status, brut) };
    const corps = JSON.parse(brut) as { reponse?: string; coutUsd?: number; outilsAppeles?: string[]; conversationId?: string };
    if (corps.conversationId) conversationId.current = corps.conversationId;
    const reponse = corps.reponse ?? "";
    messages.current = [...suivants, { role: "assistant", content: reponse }];
    const meta = [corps.outilsAppeles?.length ? `outils : ${corps.outilsAppeles.join(", ")}` : "", corps.coutUsd !== undefined ? `${corps.coutUsd.toFixed(4)} $ US` : ""]
      .filter(Boolean)
      .join(" · ");
    return { text: texteSansAnnotation(reponse) + (meta ? `\n\n(${meta})` : "") };
  }

  return (
    <main className="chat">
      {!configure && <p className="alerte bandeau">ANTHROPIC_API_KEY manquante : le chat est désactivé. Les autres pages marchent.</p>}
      {saisieInitiale && <p className="hint">À demander à LIA : « {saisieInitiale} »</p>}
      <p className="hint">Plafond {plafondUsd.toFixed(2)} $/jour · la conversation est gardée, chiffrée : tu la retrouves dans l’historique.</p>
      <div ref={setConteneur} className="chat-atelier" />
      {conteneur && (
        <Lia
          etat={etatLiaMaison()}
          atelier={{
            conteneur,
            titre: "LIA",
            options,
            historique: {
              liste: async () => {
                const r = await historiqueChatAction();
                if (!r.ok) throw new Error(r.message ?? "Historique indisponible");
                return r.conversations.map((c) => ({
                  id: c.id,
                  titre: c.titre ?? "(titre illisible)",
                  quand: new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short", timeZone: FUSEAU }).format(new Date(c.quand)),
                }));
              },
              ouvrir: async (id) => {
                const r = await ouvrirConversationAction(id);
                if (!r.ok) throw new Error(r.message ?? "Impossible de rouvrir cette conversation.");
                messages.current = r.messages;
                conversationId.current = id;
                return r.messages.map((m) => ({ de: m.role === "user" ? ("moi" as const) : ("lia" as const), texte: texteSansAnnotation(m.content) }));
              },
              nouveau: () => {
                messages.current = [];
                conversationId.current = null;
              },
            },
          }}
          ask={configure ? (question, signal, _contexte, reglages) => poser(question, signal, reglages) : undefined}
        />
      )}
    </main>
  );
}
