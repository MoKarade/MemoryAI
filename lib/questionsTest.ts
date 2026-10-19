// lib/questionsTest.ts — les DIX questions qui décident du sort du socle (ADR 0004 §10).
//
// ⚠️ Ce fichier est FIGÉ AVANT le code d'extraction, et c'est tout son intérêt. Une mesure
// écrite après coup se plie à ce qu'on vient de construire : elle ne mesure plus rien. Les
// dix questions ont été écrites par la session le 16/09 et validées telles quelles par Marc
// (« celles ecrites sont ok »).
//
// ⚠️ LE SEUIL N'EST PAS « 8 SUR 10 » TOUT COURT. L'ADR 0004 §10 ajoute, en toutes lettres :
// « la n° 5 est la plus importante : c'est la SEULE qui teste la capacité neuve (lire le
// contenu d'un papier). Un socle qui passerait les neuf autres et raterait la cinquième
// n'aurait rien prouvé. » Le BACKLOG, lui, n'écrit que « 8 des 10 » — deux écritures de la
// même règle, donc une règle et demie. `verdictSocle` porte la version STRICTE, celle qui
// nomme sa raison ; c'est elle qui fait foi, et un test la verrouille.
//
// Ce module est PUR : ni base, ni réseau, ni horloge. Il dit quoi mesurer et comment lire le
// résultat — jamais comment y répondre.

/** Ce qu'une question exerce. C'est ce qui rend un échec DIAGNOSTIQUABLE. */
export type Capacite =
  /** Lire le CONTENU d'un papier — la capacité que ce socle existe pour prouver. */
  | "contenu-piece"
  /** Retrouver un papier par ses métadonnées (type, année, émetteur). */
  | "localiser-piece"
  /** Un fait déjà porté par la Mémoire avant l'ADR 0004. */
  | "fait-existant"
  /** Comparer des dates entre elles pour répondre « quoi ensuite ». */
  | "chainage-dates"
  /** Retrouver ce qui s'est dit dans une conversation gardée (ADR 0002). */
  | "conversation";

export interface QuestionTest {
  readonly numero: number;
  readonly question: string;
  readonly capacite: Capacite;
  /**
   * `true` seulement pour la n° 5 : elle ne peut PAS se répondre avec ce qui existait avant
   * ce socle. Les autres se répondent au moins en partie avec l'inventaire déjà en base, et
   * c'est précisément pourquoi elles ne prouvent pas grand-chose à elles seules.
   */
  readonly capaciteNeuve: boolean;
  /** Ce que l'échec de CETTE question désignerait. Écrit avant de connaître le résultat. */
  readonly ceQueLEchecDesigne: string;
}

export const QUESTIONS_TEST: readonly QuestionTest[] = [
  {
    numero: 1,
    question: "Où est mon avis de cotisation 2024 ?",
    capacite: "localiser-piece",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "les facettes type + année ne filtrent pas, ou le type n'a pas été extrait",
  },
  {
    numero: 2,
    question: "Quel est mon numéro de police d'assurance auto ?",
    capacite: "contenu-piece",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "les numéros de référence ne sont pas extraits, ou pas cherchables",
  },
  {
    numero: 3,
    question: "Quand finit mon bail de logement, et celui de mon véhicule ?",
    capacite: "contenu-piece",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "les dates d'échéance ne sortent pas des pièces, ou les deux baux se confondent",
  },
  {
    numero: 4,
    question: "Qu'est-ce que j'ai comme papiers de Banque Aurore ?",
    capacite: "localiser-piece",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "la facette émetteur n'existe pas, ou le modèle devine les noms au lieu de les lire",
  },
  {
    numero: 5,
    question: "C'est quoi le numéro de téléphone sur le contrat du propriétaire ?",
    capacite: "contenu-piece",
    capaciteNeuve: true,
    ceQueLEchecDesigne:
      "le socle n'a rien prouvé : c'est la seule question qui exige de lire DANS un papier ce qu'aucune métadonnée ne porte",
  },
  {
    numero: 6,
    question: "Qu'est-ce qui expire dans les 90 prochains jours ?",
    capacite: "chainage-dates",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "les échéances ne sont pas comparables entre elles (formats, absences)",
  },
  {
    numero: 7,
    question: "Depuis quand je suis chez mon employeur actuel, et c'était qui avant ?",
    capacite: "fait-existant",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "l'historisation ne rend pas l'ancien employeur, ou la réponse ne dit pas à quelle date elle vaut",
  },
  {
    numero: 8,
    question: "Est-ce que j'ai déjà reçu quelque chose de Revenu Québec cette année ?",
    capacite: "localiser-piece",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "émetteur et année ne se croisent pas, ou l'émetteur est écrit de trois façons",
  },
  {
    numero: 9,
    question: "Qu'est-ce qu'on avait conclu sur MemoryAI le 16 septembre ?",
    capacite: "conversation",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "les conversations gardées ne sont pas cherchables par date",
  },
  {
    numero: 10,
    question: "Quel est mon statut d'immigration et quand il expire ?",
    capacite: "fait-existant",
    capaciteNeuve: false,
    ceQueLEchecDesigne: "le niveau 3 rend la réponse vide alors qu'une échéance est permise (ADR 0001 §5.3)",
  },
];

