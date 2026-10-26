// app/api/mcp/route.ts — le connecteur MCP de MemoryAI (ADR 0001 §8, lot 4).
//
// ⚠️ Route HORS du middleware de session (`ROUTES_A_AUTH_PROPRE`) : un client MCP n'a pas de
// cookie du hub. Elle porte SA PROPRE auth — OAuth 2.1 (`lib/mcp/oauth.ts`), et RIEN d'autre :
// pas de jeton statique en parallèle (CLAUDE.md §1 : « exactement le genre de porte qu'on
// oublie de refermer »).
//
// L'ordre des refus, chacun distinct du suivant :
//   • MEMORYAI_GEL=1        → 503 « mémoire gelée » (kill-switch, avant tout le reste)
//   • OAuth non configuré   → 503 « connecteur désactivé » (une configuration, pas un refus)
//   • jeton absent ou faux  → 401 + `WWW-Authenticate` (c'est lui qui amorce la découverte)
//   • clé de chiffrement ou de journal absente, base absente → 503 nommé (une panne, fermée)
//   • méthode ≠ POST        → 405
//
// Chaque appel d'outil est journalisé AVANT sa réponse (`lib/mcp/protocole.ts`).

import { depotNotesLiaDrizzle } from "@/lib/lia/notes";
import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { depotDrizzle } from "@/lib/depotFaits";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { estGele, reponseGelee } from "@/lib/gel";
import { cleJournalDepuisEnv, ClefJournalAbsenteError } from "@/lib/journal";
import { contexteMcp, NO_STORE } from "@/lib/mcp/contexte";
import { OAuthError } from "@/lib/mcp/oauth";
import type { ContexteOutils } from "@/lib/mcp/outils";
import { traiterMessage, type MessageJsonRpc } from "@/lib/mcp/protocole";
import { assurerMigrations } from "@/lib/migrations";
import { depotBancDrizzle } from "@/lib/banc/passe";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { depotSortiesDrizzle } from "@/lib/sorties/lecture";

export const dynamic = "force-dynamic";

function refus401(urlMetadonnees: string): Response {
  return Response.json(
    { error: "non_autorise" },
    {
      status: 401,
      headers: { ...NO_STORE, "WWW-Authenticate": `Bearer realm="MemoryAI", resource_metadata="${urlMetadonnees}"` },
    },
  );
}

function panne(code: string, message: string): Response {
  return Response.json({ error: code, message }, { status: 503, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  const ctx = contexteMcp(request);
  if (!ctx) {
    return panne("mcp_desactive", "Connecteur MCP désactivé : MCP_SIGNING_KEY et MCP_ACCESS_KEY ne sont pas configurées.");
  }
  try {
    ctx.auth.verifyAccessToken(request.headers.get("authorization") ?? undefined);
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return refus401(ctx.auth.resourceMetadataUrl());
  }

  let cle;
  try {
    cle = cleDepuisEnv();
    cleJournalDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return panne("cle_absente", err.message);
    if (err instanceof ClefJournalAbsenteError) return panne("journal_absent", err.message);
    throw err;
  }
  if (!baseConfiguree()) return panne("base_absente", "DATABASE_URL manquante : rien n'est servi.");

  let charge: unknown;
  try {
    charge = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible." } },
      { status: 400, headers: NO_STORE },
    );
  }

  await assurerMigrations();
  const outils: ContexteOutils = {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    banc: depotBancDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    notes: depotNotesLiaDrizzle(db, cle),
    sorties: depotSortiesDrizzle(db, cle),
    cle,
    env: process.env,
    lecteur: "claude-ai",
    maintenant: () => new Date(),
  };

  // Un lot JSON-RPC se traite EN SÉRIE : le journal est une chaîne, deux écritures parallèles
  // se marcheraient dessus (l'index unique refuserait la seconde, qui recommencerait).
  if (Array.isArray(charge)) {
    const reponses = [];
    for (const m of charge as MessageJsonRpc[]) {
      const r = await traiterMessage(m, outils);
      if (r !== null) reponses.push(r);
    }
    if (reponses.length === 0) return new Response(null, { status: 202, headers: NO_STORE });
    return Response.json(reponses, { headers: NO_STORE });
  }

  const reponse = await traiterMessage((charge ?? {}) as MessageJsonRpc, outils);
  if (reponse === null) return new Response(null, { status: 202, headers: NO_STORE });
  return Response.json(reponse, { headers: NO_STORE });
}

/**
 * Un GET dit ce qu'il faut pour VÉRIFIER un déploiement depuis un navigateur : le connecteur
 * est-il configuré, est-il gelé. Des booléens, jamais une valeur.
 */
export async function GET(request: Request): Promise<Response> {
  return Response.json(
    {
      error: "methode_non_autorisee",
      message: "Le connecteur MCP de MemoryAI parle JSON-RPC en POST.",
      configure: Boolean(contexteMcp(request)),
      gele: estGele(),
    },
    { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
  );
}
