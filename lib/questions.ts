// lib/questions.ts — ce que la mémoire NE SAIT PAS, et qu'elle demande à Marc (ADR 0002 §5.1).
//
// Fonction PURE, comme `validerFait` : elle reçoit un objet inconnu et rend soit une question
// prête à poser, soit un refus NOMMÉ. Aucune base, aucun réseau, aucune horloge.
//
// POURQUOI UNE GARDE ICI AUSSI. Une question est du texte écrit par un MODÈLE et affiché à
// Marc — c'est la même surface d'injection qu'une valeur de fait, à un cran de moins (elle ne
// se stocke pas comme une vérité sur lui). Elle passe donc par `nettoyerTexte`, la SEULE
// définition de cette règle dans le dépôt : la recopier ferait diverger les deux au premier
// durcissement.
//
// ⚠️ LE VRAI RISQUE DU PROJET EST LE PLAFOND, PAS L'INJECTION (CLAUDE.md §9 n° 5). Une file
// de questions qui enfle sans être répondue est une liste morte, et DriveAI a déjà payé
// exactement ça sur sa file de revue. D'où `MAX_OUVERTES` : passé le plafond, la plus ANCIENNE
// est écartée — et écartée, pas supprimée, sinon on la reposerait le lendemain.

import { z } from "zod";
import { ORIGINES_QUESTION } from "./db/schema";
import { nettoyerTexte } from "./validerFait";
import { definition, estRefuseStructurellement } from "./vocabulaire";
import type { ContradictionDetectee, OptionQuestion } from "./questions/contradictions";

export type OrigineQuestion = (typeof ORIGINES_QUESTION)[number];

/** Au plus cinq questions ouvertes à la fois. Ce n'est pas un réglage de confort. */
export const MAX_OUVERTES = 5;
export const LONGUEUR_MAX_QUESTION = 200;
export const LONGUEUR_MAX_MOTIF = 200;

export const CODES_REFUS_QUESTION = [
  "corps_invalide",
  "champ_inconnu",
  "question_interdite",
  "motif_interdit",
  "predicat_inconnu",
  "predicat_interdit",
] as const;
export type CodeRefusQuestion = (typeof CODES_REFUS_QUESTION)[number];

export interface RefusQuestion {
  ok: false;
  code: CodeRefusQuestion;
  raison: string;
}

export interface QuestionValide {
  ok: true;
  question: string;
  predicatVise: string;
  motif: string;
  origine: OrigineQuestion;
  /**
   * Les options d'un QCM, quand la question en est un (décision de Marc, 17/09).
   *
   * ⚠️ ELLES N'ENTRENT JAMAIS PAR `validerQuestion`, et c'est la garde principale de ce
   * mécanisme. `questionSchema` reste STRICT à trois champs : un modèle — le chat, claude.ai,
   * un extracteur — ne peut donc pas fabriquer d'options, donc ne peut pas faire pointer un
   * choix vers un fait de son choix. Seul `questionDeContradiction` en pose, à partir de faits
   * lus en base.
   *
   * ⚠️ `undefined` et `[]` ne veulent pas dire la même chose : absent = question à texte
   * libre, vide = QCM sans réponse possible, ce qui ne doit jamais être écrit (et que
   * `questionDeContradiction` ne peut pas produire — il exige deux valeurs distinctes).
   */
  options?: readonly OptionQuestion[];
}

/** La liste EXACTE des champs acceptés. Un champ de plus ⇒ `champ_inconnu`. */
const questionSchema = z
  .object({
    question: z.string().max(4000),
    predicat_vise: z.string().max(200),
    motif: z.string().max(4000),
  })
  .strict();

export const CHAMPS_QUESTION: readonly string[] = Object.keys(questionSchema.shape);

function refus(code: CodeRefusQuestion, raison: string): RefusQuestion {
  return { ok: false, code, raison };
}

/**
 * Valide une question posée par un modèle. `origine` vient de l'APPELANT (le chat, le MCP,
 * un extracteur), jamais du corps — comme la fiabilité d'un fait vient du jeton.
 */
export function validerQuestion(entree: unknown, origine: OrigineQuestion): QuestionValide | RefusQuestion {
  const parsed = questionSchema.safeParse(entree);
  if (!parsed.success) {
    const inconnu = parsed.error.issues.find((i) => i.code === "unrecognized_keys");
    if (inconnu) return refus("champ_inconnu", `champ hors du contrat : ${inconnu.message}`);
    return refus("corps_invalide", parsed.error.issues[0]?.message ?? "corps illisible");
  }

  const q = nettoyerTexte(parsed.data.question, LONGUEUR_MAX_QUESTION);
  if (!q.ok) return refus("question_interdite", `question : ${q.raison}`);
  // Une question est une QUESTION : sans point d'interrogation, c'est une affirmation qu'on
  // ferait passer pour une demande — et une affirmation écrite par un modèle est exactement
  // ce que le canari existe pour attraper côté faits.
  if (!q.valeur.includes("?")) return refus("question_interdite", "question : aucun point d'interrogation");

  const m = nettoyerTexte(parsed.data.motif, LONGUEUR_MAX_MOTIF);
  if (!m.ok) return refus("motif_interdit", `motif : ${m.raison}`);

  const predicat = parsed.data.predicat_vise.trim();
  if (estRefuseStructurellement(predicat)) {
    return refus("predicat_interdit", `prédicat refusé structurellement : ${predicat}`);
  }
  // Une question qui vise un prédicat hors vocabulaire ne peut produire aucun fait : y
  // répondre serait perdre le temps de Marc, et c'est exactement ce que la page doit éviter.
  if (!definition(predicat)) return refus("predicat_inconnu", `prédicat hors vocabulaire : ${predicat}`);

  return { ok: true, question: q.valeur, predicatVise: predicat, motif: m.valeur, origine };
}

