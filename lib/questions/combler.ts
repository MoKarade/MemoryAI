// lib/questions/combler.ts — poser les questions qui COMBLENT les trous, sans appel de modèle (L28).
//
// 31 prédicats du vocabulaire ne portaient aucun fait validé et rien ne demandait à Marc de les
// remplir : le producteur par modèle (`producteur.ts`) choisit, coûte un appel, et peut très bien
// ne jamais viser la santé ou la famille. Celui-ci est le jumeau GRATUIT : même dessin que les
// contradictions, il compose le texte à partir du seul vocabulaire et du nombre de faits validés
// par prédicat. Aucune valeur de Marc n'entre ici, donc rien à baliser, rien à chiffrer.
//
// ⚠️ GRATUIT NE VEUT PAS DIRE SANS LIMITE. Le plafond de cinq ouvertes est PARTAGÉ avec les
// contradictions et le producteur par modèle : on ne pose que dans les places LIBRES. Poser
// au-dessus ferait écarter par `depotQuestions.poser` la plus ancienne, c'est-à-dire une
// question que Marc n'a peut-être pas encore lue.
//
// ⚠️ LE PLAFOND SE RENOUVELLE PAR SA FORME, pas par un minuteur : chaque réveil recompte les
// places libres, donc une question répondue ou écartée est remplacée au passage suivant.
//
// ⚠️ UNE QUESTION ÉCARTÉE NE REVIENT PAS. L'index unique `(predicat_vise, question)` la retient
// même écartée ; le texte étant déterministe, la même question ne se reposera jamais — et le
// prédicat suivant prend sa place. C'est voulu (« meurt si Marc écarte plus qu'il ne répond »).
//
// Ce qui n'est PAS posé, et pourquoi :
//  - niveau 3 (identité, immigration, fiscal) : on ne demande pas à voix haute ce que la mémoire
//    ne sert qu'à deux verrous (ADR 0007) ;
//  - les prédicats dont la valeur est un document (`ref_document`) : on ne répond pas à une
//    question par un identifiant Drive ;
//  - les prédicats dont la valeur est un identifiant de sujet (`relation.proche`, `famille.enfant`)
//    ou une adresse : une réponse en texte libre y produirait un fait inexploitable, ou une donnée
//    que la mémoire refuse de toute façon.
//
// Pas de choix multiples (QCM) ici : une option d'un QCM pointe vers un fait qui EXISTE déjà
// (`OptionQuestion.faitId`), alors que combler un trou veut créer le fait. Les réponses sont donc
// en texte libre, via la même page `/questions` et la même porte d'écriture que toutes les autres.

import type { DepotQuestions } from "../depotQuestions";
import { MAX_OUVERTES, validerQuestion, type QuestionValide } from "../questions";
import { estRefuseStructurellement, vocabulaire, type DefinitionPredicat } from "../vocabulaire";

/** Prédicats qu'on ne demande jamais en texte libre. Voir l'en-tête pour chaque famille. */
export const PREDICATS_JAMAIS_DEMANDES: ReadonlySet<string> = new Set([
  "relation.proche",
  "relation.lien",
  "famille.enfant",
  "logement.adresse",
]);

/** Santé, famille, goûts d'abord (décision de Marc) ; le reste suit dans l'ordre du vocabulaire. */
const DOMAINES_PRIORITAIRES: readonly (readonly string[])[] = [["sante"], ["famille", "relation"], ["gout"]];

/** Le texte naturel des prédicats qui comptent le plus ; les autres passent par `texteGenerique`. */
const QUESTIONS_REDIGEES: Readonly<Record<string, string>> = {
  "sante.allergie": "As-tu des allergies ? Si oui, lesquelles ?",
  "sante.praticien": "Quels praticiens de santé consultes-tu (médecin, dentiste, optométriste…) ?",
  "sante.couverture": "Quel régime d'assurance santé as-tu (RAMQ, assurance collective…) ?",
  "sante.rendez_vous": "As-tu un rendez-vous de santé à venir ? Lequel ?",
  "sante.condition": "Y a-t-il une condition de santé dont la mémoire devrait tenir compte ?",
  "sante.pharmacie": "Quelle est ta pharmacie habituelle ?",
  "relation.statut": "Quelle est ta situation conjugale ?",
  "famille.evenement": "Quel événement familial à venir faut-il retenir ?",
  "famille.anniversaire": "Quel anniversaire faut-il retenir (de qui, quelle date) ?",
  "gout.cuisine": "Quelle cuisine ou quel plat aimes-tu le plus ?",
  "gout.activite": "Quelle activité aimes-tu faire ?",
  "gout.musique": "Quel genre de musique ou quel artiste écoutes-tu ?",
  "gout.marque": "Quelles marques préfères-tu ?",
  "gout.lecture": "Que lis-tu volontiers (auteur, genre, titre) ?",
  "gout.film_serie": "Quel film, quelle série ou quel genre aimes-tu ?",
  "gout.boisson": "Quelle boisson préfères-tu ?",
  "gout.evite": "Y a-t-il quelque chose que tu évites (aliment, activité, sujet) ?",
  "gout.style": "Quel est ton style (vêtements, déco…) ?",
  "loisir.sport": "Quel sport pratiques-tu ?",
  "loisir.activite": "Quel loisir pratiques-tu régulièrement ?",
  "loisir.equipement": "Quel équipement de loisir possèdes-tu ?",
  "loisir.club": "Fais-tu partie d'un club ou d'une ligue, ou as-tu un abonnement sportif ?",
  "animal.espece": "As-tu un animal de compagnie ? Lequel ?",
  "projet.en_cours": "Quel projet est en cours en ce moment ?",
  "projet.souhait": "Quelle envie ou quel souhait aimerais-tu réaliser ?",
  "preference.langue": "Dans quelle langue préfères-tu qu'on te réponde ?",
  "preference.fuseau": "Quel est ton fuseau horaire ?",
  "preference.horaire": "Quelle habitude d'horaire faut-il connaître (lève-tôt, soirées…) ?",
  "preference.communication": "Comment préfères-tu qu'on s'adresse à toi ?",
  "preference.outil": "Quel outil ou quelle app préfères-tu ?",
};

