"use server";
// app/idees/actions.ts — les gestes de Marc sur les idées de LIA : retenir, écarter (ADR 0027 §4).
//
// ⚠️ Chaque Server Action revérifie la session AVANT de lire le formulaire, et ne change que l'état
// de l'idée, par `appliquerGeste` (écriture gardée par les états de départ). LIA n'appelle jamais
// ceci : c'est le geste de Marc, depuis la boîte à idées. « En faire une tâche » n'est pas une
// action : c'est un lien vers la page « nouvelle issue » de GitHub, sans jeton (`lib/idees/issue.ts`).

import { revalidatePath } from "next/cache";
import { appliquerGeste, type GesteIdee } from "@/lib/idees/geste";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

/** Les identifiants d'idée sont des UUID (36 caractères) : au-delà de 64, ce n'en est pas un. */
const ID_MAX = 64;

async function appliquer(fd: FormData, geste: GesteIdee): Promise<void> {
  const id = fd.get("id");
  if (typeof id !== "string" || id.length === 0 || id.length > ID_MAX) throw new Error("idée manquante");

  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");

  // Une idée déjà changée ailleurs (`false`) n'est pas une erreur : l'écran se recharge à son état réel.
  await appliquerGeste(acces.db, id, geste, new Date());
  revalidatePath("/");
}

/** Proposée → retenue. */
export async function retenirIdeeAction(fd: FormData): Promise<void> {
  await requireSession();
  await appliquer(fd, "retenir");
}

/** Proposée ou retenue → écartée : LIA ne la reproposera pas. */
export async function ecarterIdeeAction(fd: FormData): Promise<void> {
  await requireSession();
  await appliquer(fd, "ecarter");
}
