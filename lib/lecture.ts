// lib/lecture.ts — CE QUI EST SERVI à un modèle, et sous quelle forme (ADR 0001 §3, §5.3).
//
// Les règles, dans l'ordre où elles s'appliquent, chacune testée :
//   1. jamais un fait `rejete`, `perime`, supprimé, ni `canari` — ni par le contexte, ni par
//      la recherche ; un fait `propose` est servi ET étiqueté (CLAUDE.md §9 n° 5 : une
//      mémoire vide parce que rien n'est validé est le vrai risque) ;
//   2. N0 et N1 toujours ; N2 SEULEMENT si l'appelant l'a demandé pour CET appel
//      (`inclure_n2`, journalisé) ET si `MEMORYAI_N2_CHAT=1` — la variable dit que Marc a lu
//      la rétention d'Anthropic (Q5) ; N3 toujours : il n'a aucun contenu, seulement une
//      existence, une date ou un pointeur ;
//   3. la valeur est déchiffrée ici et nulle part ailleurs ; un `ref_document` devient aussi
//      un lien Drive, parce que « où est mon avis de cotisation » attend un lien.
//
// Pur sauf le déchiffrement (clé en paramètre). La base est derrière `DepotLecture`.

import { dechiffrer, DechiffrementError, type Cle } from "./chiffrement";
import type { FaitAvecProvenance } from "./depotLecture";
import type { Attributs } from "./validerFait";
import { definition } from "./vocabulaire";

export interface FaitLisible {
  id: string;
  predicat: string;
  domaine: string;
  description: string;
  valeur: string;
  valeurType: string;
  lien: string | null;
  attributs: Attributs | null;
  niveau: number;
  statut: string;
  fiabiliteSource: string;
  confiance: number;
  valideDe: string | null;
  valideA: string | null;
  creeLe: string;
  /**
   * D'où le fait vient. ⚠️ `sourceRef` a été ajouté par [L33a] : il était ÉCRIT (`notNull`)
   * et **INDEXÉ** (`provenances_source`, index posé exactement pour retrouver les faits d'une
   * même source) et cette fonction le JETAIT. C'est pourquoi aucune surface ne pouvait
   * montrer « le document lié » : la donnée existait à un champ de distance, pas à une
   * requête neuve.
   */
  provenance: { sourceType: string; sourceRef: string; extracteur: string; dateSource: string | null } | null;
}

export interface PolitiqueLecture {
  /** L'appelant a demandé N2 pour cet appel. */
  inclureN2: boolean;
  /** `MEMORYAI_N2_CHAT=1` : Marc a lu la rétention et autorise N2 vers un modèle. */
  n2Autorise: boolean;
  /**
   * L'appelant a demandé N3 pour cet appel — le CONTENU des papiers d'identité.
   *
   * ⚠️ Décision de Marc du 19/09/2026 (« pour tous les docs niveau 3 max, tout »), après deux
   * arbitrages qui allaient déjà dans ce sens (« oui même toutes les infos confidentielles
   * traitées », « Oui, qu'il me réponde » à propos de son NAS). Ce qui l'a déclenchée est
   * concret : la Mémoire portait son passeport et ne pouvait pas dire son âge.
   */
  inclureN3: boolean;
  /** `MEMORYAI_N3_CHAT=1` : Marc autorise le contenu des papiers d'identité vers un modèle. */
  n3Autorise: boolean;
  /** Servir aussi les faits `propose` (défaut : oui, étiquetés). */
  inclureProposes: boolean;
}

export const STATUTS_SERVIS = ["valide", "propose"] as const;

export function n2Autorise(env: Record<string, string | undefined> = process.env): boolean {
  return env.MEMORYAI_N2_CHAT?.trim() === "1";
}

/**
 * `MEMORYAI_N3_CHAT=1` : le contenu des papiers d'identité peut sortir vers un modèle.
 *
 * ⚠️ DEUX VERROUS, ET C'EST VOULU — la variable d'environnement ET la demande par appel. La
 * variable seule ferait sortir le contenu d'un passeport à CHAQUE question posée, y compris
 * depuis claude.ai par le serveur MCP, qui s'authentifie par jeton et non par la session de
 * Marc. La demande seule serait à la main de l'appelant, donc d'un modèle. Il faut les deux,
 * exactement comme pour N2.
 */
