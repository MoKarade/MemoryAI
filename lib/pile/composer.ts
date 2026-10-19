// lib/pile/composer.ts — l'ORDRE de la pile « vrai / faux » (ADR 0012 §2). PUR : ni base, ni
// clé, ni horloge — la date du jour se passe en paramètre.
//
// Ce module décide QUELLE carte vient ensuite ; il ne sait rien de ce qu'elle contient. C'est
// ce qui le rend testable à l'exhaustive, et c'est aussi ce qui garantit qu'aucun contenu n'est
// déchiffré pour décider de l'ordre.

export type GenreCarte = "piece" | "fait" | "question";
export type Verdict = "vrai" | "faux" | "passe";

export const GENRES_CARTE = ["piece", "fait", "question"] as const satisfies readonly GenreCarte[];
export const VERDICTS = ["vrai", "faux", "passe"] as const satisfies readonly Verdict[];

/**
 * En dessous de cette certitude sur le titulaire, « ce papier est-il bien à toi ? » passe en
 * tête. Un titulaire mal attribué change la réponse à « quel est MON numéro de passeport ? »
 * (le 24/09, la mémoire portait aussi ceux de deux proches) : c'est l'erreur de lecture qui
 * coûte le plus, donc la première à faire juger.
 */
export const SEUIL_TITULAIRE_INCERTAIN = 0.8;
/** Une carte sur `PAS_INTERCALAGE` est une déduction ou une question, tant qu'il y en a. */
export const PAS_INTERCALAGE = 4;
/** Une échéance dans cette fenêtre fait monter le papier : c'est ce qui appellera un geste. */
const JOURS_ECHEANCE_PROCHE = 365;

export interface CandidatPiece {
  id: string;
  domaine: string | null;
  /** Présent ⇔ le papier NOMME quelqu'un. `null` = aucun titulaire lu, donc rien à confirmer. */
  titulaireConfiance: number | null;
  dateEcheance: string | null;
  creeLe: Date;
}

export interface CandidatSimple {
  id: string;
  creeLe: Date;
}

export interface AvisEnVigueur {
  genre: GenreCarte;
  refId: string;
  verdict: Verdict;
  avisLe: Date;
}

export interface CarteRef {
  genre: GenreCarte;
  id: string;
}

/** Le verdict EN VIGUEUR par carte : le plus récent (ADR 0012 §2.4 — la table est en ajout seul). */
export function avisEnVigueur(avis: readonly AvisEnVigueur[]): Map<string, AvisEnVigueur> {
  const m = new Map<string, AvisEnVigueur>();
  for (const a of avis) {
    const cle = `${a.genre}|${a.refId}`;
    const deja = m.get(cle);
    if (!deja || a.avisLe.getTime() >= deja.avisLe.getTime()) m.set(cle, a);
  }
  return m;
}

function jourPlus(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Le rang d'un papier : plus petit = plus tôt. Exporté pour être testé seul. */
export function rangPiece(p: CandidatPiece, aujourdhui: string): number {
  if (p.titulaireConfiance !== null && p.titulaireConfiance < SEUIL_TITULAIRE_INCERTAIN) return 0;
  const d = (p.domaine ?? "").trim();
  if (d.startsWith("04")) return 1;
  if (d.startsWith("01")) return 2;
  if (p.dateEcheance && p.dateEcheance >= aujourdhui && p.dateEcheance <= jourPlus(aujourdhui, JOURS_ECHEANCE_PROCHE)) return 3;
  return 4;
}

const plusRecentDabord = (a: { creeLe: Date }, b: { creeLe: Date }) => b.creeLe.getTime() - a.creeLe.getTime();

/**
 * La pile, dans l'ordre. Une carte déjà jugée (vrai ou faux) n'y est plus ; une carte PASSÉE
 * y est, en fin de pile, de la plus anciennement passée à la plus récente — sinon « Passer »
 * ramènerait la même carte au chargement suivant.
 */
export function composerPile(params: {
  pieces: readonly CandidatPiece[];
  faits: readonly CandidatSimple[];
  questions: readonly CandidatSimple[];
  avis: readonly AvisEnVigueur[];
  /** Le jour de Marc, `AAAA-MM-JJ` (fuseau de Québec). */
  aujourdhui: string;
}): CarteRef[] {
  const enVigueur = avisEnVigueur(params.avis);
  const passees: { ref: CarteRef; le: number }[] = [];

  const garder = (genre: GenreCarte, id: string): boolean => {
    const a = enVigueur.get(`${genre}|${id}`);
    if (!a) return true;
    if (a.verdict === "passe") passees.push({ ref: { genre, id }, le: a.avisLe.getTime() });
    return false;
  };

  const pieces = params.pieces
    .filter((p) => garder("piece", p.id))
    .map((p) => ({ p, rang: rangPiece(p, params.aujourdhui) }))
    .sort((x, y) => x.rang - y.rang || plusRecentDabord(x.p, y.p))
    .map(({ p }): CarteRef => ({ genre: "piece", id: p.id }));

  const aCote: CarteRef[] = [
    ...[...params.faits].filter((f) => garder("fait", f.id)).sort(plusRecentDabord).map((f): CarteRef => ({ genre: "fait", id: f.id })),
    ...[...params.questions].filter((q) => garder("question", q.id)).sort(plusRecentDabord).map((q): CarteRef => ({ genre: "question", id: q.id })),
  ];

  // ⚠️ L'INTERCALAGE SE COMPTE SUR CE QUI A ÉTÉ JUGÉ, PAS SUR LA POSITION. L'écran ne montre
  // que la carte du dessus et recompose la pile à chaque chargement : une règle « une carte
  // sur quatre » posée sur la position ne s'appliquait donc JAMAIS — juger la carte du dessus
  // la retire, et le papier suivant prend sa place (revue #73, sonde : 10 papiers jugés un à
  // un, la déduction arrivait en 11ᵉ). Le compteur part du nombre de papiers jugés (ou
  // passés) DEPUIS la dernière carte « à côté » jugée.
  const derniereACote = Math.max(
    0,
    ...params.avis.filter((a) => a.genre !== "piece").map((a) => a.avisLe.getTime()),
  );
  const papiersDepuis = params.avis.filter((a) => a.genre === "piece" && a.avisLe.getTime() > derniereACote).length;

  const pile: CarteRef[] = [];
  let sansACote = Math.min(papiersDepuis, PAS_INTERCALAGE - 1);
  let i = 0;
  let j = 0;
  while (i < pieces.length || j < aCote.length) {
    if (j < aCote.length && (sansACote >= PAS_INTERCALAGE - 1 || i >= pieces.length)) {
      pile.push(aCote[j++]!);
      sansACote = 0;
    } else {
      pile.push(pieces[i++]!);
      sansACote++;
    }
  }
  passees.sort((x, y) => x.le - y.le);
  return [...pile, ...passees.map((x) => x.ref)];
}

/** Combien il reste de cartes par famille (hors cartes passées, qui ne sont pas « à faire »). */
export function restantParGenre(pile: readonly CarteRef[], avis: readonly AvisEnVigueur[]): Record<GenreCarte, number> {
  const enVigueur = avisEnVigueur(avis);
  const r: Record<GenreCarte, number> = { piece: 0, fait: 0, question: 0 };
  for (const c of pile) if (enVigueur.get(`${c.genre}|${c.id}`)?.verdict !== "passe") r[c.genre]++;
  return r;
}
