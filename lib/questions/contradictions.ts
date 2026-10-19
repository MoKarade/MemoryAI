// lib/questions/contradictions.ts — quand deux sources ne disent pas la même chose, la
// mémoire POSE LA QUESTION au lieu de choisir (ADR 0004, décision n° 21 ; re-confirmé par
// Marc le 17/09 : « une page de questions avec des questions précises que je peux répondre
// soit en QCM soit en texte alors oui, mais le reste non »).
//
// ⚠️ POURQUOI CE MODULE EXISTE, avec sa date. Jusqu'au 17/09, une divergence arrivait dans
// `/a-valider` sous la forme d'un fait « proposé » ordinaire. Cliquer « Valider » y PÉRIME
// silencieusement le fait concurrent — Marc l'a fait sur six faits et cinq valeurs lues sur
// des documents ont été remplacées par la déduction d'un modèle. Le geste n'était pas
// informé : rien ne disait qu'un autre fait allait être remplacé, ni par quoi.
//
// La forme qui répare ça n'est pas un meilleur avertissement, c'est un autre OBJET : une
// question qui porte les DEUX valeurs avec leur provenance, et dont la réponse est un clic
// sur celle qu'on garde. Le choix ne peut plus être fait à l'aveugle parce qu'il n'y a plus
// d'aveugle possible.
//
// ⚠️ CE MODULE EST PUR. Il ne lit pas la base, n'appelle aucun modèle, ne connaît pas
// l'horloge. Il reçoit des faits DÉJÀ déchiffrés et rend une question à poser, ou rien.
// Corollaire qui vaut d'être dit : aucune valeur de Marc ne part vers un LLM pour produire
// cette question — le texte est composé ici, en français, à partir du prédicat seul.

import { FIABILITES } from "../db/schema";

type Fiabilite = (typeof FIABILITES)[number];

/** Un fait candidat, réduit à ce qui décide. Déjà déchiffré par l'appelant. */
export interface FaitEnConflit {
  readonly id: string;
  readonly predicat: string;
  readonly valeur: string;
  readonly fiabiliteSource: Fiabilite;
  /** L'extracteur qui l'a produit — c'est ce que Marc lit pour trancher. */
  readonly extracteur: string | null;
  readonly statut: "valide" | "propose";
}

/** Une option de QCM : un fait existant, présenté pour être choisi. */
export interface OptionQuestion {
  readonly faitId: string;
  readonly valeur: string;
  /** D'où ça vient, en français, sans jargon — c'est ce qui rend le choix informé. */
  readonly provenance: string;
  /**
   * Ce que le bouton AFFICHE. Séparé de `valeur`, et pas par confort : sur un doublon exact,
   * les deux options portent la MÊME valeur — deux boutons identiques ne se choisissent pas.
   * Le libellé dit alors ce qui les distingue (la provenance), et la valeur reste dessous.
   */
  readonly libelle: string;
  /**
   * Les faits à REJETER si cette option est choisie — gardés, jamais servis (ADR 0001 §5.5).
   *
   * ⚠️ Nécessaire pour un prédicat MULTIPLE, et seulement là : `valider` périme les autres
   * faits validés d'un prédicat à valeur unique, mais il ne touche à rien sur un prédicat
   * multiple — c'est tout son intérêt (deux fournisseurs coexistent). Sans ce champ, choisir
   * « garder celui-ci » sur un doublon exact ne retirerait pas l'autre, et la question
   * reviendrait à chaque passe sur un état inchangé.
   *
   * ⚠️ REJETER, jamais oublier. Un rejet garde la ligne et empêche un rejeu de la même source
   * de la re-proposer ; un oubli est définitif et c'est une décision de Marc, pas la
   * conséquence d'un clic sur « lequel des deux ».
   */
  readonly aRejeter?: readonly string[];
}

export interface ContradictionDetectee {
  readonly predicat: string;
  readonly question: string;
  readonly motif: string;
  readonly options: readonly OptionQuestion[];
}

/**
 * Comment on nomme une source à l'écran. ⚠️ Ce n'est PAS une hiérarchie : aucun ordre de
 * fiabilité n'existe dans ce dépôt, et en inventer un ici en ferait un arbitre silencieux.
 * Ces libellés servent à ce que Marc reconnaisse la source, pas à la classer.
 */
export const PROVENANCE_LISIBLE: Record<Fiabilite, string> = {
  "document-officiel": "lu sur un document officiel",
  "document-tiers": "lu sur un document",
  app: "déduit par un modèle",
  "mail-tiers": "lu dans un courriel",
  marc: "dit par toi",
  seed: "tiré de tes règles au démarrage",
};

