// lib/coutChat.ts — ce que le chat coûte, et le plafond qui ne se désactive pas (ADR 0001 §5.5).
//
// Fonctions PURES : les prix, le coût d'un appel, la décision « ce jour a-t-il encore du
// budget ». La lecture et l'écriture du compteur vivent dans `lib/depotChat.ts`.
//
// ⚠️ Le plafond est DUR et n'a pas de variable pour l'éteindre : c'est la décision de Marc
// (Q15). Un appel est compté AVANT toute validation de la réponse — il est facturé même si
// le modèle rend quelque chose d'inutilisable (leçon JobAI).
//
// ⚠️ DEUX POSTES DEPUIS LE 16/09, et c'est ce qui rend l'apprentissage automatique tenable.
// Le chat et l'apprentissage ne se disputent plus un pot commun : chacun a SON plafond, donc
// une grosse passe d'extraction ne peut plus couper le chat de Marc pour la journée, et un
// emballement se voit sur SA ligne au lieu de se diluer. C'est le patron des budgets de
// DriveAI — nommer et borner chaque poste plutôt qu'un total que personne ne sait imputer.
// Le TOTAL (3 $/jour) est une décision de dépense de Marc, du 16/09 ; la répartition est
// technique et se réalloue, mais `tests/coutChat.test.ts` exige que la somme reste le total.
//
// ⚠️ Un champ d'usage absent vaut 0, jamais `undefined` : un seul `NaN` empoisonnerait tout
// le cumul (leçon DriveAI). Un relevé illisible est COMPTÉ comme tel, pas rabattu sur zéro.

import { FUSEAU } from "./fuseau";

/**
 * Les postes de dépense. Liste FERMÉE : un appel doit dire lequel il consomme, et le
 * compilateur le demande à chaque site (il n'y a pas de défaut — un défaut ferait tomber
 * l'apprentissage dans le budget du chat sans que personne ne le voie).
 */
export const POSTES = ["chat", "apprentissage"] as const;
export type Poste = (typeof POSTES)[number];

/**
 * Le plafond de CHAQUE poste PAR DÉFAUT, en USD par jour (à l'heure du Québec) — la
 * décision de Marc du 16/09, préservée telle quelle.
 *
 * ⚠⚠ DÉFAUT, et plus valeur unique, depuis le 18/09 : Marc règle les plafonds dans l'app
 * (table `plafonds`). Ce qui reste de l'ADR 0001 §5.5 (« plafond dur, non désactivable ») :
 * l'ABSENCE de réglage vaut ces valeurs, jamais « illimité ». Un plafond existe toujours.
 */
export const PLAFONDS_DEFAUT_USD_PAR_JOUR: Record<Poste, number> = {
  chat: 1,
  apprentissage: 2,
};

/**
 * Le maximum qu'un poste peut atteindre, quoi que Marc entre dans l'app. C'est LUI qui rend
 * la règle « non désactivable » encore vraie : un plafond réglable sans borne serait un
 * plafond absent d'un caractère. Écrit dans le code **et** dans la base
 * (`plafonds_borne`), parce que l'app n'est pas le seul chemin d'écriture possible.
 *
 * ⚠️ Le relever est une décision de dépense, comme l'était le total : ça se change ICI, en
 * connaissance de cause, pas dans un formulaire.
 */
export const PLAFOND_MAX_USD_PAR_JOUR = 50;

/** Le plancher : « 0 $ » est une PAUSE (le plafond au maximum de son effet), pas un arrêt. */
export const PLAFOND_MIN_USD_PAR_JOUR = 0;

/** Un réglage entré par Marc, ramené dans les bornes. Une valeur illisible vaut le DÉFAUT. */
export function plafondValide(brut: unknown, poste: Poste): number {
  const n = typeof brut === "number" ? brut : Number(brut);
  // ⚠️ `Number.isFinite` et pas `!isNaN` : `Infinity` passerait le second, et un plafond
  // infini est exactement le plafond désactivé que l'ADR interdit.
  if (!Number.isFinite(n)) return PLAFONDS_DEFAUT_USD_PAR_JOUR[poste];
  return Math.min(PLAFOND_MAX_USD_PAR_JOUR, Math.max(PLAFOND_MIN_USD_PAR_JOUR, n));
}

/**
 * Le total que Marc a décidé le 16/09 (« tout à 3 $ »). Ce n'est pas la somme calculée : c'est
 * la BORNE, et le test exige que la somme des postes lui soit EXACTEMENT égale. Réallouer entre
 * postes est technique ; relever ce nombre est une décision de dépense.
 */
export const PLAFOND_TOTAL_USD_PAR_JOUR = 3;

