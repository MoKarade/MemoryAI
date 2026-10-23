// lib/sauvetage/sauvetage.ts — UNE passe du sauvetage (ADR 0019 §2, étape 4).
//
// Une passe prend les lignes pas encore sauvées, dans l'ordre de leur identifiant, et pour
// chacune : demande sa page à l'ancien déploiement (seulement si elle porte un scellé `v1`),
// refait le clair exact et le prouve par la taille, le scelle sous la nouvelle clé avec ses
// empreintes, puis l'écrit avec son archive en une instruction. Ce qui échoue est noté avec sa
// raison et retenté à la passe suivante.
//
// ⚠️ UNE PASSE EST BORNÉE DANS LE TEMPS, pas dans le nombre : une fonction Vercel a une durée
// maximale, et une passe coupée au milieu n'abîme rien (chaque ligne est atomique). Elle rend
// `termine: false`, et l'écran relance.
//
// ⚠️ UN REFUS DE L'ORACLE ARRÊTE LA PASSE. Si l'ancien déploiement refuse une page (session ou
// contournement refusés), il refusera toutes les autres : continuer noterait des milliers
// d'échecs qui ne disent rien des lignes. La passe s'arrête et dit pourquoi.
//
// Orchestration seule : la base, l'oracle et la clé sont injectés.

import { DechiffrementError, estScelleAncien, type Cle } from "../chiffrement";
import type { DepotSauvetage, TableSauvee } from "./depot";
import { extraireFait, extrairePiece } from "./extraire";
import type { Lecture, Oracle } from "./oracle";
import { reconstruireFait, reconstruirePiece, RAISONS_ECHEC } from "./reconstruire";
import { rescellerFait, rescellerPiece } from "./resceller";

/** Toutes les raisons qu'un échec peut porter : celles de la reconstruction, puis celles de l'écriture. */
export const RAISONS_SAUVETAGE = [
  ...RAISONS_ECHEC,
  /** La ligne a changé entre sa lecture et son écriture : rien n'a été écrit. */
  "concurrence",
  /** Un scellé `v2` de la ligne ne se déchiffre pas sous la nouvelle clé. */
  "illisible-nouvelle-cle",
  /** La base a refusé l'écriture (contrainte, panne). */
  "erreur-ecriture",
  /** L'ancien déploiement n'a pas répondu à temps, ou a répondu en erreur. */
  "oracle-en-panne",
] as const;

export interface ResultatPasse {
  sauves: Record<TableSauvee, number>;
  echecs: Record<TableSauvee, number>;
  /** Le balayage est allé au bout : chaque ligne à sauver a été essayée une fois. */
  termine: boolean;
  /** Où reprendre à la passe suivante du MÊME balayage (`null` quand il est fini). */
  reprise: Reprise | null;
  /** La passe s'est arrêtée d'elle-même : l'oracle refuse l'accès. */
  arret: "acces-refuse" | null;
}

/**
 * Un balayage se fait en plusieurs passes ; la reprise dit où la précédente s'est arrêtée. Sans
 * elle, chaque passe recommencerait par les mêmes faits en échec et n'atteindrait jamais les
 * papiers. Un nouveau balayage (reprise absente) retente tout ce qui a échoué.
 */
export interface Reprise {
  table: TableSauvee;
  apres: string;
}

export interface OptionsPasse {
  /** Où reprendre ; absent = un nouveau balayage, depuis le début. */
  reprise?: Reprise | null;
  /** Durée maximale de la passe, en millisecondes. */
  budgetMs: number;
  /** Lignes lues par requête. */
  lot?: number;
  /** Lignes traitées en parallèle (autant de pages demandées à la fois). */
  parallele?: number;
  maintenant?: () => number;
}

interface Ligne {
  id: string;
}

