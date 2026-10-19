"use server";
// app/conversations/actions.ts — le seul geste de Marc sur une conversation : l'oublier.
//
// Suppression LOGIQUE, comme un fait oublié. Une conversation oubliée ne se remplit plus
// (`consigner` refuse), ne s'affiche plus, et ne compte plus dans la mesure.

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function oublierConversationAction(fd: FormData): Promise<void> {
  await requireSession();
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("identifiant invalide");
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  await depotConversationsDrizzle(acces.db).oublier(id, new Date());
  revalidatePath("/conversations");
  rafraichirCompteurs();
}