/**
 * Les trois modèles du sélecteur (Q13), en génération 5.5. Pas de Fable 5.1 : rétention de 30 jours (Q5).
 * Prix en dollars par million de jetons, relus sur la page officielle des tarifs le 28/10/2026
 * (platform.claude.com/docs/en/about-claude/pricing). `lecture` : lecture de cache, multiple du prix
 * d'entrée (0,10 $ chez Sonnet 5.5 et 0,20 $ chez Opus 5.5, soit ×0,05 ; 0,01 $ chez Haiku 5.5, soit ×0,10).
 * Haiku 5.5 : grille des prompts de 100 000 jetons ou moins (au-delà 0,50 $ / 2,50 $, aucun appel n'en approche).
 * Les anciens modèles n'y sont plus : chaque ligne de dépense passée porte déjà son coût en dollars.
 */
export const MODELES = [
  { id: "claude-haiku-5-5", nom: "Haiku 5.5", entree: 0.1, sortie: 0.5, lecture: 0.1 },
  { id: "claude-sonnet-5-5", nom: "Sonnet 5.5", entree: 2, sortie: 10, lecture: 0.05 },
  { id: "claude-opus-5-5", nom: "Opus 5.5", entree: 4, sortie: 20, lecture: 0.05 },
] as const;
export type IdModele = (typeof MODELES)[number]["id"];
export const MODELE_DEFAUT: IdModele = "claude-sonnet-5-5";

/** Écriture de cache ×1,25 du prix d'entrée — dérivé, jamais recopié (la lecture est dans `MODELES`). */
const FACTEUR_ECRITURE_CACHE = 1.25;

/**
 * Un poste de dépense reconnu. [L34] — le jumeau d'`estModele`, et pour la même raison : une
 * valeur qui vient d'un FORMULAIRE n'est pas typée, et un poste inconnu rabattu sur un défaut
 * ferait régler le mauvais budget sans que rien ne le dise.
 */
export function estPoste(v: unknown): v is Poste {
  return typeof v === "string" && (POSTES as readonly string[]).includes(v);
}

export function estModele(v: unknown): v is IdModele {
  return typeof v === "string" && MODELES.some((m) => m.id === v);
}

export interface UsageAppel {
  entree: number;
  sortie: number;
  ecritureCache: number;
  lectureCache: number;
}

function entier(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Normalise un `usage` du SDK : absent ⇒ 0. Rend aussi si le relevé était lisible. */
export function lireUsage(brut: unknown): { usage: UsageAppel; lisible: boolean } {
  const u = (brut ?? {}) as Record<string, unknown>;
  const lisible = typeof u.input_tokens === "number" && typeof u.output_tokens === "number";
  return {
    usage: {
      entree: entier(u.input_tokens),
      sortie: entier(u.output_tokens),
      ecritureCache: entier(u.cache_creation_input_tokens),
      lectureCache: entier(u.cache_read_input_tokens),
    },
    lisible,
  };
}

/** Coût USD d'un appel. PURE. */
export function coutUsd(modele: IdModele, u: UsageAppel): number {
  const m = MODELES.find((x) => x.id === modele)!;
  const parMtok =
    u.entree * m.entree +
    u.sortie * m.sortie +
    u.ecritureCache * m.entree * FACTEUR_ECRITURE_CACHE +
    u.lectureCache * m.entree * m.lecture;
  return parMtok / 1_000_000;
}

/** Le jour de Marc (Québec), pas celui du serveur : Vercel tourne en UTC. */
export function jourQuebec(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * Le budget de CE poste est-il encore ouvert ? PURE. Strictement : atteint = fermé.
 *
 * ⚠️ `depenseDuJourUsd` est la dépense DU POSTE, jamais le total : les passer l'un pour
 * l'autre fermerait le chat dès que l'apprentissage a travaillé, ce que la séparation en
 * postes existe précisément pour empêcher.
 */
/**
 * Ce jour a-t-il encore du budget pour ce poste ?
 *
 * ⚠⚠ LE PLAFOND EST UN ARGUMENT depuis le 18/09, et ce n'est pas du style : il était lu
 * dans une constante globale, donc un site d'appel pouvait l'oublier sans que rien ne le
 * dise. En paramètre REQUIS, `tsc` énumère les cinq sites — et un lot futur qui ajoute un
 * appel doit décider d'où vient le plafond au lieu d'hériter d'un défaut muet. C'est ce qui
 * garde « toujours consulté » vrai maintenant que la valeur vient de la base.
 */
export function budgetOuvert(depenseDuJourUsd: number, poste: Poste, plafonds: Record<Poste, number>): boolean {
  return depenseDuJourUsd < plafonds[poste];
}
