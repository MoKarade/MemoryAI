"use server";
// app/chat/actions.ts — « Épingler » : Marc retient une phrase du chat comme fait `propose`
// (ADR 0001 §5.5). Fiabilité `marc` — c'est lui qui a choisi et relu la valeur — mais statut
// `propose` : LIA le relit avant de le garder, sans qu'il ait à le juger. Mêmes gardes que tout
// écrivain (`ecrireLot`).

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { DechiffrementError } from "@/lib/chiffrement";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotDrizzle } from "@/lib/depotFaits";
import { ecrireLot } from "@/lib/ecrireFaits";
import type { Ecrivain } from "@/lib/jetons";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

const ECRIVAIN_MARC: Ecrivain = { appId: "chat", role: "ecriture", fiabilites: ["marc"] };

export interface RetourEpingle {
  ok: boolean;
  message: string;
}

export async function epinglerAction(entree: { predicat: string; valeur: string; valeur_type: string }): Promise<RetourEpingle> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) return { ok: false, message: acces.manque === "base" ? "base absente" : "clé absente" };
  const jour = new Date().toISOString().slice(0, 10);
  const r = await ecrireLot(
    [
      {
        sujet: "marc",
        predicat: entree.predicat,
        valeur: entree.valeur,
        valeur_type: entree.valeur_type,
        provenance: { source_type: "marc", source_ref: `chat:${jour}`, extracteur: "chat-epingle-v1", date_source: jour },
      },
    ],
    ECRIVAIN_MARC,
    acces.cle,
    depotDrizzle(acces.db),
  );
  revalidatePath("/a-valider");
  rafraichirCompteurs();
  if (r.acceptes === 1) return { ok: true, message: "Épinglé : LIA le relira avant de le garder." };
  if (r.dejaPresents === 1) return { ok: true, message: "Déjà dans la mémoire." };
  return { ok: false, message: `${r.refuses[0]?.code ?? "refus"} — ${r.refuses[0]?.raison ?? ""}` };
}

// ── [L2, ADR 0011] L'historique du chat ─────────────────────────────────────────────────
// Les conversations du chat sont gardées en base depuis l'ADR 0002, et rien ne permettait de
// les rouvrir : l'onglet fermé, la conversation était perdue pour Marc alors qu'elle était
// là. Ces deux actions la lui rendent — à lui seul (`requireSession`), et seulement celles du
// CHAT (`memoryai`) : une session Claude Code consignée n'est pas une conversation qu'on
// reprend ici.


// ⚠️ PAS exportées : un fichier « use server » n'exporte que des fonctions async — Next refuse
// le build sinon (payé chez JobAI), et chaque export y est une route POST.
const LIMITE_HISTORIQUE = 30;
/** Au-delà, une conversation rouverte est tronquée à ses derniers messages — et le dit. */
const MAX_MESSAGES_ROUVERTS = 200;

export interface ApercuHistorique {
  id: string;
  quand: string;
  titre: string | null;
  nbMessages: number;
}

export async function historiqueChatAction(): Promise<{ ok: boolean; conversations: ApercuHistorique[]; message?: string }> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) return { ok: false, conversations: [], message: acces.manque === "base" ? "base absente" : "clé absente" };
  const l = await depotConversationsDrizzle(acces.db).apercus("memoryai", LIMITE_HISTORIQUE, acces.cle);
  return {
    ok: true,
    conversations: l.map((c) => ({ id: c.id, quand: c.finLe.toISOString(), titre: c.titre, nbMessages: c.nbMessages })),
  };
}

export async function ouvrirConversationAction(
  id: string,
): Promise<{ ok: boolean; messages: { role: "user" | "assistant"; content: string }[]; tronquee?: number; message?: string }> {
  await requireSession();
  // L'identifiant vient du client : il se vérifie, comme dans `/api/chat`.
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, messages: [], message: "identifiant invalide" };
  const acces = await accesDonnees();
  if (!acces.ok) return { ok: false, messages: [], message: acces.manque === "base" ? "base absente" : "clé absente" };
  const depot = depotConversationsDrizzle(acces.db);
  const conv = await depot.parId(id);
  // Introuvable, oubliée, ou d'une autre source : même réponse — il n'y a rien à rouvrir ici.
  if (!conv || conv.source !== "memoryai") return { ok: false, messages: [], message: "conversation introuvable" };
  // Revue #71 : un message illisible (clé tournée, ligne altérée) faisait REJETER l'action, et
  // l'écran ne disait rien. Il se dit, et la conversation reste listée.
  let tous;
  try {
    tous = await depot.messages(id, acces.cle);
  } catch (err) {
    if (err instanceof DechiffrementError) return { ok: false, messages: [], message: "Cette conversation est illisible (clé changée ou message altéré)." };
    throw err;
  }
  const garde = tous.slice(-MAX_MESSAGES_ROUVERTS);
  return {
    ok: true,
    messages: garde.map((m) => ({ role: m.role, content: m.contenu })),
    ...(tous.length > garde.length ? { tronquee: tous.length - garde.length } : {}),
  };
}