export function n3Autorise(env: Record<string, string | undefined> = process.env): boolean {
  return env.MEMORYAI_N3_CHAT?.trim() === "1";
}

/**
 * Les SEULS lecteurs à qui le niveau 3 peut sortir (ADR 0011). Le chat du propriétaire, et
 * rien d'autre.
 *
 * ⚠️ UNE LISTE BLANCHE, PAS UNE EXCLUSION DU MCP. Jusqu'au 24/09, le connecteur servait le
 * passeport de Marc à tout client muni d'un jeton OAuth, dès qu'un MODÈLE demandait
 * `inclure_n3` : le « second verrou » de l'ADR 0007 était, côté MCP, à la main de l'appelant.
 * Écrire « sauf claude-ai » laisserait ouvert le prochain lecteur ajouté ; écrire « seulement
 * chat » le laisse fermé tant que quelqu'un ne l'a pas décidé.
 */
export const LECTEURS_N3: ReadonlySet<string> = new Set(["chat"]);

export function lecteurPeutN3(lecteur: string): boolean {
  return LECTEURS_N3.has(lecteur);
}

/**
 * Le niveau maximal que cette politique laisse sortir.
 *
 * ⚠️ MONOTONE, et il faut que ça le reste : demander N3 sert AUSSI N2. L'écrire autrement —
 * un plafond qui retombe à 1 parce que `MEMORYAI_N2_CHAT` manque alors que N3 est autorisé —
 * ferait sortir MOINS pour une demande PLUS large, ce qui ne se remarquerait sur aucun écran.
 * C'est le même piège que l'ordre des branches de `sortDeLaPiece`.
 *
 * ⚠️ Et « 3 » ne veut pas dire la même chose des deux côtés : un FAIT de niveau 3 n'a jamais
 * de contenu (`validerFait` le refuse, la base aussi), donc ce plafond ne lui ajoute rien —
 * il sortait déjà. Ce qu'il ouvre, ce sont les colonnes chiffrées d'une PIÈCE.
 */
export function niveauMaxServi(p: PolitiqueLecture): 1 | 2 | 3 {
  if (p.inclureN3 && p.n3Autorise) return 3;
  return p.inclureN2 && p.n2Autorise ? 2 : 1;
}

/**
 * true si ce fait a le droit de sortir sous cette politique. PURE.
 *
 * ⚠️ `predicatsRetenus` est REQUIS, et ce n'est pas une préférence de style. C'est l'ensemble
 * des prédicats que la quarantaine RETIENT (ADR 0004 §2.3) : `en_quarantaine` parce que
 * personne n'a encore dit oui, `refuse` parce que Marc a dit non. Le rendre optionnel
 * donnerait à un appelant distrait le défaut « rien n'est retenu », c'est-à-dire exactement
 * le côté DANGEREUX — un prédicat neuf servi à un modèle avec l'autorité de la mémoire de
 * Marc. Ici le défaut sûr n'existe pas, donc il n'y a pas de défaut : le compilateur énumère
 * les consommateurs, et c'est le but.
 */
export function estServable(
  f: FaitAvecProvenance["fait"],
  p: PolitiqueLecture,
  predicatsRetenus: ReadonlySet<string>,
): boolean {
  if (f.supprimeLe) return false;
  // ⚠️ MIGRÉ n'est pas OUBLIÉ. Un fait `document.existe` devenu une PIÈCE (ADR 0004 §6.2)
  // cesse d'être servi — sinon le papier sortirait DEUX fois, une par table, et un modèle
  // croirait à deux sources qui se confirment. Il n'est pas effacé pour autant : la
  // migration se défait, l'oubli non.
  if (f.migreEnPiece) return false;
  if (f.canari) return false;
  if (predicatsRetenus.has(f.predicat)) return false;
  if (f.statut === "valide") {
    /* ok */
  } else if (f.statut === "propose") {
    if (!p.inclureProposes) return false;
  } else {
    return false;
  }
  // N3 n'a pas de contenu : il sort toujours. N2 passe par la bascule.
  if (f.niveau === 2 && niveauMaxServi(p) < 2) return false;
  return true;
}