/** Le nombre de réponses exigées, écrit une fois. */
export const SEUIL_REPONDUES = 8;

/** Ce qu'une passe de mesure rend pour une question. */
export interface ResultatQuestion {
  readonly numero: number;
  /** A-t-elle trouvé SA réponse ? Pas « le modèle a répondu quelque chose ». */
  readonly repondue: boolean;
  /** Ce qui a été observé — sert au diagnostic, jamais au verdict. */
  readonly observe?: string;
}

export interface VerdictSocle {
  readonly passe: boolean;
  readonly repondues: number;
  readonly total: number;
  /** La raison du refus, ou de l'acceptation. Jamais un booléen nu : un verdict se lit. */
  readonly raison: string;
  /** Les numéros restés sans réponse, pour savoir quoi corriger. */
  readonly manquantes: readonly number[];
}

/**
 * Le verdict du socle. DEUX conditions, pas une (ADR 0004 §10) :
 *  - au moins `SEUIL_REPONDUES` des dix trouvent leur réponse ;
 *  - ET la question à capacité NEUVE (la n° 5) est du lot.
 *
 * ⚠️ Un résultat manquant vaut « non répondue », jamais « on verra » : une mesure
 * incomplète ne doit pas pouvoir rendre un verdict favorable par omission.
 */
export function verdictSocle(resultats: readonly ResultatQuestion[]): VerdictSocle {
  const parNumero = new Map(resultats.map((r) => [r.numero, r]));
  const repondues = QUESTIONS_TEST.filter((q) => parNumero.get(q.numero)?.repondue === true);
  const manquantes = QUESTIONS_TEST.filter((q) => parNumero.get(q.numero)?.repondue !== true).map((q) => q.numero);

  const neuves = QUESTIONS_TEST.filter((q) => q.capaciteNeuve);
  const neuvesRatees = neuves.filter((q) => parNumero.get(q.numero)?.repondue !== true);

  const n = repondues.length;
  const total = QUESTIONS_TEST.length;

  if (neuvesRatees.length > 0) {
    const nums = neuvesRatees.map((q) => q.numero).join(", ");
    return {
      passe: false,
      repondues: n,
      total,
      raison: `la question ${nums} teste la capacité neuve et reste sans réponse — ${n}/${total} ne prouve rien sans elle`,
      manquantes,
    };
  }

  if (n < SEUIL_REPONDUES) {
    return {
      passe: false,
      repondues: n,
      total,
      raison: `${n}/${total} répondues, il en faut ${SEUIL_REPONDUES}`,
      manquantes,
    };
  }

  return {
    passe: true,
    repondues: n,
    total,
    raison: `${n}/${total} répondues, dont celle qui teste la capacité neuve`,
    manquantes,
  };
}
