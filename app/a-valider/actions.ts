"use server";
// app/a-valider/actions.ts — les trois gestes de Marc sur un fait. Points d'entrée POST à
// part entière : chacun revérifie la session, puis fait UNE chose, puis rafraîchit les pages.

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { accesDonnees } from "@/lib/pageDonnees";
import { depotPiecesDrizzle } from "@/lib/pieces/depot";
import { depotMigrationDrizzle } from "@/lib/pieces/depotMigration";
import { annulerMigrationInventaire, migrerLotInventaire } from "@/lib/pieces/migrerInventaire";
import { requireSession } from "@/lib/session";

function idDe(fd: FormData): string {
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("identifiant invalide");
  return id;
}

async function preparer(fd: FormData) {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  return { id: idDe(fd), admin: depotAdminDrizzle(acces.db), cle: acces.cle };
}

function rafraichir(id: string) {
  revalidatePath("/a-valider");
  rafraichirCompteurs();
  revalidatePath(`/fait/${id}`);
}

export async function validerAction(fd: FormData): Promise<void> {
  const { id, admin } = await preparer(fd);
  await admin.valider(id, new Date());
  rafraichir(id);
}

/**
 * Remettre en service un fait PÉRIMÉ. C'est le même mutateur que « Valider » — `valider`
 * accepte n'importe quel fait vivant, quel que soit son statut de départ, et périme au
 * passage celui qui l'avait remplacé (prédicat non `multi`). D'où une action DISTINCTE malgré
 * le corps identique : ce que Marc fait ici n'est pas « accepter une proposition », c'est
 * « revenir en arrière », et un bouton doit dire ce qu'il fait. Les fusionner en une seule
 * action rendrait le libellé de la page dépendant du contexte, c'est-à-dire de rien.
 */
export async function restaurerAction(fd: FormData): Promise<void> {
  const { id, admin } = await preparer(fd);
  await admin.valider(id, new Date());
  rafraichir(id);
}

export async function rejeterAction(fd: FormData): Promise<void> {
  const { id, admin } = await preparer(fd);
  await admin.rejeter(id);
  rafraichir(id);
}

export async function oublierAction(fd: FormData): Promise<void> {
  const { id, admin, cle } = await preparer(fd);
  await admin.oublier(id, cle, "oublié par Marc depuis l'interface", new Date());
  rafraichir(id);
}

/**
 * LE SECOND CHEMIN DE SORTIE DE QUARANTAINE (ADR 0004 §2.3) : Marc, d'un clic.
 *
 * ⚠️ Sans cette action, `sortiePar: "marc"` et le statut `refuse` seraient deux valeurs que
 * le code SAIT lire et que personne ne produit — la classe de défaut que l'écosystème nomme
 * `UN-CHAMP-TYPE-SANS-PRODUCTEUR`. Le chemin « trois extracteurs » ne peut pas les remplacer :
 * il n'y a que deux écrivains aujourd'hui, donc en pratique ce bouton EST la sortie.
 *
 * Point d'entrée POST à part entière : il revérifie la session, comme ses trois voisins.
 */
export async function trancherPredicatAction(fd: FormData): Promise<void> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  const predicat = fd.get("predicat");
  const verdict = fd.get("verdict");
  // La FORME du prédicat est re-vérifiée ici : cette action est atteignable sans passer par
  // la page qui affiche le bouton, donc son entrée ne vient pas forcément de notre liste.
  if (typeof predicat !== "string" || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/.test(predicat)) {
    throw new Error("prédicat invalide");
  }
  if (verdict !== "accepte" && verdict !== "refuse") throw new Error("verdict invalide");
  await depotAdminDrizzle(acces.db).trancherPredicat(predicat, verdict, new Date());
  revalidatePath("/a-valider");
  rafraichirCompteurs();
}

/**
 * LE PRODUCTEUR DE LA MIGRATION (ADR 0004 §6.2, décision n° 7).
 *
 * ⚠️ Sans ces deux actions, `migrerLotInventaire` et `annulerMigrationInventaire` seraient du
 * code que rien n'appelle — la classe de défaut que l'écosystème nomme
 * `UN-CHAMP-TYPE-SANS-PRODUCTEUR`, et qui est ici plus discrète que d'habitude : la migration
 * est testée, prouvée par mutation, réversible… et elle ne tournerait jamais.
 *
 * ⚠️ UN LOT PAR CLIC, pas « tout d'un coup ». Les ~2 700 faits `document.existe` en base (et
 * les ~19 900 à venir) déchiffrent et ré-écrivent une ligne chacun : une action qui prendrait
 * tout serait coupée par le mur de la fonction serverless, et l'on ne saurait pas OÙ elle
 * s'est arrêtée. Le lot rend `reste`, donc Marc voit la file descendre et décide de continuer.
 */
export async function migrerLotAction(): Promise<void> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  await migrerLotInventaire(
    depotMigrationDrizzle(acces.db),
    depotPiecesDrizzle(acces.db),
    acces.cle,
    new Date(),
  );
  revalidatePath("/a-valider");
  rafraichirCompteurs();
}

/**
 * LE RETOUR EN ARRIÈRE, exigé par l'ADR avant de toucher la prod : « elle se livre avec son
 * retour en arrière ». Il ne supprime QUE les pièces nées de la migration (`origine_fait_id`
 * non nul) et rend les faits à leur état d'avant — rien n'est perdu dans aucun des deux sens.
 */
export async function annulerMigrationAction(): Promise<void> {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  await annulerMigrationInventaire(depotMigrationDrizzle(acces.db));
  revalidatePath("/a-valider");
  rafraichirCompteurs();
}
