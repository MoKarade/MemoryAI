"use server";
// app/regler/sauvetage/actions.ts — les deux gestes de Marc sur le sauvetage (ADR 0019 §6).
//
//   • une PASSE (étape 4) : bornée dans le temps, relancée par l'écran jusqu'au bout du
//     balayage. Elle écrit en base : archive d'abord, puis `v2`, ligne par ligne ;
//   • la CLÔTURE (étape 6) : ce qui reste en `v1` est déclaré perdu (gardé dans l'archive et en
//     base), et les écritures des apps rouvrent. Exige le mot exact, vérifié ICI.
//
// Chaque action revérifie la session. Rien de ce qui passe n'est journalisé : ni page, ni clair.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { depotSauvetageDrizzle } from "@/lib/sauvetage/depot";
import { configOracle, oracleAncienDeploiement } from "@/lib/sauvetage/oracle";
import { MOT_CLORE } from "@/lib/sauvetage/porte";
import { passeDeSauvetage, type Reprise, type ResultatPasse } from "@/lib/sauvetage/sauvetage";

/** Sous la durée maximale de la page (300 s) : la passe rend la main avant d'être coupée. */
const BUDGET_PASSE_MS = 240_000;

export type IssuePasse =
  | { ok: true; resultat: ResultatPasse }
  | { ok: false; raison: "acces" | "pas-ouvert" | "clos"; manque?: string[] };

export async function passeSauvetageAction(reprise: Reprise | null): Promise<IssuePasse> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) return { ok: false, raison: "acces", manque: [acces.manque === "base" ? "DATABASE_URL" : "MEMORYAI_CHIFFREMENT"] };
  const config = configOracle();
  if (!config.ok) return { ok: false, raison: "acces", manque: config.manque };

  const depot = depotSauvetageDrizzle(acces.db);
  const bilan = await depot.bilan();
  if (bilan.ouvertLe === null) return { ok: false, raison: "pas-ouvert" };
  if (bilan.closLe !== null) return { ok: false, raison: "clos" };

  const resultat = await passeDeSauvetage(depot, oracleAncienDeploiement(config.config), acces.cle, {
    budgetMs: BUDGET_PASSE_MS,
    reprise,
  });
  revalidatePath("/regler/sauvetage");
  return { ok: true, resultat };
}

export async function cloreSauvetageAction(fd: FormData): Promise<void> {
  await requireSession();
  if (fd.get("confirmation") !== MOT_CLORE) redirect("/regler/sauvetage?clore=mot");
  const acces = await accesDonnees();
  if (!acces.ok) redirect("/regler/sauvetage?clore=acces");
  const clos = await depotSauvetageDrizzle(acces.db).clore();
  revalidatePath("/regler/sauvetage");
  revalidatePath("/regler");
  redirect(`/regler/sauvetage?clore=${clos ? "ok" : "deja"}`);
}