/**
 * D'où vient un fait, en une phrase lisible.
 *
 * ⚠️ Un repli explicite, pas un `!` : une fiabilité que le code ne connaîtrait pas (une valeur
 * ajoutée au schéma sans l'être ici) doit s'afficher comme INCONNUE, pas faire planter la page
 * ni se faire passer pour une source établie.
 */
function provenanceLisible(f: FaitEnConflit): string {
  return [PROVENANCE_LISIBLE[f.fiabiliteSource] ?? "source inconnue", f.extracteur]
    .filter((x): x is string => Boolean(x))
    .join(" · ");
}

/** Deux valeurs différentes, une seule place : il y a quelque chose à décider. */
const MOTIF = "Deux sources ne disent pas la même chose, et ce prédicat n'admet qu'une valeur.";

/**
 * La contradiction d'UN prédicat, s'il y en a une.
 *
 * `faits` doit être l'ensemble des faits vivants et servables de ce prédicat pour ce sujet —
 * `valide` et `propose` confondus. L'appelant garantit que le prédicat n'admet qu'une valeur :
 * sur un prédicat multiple, deux valeurs différentes ne sont pas une contradiction, c'est le
 * cas ordinaire (deux fournisseurs, deux diplômes).
 *
 * ⚠️ Les valeurs IDENTIQUES ne font pas une contradiction, et cette ligne n'est pas
 * redondante avec la garde `doublon_valide` de `ecrireLot` : celle-là empêche une valeur
 * identique d'ENTRER quand un fait validé la porte déjà, mais deux faits identiques peuvent
 * coexister en base pour d'autres raisons (validés avant la garde, ou tous deux `propose`).
 * Poser une question entre deux valeurs identiques serait demander à Marc de choisir entre
 * une chose et elle-même.
 *
 * ⚠️ Une seule valeur distincte ⇒ rien. Zéro ou une option ne fait pas un choix, et une
 * question à une seule réponse possible est une question qui use la page pour rien.
 */
export function contradictionDe(faits: readonly FaitEnConflit[]): ContradictionDetectee | null {
  if (faits.length < 2) return null;
  const predicat = faits[0]!.predicat;

  // Une option par VALEUR distincte, et on garde le fait le plus fort à l'affichage : un
  // `valide` d'abord (c'est ce que la mémoire sert aujourd'hui), sinon le premier venu.
  const parValeur = new Map<string, FaitEnConflit>();
  for (const f of faits) {
    const vu = parValeur.get(f.valeur);
    if (!vu || (vu.statut !== "valide" && f.statut === "valide")) parValeur.set(f.valeur, f);
  }
  if (parValeur.size < 2) return null;

  const options = [...parValeur.values()].map((f) => ({
    faitId: f.id,
    valeur: f.valeur,
    // Les valeurs DIFFÈRENT ici (c'est la définition d'une contradiction), donc la valeur
    // elle-même est le meilleur libellé : c'est ce entre quoi Marc choisit.
    libelle: f.valeur,
    provenance: provenanceLisible(f),
  }));

  return {
    predicat,
    // ⚠️ Le texte ne contient AUCUNE valeur, et ce n'est pas une précaution tiède : les
    // valeurs vivent dans les options, qui sont déchiffrées à l'affichage. Une question dont
    // le texte porterait la valeur la figerait en clair dans la table `questions`, hors du
    // régime de chiffrement des faits — et l'index unique `(predicat, question)` empêcherait
    // en plus de reposer la question le jour où la valeur change.
    question: `Quelle valeur garder pour « ${predicat} » ?`,
    motif: MOTIF,
    options,
  };
}

/**
 * Toutes les contradictions d'un lot de faits, groupées par prédicat.
 *
 * `predicatsAUneValeur` est REQUIS, comme `predicatsRetenus` l'est pour `estServable` : son
 * défaut serait « tous les prédicats », c'est-à-dire le côté qui pose des questions absurdes
 * sur des prédicats multiples. Le compilateur oblige donc l'appelant à dire ce qu'il sait.
 */
export function contradictions(
  faits: readonly FaitEnConflit[],
  predicatsAUneValeur: ReadonlySet<string>,
): ContradictionDetectee[] {
  const parPredicat = new Map<string, FaitEnConflit[]>();
  for (const f of faits) {
    if (!predicatsAUneValeur.has(f.predicat)) continue;
    const l = parPredicat.get(f.predicat) ?? [];
    l.push(f);
    parPredicat.set(f.predicat, l);
  }
  const trouvees: ContradictionDetectee[] = [];
  for (const l of parPredicat.values()) {
    const c = contradictionDe(l);
    if (c) trouvees.push(c);
  }
  // Un ordre TOTAL et déterministe : deux passes sur le même état posent les mêmes questions
  // dans le même ordre, donc le plafond de cinq ouvertes n'écarte pas au hasard.
  return trouvees.sort((a, b) => a.predicat.localeCompare(b.predicat));
}

