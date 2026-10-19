"use server";
// app/regler/actions.ts — [L27] « Comment Lia te parle » : Marc écrit la VOIX de Lia (ADR 0005 A4).
//
// ⚠️ Chaque Server Action revérifie la session ET passe par le dépôt, qui valide (`nettoyerVoix` :
// 600 caractères, ni balise ni URL). L'écran ne valide rien à lui seul : un appel direct de
// l'action ne contourne donc rien.
//
// Le retour passe par l'adresse (`?voix=…`) : un formulaire serveur sans état client n'a pas
// d'autre moyen de dire « refusé, voilà pourquoi » sans lever une erreur qui montrerait une page
// d'échec. Le motif est un CODE d'une liste fermée, jamais le texte de la requête.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

/** Les issues possibles, lues par la page. Liste fermée. */
export type IssueVoix = "ok" | "efface" | "trop_long" | "balise" | "url" | "refus";

function codeDuRefus(raison: string): IssueVoix {
  if (raison.startsWith("plus de")) return "trop_long";
  if (raison === "balise") return "balise";
  if (raison === "URL") return "url";
  return "refus";
}

export async function reglerVoixAction(fd: FormData): Promise<void> {
  await requireSession();
  const brut = fd.get("voix");
  if (typeof brut !== "string") throw new Error("voix manquante");

  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");

  const r = await depotAdminDrizzle(acces.db).reglerVoixLia(brut, new Date());
  if (!r.ok) redirect(`/regler?voix=${codeDuRefus(r.raison)}`);

  revalidatePath("/regler");
  redirect(`/regler?voix=${r.effacee ? "efface" : "ok"}`);
}
