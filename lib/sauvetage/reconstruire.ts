// lib/sauvetage/reconstruire.ts — d'une page relue au clair EXACT de chaque scellé `v1` (ADR 0019 §2).
//
// Une page affiche ; elle ne rend pas le texte scellé tel quel. Les attributs d'un fait sont
// scellés en `JSON.stringify(attributs)`, la page en montre des paires ; les champs d'un papier
// sont aplatis en « libelle : X · valeur : Y ». Ce module refait le texte EXACT qui avait été
// scellé, puis le confronte au scellé `v1` lui-même.
//
// ── LA PREUVE : LA TAILLE ────────────────────────────────────────────────────────────────
// AES-GCM ne change pas la longueur : le chiffré `v1` fait exactement autant d'octets que le clair
// qu'il cache (`longueurClaire`). Un clair relu qui n'a pas cette taille n'est PAS le bon — une
// troncature, un « — », un aplatissement mal défait —, et la ligne reste en `v1`, en échec.
// La preuve n'est pas parfaite (deux textes de même taille passeraient), mais elle s'ajoute à la
// lecture structurelle de la page : chaque clair vient d'un endroit précis, pas d'une devinette.
//
// ⚠️ TOUT OU RIEN, PAR LIGNE. Une ligne dont une seule colonne `v1` échoue n'est pas sauvée du
// tout : un fait dont la valeur est sauvée mais les attributs perdus serait une ligne à moitié
// vraie, et rien ne dirait laquelle. Elle se retente à la relance suivante.
//
// Module PUR : aucune clé, aucune base, aucun réseau.

import { estScelleAncien, longueurClaire } from "../chiffrement";
import { lienDrive } from "../lecture";
import type { ClairFait, ClairPiece } from "./extraire";

/** Pourquoi une ligne n'a pas pu être sauvée. Fermé : le bilan les compte par raison. */
export const RAISONS_ECHEC = [
  /** L'ancien déploiement n'a pas rendu la page de cette ligne (refus, erreur, autre page). */
  "page-absente",
  /** Le papier est N3 et l'ancien déploiement n'en montre que le sommaire. */
  "sommaire-n3",
  /** La page ne montre pas cette colonne (un fait sans champ « Corriger », un résumé caché). */
  "absent-de-la-page",
  /** Le clair relu n'a pas la taille du scellé : ce n'est pas le bon. */
  "taille-differente",
] as const;
export type RaisonEchec = (typeof RAISONS_ECHEC)[number];

export type Reconstruction<T> = { ok: true; clairs: T } | { ok: false; echecs: { colonne: string; raison: RaisonEchec }[] };

/** Le clair `candidat` est-il celui que cache `scelle` ? Seulement si la taille tombe juste. */
export function tailleJuste(scelle: string, candidat: string): boolean {
  const attendue = longueurClaire(scelle);
  return attendue !== null && attendue === Buffer.byteLength(candidat, "utf8");
}

/** Accumule les clairs vérifiés et les échecs d'une ligne. */
class Tri {
  readonly clairs: Record<string, string> = {};
  readonly echecs: { colonne: string; raison: RaisonEchec }[] = [];

  /**
   * Ne fait rien si `scelle` n'est pas `v1` : seule la clé perdue a besoin de l'ancien déploiement.
   *
   * ⚠️ Une page qui affiche le scellé LUI-MÊME n'a jamais su le lire (revue du 23/10) : l'écrivain
   * des papiers scelle les facettes et les chemins à TOUS les niveaux, et le lecteur prend ceux
   * d'un papier N0 pour du clair. Ces colonnes étaient déjà illisibles avant l'incident ; le
   * sauvetage ne peut pas les rendre, et ne fait pas échouer la ligne pour elles : elles restent
   * telles quelles, et le reste de la ligne est sauvé.
   */
  essayer(colonne: string, scelle: string | null, candidat: string | null | undefined): void {
    if (!estScelleAncien(scelle)) return;
    if (candidat === scelle) return;
    if (candidat === null || candidat === undefined) this.echecs.push({ colonne, raison: "absent-de-la-page" });
    else if (!tailleJuste(scelle as string, candidat)) this.echecs.push({ colonne, raison: "taille-differente" });
    else this.clairs[colonne] = candidat;
  }
}

