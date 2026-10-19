"use server";
// app/conversations/extraireAction.ts — « tire des faits de cette conversation ».
//
// ⚠️ CE BOUTON N'EST PLUS LE SEUL CHEMIN, depuis le lot 16 (16/09). L'extraction se déclenche
// désormais SEULE — à la fin d'un tour de chat et une fois par jour (`lib/apprentissage.ts`).
// Ce que ce bouton garde, c'est le geste DÉLIBÉRÉ : forcer la lecture d'une conversation
// précise, tout de suite, sans attendre le seuil ni le cron.
//
// ⚠️ Et il dépense sur le poste APPRENTISSAGE (2 $/jour), pas sur celui du chat — cette
// phrase disait « le plafond du chat (1 $/jour) la couvre » jusqu'au 16/09, et c'était devenu
// faux le jour où le budget s'est réparti en postes. Le plafond qui coupe ici est donc
// `PlafondApprentissageError`, jamais `PlafondAtteintError`.

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { extraireDUneConversation } from "@/lib/conversations/extraction";
import { MODELE_DEFAUT } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotDrizzle } from "@/lib/depotFaits";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function extraireAction(fd: FormData): Promise<void> {
  await requireSession();
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("identifiant invalide");

  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Une intégration ÉTEINTE n'est pas une panne : on le dit plutôt que de laisser un bouton
  // échouer sans raison lisible.
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY absente : l'extraction est désactivée.");

  const conversations = depotConversationsDrizzle(acces.db);
  const conv = await conversations.parId(id);
  if (!conv) return;
  const messages = await conversations.messages(id, acces.cle);
  if (messages.length === 0) return;

  const client = new Anthropic({ apiKey });
  try {
    await extraireDUneConversation({
      client: { create: (p) => client.messages.create(p as Parameters<typeof client.messages.create>[0]) as never },
      modele: MODELE_DEFAUT,
      conversationId: id,
      messages,
      cle: acces.cle,
      ecriture: depotDrizzle(acces.db),
      admin: depotAdminDrizzle(acces.db),
      maintenant: () => new Date(),
    });
    // Marquée APRÈS l'extraction : une passe qui échoue laisse la conversation extractible,
    // sinon un échec la retirerait du jeu sans que rien n'ait été proposé.
    await conversations.marquerExtraite(id, messages.length);
  } catch (err) {
    // ⚠️ Ce bloc a porté `if (err instanceof PlafondAtteintError) throw err;` jusqu'au 16/09 :
    // les deux branches re-jetaient, donc il ne changeait RIEN — mais il nommait le plafond du
    // CHAT, et depuis la répartition en postes ce n'est plus celui-là qui coupe ici. Un `catch`
    // qui affirme quelque chose de faux est pire qu'un `catch` absent : il fait chercher le
    // mauvais budget. On laisse remonter, la Server Action rend l'erreur telle quelle.
    throw err;
  }
  revalidatePath("/conversations");
  revalidatePath("/a-valider");
}