/** Deux sources disent EXACTEMENT la même chose, sur un prédicat qui en accepte plusieurs. */
const MOTIF_DOUBLON = "Deux sources disent exactement la même chose, et ce prédicat accepte plusieurs valeurs.";

/**
 * Le DOUBLON EXACT d'un prédicat MULTIPLE (demandé par Marc, 17/09).
 *
 * ⚠️ Pourquoi c'est un cas à part, et pas la contradiction ci-dessus. Sur un prédicat
 * multiple, deux valeurs différentes sont le cas ORDINAIRE — deux fournisseurs, deux
 * diplômes — et il n'y a rien à demander. Ce qui mérite une question, c'est l'inverse : la
 * même valeur DEUX fois. `valider` ne périme rien sur un prédicat multiple (c'est tout son
 * intérêt), et la garde `doublon_valide` de `ecrireLot` ne couvre que les prédicats à valeur
 * unique : le doublon s'installe donc et personne ne le retire. Vécu — « Marque Services
 * Financiers » existe en double sur `contrat.fournisseur` depuis le 17/09.
 *
 * ⚠️ Égalité STRICTE, comme la garde d'écriture : « Marque » et « marque » peuvent être une
 * correction, et les fusionner d'office retirerait à Marc une information qu'il a peut-être
 * voulue.
 *
 * ⚠️ « Garder les deux » N'EST PAS une option du QCM, et c'est délibéré : c'est le bouton
 * « Écarter » qui existe déjà. Une question écartée ne se repose jamais (index unique), donc
 * la sémantique est exactement « je ne veux pas trancher, laisse les deux » — sans inventer
 * une troisième forme d'option qui ne rejette ni ne valide rien.
 */
export function doublonExactDe(faits: readonly FaitEnConflit[]): ContradictionDetectee | null {
  if (faits.length < 2) return null;
  const predicat = faits[0]!.predicat;

  const parValeur = new Map<string, FaitEnConflit[]>();
  for (const f of faits) {
    const l = parValeur.get(f.valeur) ?? [];
    l.push(f);
    parValeur.set(f.valeur, l);
  }
  // La valeur la PLUS dupliquée d'abord : s'il y a plusieurs doublons sur le même prédicat, on
  // traite le plus encombrant, et les autres reviendront à la passe suivante. Un ordre total
  // (le compte, puis la valeur) pour que deux passes posent la même question.
  const groupes = [...parValeur.entries()]
    .filter(([, l]) => l.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const premier = groupes[0];
  if (!premier) return null;

  const [valeur, doublons] = premier;
  const tous = doublons.map((f) => f.id);
  const options = doublons.map((f) => ({
    faitId: f.id,
    valeur,
    provenance: provenanceLisible(f),
    // ⚠️ Le libellé porte la PROVENANCE, pas la valeur : elles sont identiques par définition,
    // donc deux boutons portant la valeur seraient indiscernables.
    libelle: `Garder celui ${provenanceLisible(f)}`,
    aRejeter: tous.filter((id) => id !== f.id),
  }));

  return {
    predicat,
    question: `Deux fois la même valeur pour « ${predicat} » — lequel garder ?`,
    motif: MOTIF_DOUBLON,
    options,
  };
}

/** Les doublons exacts d'un lot, groupés par prédicat MULTIPLE. */
export function doublonsExacts(
  faits: readonly FaitEnConflit[],
  predicatsAUneValeur: ReadonlySet<string>,
): ContradictionDetectee[] {
  const parPredicat = new Map<string, FaitEnConflit[]>();
  for (const f of faits) {
    // ⚠️ L'INVERSE du filtre de `contradictions` : ici on ne veut QUE les prédicats multiples.
    // Sur un prédicat à valeur unique, un doublon exact est déjà traité — la garde d'écriture
    // le refuse, et le rattrapage du 17/09 a nettoyé le stock.
    if (predicatsAUneValeur.has(f.predicat)) continue;
    const l = parPredicat.get(f.predicat) ?? [];
    l.push(f);
    parPredicat.set(f.predicat, l);
  }
  const trouves: ContradictionDetectee[] = [];
  for (const l of parPredicat.values()) {
    const d = doublonExactDe(l);
    if (d) trouves.push(d);
  }
  return trouves.sort((a, b) => a.predicat.localeCompare(b.predicat));
}
