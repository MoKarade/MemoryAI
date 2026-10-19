"use server";
// app/moi/actions.ts — la purge totale (ADR 0001 §3, kill-switches). Le mot exact est exigé
// ICI, côté serveur, pas seulement dans le formulaire : une Server Action est atteignable
// sans la page.

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function purgerAction(fd: FormData): Promise<void> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  const confirmation = fd.get("confirmation");
  const r = await depotAdminDrizzle(acces.db).purger(typeof confirmation === "string" ? confirmation : "");
  if (r === "refuse") throw new Error("purge refusée : le mot de confirmation ne correspond pas");
  rafraichirCompteurs();
  revalidatePath("/a-valider");
}
