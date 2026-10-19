"use server";
// app/pieces/actions.ts — le RETRAIT d'une pièce. Point d'entrée POST à part entière : il
// revérifie la session, fait UNE chose, puis rafraîchit.
//
// ⚠️ Ce geste est DÉFINITIF par conception : l'empreinte d'oubli survit à la suppression, donc
// la pièce ne revient ni par le rejeu, ni par le rattrapage, ni par le flux vivant (ADR 0001).
// C'est ce qu'on veut — un retrait qui se ferait ré-écrire au tick suivant n'en serait pas un.

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { accesDonnees } from "@/lib/pageDonnees";
import { depotOubliPiecesDrizzle } from "@/lib/pieces/depotOubli";
import { requireSession } from "@/lib/session";

export async function oublierPieceAction(fd: FormData): Promise<void> {
  await requireSession();
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("identifiant invalide");
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");

  const res = await depotOubliPiecesDrizzle(acces.db).oublier(
    id,
    acces.cle,
    "retiré par Marc depuis l'écran des pièces",
    new Date(),
  );
  // ⚠️ Un « introuvable » ne se tait pas : sans ça, l'écran se rafraîchit comme si le retrait
  // avait eu lieu, et Marc croit avoir retiré un papier qui est toujours là.
  if (res === "introuvable") throw new Error("pièce introuvable (déjà retirée ?)");
  revalidatePath("/pieces");
  rafraichirCompteurs();
}
