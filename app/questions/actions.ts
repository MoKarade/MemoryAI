"use server";
// app/questions/actions.ts — les deux gestes de Marc sur une question : répondre, écarter.
// Points d'entrée POST à part entière : chacun revérifie la session avant toute chose.
//
// ⚠️ RÉPONDRE PASSE PAR `validerFait`, comme TOUT le reste. La réponse de Marc n'est pas
// écrite directement en base : elle est proposée par `ecrireLot` (qui applique le vocabulaire,
// les longueurs, le canari, les oublis, le MAX des niveaux), PUIS validée — parce que le
// contrat d'écriture force `statut: "propose"`, et que personne, pas même cette page, n'écrit
// un fait validé d'un seul geste. C'est deux appels au lieu d'un, et c'est le prix d'avoir
// UNE seule porte d'écriture (ADR 0001 §3).

import { revalidatePath } from "next/cache";
import { rafraichirCompteurs } from "../rafraichirCompteurs";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotDrizzle } from "@/lib/depotFaits";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { ecrireLot } from "@/lib/ecrireFaits";
import type { Ecrivain } from "@/lib/jetons";
import { accesDonnees } from "@/lib/pageDonnees";
import { lireOptions, optionChoisie } from "@/lib/questions";
import { requireSession } from "@/lib/session";
import { depotPileDrizzle } from "@/lib/pile/depot";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { EXTRACTEUR_MIGRATION } from "@/lib/pieces/migration";
import { GENRES_CARTE, VERDICTS, type GenreCarte, type Verdict } from "@/lib/pile/composer";

/**
 * C'est MARC qui répond : fiabilité `marc`, la plus haute. Il n'a personne à valider derrière
 * lui — d'où la validation immédiate qui suit l'écriture.
 *
 * ⚠️ NON EXPORTÉ, et ce n'est pas un choix de portée : dans un fichier `"use server"`, Next
 * n'autorise QUE des fonctions async à l'export. Exporter cet objet fait échouer le build à
 * la collecte des pages (« A "use server" file can only export async functions »), pas à la
 * compilation — donc après le typecheck et les tests. Le pendant de la leçon JobAI : là-bas
 * un export de trop OUVRE une route, ici il casse le build. Dans les deux cas, un `export`
 * dans un fichier `"use server"` est une décision, jamais une commodité.
 */
const MARC: Ecrivain = { appId: "marc", role: "ecriture", fiabilites: ["marc"] };

function idDe(fd: FormData): string {
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("identifiant invalide");
  return id;
}

async function preparer(fd: FormData) {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) throw new Error(acces.manque === "base" ? "base absente" : "clé absente");
  return { id: idDe(fd), acces };
}

function rafraichir() {
  revalidatePath("/questions");
  revalidatePath("/pieces");
  rafraichirCompteurs();
  revalidatePath("/a-valider");
}

/**
 * La réponse de Marc devient un fait. Le type de valeur se déduit de la FORME : une date ISO
 * est une date, le reste est du texte. Un `ref_document` ne se saisit pas à la main — ce
 * serait demander à Marc de recopier un identifiant Drive.
 */
