// lib/banc/banc.ts — le BANC de questions qui mesure chaque lot de la refonte LIA (MemoryAI#69).
//
// ⚠️ FIGÉ AVANT LE CODE QU'IL MESURE, comme les dix questions du socle (`lib/questionsTest.ts`) :
// une mesure écrite après coup se plie à ce qu'on vient de construire. Le banc d'un lot est
// tiré UNE fois, gardé en base, et tous les lots suivants se mesurent sur les MÊMES questions.
//
// ⚠️ LE DÉPÔT EST PUBLIC : il ne porte que les GABARITS et le calcul. Les questions réelles
// nomment des émetteurs et des types de papiers de Marc ; elles sont tirées en production et
// gardées CHIFFRÉES (`lib/banc/depot.ts`). Les tests de ce module tournent sur des papiers fictifs.
//
// Cinq capacités, reprises de LongMemEval (arXiv 2410.10813) et ramenées à ce que la mémoire
// contient aujourd'hui, des papiers : trouver UN papier, en trouver PLUSIEURS, situer dans le
// TEMPS, prendre le plus RÉCENT, et savoir dire « je n'ai rien » (au moins 20 %, sinon un
// système qui rend toujours quelque chose passerait pour bon).
//
// Ce module est PUR : ni base, ni clé, ni horloge.

export const CAPACITES = ["extraction", "multi-sources", "temporel", "mise-a-jour", "abstention"] as const;
type Capacite = (typeof CAPACITES)[number];

/** La part minimale de questions sans réponse. En dessous, le banc ment sur la précision. */
const PART_ABSTENTION_MIN = 0.2;
/** Questions tirées par capacité : 8 × 5 = 40, dont 8 d'abstention (20 %). */
export const PAR_CAPACITE = 8;
/** Le rang jusqu'où une source attendue compte comme trouvée. */
export const K_RAPPEL = 20;
/** Au-delà, une question « plusieurs papiers » ne se lit plus en une page de résultats. */
const MULTI_MAX = K_RAPPEL;

export interface QuestionBanc {
  capacite: Capacite;
  question: string;
  /**
   * Les mots qu'un modèle passerait à l'outil de recherche pour cette question. C'est ce que
   * le lot 0 mesure : la recherche ELLE-MÊME, sans le talent d'un modèle pour la reformuler.
   */
  motsCles: string;
  /** Les papiers qui répondent. Vide = question d'abstention : la bonne réponse est « rien ». */
  attendus: string[];
}

