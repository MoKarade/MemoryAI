// lib/lia/repondre.ts — un tour de LIA, commun aux deux portes (ADR 0016) : le hub
// (`app/api/ask`, jeton) et la maison (`app/api/lia/ask`, session de Marc). Chaque porte fait
// SON contrôle d'accès et lit la demande ; ce module fait le reste, à l'identique : niveaux 0 et
// 1, outils de MÉMOIRE en lecture seule, blocs sourcés. Seul le LECTEUR change, pour le journal.
// ⚠️ Le seul outil qui ÉCRIT est `lia_retenir` (ADR 0033, voie A) : sa preuve est la question de Marc,
// lue ICI dans la demande et jamais passée par le modèle.
// ⚠️ La question n'est JAMAIS journalisée en clair, ni dans une erreur (nom et message seulement).

import { depotNotesLiaDrizzle } from "@/lib/lia/notes";
import { sourceMeteoEccc } from "@/lib/monde/meteo";
import { sourceActualite } from "@/lib/monde/actualite";
import Anthropic from "@anthropic-ai/sdk";
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
import { cleJournalDepuisEnv, ClefJournalAbsenteError } from "@/lib/journal";
import { SOURCE_BILAN_HUB } from "@/lib/lia/blocs";
import { composerQuestion, composerReponse, CONVERSATIONS_FERMEES, OUTILS_LIA_HUB, type DemandeAsk } from "@/lib/lia/ask";
import { longueSansBloc } from "@/lib/lia/longueur";
import { retenirLiaDrizzle } from "@/lib/lia/retenir";
import { assurerMigrations } from "@/lib/migrations";
import { depotBancDrizzle } from "@/lib/banc/passe";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";

const NO_STORE = { "Cache-Control": "no-store" };
export const erreurLia = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status, headers: NO_STORE });

/** Répond à une demande DÉJÀ admise par sa porte. 503 nommé pour tout manque, 200 `{ text, blocks? }`. */
export async function repondreLia(demande: DemandeAsk, origine: string, lecteur: string): Promise<Response> {
  const erreur = erreurLia;
  // Ce qu'il faut pour répondre. Chaque manque est NOMMÉ, jamais une réponse inventée.
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
      lecteur,
    });
    const r = await tourDeChat({
      client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
      modele: MODELE_DEFAUT,
      messages: [{ role: "user", content: composerQuestion(demande) }],
      // Niveaux 0 et 1 seulement : aucune bascule ne s'ouvre depuis une autre app (ADR 0016 §3).
      inclureN2: false,
      inclureN3: false,
      outilsPermis: OUTILS_LIA_HUB,
      blocs: true,
      // ADR 0033 : LIA retient seule ce que Marc dit. La preuve est SA question, pas le bilan du hub.
      retenir: retenirLiaDrizzle(db, {
        messages: [{ role: "user", content: demande.question }],
        cle,
        client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
      }),
      // Le bilan du hub est une source servie SEULEMENT quand il est joint à cette question.
      sourcesServies: demande.contexte ? new Set([SOURCE_BILAN_HUB]) : undefined,
      outils: {
        lecture: depotLectureDrizzle(db),
        // Requis par le type ; aucun outil de `OUTILS_LIA_HUB` n'écrit (`lia_retenir` a son propre dépôt).
        ecriture: depotDrizzle(db),
        pieces: depotPiecesLectureDrizzle(db),
        banc: depotBancDrizzle(db),
        questions: depotQuestionsDrizzle(db),
        conversations: CONVERSATIONS_FERMEES,
        notes: depotNotesLiaDrizzle(db, cle),
        meteo: sourceMeteoEccc(db, process.env.MEMORYAI_METEO_VILLE),
        actualite: sourceActualite(db),
        cle,
        env: process.env,
        lecteur,
        maintenant,
      },
      admin: depotAdminDrizzle(db),
      couches,
    });
    // Chaque tour laisse ses COMPTEURS (jamais son contenu) : sans eux, « 0 bloc » ne dit pas si
    // le modèle n'a rien proposé ou si tout a été rejeté. `longue_sans_bloc` (tâche MemoryAI 291)
    // dit si la réponse dépasse 280 caractères sans bloc : la part de 1 sur le total des tours est
    // la mesure de « deux phrases ».
    const longue = longueSansBloc(r.reponse, r.blocs.length);
    console.info(`[${lecteur}] tour : ${r.blocs.length} bloc(s), outils ${r.outilsAppeles.join(", ") || "aucun"}, longue_sans_bloc=${longue ? 1 : 0}`);
    // Les raisons portent des chemins de champs, jamais des valeurs : un journal n'est pas chiffré.
    if (r.blocsRejetes > 0) console.error(`[${lecteur}] ${r.blocsRejetes} bloc(s) rejeté(s) : ${r.raisonsBlocs.join(" ; ")}`);
    const reponse = composerReponse(r.reponse, origine, r.blocs);
    if (!reponse) {
      // Un 503 sans trace ne se diagnostique pas : les compteurs du tour, jamais son contenu.
      console.error(`[${lecteur}] réponse vide : ${r.blocs.length} bloc(s), outils ${r.outilsAppeles.join(", ") || "aucun"}`);
      return erreur(503, "reponse_vide", "Le modèle n'a rien répondu.");
    }
    return Response.json(reponse, { headers: NO_STORE });
  } catch (err) {
    // Budget épuisé = LIA indisponible (contrat : 503), pas « trop de requêtes ».
    if (err instanceof PlafondAtteintError) return erreur(503, "budget_epuise", err.message);
    const m = classerErreurModele(err);
    // Le nom et le message de l'erreur, jamais la requête : elle contient la question.
    console.error(`[${lecteur}] tour impossible`, err instanceof Error ? `${err.name}: ${err.message}` : "erreur");
    if (m) return erreur(503, m.code, m.message);
    return erreur(500, "erreur_interne", "Le tour a échoué côté serveur.");
  }
}
