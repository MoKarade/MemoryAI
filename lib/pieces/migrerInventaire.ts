// lib/pieces/migrerInventaire.ts — déplacer les `document.existe` vers `pieces`, par LOTS.
//
// ADR 0004 §6.2, décision n° 7 : « les 2 729 faits `document.existe` sont MIGRÉS en pièces et
// disparaissent des faits. Une migration sur 2 729 lignes de production : elle se livre avec
// son retour en arrière, et elle se prouve sur une copie avant de toucher la prod. »
//
// ⚠️ RIEN N'EST EFFACÉ. Le fait reste en base, marqué `migre_en_piece` : il cesse d'être
// servi, il ne disparaît pas. Un fait MIGRÉ n'est pas un fait OUBLIÉ — le second est une
// décision de Marc et ne revient jamais, le premier est un déménagement qu'on peut défaire
// (`annulerMigration`). Confondre les deux rendrait la migration irréversible en pratique.
//
// ⚠️ PAR LOTS, ET IDEMPOTENT. `document.existe` est alimenté en continu par le tick de
// DriveAI : la migration ne « finit » donc jamais au sens strict — elle rattrape. Un fait déjà
// migré est sauté par le filtre, une pièce déjà écrite est comptée `dejaPresentes` par
// l'empreinte. On peut la relancer autant de fois qu'on veut, y compris pendant que DriveAI
// pousse, et c'est exactement ce qu'il faudra faire.
//
// ⚠️ ELLE PASSE PAR LE MÊME CHEMIN D'ÉCRITURE que les pièces extraites (`ecrireLotPieces`).
// Une seconde implémentation oublierait le régime de chiffrement ou la clé de facette, et ça
// ne se verrait qu'en lisant une ligne déjà écrite — des mois plus tard.

import { dechiffrer, DechiffrementError, type Cle } from "../chiffrement";
import type { DepotPieces } from "./depot";
import { ecrireLotPieces } from "./ecrire";
import { APP_INVENTAIRE } from "./lignee";
import { EXTRACTEUR_MIGRATION, PREDICAT_MIGRE, pieceDepuisFait, type FaitAMigrer } from "./migration";
import type { Ecrivain } from "../jetons";

/** L'écrivain de la migration. Il ne vient d'aucun jeton : c'est Marc qui déclenche. */
export const ECRIVAIN_MIGRATION: Ecrivain = {
  // ⚠️ Un tiret : aucun nom de variable de jeton (`[A-Z0-9]+`) ne peut produire cet appId.
  appId: APP_INVENTAIRE,
  role: "ecriture",
  fiabilites: ["document-officiel"],
};

/** Le lot par passe. Petit : chaque passe doit tenir dans une requête HTTP de Marc. */
export const LOT_MIGRATION = 50;

export interface DepotMigration {
  /** Les `document.existe` pas encore migrés, les plus anciens d'abord. */
  aMigrer(predicat: string, limite: number): Promise<FaitAMigrerChiffre[]>;
  /** Combien restent, tous lots confondus — c'est lui qui dit si c'est fini. */
  resteAMigrer(predicat: string): Promise<number>;
  /** Marque ces faits comme migrés. Appelé APRÈS l'écriture des pièces, jamais avant. */
  marquerMigres(ids: readonly string[], maintenant: Date): Promise<void>;
  /** Le retour en arrière : rend les faits et supprime les pièces que la migration a créées. */
  annuler(): Promise<{ faits: number; pieces: number }>;
}

export interface FaitAMigrerChiffre extends FaitAMigrer {
  /** Chiffrée dès N1, avec l'AAD `id|niveau` — d'où le CODE plutôt que du SQL. */
  valeur: string | null;
  attributs: string | null;
}

export interface ResultatMigration {
  lus: number;
  migres: number;
  dejaPresentes: number;
  /** Comptés PAR MOTIF : une migration qui saute des lignes sans dire lesquelles ment. */
  refuses: Record<string, number>;
  illisibles: number;
  reste: number;
}

function ajouter(compte: Record<string, number>, motif: string): void {
  compte[motif] = (compte[motif] ?? 0) + 1;
}

/**
 * Migre UN lot. Rend ce qui s'est passé, motif par motif.
 *
 * ⚠️ L'ORDRE EST LA GARANTIE : on écrit les pièces D'ABORD, on marque les faits ENSUITE. Une
 * coupure entre les deux rejoue au tour suivant (les pièces sont dédupliquées par empreinte)
 * ; l'ordre inverse perdrait des papiers en les déclarant migrés avant de les avoir écrits.
 */