/** Les colonnes `v1` d'une ligne, toutes en échec pour la même raison. */
function toutEchoue(colonnes: [string, string | null][], raison: RaisonEchec) {
  return colonnes.filter(([, v]) => estScelleAncien(v)).map(([colonne]) => ({ colonne, raison }));
}

// ── Faits ──────────────────────────────────────────────────────────────────────────────────

export interface FaitAncien {
  id: string;
  /** Un fait N0 est écrit en clair : un « v1: » y est du texte, pas un scellé. */
  niveau: number;
  valeurType: string;
  valeur: string | null;
  attributs: string | null;
}

/** Ce qui est sauvé d'un fait, par colonne `v1`. */
export interface ClairsFait {
  valeur?: string;
  attributs?: string;
}

/**
 * Les libellés FIXES de « D’où ça vient » qui n'ont pas de balise dans leur `<dd>` (les autres,
 * prédicat et référence de source, portent un `<code>` et ne sont pas lus). Tout le reste de la
 * liste, ce sont les attributs du fait, dans leur ordre.
 */
const RANGEMENT_FAIT = new Set(["protection", "valable", "extrait par"]);

export function reconstruireFait(ligne: FaitAncien, page: ClairFait | null): Reconstruction<ClairsFait> {
  // N0 : l'écrivain n'a rien scellé (`ecrireLot`), un « v1: » en tête est du texte.
  if (ligne.niveau < 1) return { ok: true, clairs: {} };
  const colonnes: [string, string | null][] = [
    ["valeur", ligne.valeur],
    ["attributs", ligne.attributs],
  ];
  if (!colonnes.some(([, v]) => estScelleAncien(v))) return { ok: true, clairs: {} };
  if (!page) return { ok: false, echecs: toutEchoue(colonnes, "page-absente") };

  const tri = new Tri();
  // Un `ref_document` n'a pas de champ « Corriger » : sa valeur est le fileId de son bouton.
  tri.essayer("valeur", ligne.valeur, ligne.valeurType === "ref_document" ? page.refDocument : page.valeur);
  const attributs = page.paires.filter(([k]) => !RANGEMENT_FAIT.has(k));
  tri.essayer("attributs", ligne.attributs, JSON.stringify(Object.fromEntries(attributs)));

  return tri.echecs.length > 0 ? { ok: false, echecs: tri.echecs } : { ok: true, clairs: tri.clairs };
}

// ── Papiers ────────────────────────────────────────────────────────────────────────────────

export interface PieceAncienne {
  id: string;
  /** Régime clair : le résumé est du texte, pas un scellé. */
  resumeEnClair: boolean;
  titulaireConfiance: number | null;
  type: string | null;
  emetteur: string | null;
  titulaire: string | null;
  resume: string | null;
  champsStructures: string | null;
  champsLibres: string | null;
  exemplaires: { fileId: string; chemin: string | null }[];
}

export interface ClairsPiece {
  type?: string;
  emetteur?: string;
  titulaire?: string;
  resume?: string;
  champsStructures?: string;
  champsLibres?: string;
  /** fileId → chemin, pour chaque exemplaire dont le chemin était `v1`. */
  chemins: Record<string, string>;
}

/**
 * Défait « libelle : A · valeur : B · libelle : C · valeur : D » (le `valeurLisible` de la page)
 * en entrées. `null` si le texte n'a pas cette forme, ou si une entrée est ambiguë.
 *
 * ⚠️ RISQUE RÉSIDUEL, DIT (revue du 23/10) : une valeur qui contiendrait « · libelle : X · valeur :
 * Y » se lirait comme DEUX entrées de même taille totale, et la taille ne le verrait pas. Aucun
 * extracteur n'écrit ce motif ; le cas est accepté et écrit dans l'ADR 0019.
 */
