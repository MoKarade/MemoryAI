// lib/mcp/protocole.ts — le sous-ensemble de MCP dont un serveur d'OUTILS a besoin. PUR
// (hors les outils eux-mêmes, qui reçoivent leur contexte en paramètre).
//
// Port de `carai/lib/mcp/protocole.ts`. MCP sur HTTP est du JSON-RPC 2.0 : `initialize`,
// `tools/list`, `tools/call`, et rien de plus ici. Pas de SDK : testable sans transport.
//
// ⚠️ Une NOTIFICATION (message sans `id`) ne reçoit JAMAIS de réponse — `null` est un
// retour légitime.
//
// ⚠️ L'ORDRE DANS `tools/call` EST LA GARDE : l'outil s'exécute, PUIS l'accès est journalisé,
// PUIS la réponse part. Si le journal ne peut pas s'écrire, rien n'est servi — servir sans
// trace est exactement ce que le journal existe pour empêcher (ADR 0001 §3).

import { cleJournalDepuisEnv } from "../journal";
import { journaliserAcces } from "../journalAcces";
import { OUTILS, outilParNom, schemaPourLecteur, type ContexteOutils } from "./outils";

export const VERSION_PROTOCOLE = "2024-11-05";
export const SERVEUR = { name: "memoryai", version: "1.0.0" } as const;

export const CODE_METHODE_INCONNUE = -32601;
export const CODE_PARAMS_INVALIDES = -32602;

export interface MessageJsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ReponseJsonRpc {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const ok = (id: string | number | null, result: unknown): ReponseJsonRpc => ({ jsonrpc: "2.0", id, result });
const erreur = (id: string | number | null, code: number, message: string): ReponseJsonRpc => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export async function traiterMessage(msg: MessageJsonRpc, ctx: ContexteOutils): Promise<ReponseJsonRpc | null> {
  const id = msg.id ?? null;
  const estNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(id, { protocolVersion: VERSION_PROTOCOLE, capabilities: { tools: {} }, serverInfo: SERVEUR });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return estNotification ? null : ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: OUTILS.map((o) => ({ name: o.name, description: o.description, inputSchema: schemaPourLecteur(o, ctx.lecteur) })),
      });

    case "tools/call": {
      const nom = typeof msg.params?.name === "string" ? msg.params.name : null;
      if (!nom) return erreur(id, CODE_PARAMS_INVALIDES, "Paramètre `name` manquant.");
      const outil = outilParNom(nom);
      if (!outil) return erreur(id, CODE_PARAMS_INVALIDES, `Outil inconnu : ${nom}`);
      const args =
        msg.params?.arguments && typeof msg.params.arguments === "object"
          ? (msg.params.arguments as Record<string, unknown>)
          : {};
      try {
        const r = await outil.executer(args, ctx);
        // Journal AVANT la réponse : pas de trace, pas de réponse.
        await journaliserAcces(
          ctx.lecture,
          cleJournalDepuisEnv(ctx.env),
          {
            lecteur: ctx.lecteur,
            outil: outil.name,
            usage: r.usage,
            niveauMaxServi: r.niveauMaxServi,
            idsFaits: r.faitsServis.map((f) => f.id),
            idsPieces: r.piecesServies?.map((x) => x.id) ?? [],
            questionEmpreinte: r.questionEmpreinte,
          },
          ctx.maintenant,
        );
        return ok(id, { content: [{ type: "text", text: r.texte }] });
      } catch (err) {
        // Erreur d'OUTIL : le modèle doit la LIRE, pas voir le transport tomber.
        const message = err instanceof Error ? err.message : "Erreur inconnue.";
        console.error(`[mcp] ${nom} a échoué`, err);
        return ok(id, { content: [{ type: "text", text: `Impossible de répondre : ${message}` }], isError: true });
      }
    }

    default:
      if (estNotification) return null;
      return erreur(id, CODE_METHODE_INCONNUE, `Méthode inconnue : ${msg.method ?? "(absente)"}`);
  }
}