export async function migrerLotInventaire(
  depotMigration: DepotMigration,
  depotPieces: DepotPieces,
  cle: Cle,
  maintenant: Date,
  taille: number = LOT_MIGRATION,
): Promise<ResultatMigration> {
  const lignes = await depotMigration.aMigrer(PREDICAT_MIGRE, taille);
  const res: ResultatMigration = {
    lus: lignes.length,
    migres: 0,
    dejaPresentes: 0,
    refuses: {},
    illisibles: 0,
    reste: 0,
  };
  if (lignes.length === 0) {
    res.reste = await depotMigration.resteAMigrer(PREDICAT_MIGRE);
    return res;
  }

  const entrees: unknown[] = [];
  const origines: (string | null)[] = [];
  const idsFaits: string[] = [];

  for (const l of lignes) {
    let fileId: string;
    let attributs: Record<string, string> | null = null;
    try {
      if (l.valeur === null) {
        ajouter(res.refuses, "valeur_vide");
        continue;
      }
      fileId = l.niveau >= 1 ? dechiffrer(cle, l.valeur, l.id, l.niveau) : l.valeur;
      if (l.attributs !== null) {
        const brut = l.niveau >= 1 ? dechiffrer(cle, l.attributs, l.id + "#attributs", l.niveau) : l.attributs;
        attributs = JSON.parse(brut) as Record<string, string>;
      }
    } catch (err) {
      // ⚠️ Un fait ILLISIBLE (clé tournée, ligne altérée) est COMPTÉ et LAISSÉ EN PLACE : le
      // migrer à moitié le perdrait. Il n'est pas marqué, donc il reviendra — et le compte
      // dit qu'il faut aller voir, plutôt que de laisser un écart qu'on découvre en comptant.
      if (err instanceof DechiffrementError || err instanceof SyntaxError) {
        res.illisibles += 1;
        continue;
      }
      throw err;
    }

    const compose = pieceDepuisFait(l, fileId, attributs);
    if (!compose.ok) {
      ajouter(res.refuses, compose.refus);
      continue;
    }
    const p = compose.piece;
    entrees.push({
      sujet: p.sujet,
      ...(p.type ? { type: p.type } : {}),
      ...(p.emetteur ? { emetteur: p.emetteur } : {}),
      ...(p.annee !== null ? { annee: p.annee } : {}),
      ...(p.domaine ? { domaine: p.domaine } : {}),
      ...(p.dateDocument ? { date_document: p.dateDocument } : {}),
      niveau_propose: p.niveau,
      extracteur: EXTRACTEUR_MIGRATION,
      exemplaires: [{ file_id: p.fileId }],
    });
    origines.push(p.origineFaitId);
    idsFaits.push(l.id);
  }

  if (entrees.length > 0) {
    const ecrit = await ecrireLotPieces(entrees, ECRIVAIN_MIGRATION, cle, depotPieces, origines);
    res.migres = ecrit.acceptees;
    res.dejaPresentes = ecrit.dejaPresentes + ecrit.oubliees;
    for (const r of ecrit.refusees) ajouter(res.refuses, r.code);

    // ⚠️ On marque AUSSI les `dejaPresentes` et les `oubliees` : leur pièce existe (ou a été
    // délibérément retirée par Marc), donc le fait n'a plus de raison d'être servi. Ne marquer
    // que les acceptées ferait re-lire ces mêmes lignes à chaque passe — la migration
    // n'avancerait plus, et le compteur « reste » resterait figé sans que rien ne soit cassé.
    const nonEcrits = new Set(ecrit.refusees.map((r) => origines[r.index]));
    const aMarquer = idsFaits.filter((id) => !nonEcrits.has(id));
    if (aMarquer.length > 0) await depotMigration.marquerMigres(aMarquer, maintenant);
  }

  res.reste = await depotMigration.resteAMigrer(PREDICAT_MIGRE);
  return res;
}

/** Le retour en arrière, en un geste. Rien n'a été effacé, donc tout revient. */
export async function annulerMigrationInventaire(
  depotMigration: DepotMigration,
): Promise<{ faits: number; pieces: number }> {
  return depotMigration.annuler();
}
