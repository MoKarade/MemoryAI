// lib/faitPhrase.ts — [L33a] comment un fait se LIT, avant de savoir comment il est rangé.
//
// Marc, le 18/09 : « va falloir full retravailler comment ça affiche les faits et ce qu'on
// en fait ». Mesuré avant d'écrire : le libellé HUMAIN existait déjà — le vocabulaire porte
// `d("vehicule.bail.fin", …, "Fin du bail")`, et `rendreLisible` le pose dans
// `FaitLisible.description`. `CarteFait` l'affichait en `hint` SOUS la valeur, pendant que le
// nom machine (`vehicule.bail.fin`) occupait l'en-tête. Le travail est donc une INVERSION,
// pas une table de phrases à écrire : une table par prédicat pourrirait au premier ajout au
// vocabulaire, et diverge en silence de la description qui, elle, est la source unique.
//
// ⚠️ MODULE PUR, et c'est la moitié qui compte : il ne rend aucun JSX, donc chaque décision
// se perturbe et se teste sans monter React. Et il rend des DONNÉES (`{ titre, sousTitre }`),
// jamais une chaîne déjà composée — une valeur interpolée dans une phrase n'est plus un nœud,
// donc plus masquable le jour où cette app aura un mode discret (leçon FinanceAI
// `UN-MONTANT-INTERPOLE-DANS-UNE-CHAINE-N-EST-PLUS-UN-NOEUD`).

import type { TYPES_LIEN } from "./db/schema";
import type { FaitLisible } from "./lecture";

/** Les préfixes de `provenances.source_ref` réellement écrits par les producteurs. */
const PREFIXES = { drive: "drive", conversation: "conv" } as const;

export type GenreSource = "drive" | "conversation" | "inconnu";

export interface SourceDuFait {
  genre: GenreSource;
  /** L'identifiant NU, préfixe retiré. */
  ref: string;
  /** Un lien, SEULEMENT quand la référence dit d'elle-même qu'elle en a un. */
  lien: string | null;
}

/**
 * De quel document — ou de quelle conversation — ce fait a été tiré.
 *
 * ⚠️ `source_ref` est un champ LIBRE au contrat (`z.string().min(1).max(256)`), et les valeurs
 * réelles sont de DEUX formes : préfixée (`drive|<fileId>`, `conv|<id>`) et NUE (les fixtures
 * de la migration de l'inventaire portent un fileId sans préfixe). On ne fabrique donc un
 * lien Drive que sur le préfixe EXPLICITE : composer `drive.google.com/file/d/<n'importe
 * quoi>` à partir d'une référence nue rendrait un lien crédible qui tombe en 404, et un lien
 * faux est pire qu'un identifiant honnête. Le lien FIABLE d'un papier reste `FaitLisible.lien`,
 * dérivé de sa propre valeur.
 */
export function sourceDuFait(sourceRef: string | null | undefined): SourceDuFait | null {
  const brut = (sourceRef ?? "").trim();
  if (!brut) return null;
  const coupe = brut.indexOf("|");
  if (coupe <= 0) return { genre: "inconnu", ref: brut, lien: null };
  const prefixe = brut.slice(0, coupe);
  const ref = brut.slice(coupe + 1).trim();
  if (!ref) return { genre: "inconnu", ref: brut, lien: null };
  if (prefixe === PREFIXES.drive) {
    return { genre: "drive", ref, lien: `https://drive.google.com/file/d/${encodeURIComponent(ref)}/view` };
  }
  if (prefixe === PREFIXES.conversation) return { genre: "conversation", ref, lien: null };
  return { genre: "inconnu", ref: brut, lien: null };
}

export interface TitreFait {
  /** Ce qui s'affiche en gros. Jamais un identifiant technique. */
  titre: string;
  /** Ce qui le qualifie, quand la donnée le porte. `null` plutôt qu'une phrase inventée. */
  sousTitre: string | null;
  /** Vrai si le titre est une DATE, pour que le rendu l'enveloppe dans un `<time>`. */
  estDate: boolean;
}

/**
 * Le titre d'un fait.
 *
 * ⚠️ Le cas qui a motivé ce module : un fait `ref_document` a pour VALEUR un fileId Drive
 * opaque (`1x_FICTIFexemple000000000000000zz`), et son libellé humain vit dans
 * `attributs.type`. Ils sont **2 729 sur ~2 828**, donc c'est le cas MAJORITAIRE de cette
 * mémoire qui s'affichait comme un identifiant. Mesuré sur les données réelles de Marc :
 * `attributs` porte `type`, `emetteur` et `annee` — la fiche avait déjà tout ce qu'il lui
 * fallait, elle n'en affichait rien.
 */