export async function passeDeSauvetage(
  depot: DepotSauvetage,
  oracle: Oracle,
  cle: Cle,
  options: OptionsPasse,
): Promise<ResultatPasse> {
  const maintenant = options.maintenant ?? Date.now;
  const fin = maintenant() + options.budgetMs;
  const lot = options.lot ?? 40;
  const parallele = Math.max(1, options.parallele ?? 4);
  const resultat: ResultatPasse = {
    sauves: { faits: 0, pieces: 0 },
    echecs: { faits: 0, pieces: 0 },
    termine: false,
    reprise: null,
    arret: null,
  };

  /** `null` = la ligne n'a pas besoin de page ; une `Lecture` sinon. Un refus arrête tout. */
  const demander = async (besoin: boolean, lireParOracle: () => Promise<Lecture>): Promise<string | null | "panne"> => {
    if (!besoin) return null;
    const l = await lireParOracle();
    if (l.ok) return l.html;
    if (l.raison === "refus") resultat.arret = "acces-refuse";
    return l.raison === "panne" ? "panne" : null;
  };

  const echouer = async (table: TableSauvee, id: string, raisons: readonly string[]) => {
    resultat.echecs[table] += 1;
    await depot.noterEchec(table, id, raisons);
  };

  async function parcourir<T extends Ligne>(
    table: TableSauvee,
    lire: (apres: string, limite: number) => Promise<T[]>,
    traiter: (ligne: T) => Promise<void>,
    depuis: string,
  ): Promise<boolean> {
    let apres = depuis;
    for (;;) {
      resultat.reprise = { table, apres };
      if (maintenant() >= fin || resultat.arret) return false;
      const lignes = await lire(apres, lot);
      if (lignes.length === 0) return true;
      for (let i = 0; i < lignes.length; i += parallele) {
        if (maintenant() >= fin || resultat.arret) {
          // Reprendre juste avant le premier paquet non traité : rien n'est sauté.
          if (i > 0) resultat.reprise = { table, apres: lignes[i - 1]!.id };
          return false;
        }
        await Promise.all(
          lignes.slice(i, i + parallele).map((l) =>
            traiter(l).catch(async (err: unknown) => {
              // Une ligne qui casse n'arrête pas la passe ; elle est notée, et la suivante passe.
              await echouer(table, l.id, [err instanceof DechiffrementError ? "illisible-nouvelle-cle" : "erreur-ecriture"]);
            }),
          ),
        );
      }
      apres = lignes[lignes.length - 1]!.id;
    }
  }

  const depart = options.reprise ?? { table: "faits", apres: "" };
  const faitsFinis =
    depart.table === "pieces" ||
    (await parcourir("faits", depot.faitsASauver, async (f) => {
    const page = await demander(estScelleAncien(f.valeur) || estScelleAncien(f.attributs), () => oracle.fait(f.id));
    if (resultat.arret) return;
    if (page === "panne") return echouer("faits", f.id, ["oracle-en-panne"]);
    const r = reconstruireFait(f, page === null ? null : extraireFait(page, f.id));
    if (!r.ok) return echouer("faits", f.id, r.echecs.map((e) => e.raison));
    if (await depot.sauverFait(f, rescellerFait(cle, f, r.clairs))) resultat.sauves.faits += 1;
    else await echouer("faits", f.id, ["concurrence"]);
  }, depart.apres));
  if (!faitsFinis) return resultat;

  const piecesFinies = await parcourir("pieces", depot.piecesASauver, async (p) => {
    const besoin = [p.type, p.emetteur, p.titulaire, p.resume, p.champsStructures, p.champsLibres, ...p.exemplaires.map((x) => x.chemin)].some(
      estScelleAncien,
    );
    const page = await demander(besoin, () => oracle.piece(p.id));
    if (resultat.arret) return;
    if (page === "panne") return echouer("pieces", p.id, ["oracle-en-panne"]);
    const r = reconstruirePiece(p, page === null ? null : extrairePiece(page, p.id));
    if (!r.ok) return echouer("pieces", p.id, r.echecs.map((e) => e.raison));
    if (await depot.sauverPiece(p, rescellerPiece(cle, p, r.clairs))) resultat.sauves.pieces += 1;
    else await echouer("pieces", p.id, ["concurrence"]);
  }, depart.table === "pieces" ? depart.apres : "");
  resultat.termine = piecesFinies;
  if (piecesFinies) resultat.reprise = null;
  return resultat;
}
