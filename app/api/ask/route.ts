// app/api/ask/route.ts — LIA répond au hub, et par lui à toutes les apps (ADR 0016).
//
// Contrat du fil Assistant : navigateur → app → hub → ICI. MemoryAI ne fait confiance qu'au
// hub : `x-hub-token` (le même `HUB_TOKEN` que `/hub/summary`, comparé en temps constant), ni
// session, ni CORS. Route HORS du middleware de session, par égalité stricte (`lib/authGuard.ts`).
//
// Réponses : 503 `HUB_TOKEN` absent · 401 jeton absent ou faux · 503 gelée · 413 corps > 8 Ko ·
// 400 corps invalide · 403 pas le propriétaire · 503 LIA indisponible (clé, base, API absente,
// budget épuisé, refus du modèle, réponse vide) · 500 le reste · 200 `{ text, blocks? }`. Toujours
// `no-store`, toujours un corps JSON. ⚠️ La question n'est JAMAIS journalisée en clair : ni ici,
// ni dans un message d'erreur (`lireDemande` ne cite que des noms de champs).

import { HUB_TOKEN_HEADER, jetonsEgaux } from "@mokarade/hub-contract/endpoint";
import { estGele } from "@/lib/gel";
import { LECTEUR_LIA_HUB, lireDemande } from "@/lib/lia/ask";
import { erreurLia as erreur, repondreLia } from "@/lib/lia/repondre";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  // 1. Le jeton, avant tout : un inconnu n'apprend rien de l'état de la mémoire.
  const attendu = process.env.HUB_TOKEN?.trim();
  if (!attendu) return erreur(503, "hub_token_absent", "HUB_TOKEN n'est pas configuré : LIA ne répond à personne.");
  const recu = request.headers.get(HUB_TOKEN_HEADER);
  if (!recu || !(await jetonsEgaux(recu, attendu))) return erreur(401, "non_autorise", "Jeton du hub absent ou faux.");

  if (estGele()) return erreur(503, "gelee", "MemoryAI est gelée : LIA ne répond pas.");

  // 2. Le corps : taille, forme, propriétaire.
  const lu = lireDemande(await request.text());
  if (!lu.ok) return erreur(lu.status, lu.code, lu.message);

  // 3. Le tour, commun avec la maison (`lib/lia/repondre.ts`).
  return repondreLia(lu.demande, new URL(request.url).origin, LECTEUR_LIA_HUB);
}