export async function repondreAction(fd: FormData): Promise<void> {
  const { id, acces } = await preparer(fd);
  const brut = fd.get("reponse");
  const reponse = typeof brut === "string" ? brut.trim() : "";
  if (reponse.length === 0) return;

  const questions = depotQuestionsDrizzle(acces.db);
  const q = await questions.parId(id);
  if (!q || q.statut !== "ouverte") return;

  const jour = new Date().toISOString().slice(0, 10);
  const estDate = /^\d{4}-\d{2}-\d{2}$/.test(reponse);
  const r = await ecrireLot(
    [
      {
        sujet: "marc",
        predicat: q.predicatVise,
        valeur: reponse,
        valeur_type: estDate ? "date" : "texte",
        provenance: {
          source_type: "marc",
          // La question EST la source : son identifiant rend la réponse traçable, et rejouer
          // la même question ne recrée pas un doublon (idempotence par empreinte).
          source_ref: `question:${id}`,
          extracteur: "page-questions-v1",
          date_source: jour,
        },
      },
    ],
    MARC,
    acces.cle,
    depotDrizzle(acces.db),
  );

  const faitId = r.idsCrees[0];
  if (faitId === undefined) {
    // Refusé, ou déjà présent : la question reste OUVERTE. La fermer laisserait croire que la
    // réponse est entrée alors que rien n'a été écrit.
    rafraichir();
    return;
  }
  const maintenant = new Date();
  await depotAdminDrizzle(acces.db).valider(faitId, maintenant);
  await questions.cloreAvecFait(id, faitId, maintenant);
  await noterCarteACote(acces, id, maintenant);
  rafraichir();
}

/**
 * Trancher un QCM : Marc clique la valeur qu'il garde, et c'est FINI.
 *
 * ⚠️ Ce chemin ne crée AUCUN fait, contrairement à `repondreAction`. Les deux valeurs
 * existent déjà en base ; ce qui manquait était le choix. Créer un troisième fait « la
 * réponse de Marc » ferait trois lignes pour une seule vérité, et la question « laquelle des
 * trois ? » se reposerait au tour suivant.
 *
 * ⚠️ `admin.valider` fait le reste, et il le fait DÉJÀ : valider le fait choisi périme les
 * autres faits validés du même prédicat (non `multi`). C'est exactement l'effet voulu, et
 * c'est pour ça qu'aucune écriture directe n'est faite ici — réécrire la règle de péremption
 * une seconde fois, c'est une règle et demie.
 *
 * ⚠️ LA GARDE EST `optionChoisie`. Le `faitId` arrive du formulaire, donc du client : sans
 * vérifier qu'il appartient aux options de CETTE question, un identifiant forgé ferait
 * valider n'importe quel fait de la base — donc en périmer un autre. La question porte la
 * liste de ce qu'on a le droit de choisir ; rien d'autre ne l'autorise.
 */
export async function choisirOptionAction(fd: FormData): Promise<void> {
  const { id, acces } = await preparer(fd);
  const faitId = fd.get("faitId");
  if (typeof faitId !== "string" || !/^[0-9a-f-]{36}$/.test(faitId)) throw new Error("identifiant invalide");

  const questions = depotQuestionsDrizzle(acces.db);
  const q = await questions.parId(id);
  // Une question déjà close ne se re-tranche pas : sinon un double clic — ou un retour
  // arrière du navigateur — re-périmerait un fait que Marc vient de choisir.
  if (!q || q.statut !== "ouverte") {
    rafraichir();
    return;
  }
  const choisie = optionChoisie(lireOptions(q.options), faitId);
  if (!choisie) {
    rafraichir();
    return;
  }

  const maintenant = new Date();
  const admin = depotAdminDrizzle(acces.db);
  await admin.valider(faitId, maintenant);
  // ⚠️ Les rejets APRÈS la validation, jamais avant : si la coupure tombe entre les deux, on
  // reste avec un fait validé de trop (visible, et la question se repose), pas avec un
  // prédicat vidé de tout ce qui le portait. Et `valider` ne suffit pas sur un prédicat
  // MULTIPLE — il ne périme rien, c'est tout son intérêt : sans ces rejets, choisir « garder
  // celui-ci » sur un doublon laisserait l'autre en place et la question reviendrait.
  for (const aRejeter of choisie.aRejeter ?? []) await admin.rejeter(aRejeter);
  await questions.cloreAvecFait(id, faitId, maintenant);
  await noterCarteACote(acces, id, maintenant);
  rafraichir();
}

export async function ecarterAction(fd: FormData): Promise<void> {
  const { id, acces } = await preparer(fd);
  const maintenant = new Date();
  await depotQuestionsDrizzle(acces.db).ecarter(id, maintenant);
  await noterCarteACote(acces, id, maintenant);
  rafraichir();
}

