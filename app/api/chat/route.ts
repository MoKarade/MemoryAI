// app/api/chat/route.ts — un tour du chat plein écran. DERRIÈRE le middleware de session (ce
// n'est pas une route machine) ET revérifié ici. Gelée par MEMORYAI_GEL comme le MCP.
//
// Réponses : 503 gelée · 401 sans session · 503 clé de chiffrement / de journal / API / base
// absente · 400 corps invalide · 429 plafond atteint · 503/502 refus de l'API du modèle, NOMMÉ
// (crédit épuisé, clé refusée…) · 500 { error, message } pour le reste — jamais un corps vide ·
// 200 { reponse, coutUsd, outilsAppeles }.

import { depotNotesLiaDrizzle } from "@/lib/lia/notes";
import { sourceMeteoEccc } from "@/lib/monde/meteo";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { apprendreDeLaConversation } from "@/lib/apprentissage";
import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { tourDeChat, PlafondAtteintError, type MessageChat } from "@/lib/chat/agent";
import { chargerCouches } from "@/lib/chat/couches";
import { classerErreurModele } from "@/lib/chat/erreursModele";
import { estModele, MODELE_DEFAUT } from "@/lib/coutChat";
import { baseConfiguree, db } from "@/lib/db";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotDrizzle } from "@/lib/depotFaits";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { estGele, reponseGelee } from "@/lib/gel";
import { cleJournalDepuisEnv, ClefJournalAbsenteError } from "@/lib/journal";
import { assurerMigrations } from "@/lib/migrations";
import { NonAutorise, requireSession } from "@/lib/session";
import { depotBancDrizzle } from "@/lib/banc/passe";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const erreur = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) return erreur(401, "non_autorise", err.message);
    throw err;
  }

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
  if (!apiKey) return erreur(503, "api_absente", "ANTHROPIC_API_KEY manquante : le chat est désactivé.");
  if (!baseConfiguree()) return erreur(503, "base_absente", "DATABASE_URL manquante.");

  let corps: { modele?: unknown; messages?: unknown; inclureN2?: unknown; inclureN3?: unknown; conversationId?: unknown };
  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur(400, "corps_invalide", "JSON attendu.");
  }
  const modele = corps.modele === undefined ? MODELE_DEFAUT : corps.modele;
  if (!estModele(modele)) return erreur(400, "corps_invalide", "modele inconnu.");
  const messages = Array.isArray(corps.messages)
    ? (corps.messages as unknown[]).filter(
        (m): m is MessageChat =>
          !!m && typeof m === "object" && ((m as MessageChat).role === "user" || (m as MessageChat).role === "assistant") && typeof (m as MessageChat).content === "string",
      )
    : [];
  if (messages.length === 0) return erreur(400, "corps_invalide", "messages vide.");
  // Une requête du CLIENT mal formée est un 400, pas une panne du serveur (revue #72).
  if (messages[messages.length - 1]!.role !== "user") return erreur(400, "corps_invalide", "le dernier message doit venir de Marc.");

  await assurerMigrations();
  const client = new Anthropic({ apiKey });
  try {
    // [L27] La voix et le profil de Marc : lus à CHAQUE tour, donc une voix changée se constate
    // au message suivant (la mesure de l'ADR 0005 A4), sans redéploiement ni cache.
    const couches = await chargerCouches({
      lecture: depotLectureDrizzle(db),
      admin: depotAdminDrizzle(db),
      cle,
      env: process.env,
      maintenant: () => new Date(),
    });
    const r = await tourDeChat({
      client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
      modele,
      messages,
      inclureN2: corps.inclureN2 === true,
      inclureN3: corps.inclureN3 === true,
      outils: {
        lecture: depotLectureDrizzle(db),
        ecriture: depotDrizzle(db),
        pieces: depotPiecesLectureDrizzle(db),
        banc: depotBancDrizzle(db),
        questions: depotQuestionsDrizzle(db),
        conversations: depotConversationsDrizzle(db),
        notes: depotNotesLiaDrizzle(db, cle),
        meteo: sourceMeteoEccc(db, process.env.MEMORYAI_METEO_VILLE),
        cle,
        env: process.env,
        lecteur: "chat",
        maintenant: () => new Date(),
      },
      admin: depotAdminDrizzle(db),
      couches,
    });
    // ── Consigner l'échange (ADR 0002 §5.2) ───────────────────────────────────────────
    // La conversation est créée au PREMIER tour et son identifiant rendu au client, qui le
    // renvoie ensuite : sans lui, chaque message ouvrirait sa propre conversation.
    //
    // ⚠️ ON NE CONSIGNE QUE CE TOUR-CI — le dernier message de Marc et la réponse. Le client
    // renvoie tout son historique à chaque appel (tronqué à `MAX_MESSAGES`) : consigner
    // `messages` en entier réécrirait chaque fois ce qui est déjà en base, et les index
    // divergeraient dès la première troncature.
    //
    // ⚠️ UN ÉCHEC DE CONSIGNATION NE FAIT PAS ÉCHOUER LE TOUR. Marc a eu sa réponse ; la
    // perdre parce que la mémoire n'a pas pu s'écrire serait le pire des deux maux. L'échec
    // est journalisé, et `/conversations` montre ce qui est réellement là.
    const conversations = depotConversationsDrizzle(db);
    // L'identifiant vient du CLIENT : il se vérifie. Un identifiant mal formé, ou qui ne
    // désigne aucune conversation vivante (oubliée depuis, ou inventé), ouvre une conversation
    // NEUVE plutôt que d'écrire dans le vide — `consigner` ne ferait rien et personne ne le
    // saurait, ce qui est exactement le mode de panne muet qu'on refuse ailleurs.
    const propose = typeof corps.conversationId === "string" && /^[0-9a-f-]{36}$/.test(corps.conversationId)
      ? corps.conversationId
      : null;
    let conversationId: string | null = null;
    try {
      const maintenant = new Date();
      // ⚠️ Revue #71 : seulement une conversation du CHAT. L'identifiant survit désormais au
      // rechargement de l'onglet ; sans ce contrôle, un identifiant de session Claude Code
      // ferait écrire le chat dans cette conversation-là. Même règle que `ouvrirConversationAction`.
      const existante = propose !== null ? await conversations.parId(propose) : null;
      conversationId = existante !== null && existante.source === "memoryai" ? propose : null;
      if (conversationId === null) conversationId = await conversations.demarrer("memoryai", maintenant);
      const dernierUser = [...messages].reverse().find((m) => m.role === "user");
      await conversations.consigner(
        conversationId,
        [
          ...(dernierUser ? [{ role: "user" as const, contenu: dernierUser.content }] : []),
          { role: "assistant" as const, contenu: r.reponse },
        ],
        cle,
        maintenant,
      );
    } catch (err) {
      console.error("[chat] conversation non consignée", err);
    }

    // ⚠️ APRÈS la réponse, jamais avant : Marc ne doit pas attendre que la mémoire apprenne.
    // `after` fait tourner ce travail dans la MÊME invocation, une fois la réponse partie —
    // donc il est borné par elle, et c'est voulu : ce qui n'a pas le temps de passer sera
    // repris par le cron quotidien, qui existe exactement pour ça.
    //
    // ⚠️ UN SEUL `after`, et il ne lit QU'UNE conversation. Une passe complète ici coûterait
    // le budget d'une journée en une soirée (cf. `apprendreDeLaConversation`).
    //
    // ⚠️ Il ne peut rien casser : son échec est journalisé et n'atteint jamais la réponse,
    // déjà envoyée. Le seuil de messages non extraits est dans `lib/apprentissage.ts`.
    const pourApprendre = conversationId;
    if (pourApprendre !== null) {
      after(async () => {
        try {
          await apprendreDeLaConversation({
            client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
            modele,
            conversationId: pourApprendre,
            cle,
            conversations: depotConversationsDrizzle(db),
            ecriture: depotDrizzle(db),
            admin: depotAdminDrizzle(db),
            maintenant: () => new Date(),
          });
        } catch (err) {
          console.error("[chat] apprentissage différé impossible", err);
        }
      });
    }

    return Response.json({ ...r, conversationId }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof PlafondAtteintError) return erreur(429, "plafond_atteint", err.message);
    // ⚠️ 24/09 : laissée remonter, une erreur de l'API devenait un 500 SANS CORPS, et l'écran
    // affichait « Unexpected end of JSON input » au lieu de « recharge ton crédit ».
    const m = classerErreurModele(err);
    console.error("[chat] tour impossible", err);
    if (m) return erreur(m.status, m.code, m.message);
    return erreur(500, "erreur_interne", "Le tour a échoué côté serveur. Le détail est dans ses journaux.");
  }
}
