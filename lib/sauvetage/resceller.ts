// lib/sauvetage/resceller.ts — sceller sous la NOUVELLE clé ce que le sauvetage a retrouvé (ADR 0019 §2).
//
// Une ligne sauvée change trois choses, et pas seulement ses scellés :
//   1. chaque colonne `v1` retrouvée est scellée en `v2`, sous la même AAD qu'à l'écriture ;
//   2. ses EMPREINTES sont recalculées : ce sont des HMAC sous une clé dérivée de la clé perdue,
//      donc l'idempotence ne reconnaîtrait plus rien (un fait repoussé par DriveAI entrerait en
//      double). Une ligne N0, qui n'a aucun scellé, a quand même une empreinte à refaire ;
//   3. les clés de facette d'un papier (`type_cle`, …), pour la même raison.
//
// Ce qui ne change pas reste tel quel, octet pour octet. Et tout ce qui change est d'abord
// copié dans `ancien`, que le dépôt archive dans la même instruction : si la clé perdue revient
// un jour, rien n'a été effacé.
//
// Module PUR : la clé est un paramètre. Un scellé `v2` déjà présent (un fait corrigé par Marc
// après la bascule) est déchiffré sous la nouvelle clé pour en refaire l'empreinte ; s'il ne se
// déchiffre pas, `DechiffrementError` remonte et la ligne reste en échec.

import { chiffrer, dechiffrer, type Cle } from "../chiffrement";
import { empreinteFait } from "../ecrireFaits";
import { empreintePiece } from "../pieces/ecrire";
import { cleFacette } from "../pieces/facettes";
import type { ClairsFait, ClairsPiece, FaitAncien, PieceAncienne } from "./reconstruire";

/** Le préfixe des empreintes qui ne sont PAS des HMAC (une pièce remplacée) : on n'y touche pas. */
const EMPREINTE_NON_KEYEE = "remplacee:";

/** Le clair d'une colonne : retrouvé par le sauvetage, sinon en clair en base, sinon scellé `v2`. */
function clairDe(
  cle: Cle,
  retrouve: string | undefined,
  valeur: string | null,
  aad: string,
  niveau: number,
  enClair: boolean,
): string | null {
  if (retrouve !== undefined) return retrouve;
  if (valeur === null) return null;
  return enClair ? valeur : dechiffrer(cle, valeur, aad, niveau);
}

/** `retrouve` scellé en `v2`, ou la valeur d'origine si rien n'a été retrouvé pour cette colonne. */
function scelle(cle: Cle, retrouve: string | undefined, valeur: string | null, aad: string, niveau: number): string | null {
  return retrouve === undefined ? valeur : chiffrer(cle, retrouve, aad, niveau);
}

// ── Faits ──────────────────────────────────────────────────────────────────────────────────

export interface FaitARescueller extends FaitAncien {
  sujet: string;
  predicat: string;
  niveau: number;
  empreinte: string;
  /** La PREMIÈRE provenance du fait : celle sous laquelle son empreinte a été calculée. */
  provenance: { sourceRef: string; extracteur: string } | null;
}

export interface PatchFait {
  valeur: string | null;
  attributs: string | null;
  empreinte: string;
  /** Les valeurs d'avant, pour l'archive. */
  ancien: { valeur: string | null; attributs: string | null; empreinte: string };
}

export function rescellerFait(cle: Cle, f: FaitARescueller, clairs: ClairsFait): PatchFait {
  const enClair = f.niveau < 1;
  const valeur = clairDe(cle, clairs.valeur, f.valeur, f.id, f.niveau, enClair);
  // Sans provenance, on ne sait pas sous quelles parties l'empreinte avait été calculée : on la
  // laisse. Elle ne reconnaîtra plus rien, ce qui n'est pas pire qu'aujourd'hui.
  const empreinte = f.provenance
    ? empreinteFait(cle, {
        sujet: f.sujet,
        predicat: f.predicat,
        sourceRef: f.provenance.sourceRef,
        extracteur: f.provenance.extracteur,
        valeur: valeur ?? "",
      })
    : f.empreinte;
  return {
    valeur: enClair ? f.valeur : scelle(cle, clairs.valeur, f.valeur, f.id, f.niveau),
    attributs: enClair ? f.attributs : scelle(cle, clairs.attributs, f.attributs, `${f.id}#attributs`, f.niveau),
    empreinte,
    ancien: { valeur: f.valeur, attributs: f.attributs, empreinte: f.empreinte },
  };
}