/**
 * [L3] Une question TRAITÉE (répondue, tranchée, écartée) se consigne dans la pile comme un
 * avis `vrai` — au sens de « traitée », pas « exacte ». C'est ce qui fait avancer l'intercalage
 * (ADR 0012 §2.2) : il se compte sur les cartes JUGÉES, et une question se clôt par ses propres
 * formulaires, pas par `jugerCarteAction`.
 */
async function noterCarteACote(acces: Awaited<ReturnType<typeof preparer>>["acces"], id: string, maintenant: Date) {
  await depotPileDrizzle(acces.db).consigner({ genre: "question", refId: id, verdict: "vrai" }, acces.cle, maintenant);
}

/**
 * [L3] Juger la carte du dessus de la pile (ADR 0012) : Vrai, Faux ou Passer.
 *
 * ⚠️ Le genre et le verdict arrivent du FORMULAIRE, donc du client : ils se vérifient contre
 * les listes fermées, et l'identifiant contre sa forme. Un papier jugé ne change PAS : l'avis
 * s'ajoute à côté. Un FAIT jugé passe par les mutateurs de `/a-valider` — `valider` et
 * `rejeter`, inchangés — pour qu'il n'existe qu'une seule façon de valider un fait.
 */
export async function jugerCarteAction(fd: FormData): Promise<void> {
  const { id, acces } = await preparer(fd);
  const genre = fd.get("genre");
  const verdict = fd.get("verdict");
  if (typeof genre !== "string" || !(GENRES_CARTE as readonly string[]).includes(genre)) throw new Error("genre invalide");
  if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) throw new Error("verdict invalide");
  const g = genre as GenreCarte;
  const v = verdict as Verdict;
  const maintenant = new Date();
  const pile = depotPileDrizzle(acces.db);

  // ⚠️ Revue #73 : l'identifiant vient du formulaire. On ne consigne un avis que sur une carte
  // qui EXISTE et qui a sa place dans la pile — sinon un « vrai » sur un papier de l'inventaire
  // (jamais ouvert) le ferait servir au chat comme « confirmé ».
  if (g === "fait") {
    const admin = depotAdminDrizzle(acces.db);
    const f = await admin.parId(id);
    // Seul un fait PROPOSÉ se juge ici : un identifiant forgé ne doit pas périmer un fait validé.
    if (!f || f.fait.statut !== "propose" || f.fait.supprimeLe) return rafraichir();
    if (v === "vrai") await admin.valider(id, maintenant);
    else if (v === "faux") await admin.rejeter(id);
    // Consigné aussi quand il est validé ou rejeté : c'est ce qui fait avancer l'intercalage.
    await pile.consigner({ genre: "fait", refId: id, verdict: v }, acces.cle, maintenant);
  } else if (g === "question") {
    // Une question se tranche par ses propres formulaires (réponse, choix, écarter) : « vrai »
    // et « faux » n'ont pas de sens pour elle. Seul « passer » passe ici.
    if (v !== "passe") throw new Error("une question ne se juge pas vrai ou faux");
    const q = await depotQuestionsDrizzle(acces.db).parId(id);
    if (!q || q.statut !== "ouverte") return rafraichir();
    await pile.consigner({ genre: "question", refId: id, verdict: "passe" }, acces.cle, maintenant);
  } else {
    const brute = await depotPiecesLectureDrizzle(acces.db).parId(id);
    if (!brute || brute.piece.extracteur === EXTRACTEUR_MIGRATION) return rafraichir();
    const remarque = fd.get("remarque");
    await pile.consigner({ genre: "piece", refId: id, verdict: v, remarque: typeof remarque === "string" ? remarque : null }, acces.cle, maintenant);
  }
  rafraichir();
  if (g === "piece") revalidatePath(`/pieces/${id}`);
  if (g === "fait") revalidatePath(`/fait/${id}`);
}

