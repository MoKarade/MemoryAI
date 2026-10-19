"use server";
// app/graphe/actions.ts — recalculer les liens. Un GESTE de Marc, jamais un automatisme.
//
// ⚠️ POURQUOI UN BOUTON ET PAS UN CALCUL AU CHARGEMENT. Le recalcul lit tous les faits, les
// déchiffre et réécrit une table : le faire à chaque affichage ferait payer une écriture à
// une page qu'on ouvre pour REGARDER. C'est la même règle que l'extraction du lot 9 — ce qui
// coûte, ou ce qui écrit, se déclenche à la main.
//
// Point d'entrée POST à part entière : il revérifie la session, comme tous les autres.

import { revalidatePath } from "next/cache";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function recalculerAction(): Promise<void> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  await depotLiensDrizzle(acces.db).recalculer(acces.cle, new Date());
  revalidatePath("/graphe");
}
