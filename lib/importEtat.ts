// lib/importEtat.ts — [L38] où en est la lecture des documents, en chiffres honnêtes.
//
// Marc, 18/09 : « je veux des graphs voir ce qui reste ce qui a été traité depuis combien de
// temps etc combien de liens fais etc ».
//
// MODULE PUR : il ne lit rien, il ne rend aucun JSX. On lui donne des comptes et il rend des
// grandeurs. C'est ce qui permet de perturber chaque décision sans monter React ni Postgres —
// et sur une page de tableau de bord, chaque chiffre est une affirmation.
//
// ── LES TROIS PIÈGES QUE CE MODULE EXISTE POUR ÉVITER ────────────────────────────────────
//
// ⚠️⚠️ 1. DEUX RYTHMES DIFFÉRENTS RÉPONDENT À DEUX QUESTIONS DIFFÉRENTES, et prendre le mauvais
// fabrique une estimation confiante et fausse. Le rythme « total lu ÷ jours écoulés depuis le
// début » lisse les jours d'arrêt : un import qui a lu 83 documents en une seule journée il y a
// trois semaines annoncerait « 4 par jour », donc « il reste 660 jours », alors qu'il ne tourne
// PLUS DU TOUT. Le rythme qui prédit quelque chose est celui des jours ACTIFS — « quand ça
// tourne, ça lit X par jour » —, et la question « est-ce que ça tourne ? » se répond à part,
// par `joursDepuisDernier`. Les mélanger, c'est répondre à une question avec la réponse d'une
// autre.
//
// ⚠️ 2. UN RYTHME NUL NE DONNE PAS UNE ESTIMATION INFINIE, il ne donne AUCUNE estimation.
// `restants / 0` vaut `Infinity`, et `Infinity.toFixed(0)` s'affiche « Infinity » — un mot à la
// place d'un nombre. `null` dit « on ne sait pas », ce qui est la vérité.
//
// ⚠️ 3. UN POURCENTAGE SUR UN TOTAL NUL N'EST PAS « 0 % », c'est « rien à mesurer ». Diviser
// rendrait `NaN`, et un « NaN % » à l'écran est pire qu'une absence : il a l'air d'un chiffre.

/** Ce qu'on sait du jour où des papiers ont été lus. Une entrée par jour NON VIDE. */
export interface JourLu {
  /** `AAAA-MM-JJ`, à l'heure du Québec — le jour de Marc, comme partout ailleurs. */
  jour: string;
  nombre: number;
}

export interface EtatImport {
  lus: number;
  restants: number;
  total: number;
  /** `null` quand il n'y a rien à mesurer — jamais `0` ni `NaN`. */
  partLuePourCent: number | null;
  /** Le premier et le dernier jour où quelque chose a été lu. `null` si jamais rien. */
  premierJour: string | null;
  dernierJour: string | null;
  /**
   * ⚠️ LE CHIFFRE LE PLUS UTILE DE CETTE PAGE, et ce n'est pas l'estimation : il dit si
   * l'import TOURNE. Un import arrêté depuis trois semaines et un import qui avance ont la
   * même barre de progression — c'est celui-là qui les distingue. `null` si rien n'a jamais
   * été lu : « arrêté depuis 0 jour » serait faux, et « depuis toujours » ne se calcule pas.
   */
  joursDepuisDernier: number | null;
  /** Le nombre de jours où quelque chose a VRAIMENT été lu. C'est la base du rythme. */
  joursActifs: number;
  /**
   * « Quand ça tourne, ça lit X par jour. » Mesuré sur les jours ACTIFS seulement — voir le
   * piège n° 1. `null` si aucun jour actif.
   */
  rythmeParJourActif: number | null;
  /**
   * Combien de jours ACTIFS il faudrait encore. ⚠️ Des jours ACTIFS, pas des jours de
   * calendrier : dire « il reste 12 jours » laisserait croire que ça se fera tout seul en
   * douze nuits, alors que ça dépend du nombre de fois où l'import tournera. `null` quand il
   * n'y a pas de rythme, ou quand il ne reste rien.
   */
  joursActifsRestants: number | null;
}

/** Combien de jours séparent deux jours `AAAA-MM-JJ`. Entier, jamais négatif. */
function ecartEnJours(de: string, a: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  // ⚠️ Une date illisible donne `NaN`, et `NaN` propagé dans un affichage devient « NaN jours ».
  // On rend 0 plutôt que de propager — et l'appelant ne voit jamais de `NaN`.
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function etatImport(params: {
  lus: number;
  restants: number;
  /** Les jours NON VIDES, dans n'importe quel ordre : la fonction trie. */
  joursLus: readonly JourLu[];
  /** Aujourd'hui, `AAAA-MM-JJ`. Passé en ARGUMENT : une fonction qui lit l'horloge n'est pas
   *  testable, et un test qui fige une date pendant que le code lit l'heure est une bombe. */
  aujourdhui: string;
}): EtatImport {
  const { lus, restants, aujourdhui } = params;
  const total = lus + restants;

  // On ne garde que les jours qui portent vraiment quelque chose : un jour à zéro n'est pas un
  // jour actif, et le compter diviserait le rythme par des jours où rien n'a eu lieu.
  const jours = [...params.joursLus].filter((j) => j.nombre > 0).sort((a, b) => a.jour.localeCompare(b.jour));
  const joursActifs = jours.length;
  const premierJour = jours[0]?.jour ?? null;
  const dernierJour = jours[joursActifs - 1]?.jour ?? null;

  // ⚠️ Le rythme se mesure sur ce que les jours actifs ont VRAIMENT produit, pas sur `lus` :
  // les deux diffèrent dès qu'un papier a été lu avant que cette série ne commence (une
  // migration, une reprise de base). Utiliser `lus` gonflerait le rythme en silence.
  const luSurLaPeriode = jours.reduce((n, j) => n + j.nombre, 0);
  const rythmeParJourActif = joursActifs > 0 ? luSurLaPeriode / joursActifs : null;

  return {
    lus,
    restants,
    total,
    partLuePourCent: total > 0 ? (lus / total) * 100 : null,
    premierJour,
    dernierJour,
    joursDepuisDernier: dernierJour === null ? null : ecartEnJours(dernierJour, aujourdhui),
    joursActifs,
    rythmeParJourActif,
    joursActifsRestants:
      // Trois `null` distincts, et chacun dit autre chose : pas de rythme, rien à faire, ou un
      // rythme nul. Les aplatir en `0` dirait « c'est fini » dans les trois cas.
      restants <= 0 || rythmeParJourActif === null || rythmeParJourActif <= 0
        ? null
        : Math.ceil(restants / rythmeParJourActif),
  };
}
