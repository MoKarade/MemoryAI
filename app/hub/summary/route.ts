// app/hub/summary/route.ts — endpoint consommé par le hub (contrat @mokarade/hub-contract).
//
// La mécanique (503/401/405, temps constant, no-store, validation) vit dans `serveSummary`.
// Ici : QUI on est et QUOI publier, depuis les comptes réels (`lib/hubSummary.ts`, pure).
//
// ⚠️ Route HORS du middleware de session (elle porte `x-hub-token`) — piège n° 1 du gabarit.
// ⚠️ Le hub polle toutes les ~15 s : les comptes sont cinq requêtes indexées, pas de cache.
// ⚠️ Si `construireSummary` JETTE, `serveSummary` répond 500 — jamais un summary partiel.

import { HUB_TOKEN_HEADER, serveSummary } from "@mokarade/hub-contract/endpoint";
import type { HubSummary } from "@mokarade/hub-contract";
import { baseConfiguree, db } from "@/lib/db";
import { comptesParDomaine, depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { estGele } from "@/lib/gel";
import { composerSummary } from "@/lib/hubSummary";
import { comptesNotesLia } from "@/lib/lia/notes";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

async function construireSummary(): Promise<HubSummary> {
  if (!baseConfiguree()) {
    return composerSummary({ valides: 0, aValider: 0, canaris: 0, dernierValideLe: null, parDomaine: {}, chat: { totalUsd: 0, appels: 0 }, gele: estGele(), papiers: 0 });
  }
  await assurerMigrations();
  const c = await depotLectureDrizzle(db).comptes();
  const chat = await depotAdminDrizzle(db).depenseTotaleUsd();
  // ⚠️ Cinquième requête, assumée : le hub polle toutes les ~15 s, mais publier « Faits
  // validés » sans « Papiers » depuis que l'inventaire a migré (ADR 0004 §6.2) afficherait
  // une chute de 94 % sans dire où l'inventaire est passé.
  const papiers = await depotPiecesLectureDrizzle(db).comptes();
  // Nombre de notes de LIA non lues : si SA lecture échoue, la métrique est absente (jamais 0) et le
  // reste du résumé sort ; l'erreur est journalisée, pas avalée.
  let notesLiaNonLues: number | undefined;
  try {
    notesLiaNonLues = await comptesNotesLia(db);
  } catch (e) {
    console.error("[hub/summary] compte des notes de LIA illisible :", e instanceof Error ? e.message : "erreur inconnue");
  }
  return composerSummary({
    ...(notesLiaNonLues !== undefined ? { notesLiaNonLues } : {}),
    valides: c.parStatut.valide ?? 0,
    aValider: c.parStatut.propose ?? 0,
    papiers: papiers.total,
    canaris: c.canaris,
    dernierValideLe: c.dernierValideLe,
    parDomaine: await comptesParDomaine(db),
    chat: { totalUsd: chat.total, appels: chat.appels },
    gele: estGele(),
  });
}

export async function GET(request: Request): Promise<Response> {
  const { status, headers, body } = await serveSummary(
    { method: "GET", token: request.headers.get(HUB_TOKEN_HEADER) },
    { expectedToken: process.env.HUB_TOKEN, build: construireSummary },
  );
  return new Response(body, { status, headers });
}
