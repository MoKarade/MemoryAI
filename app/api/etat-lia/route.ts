// app/api/etat-lia/route.ts — l'état partagé de LIA, pour le hub (et par lui, toutes les apps) :
// il relaie ce que sa propre route `/api/lia/etat` reçoit d'une page. `x-hub-token` seul, en
// temps constant, comme `/api/ask` ; propriétaire seul : le hub le DIT par `x-lia-proprietaire: 1`
// après avoir vérifié la session (un invité d'une app n'écrit pas l'état de LIA). Contrat :
// `commun/assistant/CONTRAT-etat-lia.md` ; décisions : `lib/lia/depotEtat.ts`.
//
// Réponses : 503 sans `HUB_TOKEN` · 401 jeton faux · 403 propriétaire non dit · GET 200 / 204 ·
// PUT 200 / 409 / 400 / 413 · 503 gelée (écriture) ou base absente · toujours `no-store`.

import { HUB_TOKEN_HEADER, jetonsEgaux } from "@mokarade/hub-contract/endpoint";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { depotEtatLiaDrizzle, repondreEcriture, repondreLecture } from "@/lib/lia/depotEtat";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

/** L'en-tête par lequel le hub dit que la page est celle du propriétaire. */
const EN_TETE_PROPRIETAIRE = "x-lia-proprietaire";

const refus = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

async function garde(request: Request): Promise<Response | null> {
  // Le jeton, avant tout : un inconnu n'apprend rien.
  const attendu = process.env.HUB_TOKEN?.trim();
  if (!attendu) return refus(503, "hub_token_absent", "HUB_TOKEN n'est pas configuré.");
  const recu = request.headers.get(HUB_TOKEN_HEADER);
  if (!recu || !(await jetonsEgaux(recu, attendu))) return refus(401, "non_autorise", "Jeton du hub absent ou faux.");
  if (request.headers.get(EN_TETE_PROPRIETAIRE) !== "1") return refus(403, "reserve_au_proprietaire", "L'état de LIA n'est partagé qu'avec le propriétaire.");
  if (!baseConfiguree()) return refus(503, "base_absente", "DATABASE_URL manquante.");
  await assurerMigrations();
  return null;
}

export async function GET(request: Request): Promise<Response> {
  return (await garde(request)) ?? repondreLecture(depotEtatLiaDrizzle(db));
}

export async function PUT(request: Request): Promise<Response> {
  const r = await garde(request);
  if (r) return r;
  if (estGele()) return reponseGelee();
  return repondreEcriture(depotEtatLiaDrizzle(db), await request.text());
}