/** Ce que le tirage lit d'un papier : déjà déchiffré par l'appelant, jamais stocké tel quel. */
export interface PapierBanc {
  id: string;
  type: string | null;
  emetteur: string | null;
  annee: number | null;
  /** `AAAA-MM-JJ`. */
  dateDocument: string | null;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * L'ordre de tirage : une fonction des identifiants seule, pour qu'un même parc donne le même
 * banc. ⚠️ Pas `Math.random` : un banc qu'on ne peut pas retirer à l'identique ne se vérifie pas.
 */
function ordre(cle: string): number {
  let h = 2166136261;
  for (let i = 0; i < cle.length; i++) {
    h ^= cle.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function prendre<T>(candidats: T[], cle: (t: T) => string): T[] {
  return [...candidats].sort((a, b) => ordre(cle(a)) - ordre(cle(b)) || cle(a).localeCompare(cle(b))).slice(0, PAR_CAPACITE);
}

function grouper<T>(xs: readonly T[], cle: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = cle(x);
    if (k === null) continue;
    const l = m.get(k) ?? [];
    l.push(x);
    m.set(k, l);
  }
  return m;
}

/**
 * Tire le banc d'un parc de papiers. Une capacité sans assez de candidats rend MOINS de
 * questions, jamais des questions inventées : `validerBanc` dira ensuite si le banc tient.
 */
export function tirerBanc(papiers: readonly PapierBanc[]): QuestionBanc[] {
  const nommes = papiers.filter((p): p is PapierBanc & { type: string; emetteur: string } => !!p.type && !!p.emetteur);
  const parTypeEmetteur = grouper(nommes, (p) => `${p.type}\u0000${p.emetteur}`);
  const parTriplet = grouper(nommes, (p) => (p.annee === null ? null : `${p.type}\u0000${p.emetteur}\u0000${p.annee}`));
  const parMois = grouper(nommes, (p) => (p.dateDocument ? `${p.type}\u0000${p.emetteur}\u0000${p.dateDocument.slice(0, 7)}` : null));

  const extraction = prendre(
    [...parTriplet.values()].filter((g) => g.length === 1).map((g) => g[0]!),
    (p) => p.id,
  ).map((p) => ({ capacite: "extraction" as const, question: `Où est mon ${p.type} de ${p.emetteur} de ${p.annee} ?`, motsCles: `${p.type} ${p.emetteur} ${p.annee}`, attendus: [p.id] }));

  const multi = prendre(
    [...parTypeEmetteur.values()].filter((g) => g.length >= 2 && g.length <= MULTI_MAX),
    (g) => g[0]!.id,
  ).map((g) => ({
    capacite: "multi-sources" as const,
    question: `Quels sont tous mes papiers ${g[0]!.type} de ${g[0]!.emetteur} ?`,
    motsCles: `${g[0]!.type} ${g[0]!.emetteur}`,
    attendus: g.map((p) => p.id).sort(),
  }));

  const temporel = prendre(
    [...parMois.values()].filter((g) => g.length === 1).map((g) => g[0]!),
    (p) => `t${p.id}`,
  ).map((p) => {
    const [a, m] = p.dateDocument!.split("-");
    return {
      capacite: "temporel" as const,
      question: `Quel ${p.type} ai-je reçu de ${p.emetteur} en ${MOIS[Number(m) - 1]} ${a} ?`,
      motsCles: `${p.type} ${p.emetteur} ${a}`,
      attendus: [p.id],
    };
  });

  const miseAJour = prendre(
    [...parTypeEmetteur.values()].filter((g) => {
      const dates = g.map((p) => p.dateDocument).filter((d): d is string => !!d).sort();
      // Le plus récent doit être UNIQUE : deux papiers du même jour n'ont pas de « dernier ».
      return dates.length >= 2 && dates.at(-1) !== dates.at(-2);
    }),
    (g) => `m${g[0]!.id}`,
  ).map((g) => {
    const dernier = [...g].filter((p) => p.dateDocument).sort((a, b) => b.dateDocument!.localeCompare(a.dateDocument!))[0]!;
    return {
      capacite: "mise-a-jour" as const,
      question: `Quel est mon ${dernier.type} de ${dernier.emetteur} le plus récent ?`,
      motsCles: `${dernier.type} ${dernier.emetteur}`,
      attendus: [dernier.id],
    };
  });

  // L'abstention : un type et un émetteur qui EXISTENT, à une année où ils n'ont rien. Un nom
  // inventé serait trop facile — rien ne lui ressemble ; ici tout ressemble, sauf l'année.
  const abstention = prendre([...parTypeEmetteur.values()], (g) => `a${g[0]!.id}`).flatMap((g) => {
    const annees = g.map((p) => p.annee).filter((a): a is number => a !== null);
    if (annees.length === 0) return [];
    const absente = Math.max(...annees) + 7;
    return [
      {
        capacite: "abstention" as const,
        question: `Où est mon ${g[0]!.type} de ${g[0]!.emetteur} de ${absente} ?`,
        motsCles: `${g[0]!.type} ${g[0]!.emetteur} ${absente}`,
        attendus: [],
      },
    ];
  });

  return [...extraction, ...multi, ...temporel, ...miseAJour, ...abstention];
}

/** Ce qui empêche un banc de mesurer quoi que ce soit. Vide = le banc tient. */
export function validerBanc(questions: readonly QuestionBanc[]): string[] {
  const erreurs: string[] = [];
  if (questions.length === 0) return ["banc vide"];
  const abst = questions.filter((q) => q.capacite === "abstention").length;
  if (abst / questions.length < PART_ABSTENTION_MIN) {
    erreurs.push(`abstention ${abst}/${questions.length}, sous le minimum de ${PART_ABSTENTION_MIN * 100} %`);
  }
  for (const c of CAPACITES) {
    if (!questions.some((q) => q.capacite === c)) erreurs.push(`aucune question « ${c} »`);
  }
  for (const q of questions) {
    if (q.capacite === "abstention" && q.attendus.length > 0) erreurs.push("une question d'abstention a une réponse");
    if (q.capacite !== "abstention" && q.attendus.length === 0) erreurs.push(`une question « ${q.capacite} » n'a pas de réponse`);
  }
  return [...new Set(erreurs)];
}

interface ScoreCapacite {
  questions: number;
  /** Moyenne, sur les questions, de la part des attendus trouvés dans les `k` premiers. */
  rappel: number | null;
}

export interface Mesure {
  k: number;
  questions: number;
  parCapacite: Record<Capacite, ScoreCapacite>;
  /** Le rappel des questions qui ONT une réponse, toutes capacités confondues. */
  rappel: number | null;
  /** La part des questions d'abstention auxquelles la recherche n'a RIEN rendu. */
  abstentionCorrecte: number | null;
}

const arrondi = (x: number): number => Math.round(x * 1000) / 1000;
const moyenne = (xs: number[]): number | null => (xs.length ? arrondi(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Note ce que la recherche a rendu pour chaque question (`trouves[i]` répond à `questions[i]`,
 * dans l'ordre servi). Un nombre absent est `null`, jamais `0` : « pas de question » n'est pas
 * « tout raté ».
 */
export function noterBanc(questions: readonly QuestionBanc[], trouves: readonly (readonly string[])[], k = K_RAPPEL): Mesure {
  if (trouves.length !== questions.length) throw new Error("une réponse par question, ni plus ni moins");
  const rappels = new Map<Capacite, number[]>(CAPACITES.map((c) => [c, []]));
  const abstentions: number[] = [];
  questions.forEach((q, i) => {
    const rendus = trouves[i]!;
    if (q.capacite === "abstention") {
      abstentions.push(rendus.length === 0 ? 1 : 0);
      rappels.get("abstention")!.push(rendus.length === 0 ? 1 : 0);
      return;
    }
    const tete = new Set(rendus.slice(0, k));
    rappels.get(q.capacite)!.push(q.attendus.filter((id) => tete.has(id)).length / q.attendus.length);
  });
  const parCapacite = Object.fromEntries(
    CAPACITES.map((c) => [c, { questions: rappels.get(c)!.length, rappel: moyenne(rappels.get(c)!) }]),
  ) as Record<Capacite, ScoreCapacite>;
  return {
    k,
    questions: questions.length,
    parCapacite,
    rappel: moyenne(CAPACITES.filter((c) => c !== "abstention").flatMap((c) => rappels.get(c)!)),
    abstentionCorrecte: moyenne(abstentions),
  };
}
