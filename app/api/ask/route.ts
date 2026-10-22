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

import Anthropic from "@anthropic-ai/sdk";
import { HUB_TOKEN_HEADER, jetonsEgaux } from "@mokarade/hub-contract/endpoint";
import { tourDeChat, PlafondAtteintError } from "@/lib/chat/agent";
import { chargerCouches } from "@/lib/chat/couches";
import { classerErreurModele } from "@/lib/chat/erreursModele";
import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { MODELE_DEFAUT } from "@/lib/coutChat";
import { baseConfiguree, db } from "@/lib/db";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotDrizzle } from "@/lib/depotFaits";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { estGele } from "@/lib/gel";
import { cleJournalDepuisEnv, ClefJournalAbsenteError } from "@/lib/journal";
import { composerQuestion, composerReponse, CONVERSATIONS_FERMEES, LECTEUR_LIA_HUB, lireDemande, OUTILS_LIA_HUB } from "@/lib/lia/ask";
import { assurerMigrations } from "@/lib/migrations";
import { depotBancDrizzle } from "@/lib/banc/passe";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const erreur = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status, headers: NO_STORE });

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

  // 3. Ce qu'il faut pour répondre. Chaque manque est NOMMÉ, jamais une réponse inventée.
  let cle;
  try {
    cle = cleDepuisEnv();
    cleJournalDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return erreur(503, "cle_absente", err.message);
    if (err instanceof ClefJournalAbsenteError) return erreur(503, "journal_absent", err.message);
    throw err;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return erreur(503, "api_absente", "ANTHROPIC_API_KEY manquante.");
  if (!baseConfiguree()) return erreur(503, "base_absente", "DATABASE_URL manquante.");

  await assurerMigrations();
  const client = new Anthropic({ apiKey });
  const maintenant = () => new Date();
  try {
    const couches = await chargerCouches({
      lecture: depotLectureDrizzle(db),
      admin: depotAdminDrizzle(db),
      cle,
      env: process.env,
      maintenant,
      lecteur: LECTEUR_LIA_HUB,
    });
    const r = await tourDeChat({
      client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
      modele: MODELE_DEFAUT,
      messages: [{ role: "user", content: composerQuestion(lu.demande) }],
      // Niveaux 0 et 1 seulement : aucune bascule ne s'ouvre depuis une autre app (ADR 0016 §3).
      inclureN2: false,
      inclureN3: false,
      outilsPermis: OUTILS_LIA_HUB,
      blocs: true,
      outils: {
        lecture: depotLectureDrizzle(db),
        // Requis par le type ; aucun outil de `OUTILS_LIA_HUB` n'écrit.
        ecriture: depotDrizzle(db),
        pieces: depotPiecesLectureDrizzle(db),
        banc: depotBancDrizzle(db),
        questions: depotQuestionsDrizzle(db),
        conversations: CONVERSATIONS_FERMEES,
        cle,
        env: process.env,
        lecteur: LECTEUR_LIA_HUB,
        maintenant,
      },
      admin: depotAdminDrizzle(db),
      couches,
    });
    if (r.blocsRejetes > 0) console.error(`[ask] ${r.blocsRejetes} bloc(s) rejeté(s)`);
    const reponse = composerReponse(r.reponse, new URL(request.url).origin, r.blocs);
    if (!reponse) return erreur(503, "reponse_vide", "Le modèle n'a rien répondu.");
    return Response.json(reponse, { headers: NO_STORE });
  } catch (err) {
    // Budget épuisé = LIA indisponible (contrat : 503), pas « trop de requêtes ».
    if (err instanceof PlafondAtteintError) return erreur(503, "budget_epuise", err.message);
    const m = classerErreurModele(err);
    // Le nom et le message de l'erreur, jamais la requête : elle contient la question.
    console.error("[ask] tour impossible", err instanceof Error ? `${err.name}: ${err.message}` : "erreur");
    if (m) return erreur(503, m.code, m.message);
    return erreur(500, "erreur_interne", "Le tour a échoué côté serveur.");
  }
}
