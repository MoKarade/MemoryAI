// app/api/lia/etat/route.ts — l'état partagé de LIA, pour LIA chez elle (`etatHttp` du paquet,
// même origine, cookie de session). DERRIÈRE le middleware de session ET revérifiée ici : jamais
// d'invité. Contrat : `commun/assistant/CONTRAT-etat-lia.md` ; décisions : `lib/lia/depotEtat.ts`.
//
// Réponses : 401 sans session · GET 200 l'état / 204 aucun · PUT 200 gardé / 409 l'état gardé /
// 400 / 413 · 503 gelée (écriture) ou base absente · toujours `no-store`.

import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { cleDeLaDiscussion, depotEtatLiaDrizzle, repondreEcriture, repondreLecture } from "@/lib/lia/depotEtat";
import { assurerMigrations } from "@/lib/migrations";
import { NonAutorise, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function garde(): Promise<Response | null> {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) return Response.json({ error: "non_autorise", message: err.message }, { status: 401, headers: { "Cache-Control": "no-store" } });
    throw err;
  }
  if (!baseConfiguree()) return Response.json({ error: "base_absente", message: "DATABASE_URL manquante." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  await assurerMigrations();
  return null;
}

export async function GET(): Promise<Response> {
  return (await garde()) ?? repondreLecture(depotEtatLiaDrizzle(db, cleDeLaDiscussion()));
}

export async function PUT(request: Request): Promise<Response> {
  const refus = await garde();
  if (refus) return refus;
  if (estGele()) return reponseGelee();
  return repondreEcriture(depotEtatLiaDrizzle(db, cleDeLaDiscussion()), await request.text());
}
