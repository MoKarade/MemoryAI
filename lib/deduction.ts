// lib/deduction.ts — des faits DÉDUITS par une règle (ADR 0023). PURE : aucune base, aucun
// réseau, aucune horloge ; on lui donne des papiers déjà lus et le jour, il rend ce qui se déduit.
//
// ⚠️ UNE RÈGLE, PAS UN MODÈLE. L'âge se CALCULE depuis une date de naissance : aucun appel, aucun
// coût, et le même jour donne toujours le même résultat. La liste des règles est FERMÉE (ADR 0023
// §1) : en ajouter une est une décision écrite dans l'ADR.
//
// ⚠️ LA DATE DE NAISSANCE VIENT DES PAPIERS DE MARC, et seulement des siens. Un passeport d'un
// proche porte aussi une date de naissance : un papier sans titulaire, ou au nom de quelqu'un
// d'autre, ne compte pas. Deux papiers de Marc qui se CONTREDISENT ne donnent rien : on ne choisit
// pas une date au hasard, on s'abstient et on le dit.

/** L'extracteur des faits déduits : il dit à tout lecteur qu'aucun modèle ne les a touchés. */
export const EXTRACTEUR_DEDUCTION = "deduction-v1";
/** La clé que DriveAI pose dans les champs libres d'un papier (`Piece.gs`, au format AAAA-MM-JJ). */
const CLES_NAISSANCE = new Set(["date de naissance", "date_de_naissance", "date naissance", "naissance"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Ce qu'il faut d'un papier déjà déchiffré pour y lire une date de naissance. */
export interface PapierPourDeduction {
  id: string;
  /** Un exemplaire Drive : c'est la source du fait déduit, comme pour tout fait tiré d'un papier. */
  fileId: string | null;
  titulaire: string | null;
  champsLibres: Record<string, string> | null;
}

export type Naissance =
  | { ok: true; date: string; papiers: { id: string; fileId: string }[] }
  | { ok: false; motif: "aucun-papier" | "contradiction"; dates: number };

/** Normalisation d'un nom ou d'une clé : casse, accents, espaces. Jamais affichée. */
function normaliser(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Une date de naissance plausible (AAAA-MM-JJ réelle, entre 1900 et `jour`), ou `null`. */
export function dateNaissanceDe(champs: Record<string, string> | null, jour: string): string | null {
  if (!champs) return null;
  for (const [k, v] of Object.entries(champs)) {
    if (!CLES_NAISSANCE.has(normaliser(k))) continue;
    const d = String(v).trim();
    if (!ISO.test(d) || new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) !== d) continue;
    if (d < "1900-01-01" || d > jour) continue;
    return d;
  }
  return null;
}

/**
 * La clé d'un NOM : ses mots normalisés, triés. « RICHARD, Marc » et « Marc Richard » sont le
 * même titulaire ; un passeport écrit le nom de famille d'abord, Messenger le prénom.
 */
export function cleNom(v: string): string {
  return normaliser(v)
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 0)
    .sort()
    .join(" ");
}

/**
 * La date de naissance de Marc, d'après SES papiers. `nomsDeMarc` sont ses noms connus : un
 * papier compte seulement si son titulaire en est un, à l'ordre des mots près.
 */
export function naissanceDeMarc(papiers: readonly PapierPourDeduction[], nomsDeMarc: readonly string[], jour: string): Naissance {
  const noms = new Set(nomsDeMarc.map(cleNom).filter((n) => n.length > 0));
  const parDate = new Map<string, { id: string; fileId: string }[]>();
  for (const p of papiers) {
    if (!p.titulaire || !p.fileId || !noms.has(cleNom(p.titulaire))) continue;
    const d = dateNaissanceDe(p.champsLibres, jour);
    if (!d) continue;
    const liste = parDate.get(d) ?? [];
    liste.push({ id: p.id, fileId: p.fileId });
    parDate.set(d, liste);
  }
  if (parDate.size === 0) return { ok: false, motif: "aucun-papier", dates: 0 };
  if (parDate.size > 1) return { ok: false, motif: "contradiction", dates: parDate.size };
  const [date, liste] = [...parDate.entries()][0] as [string, { id: string; fileId: string }[]];
  return { ok: true, date, papiers: [...liste].sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

/** L'âge révolu au `jour` donné : il change le jour anniversaire, pas avant. Un 29 février compte le 1er mars. */
export function age(naissance: string, jour: string): number {
  const [an, mn, jn] = naissance.split("-").map(Number) as [number, number, number];
  const [a, m, j] = jour.split("-").map(Number) as [number, number, number];
  const passe = m > mn || (m === mn && j >= jn);
  return a - an - (passe ? 0 : 1);
}

/** L'anniversaire d'une année donnée. `Date.UTC` reporte un 29 février au 1er mars hors année bissextile. */
function anniversaireEn(naissance: string, annee: number): string {
  const [, mn, jn] = naissance.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(annee, mn - 1, jn)).toISOString().slice(0, 10);
}

/** Le prochain anniversaire, `jour` exclu (AAAA-MM-JJ). Un 29 février tombe le 1er mars hors année bissextile. */
export function prochainAnniversaire(naissance: string, jour: string): string {
  const annee = Number(jour.slice(0, 4));
  const cette = anniversaireEn(naissance, annee);
  return cette > jour ? cette : anniversaireEn(naissance, annee + 1);
}

/**
 * La période où l'âge du `jour` est vrai : du dernier anniversaire à la veille du prochain. Elle
 * dit au lecteur « 36 ans » JUSQU'À QUAND, sans qu'il refasse le calcul.
 */
export function periodeAge(naissance: string, jour: string): { de: string; a: string } {
  const annee = Number(jour.slice(0, 4));
  const cette = anniversaireEn(naissance, annee);
  const de = cette <= jour ? cette : anniversaireEn(naissance, annee - 1);
  const prochain = prochainAnniversaire(naissance, jour);
  const veille = new Date(Date.parse(`${prochain}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { de, a: veille };
}