export function titreDuFait(f: FaitLisible): TitreFait {
  if (f.valeurType === "ref_document") {
    const a = f.attributs ?? {};
    const type = texte(a["type"]);
    const emetteur = texte(a["emetteur"]);
    const annee = texte(a["annee"]);
    const qualifiants = [emetteur, annee].filter(Boolean);
    return {
      // « Document » est un repli HONNÊTE : il dit « on ne sait pas de quel type », là où le
      // fileId prétendait être un titre.
      titre: type || "Document",
      sousTitre: qualifiants.length > 0 ? qualifiants.join(" · ") : null,
      estDate: false,
    };
  }
  return { titre: f.valeur, sousTitre: null, estDate: f.valeurType === "date" };
}

/**
 * Ce que ce fait DIT, en français — la description du vocabulaire.
 *
 * ⚠️ Repli sur le prédicat quand le vocabulaire n'a pas de description : c'est le cas des
 * prédicats en QUARANTAINE, qui existent par construction. Inventer une phrase à partir du
 * nom (`emploi.employeur` → « Ton employeur ») marcherait sur les exemples et mentirait sur
 * le reste — un prédicat n'est pas une phrase, et le nom ne dit pas la personne.
 */
export function libelleDuFait(f: FaitLisible): { libelle: string; estDuVocabulaire: boolean } {
  const d = f.description.trim();
  return d ? { libelle: d, estDuVocabulaire: true } : { libelle: f.predicat, estDuVocabulaire: false };
}

/**
 * Ce que chaque type de lien VEUT DIRE. [L33a].
 *
 * ⚠️ Dérivé de `TYPES_LIEN` par un `Record` EXHAUSTIF : `tsc` exige une entrée par type, donc
 * une règle de liaison ajoutée à l'avenir casse le typecheck au lieu d'afficher son nom
 * machine à Marc. C'est la même raison qui a fait retirer les noms machine de la carte : y
 * remettre `meme-domaine-meme-entite` par un repli silencieux annulerait le lot.
 *
 * ⚠️ Ces libellés ne REMPLACENT pas le `pourquoi` du lien, qui est écrit en clair par la
 * règle et dit le cas particulier. Le libellé nomme la FAMILLE, le `pourquoi` dit l'instance.
 */
export const LIBELLES_LIEN: Record<(typeof TYPES_LIEN)[number], string> = {
  "meme-document": "vient du même document",
  "meme-periode": "porte sur la même période",
  remplacement: "remplace ou est remplacé",
  "meme-domaine-meme-entite": "parle de la même chose",
  "cause-declaree": "cause déclarée",
  "meme-source": "tiré de la même source",
  "meme-valeur": "nomme la même chose",
  "meme-emetteur": "vient du même émetteur",
  "dates-proches": "daté à quelques jours près",
  "sens-proche": "a un sens proche (deviné)",
  "lie-par-lia": "rapproché par LIA quand Marc l'a dit (deviné)",
};

/**
 * L'AUTRE extrémité d'un lien, vue depuis un fait — et si c'en est bien un FAIT. [L33a].
 *
 * ⚠️ Cette décision vivait dans le JSX de la fiche, donc elle était intestable autrement
 * qu'en montant React. Elle est PURE : elle mérite d'être ici.
 *
 * ⚠️ Pourquoi `estUnFait` existe : `liens.fait_a` porte une clé étrangère vers `faits`,
 * `liens.fait_b` **n'en porte aucune** — c'est ce qui permet à B de désigner une QUESTION
 * (`cible_b`). Conséquence mesurée (l'insertion ÉCHOUE autrement, vérifié en base) : un
 * identifiant de question ne peut être qu'en B, jamais en A. Donc quand on regarde depuis
 * un fait qui est en B, l'autre bout est forcément un fait ; et quand il est en A, l'autre
 * bout n'est un fait que si `cible_b` le dit. Rendre un lien vers `/fait/<id de question>`
 * ferait un 404 sur une page qui prétend montrer un rattachement.
 */
export function autreExtremite(
  l: { faitA: string; faitB: string; cibleB: string },
  faitId: string,
): { autre: string; estUnFait: boolean } {
  if (l.faitA === faitId) return { autre: l.faitB, estUnFait: l.cibleB === "fait" };
  return { autre: l.faitA, estUnFait: true };
}

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