// ── Papiers ────────────────────────────────────────────────────────────────────────────────

export interface PieceARescueller extends PieceAncienne {
  sujet: string;
  niveau: number;
  resumeEnClair: boolean;
  empreinte: string;
  typeCle: string | null;
  emetteurCle: string | null;
  titulaireCle: string | null;
  exemplaires: { fileId: string; chemin: string | null; principal: boolean }[];
}

export interface PatchPiece {
  type: string | null;
  emetteur: string | null;
  titulaire: string | null;
  typeCle: string | null;
  emetteurCle: string | null;
  titulaireCle: string | null;
  resume: string | null;
  champsStructures: string | null;
  champsLibres: string | null;
  empreinte: string;
  /** fileId → nouveau chemin scellé, seulement pour les exemplaires dont le chemin a été retrouvé. */
  chemins: Record<string, string>;
  ancien: Omit<PatchPiece, "ancien" | "chemins"> & { chemins: Record<string, string | null> };
}

export function rescellerPiece(cle: Cle, p: PieceARescueller, clairs: ClairsPiece): PatchPiece {
  // Les facettes et les chemins d'un N0 sont en clair ; le résumé suit son régime ; les champs
  // sont toujours scellés. Mêmes règles que `rendreLisiblePiece`, qui les a lus jusqu'ici.
  const facettesEnClair = p.niveau === 0;
  const facette = (retrouve: string | undefined, valeur: string | null) =>
    clairDe(cle, retrouve, valeur, p.id, p.niveau, facettesEnClair);
  const reseller = (retrouve: string | undefined, valeur: string | null) => scelle(cle, retrouve, valeur, p.id, p.niveau);

  const principal = p.exemplaires.find((x) => x.principal) ?? p.exemplaires[0];
  const chemins: Record<string, string> = {};
  for (const [fileId, chemin] of Object.entries(clairs.chemins)) chemins[fileId] = chiffrer(cle, chemin, p.id, p.niveau);

  return {
    type: reseller(clairs.type, p.type),
    emetteur: reseller(clairs.emetteur, p.emetteur),
    titulaire: reseller(clairs.titulaire, p.titulaire),
    typeCle: cleFacette(cle, "type", facette(clairs.type, p.type)),
    emetteurCle: cleFacette(cle, "emetteur", facette(clairs.emetteur, p.emetteur)),
    titulaireCle: cleFacette(cle, "titulaire", facette(clairs.titulaire, p.titulaire)),
    resume: p.resumeEnClair ? p.resume : reseller(clairs.resume, p.resume),
    champsStructures: reseller(clairs.champsStructures, p.champsStructures),
    champsLibres: reseller(clairs.champsLibres, p.champsLibres),
    empreinte:
      p.empreinte.startsWith(EMPREINTE_NON_KEYEE) || !principal ? p.empreinte : empreintePiece(cle, p.sujet, principal.fileId),
    chemins,
    ancien: {
      type: p.type,
      emetteur: p.emetteur,
      titulaire: p.titulaire,
      typeCle: p.typeCle,
      emetteurCle: p.emetteurCle,
      titulaireCle: p.titulaireCle,
      resume: p.resume,
      champsStructures: p.champsStructures,
      champsLibres: p.champsLibres,
      empreinte: p.empreinte,
      chemins: Object.fromEntries(Object.keys(chemins).map((f) => [f, p.exemplaires.find((x) => x.fileId === f)?.chemin ?? null])),
    },
  };
}