/**
 * Le texte d'un prédicat sans rédaction à lui. ⚠️ Un prédicat qui n'accepte QUE des dates le dit :
 * `repondreAction` déduit la date de la forme `AAAA-MM-JJ`, et une réponse « en mars » serait
 * refusée par l'écriture — la question resterait ouverte sans que Marc comprenne pourquoi.
 */
export function texteGenerique(p: DefinitionPredicat): string {
  const seulementDate = p.types.length > 0 && p.types.every((t) => t === "date");
  return seulementDate
    ? `${p.description} : quelle date (AAAA-MM-JJ) ?`
    : `À propos de « ${p.description} », que peux-tu m'en dire ?`;
}

/** Vrai quand une question en texte libre peut produire un fait de ce prédicat. */
export function estDemandable(p: DefinitionPredicat): boolean {
  if (p.deprecie) return false;
  if (p.niveauMin >= 3) return false;
  if (PREDICATS_JAMAIS_DEMANDES.has(p.predicat)) return false;
  if (estRefuseStructurellement(p.predicat)) return false;
  // Une valeur qui ne se saisit pas à la main (identifiant de document) ne se demande pas.
  return p.types.some((t) => t !== "ref_document");
}

/** Le rang de priorité d'un domaine : 0 = santé, 1 = famille, 2 = goûts, 3 = le reste. */
function rang(domaine: string): number {
  const i = DOMAINES_PRIORITAIRES.findIndex((groupe) => groupe.includes(domaine));
  return i === -1 ? DOMAINES_PRIORITAIRES.length : i;
}

/**
 * Les prédicats à ZÉRO fait validé qu'on peut demander, dans l'ordre où on les demande.
 * PURE : le tri est stable, donc à rang égal l'ordre du vocabulaire décide — deux réveils de
 * suite posent les mêmes questions dans le même ordre.
 */
export function trousAComblerEnOrdre(
  comptes: Readonly<Record<string, number>>,
  def: readonly DefinitionPredicat[] = vocabulaire(),
): DefinitionPredicat[] {
  return def
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => estDemandable(p) && (comptes[p.predicat] ?? 0) === 0)
    .sort((a, b) => rang(a.p.domaine) - rang(b.p.domaine) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * La question d'un trou, passée par `validerQuestion` : la règle des questions (point
 * d'interrogation, longueur, prédicat du vocabulaire) n'a qu'UNE définition, et ce texte-ci n'a
 * pas à y échapper sous prétexte qu'il est écrit par nous. `null` si elle est refusée.
 */
export function questionDuTrou(p: DefinitionPredicat): QuestionValide | null {
  const v = validerQuestion(
    {
      question: QUESTIONS_REDIGEES[p.predicat] ?? texteGenerique(p),
      predicat_vise: p.predicat,
      motif: `aucun fait enregistré sur « ${p.description} »`,
    },
    "regle",
  );
  return v.ok ? v : null;
}

/**
 * PURE — jusqu'à `places` questions, pour les trous qui ne sont pas déjà demandés.
 * `dejaOuverts` : les prédicats visés par une question OUVERTE, quelle que soit son origine.
 */
export function questionsPourLesTrous(params: {
  comptes: Readonly<Record<string, number>>;
  dejaOuverts: ReadonlySet<string>;
  places: number;
}): QuestionValide[] {
  if (params.places <= 0) return [];
  const sortie: QuestionValide[] = [];
  for (const p of trousAComblerEnOrdre(params.comptes)) {
    if (params.dejaOuverts.has(p.predicat)) continue;
    const q = questionDuTrou(p);
    if (q) sortie.push(q);
    if (sortie.length >= params.places) break;
  }
  return sortie;
}

export interface ResultatComblement {
  /** Combien de prédicats demandables n'ont aucun fait validé, posés ou non. */
  trous: number;
  /** Places libres dans la file au moment de poser. */
  places: number;
  /** Ce qui a franchi le dépôt (une question déjà posée, même écartée, ne compte pas). */
  posees: number;
}

export async function comblerLesTrous(params: {
  comptes: Readonly<Record<string, number>>;
  questions: DepotQuestions;
  maintenant: () => Date;
}): Promise<ResultatComblement> {
  const trous = trousAComblerEnOrdre(params.comptes).length;
  const ouvertes = await params.questions.ouvertes(MAX_OUVERTES + 1);
  const places = Math.max(0, MAX_OUVERTES - ouvertes.length);
  const res: ResultatComblement = { trous, places, posees: 0 };
  if (places === 0 || trous === 0) return res;

  const dejaOuverts = new Set(ouvertes.map((q) => q.predicatVise));
  // Autant de candidats que de trous, pas que de places : une question déjà posée puis écartée
  // est refusée par l'index unique et ne doit pas consommer une place — la suivante la remplace.
  const candidates = questionsPourLesTrous({ comptes: params.comptes, dejaOuverts, places: trous });
  for (const q of candidates) {
    if (res.posees >= places) break;
    const r = await params.questions.poser(q, params.maintenant());
    if (r.etat === "posee") res.posees++;
  }
  return res;
}
