"use server";
// app/apps/actions.ts — Marc règle ce que chaque app peut lire ou écrire.
//
// Points d'entrée POST à part entière : chacun revérifie la session. ⚠️ Et le périmètre n'est
// écrit QUE d'ici : `lib/depotFaits.ts` le LIT avant chaque écriture, aucune app ne l'écrit —
// une app qui pourrait élargir son propre périmètre n'aurait pas de périmètre.

import { revalidatePath } from "next/cache";
import { depotPerimetresDrizzle, lireReglage } from "@/lib/depotPerimetres";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

const APP_ID = /^[a-z0-9]{2,32}$/;

async function preparer(fd: FormData) {
  await requireSession();
  const appId = fd.get("appId");
  if (typeof appId !== "string" || !APP_ID.test(appId)) throw new Error("identifiant d'app invalide");
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  return { appId, depot: depotPerimetresDrizzle(acces.db) };
}

export async function reglerAction(fd: FormData): Promise<void> {
  const { appId, depot } = await preparer(fd);
  const lu = lireReglage(fd);
  // Un réglage refusé LÈVE : l'écrire à moitié laisserait Marc croire qu'il a accordé ce
  // qu'il vient de cocher.
  if (!lu.ok) throw new Error(lu.raison);
  await depot.regler(appId, lu.reglage, new Date());
  revalidatePath("/apps");
}

export async function retirerAction(fd: FormData): Promise<void> {
  const { appId, depot } = await preparer(fd);
  await depot.retirer(appId);
  revalidatePath("/apps");
}