/**
 * Les questions à ÉCARTER pour tenir sous le plafond, les plus anciennes d'abord.
 *
 * Appelée APRÈS l'insertion, avec la liste complète des ouvertes : la nouvelle question
 * compte, donc une pose sur une file pleine écarte bien une ancienne. `creeLe` décide seule —
 * une question posée il y a trois jours et jamais répondue a prouvé qu'elle n'intéressait pas.
 */
export function aEcarter(
  ouvertes: readonly { id: string; creeLe: Date }[],
  max: number = MAX_OUVERTES,
): string[] {
  if (ouvertes.length <= max) return [];
  return [...ouvertes]
    .sort((a, b) => a.creeLe.getTime() - b.creeLe.getTime())
    .slice(0, ouvertes.length - max)
    .map((q) => q.id);
}

/**
 * La question d'une contradiction, prête à poser. Composée ICI, jamais reçue.
 *
 * ⚠️ Pas de passage par `validerQuestion`, et ce n'est pas un raccourci : cette fonction ne
 * reçoit rien d'un modèle. Le texte est composé à partir du seul PRÉDICAT, qui a déjà été
 * vérifié contre le vocabulaire à l'écriture des faits ; les valeurs affichées dans les
 * options sont passées par `nettoyerTexte` lors de l'écriture de chaque fait (pas d'URL, pas
 * de balise, pas de retour à la ligne). Faire semblant de re-valider du texte qu'on vient
 * d'écrire soi-même donnerait une fausse impression de garde.
 *
 * ⚠️ `origine: "regle"` — cette valeur existait dans le schéma depuis l'ADR 0002 §5.1 et
 * n'avait AUCUN producteur (`HANDOVER` : « rien ne pose encore de question tout seul »). C'est
 * ici qu'elle en gagne un, quinze jours après avoir été déclarée.
 */
export function questionDeContradiction(c: ContradictionDetectee): QuestionValide {
  return {
    ok: true,
    question: c.question,
    predicatVise: c.predicat,
    motif: c.motif,
    origine: "regle",
    options: c.options,
  };
}

/**
 * L'option choisie, si elle appartient bien à CETTE question.
 *
 * ⚠️ C'est une garde, pas une commodité. Le `faitId` arrive d'un formulaire, donc du client :
 * sans cette vérification, un identifiant arbitraire ferait valider n'importe quel fait de la
 * base — donc en périmer un autre — par une simple requête forgée. La question porte la liste
 * des faits qu'on a le droit de choisir ; rien d'autre ne l'autorise.
 */
export function optionChoisie(
  options: readonly OptionQuestion[] | undefined,
  faitId: string,
): OptionQuestion | null {
  return options?.find((o) => o.faitId === faitId) ?? null;
}

/** Les options d'une question lues depuis la base. Une liste illisible vaut ABSENTE. */
export function lireOptions(brut: string | null): readonly OptionQuestion[] | undefined {
  if (!brut) return undefined;
  try {
    const parse: unknown = JSON.parse(brut);
    if (!Array.isArray(parse)) return undefined;
    const options = parse.filter(
      (o): o is OptionQuestion =>
        typeof o === "object" &&
        o !== null &&
        typeof (o as OptionQuestion).faitId === "string" &&
        typeof (o as OptionQuestion).valeur === "string" &&
        typeof (o as OptionQuestion).provenance === "string" &&
        typeof (o as OptionQuestion).libelle === "string" &&
        // ⚠️ `aRejeter` est OPTIONNEL (une contradiction n'en a pas) mais s'il est là, il doit
        // être un tableau de chaînes : c'est lui qui décide quels faits sont rejetés au clic.
        // Une valeur d'un autre type rendrait la liste ENTIÈRE absente, donc la question
        // retomberait en texte libre plutôt que de rejeter n'importe quoi.
        ((o as OptionQuestion).aRejeter === undefined ||
          (Array.isArray((o as OptionQuestion).aRejeter) &&
            (o as OptionQuestion).aRejeter!.every((x) => typeof x === "string"))),
    );
    // ⚠️ Une liste qui a PERDU des entrées au filtrage est traitée comme absente, jamais
    // tronquée : un QCM amputé propose de choisir entre moins d'options qu'il n'y en avait,
    // et Marc n'aurait aucun moyen de le savoir. La question retombe alors en texte libre.
    return options.length === parse.length && options.length > 0 ? options : undefined;
  } catch {
    return undefined;
  }
}
