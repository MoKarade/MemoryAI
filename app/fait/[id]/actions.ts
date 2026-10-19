"use server";
// app/fait/[id]/actions.ts — [L33b] CORRIGER un fait. Le geste que Marc a choisi en premier.
//
// ⚠️ Cette action est MINCE par conception : session, appel, redirection. Tout ce qui se
// teste vit dans `lib/corrigerFait.ts` — une Server Action est intestable sans monter Next,
// donc y laisser la logique aurait rendu le geste money-critical de ce lot invérifiable.
//
// ── POURQUOI IL N'Y A PAS D'ADR ICI, ALORS QUE J'EN ANNONÇAIS UN ─────────────────────────
//
// J'avais routé ce geste vers un ADR au motif qu'il touche le CONTRAT D'ÉCRITURE (CLAUDE.md
// §11). Mesuré avant d'écrire : il n'y touche pas. Tout existait déjà, de bout en bout —
// `ecrireLot(…, MARC, …)` est le chemin par lequel Marc écrit depuis le lot des questions, et
// `admin.valider` PÉRIME tout seul les autres faits validés du même prédicat non `multi`
// (c'est écrit et commenté dans son corps). Corriger, c'est écrire la bonne valeur et la
// valider. Aucune frontière déplacée ; l'ADR aurait délibéré sur une décision déjà prise par
// le schéma, et le vrai risque était l'inverse : inventer un chemin d'écriture parallèle à
// côté de celui qui marche.
//
// ⚠️ CE QUI RESTE HORS DE CE LOT, et qui lui aurait bien demandé un ADR : `remplaceId`.
// Mesuré — il est LU (la règle de graphe `remplacement`, la ligne « remplace … » de la fiche)
// et ÉCRIT PAR PERSONNE en production : zéro producteur, seulement des fixtures de test. La
// règle de liaison ne peut donc pas tirer. Lui donner un producteur exige de l'ajouter au
// contrat d'écriture (`validerFait.ts`), ce qui EST une frontière. Ticket `[L33d]`.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../../rafraichirCompteurs";
import { corrigerFait } from "@/lib/corrigerFait";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotDrizzle } from "@/lib/depotFaits";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export async function corrigerAction(fd: FormData): Promise<void> {
  await requireSession();
  const ancienId = fd.get("id");
  if (typeof ancienId !== "string" || !/^[0-9a-f-]{36}$/.test(ancienId)) throw new Error("identifiant invalide");
  const brut = fd.get("valeur");

  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");

  const r = await corrigerFait(ancienId, typeof brut === "string" ? brut : "", {
    admin: depotAdminDrizzle(acces.db),
    faits: depotDrizzle(acces.db),
    cle: acces.cle,
  });

  // ⚠️ La CAUSE part dans l'URL pour que la page la DISE. Un refus silencieux ferait repartir
  // Marc en croyant sa mémoire à jour, ce qui est pire que l'échec lui-même.
  if (!r.ok) redirect(`/fait/${ancienId}?correction=${encodeURIComponent(r.code)}`);

  revalidatePath(`/fait/${ancienId}`);
  revalidatePath(`/fait/${r.nouveauId}`);
  revalidatePath("/a-valider");
  rafraichirCompteurs();
  redirect(`/fait/${r.nouveauId}?correction=ok`);
}