export function entreesStructurees(texte: string): { libelle: string; valeur: string }[] | null {
  if (texte === "") return [];
  const TETE = "libelle : ";
  if (!texte.startsWith(TETE)) return null;
  const out: { libelle: string; valeur: string }[] = [];
  const SEP = " · valeur : ";
  for (const morceau of texte.slice(TETE.length).split(` · ${TETE}`)) {
    const coupe = morceau.indexOf(SEP);
    if (coupe < 0) return null;
    const entree = { libelle: morceau.slice(0, coupe), valeur: morceau.slice(coupe + SEP.length) };
    // ⚠️ Un second « · valeur : » dans la même entrée rend la coupe AMBIGUË (le libellé ou la
    // valeur le contenait), et deux coupes donnent la même taille : la preuve ne verrait rien.
    // On refuse plutôt que de choisir (revue du 23/10).
    if (entree.valeur.includes(SEP)) return null;
    out.push(entree);
  }
  return out;
}

function champsStructuresJson(paires: [string, string][]): string | null {
  const familles: [string, { libelle: string; valeur: string }[]][] = [];
  for (const [famille, texte] of paires) {
    const entrees = entreesStructurees(texte);
    if (!entrees) return null;
    familles.push([famille, entrees]);
  }
  return JSON.stringify(Object.fromEntries(familles));
}

export function reconstruirePiece(ligne: PieceAncienne, page: ClairPiece | null): Reconstruction<ClairsPiece> {
  const colonnes: [string, string | null][] = [
    ["type", ligne.type],
    ["emetteur", ligne.emetteur],
    ["titulaire", ligne.titulaire],
    ["resume", ligne.resumeEnClair ? null : ligne.resume],
    ["champsStructures", ligne.champsStructures],
    ["champsLibres", ligne.champsLibres],
    ...ligne.exemplaires.map((x): [string, string | null] => [`chemin:${x.fileId}`, x.chemin]),
  ];
  if (!colonnes.some(([, v]) => estScelleAncien(v))) return { ok: true, clairs: { chemins: {} } };
  if (!page) return { ok: false, echecs: toutEchoue(colonnes, "page-absente") };
  if (page.sommaire) return { ok: false, echecs: toutEchoue(colonnes, "sommaire-n3") };

  const tri = new Tri();
  tri.essayer("type", ligne.type, page.type);
  tri.essayer("emetteur", ligne.emetteur, page.emetteur);
  // « Au nom de » ajoute la certitude quand elle est connue ; on la retire telle que la page
  // l'a écrite, pas par un motif : la confiance est en clair dans la ligne.
  const suffixe = ligne.titulaireConfiance !== null ? ` (certitude ${Math.round(ligne.titulaireConfiance * 100)} %)` : "";
  const titulaire =
    page.titulaireAffiche !== null && page.titulaireAffiche.endsWith(suffixe)
      ? page.titulaireAffiche.slice(0, page.titulaireAffiche.length - suffixe.length)
      : null;
  tri.essayer("titulaire", ligne.titulaire, titulaire);
  tri.essayer("resume", ligne.resumeEnClair ? null : ligne.resume, page.resume);
  tri.essayer("champsStructures", ligne.champsStructures, champsStructuresJson(page.champsStructures));
  tri.essayer("champsLibres", ligne.champsLibres, JSON.stringify(Object.fromEntries(page.champsLibres)));

  // Plusieurs exemplaires : la page les liste, chacun sous son lien Drive. Un seul : la liste
  // n'est pas rendue, et son chemin est dans « Rangé dans ».
  const seul = ligne.exemplaires.length === 1;
  for (const x of ligne.exemplaires) {
    const candidat = seul ? page.rangeDans : page.exemplaires.get(lienDrive(x.fileId));
    tri.essayer(`chemin:${x.fileId}`, x.chemin, candidat);
  }
  if (tri.echecs.length > 0) return { ok: false, echecs: tri.echecs };

  const { type, emetteur, titulaire: t, resume, champsStructures, champsLibres } = tri.clairs;
  const chemins: Record<string, string> = {};
  for (const [colonne, v] of Object.entries(tri.clairs)) {
    if (colonne.startsWith("chemin:")) chemins[colonne.slice("chemin:".length)] = v;
  }
  return { ok: true, clairs: { type, emetteur, titulaire: t, resume, champsStructures, champsLibres, chemins } };
}
