"use server";
// app/depenses/actions.ts — [L34] Marc règle ses plafonds de dépense lui-même.
//
// Décision de Marc, 18/09 : « jveux pouvoir choisir dans lapp je veux aussi un onglet dédié
// aux depenses a limport etc ».
//
// ── CE QUI RESTE VERROUILLÉ, ET POURQUOI CE N'EST PAS UNE CONTRADICTION ──────────────────
//
// L'ADR 0001 §5.5 dit « plafond dur, NON DÉSACTIVABLE » (Q15). Ce qui y est interdit est de
// l'ÉTEINDRE, pas d'en choisir la valeur — et le test qui verrouillait la somme des postes
// disait lui-même que relever un poste oblige « à rouvrir le total avec Marc, ce qui est une
// décision de dépense et pas un effet de bord ». Marc vient de prendre cette décision.
//
// Restent donc entiers, et chacun est gardé :
//   1. un plafond EXISTE toujours — l'absence de ligne vaut le DÉFAUT du 16/09, jamais
//      « illimité » (`depotAdmin.plafonds()`) ;
//   2. il est toujours CONSULTÉ — `budgetOuvert` le prend en argument REQUIS, donc `tsc`
//      énumère les cinq sites et aucun ne peut l'oublier ;
//   3. il ne peut pas dépasser `PLAFOND_MAX_USD_PAR_JOUR`, écrit dans le code ET dans la base
//      (`plafonds_borne`) : une valeur entrée par erreur ne peut pas ouvrir une facture sans
//      fond. Le relever, LUI, se fait dans le code, en connaissance de cause.
//
// ⚠️ La validation est ICI, côté serveur, et pas seulement dans le `min`/`max` du formulaire :
// une Server Action est atteignable sans la page. Le formulaire est une politesse.
//
// ⚠️ Un plafond à 0 $ est une PAUSE, pas un arrêt du contrôle : c'est le plafond au maximum de
// son effet, et c'est exactement ce qu'il faut pour freiner un import en cours sans toucher au
// code. C'est pour ça que le plancher est zéro et non un centime.

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { estPoste } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function reglerPlafondAction(fd: FormData): Promise<void> {
  await requireSession();
  const poste = fd.get("poste");
  // ⚠️ Un poste inconnu est REFUSÉ, jamais rabattu sur « chat » : un défaut ferait régler le
  // mauvais budget sans que rien ne le dise — le défaut exact que la liste fermée des postes
  // existe pour empêcher.
  if (typeof poste !== "string" || !estPoste(poste)) throw new Error("poste inconnu");

  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");

  // `plafondValide` fait le reste (bornes, valeur illisible → défaut), dans le dépôt.
  await depotAdminDrizzle(acces.db).reglerPlafond(poste, Number(fd.get("usdParJour")));

  revalidatePath("/depenses");
  rafraichirCompteurs();
}
