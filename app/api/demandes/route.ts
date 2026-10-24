// app/api/demandes/route.ts — les demandes « Que peut-on changer ici ? » du hub (ADR 0021).
//
// Le serveur du hub dépose et relit ce que Marc a voulu changer sur une page. `x-hub-token` seul,
// en temps constant, comme `/api/etat-lia` ; propriétaire seul : le hub le DIT par
// `x-lia-proprietaire: 1` après avoir vérifié la session (un invité ne dépose rien). Contenu et
// décisions : `lib/demandes.ts`.
//
// Réponses : 503 sans `HUB_TOKEN` · 401 jeton faux · 403 propriétaire non dit · 503 gelée (lecture
// ET écriture : le `nom` est une donnée de Marc) · 503 base ou clé absente · POST 201 / 200 / 410 /
// 400 / 413 / 422 · GET 200 · toujours `no-store`, aucun refus en cache.

import { HUB_TOKEN_HEADER, jetonsEgaux } from "@mokarade/hub-contract/endpoint";
import { cleDepuisEnv, ClefAbsenteError, type Cle } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { depotDemandesDrizzle, repondreEcriture, repondreLecture } from "@/lib/demandes";
import { estGele, reponseGelee } from "@/lib/gel";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

/** L'en-tête par lequel le hub dit que la page est celle du propriétaire. */
const EN_TETE_PROPRIETAIRE = "x-lia-proprietaire";

const refus = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

async function garde(request: Request): Promise<Response | Cle> {
  // Le jeton, avant tout : un inconnu n'apprend rien.
  const attendu = process.env.HUB_TOKEN?.trim();
  if (!attendu) return refus(503, "hub_token_absent", "HUB_TOKEN n'est pas configuré.");
  const recu = request.headers.get(HUB_TOKEN_HEADER);
  if (!recu || !(await jetonsEgaux(recu, attendu))) return refus(401, "non_autorise", "Jeton du hub absent ou faux.");
  if (request.headers.get(EN_TETE_PROPRIETAIRE) !== "1") return refus(403, "reserve_au_proprietaire", "Les demandes ne sont gardées que pour le propriétaire.");
  if (estGele()) return reponseGelee();
  let cle: Cle;
  try {
    cle = cleDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return refus(503, "cle_absente", err.message);
    throw err;
  }
  if (!baseConfiguree()) return refus(503, "base_absente", "DATABASE_URL manquante.");
  await assurerMigrations();
  return cle;
}

export async function GET(request: Request): Promise<Response> {
  const g = await garde(request);
  return g instanceof Response ? g : repondreLecture(depotDemandesDrizzle(db, g));
}

export async function POST(request: Request): Promise<Response> {
  const g = await garde(request);
  return g instanceof Response ? g : repondreEcriture(depotDemandesDrizzle(db, g), await request.text(), new Date());
}