export function lienDrive(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/** Déchiffre et met en forme UN fait. Lève `DechiffrementError` si la valeur est altérée. */
export function rendreLisible(r: FaitAvecProvenance, cle: Cle): FaitLisible {
  const f = r.fait;
  const valeur = f.valeur === null ? "" : f.niveau >= 1 ? dechiffrer(cle, f.valeur, f.id, f.niveau) : f.valeur;
  let attributs: Attributs | null = null;
  if (f.attributs) {
    const brut = f.niveau >= 1 ? dechiffrer(cle, f.attributs, f.id + "#attributs", f.niveau) : f.attributs;
    attributs = JSON.parse(brut) as Attributs;
  }
  const def = definition(f.predicat, f.versionVocabulaire);
  return {
    id: f.id,
    predicat: f.predicat,
    domaine: f.predicat.split(".")[0] ?? "",
    description: def?.description ?? "",
    valeur,
    valeurType: f.valeurType,
    lien: f.valeurType === "ref_document" && valeur ? lienDrive(valeur) : null,
    attributs,
    niveau: f.niveau,
    statut: f.statut,
    fiabiliteSource: f.fiabiliteSource,
    confiance: f.confiance,
    valideDe: f.valideDe,
    valideA: f.valideA,
    creeLe: f.creeLe.toISOString(),
    provenance: r.provenance
      ? {
          sourceType: r.provenance.sourceType,
          sourceRef: r.provenance.sourceRef,
          extracteur: r.provenance.extracteur,
          dateSource: r.provenance.dateSource,
        }
      : null,
  };
}

/**
 * Filtre puis déchiffre. Un fait illisible (clé tournée, ligne altérée) est COMPTÉ et
 * écarté, jamais rendu vide : un « » à la place d'une valeur serait une donnée inventée.
 */
export function rendreServables(
  rows: readonly FaitAvecProvenance[],
  p: PolitiqueLecture,
  cle: Cle,
  predicatsRetenus: ReadonlySet<string>,
): { faits: FaitLisible[]; illisibles: number; retenus: number } {
  const faits: FaitLisible[] = [];
  let illisibles = 0;
  let retenus = 0;
  for (const r of rows) {
    // Compté à part : « aucun fait » et « des faits, mais leur prédicat attend » ne disent
    // pas la même chose, et seul le second désigne un geste (aller les accepter).
    if (predicatsRetenus.has(r.fait.predicat)) { retenus++; continue; }
    if (!estServable(r.fait, p, predicatsRetenus)) continue;
    try {
      faits.push(rendreLisible(r, cle));
    } catch (err) {
      if (err instanceof DechiffrementError) illisibles++;
      else throw err;
    }
  }
  return { faits, illisibles, retenus };
}

// ── Recherche ──────────────────────────────────────────────────────────────────────────

/** Minuscules, sans accents ni ponctuation : « Québec » et « quebec » se retrouvent. */
export function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MOTS_VIDES = new Set([
  "les", "des", "une", "mon", "mes", "est", "sont", "pour", "avec", "dans", "sur", "que", "qui", "quoi",
  "quand", "the", "and", "what", "when", "where", "est-ce", "quel", "quelle", "quels", "quelles",
]);

export function termesDe(question: string): string[] {
  return [...new Set(normaliser(question).split(" ").filter((t) => t.length >= 3 && !MOTS_VIDES.has(t)))];
}

/** Score d'un fait pour une question : nombre de termes retrouvés dans ce qu'il dit de lui. */
export function scorer(f: FaitLisible, termes: readonly string[]): number {
  if (termes.length === 0) return 0;
  const corpus = normaliser(
    [
      f.predicat.replace(/[._]/g, " "),
      f.domaine,
      f.description,
      f.valeur,
      f.valideDe ?? "",
      f.valideA ?? "",
      ...Object.values(f.attributs ?? {}),
    ].join(" "),
  );
  const mots = new Set(corpus.split(" "));
  let score = 0;
  for (const t of termes) {
    if (mots.has(t)) score += 2;
    else if (corpus.includes(t)) score += 1;
  }
  return score;
}

export function chercherParmi(faits: readonly FaitLisible[], question: string, limite = 20): FaitLisible[] {
  const termes = termesDe(question);
  return faits
    .map((f) => ({ f, s: scorer(f, termes) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.f.statut === "valide" ? -1 : 1))
    .slice(0, limite)
    .map((x) => x.f);
}
