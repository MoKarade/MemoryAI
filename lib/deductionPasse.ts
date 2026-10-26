// lib/deductionPasse.ts — la passe des faits DÉDUITS (ADR 0023, tâche MemoryAI 185) : l'I/O
// autour de `lib/deduction.ts`, qui reste pur. Elle lit les papiers de Marc, en tire sa date de
// naissance, et écrit son âge comme n'importe quel fait : par `ecrireLot`, donc avec les mêmes
// gardes (oublis, idempotence, niveau, sauvetage).
//
// ⚠️ LA DATE DE NAISSANCE NE SORT PAS. Elle est lue ici, en mémoire, le temps du calcul ; seul
// l'âge s'écrit, au niveau que Marc a choisi pour le prédicat (`profil.age`, vocabulaire). La
// provenance ne porte NI dossier NI type de document : ils monteraient le niveau à 3, où la base
// refuse tout texte, et la décision de Marc ne s'appliquerait jamais.
//
// ⚠️ LES NOMS DE MARC viennent de `personnes.est_marc` (ADR 0020). Aucun nom connu ⇒ la passe
// s'abstient et le DIT (`aucun-nom`) : deviner le titulaire « le plus fréquent » serait un choix
// silencieux, et un passeport de proche donnerait l'âge de quelqu'un d'autre.

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { dechiffrer, DechiffrementError, type Cle } from "./chiffrement";
import { jourQuebec } from "./coutChat";
import * as schema from "./db/schema";
import { age, cleNom, EXTRACTEUR_DEDUCTION, naissanceDeMarc, periodeAge, type PapierPourDeduction } from "./deduction";
import type { DepotAdmin } from "./depotAdmin";
import type { DepotFaits } from "./depotFaits";
import { ecrireLot } from "./ecrireFaits";
import { NIVEAU_MESSAGE } from "./evenements/depot";
import type { Ecrivain } from "./jetons";
import type { DepotPiecesLecture } from "./pieces/depotLecture";
import { ouvrirFacette, rendreLisiblePiece } from "./pieces/lecture";
import { SauvetageEnCoursError } from "./sauvetage/porte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le prédicat de l'âge. Son niveau est celui du vocabulaire : la décision de Marc, en un seul endroit. */
export const PREDICAT_AGE = "profil.age";

/**
 * L'écrivain de la passe. Un papier d'identité est un document OFFICIEL ; aucune autre fiabilité
 * ne lui est permise, et il ne peut pas écrire depuis un mail.
 */
const ECRIVAIN_DEDUCTION: Ecrivain = { appId: "deduction", role: "ecriture", fiabilites: ["document-officiel"] };

/** Assez pour tous les titulaires connus ; au-delà, la passe le dit plutôt que de lire à moitié. */
const TITULAIRES_MAX = 500;
const PAPIERS_MAX = 200;

type FinDeduction =
  | "ecrit"
  | "inchange"
  | "aucun-nom"
  | "aucun-papier"
  | "contradiction"
  | "illisible"
  | "refuse"
  | "sauvetage";

export interface ResultatDeduction {
  fin: FinDeduction;
  /** Combien de papiers de Marc portaient une date lisible. Un compte, jamais une date. */
  papiers: number;
}

export interface SourcesDeduction {
  nomsDeMarc(): Promise<string[]>;
  papiersDe(noms: readonly string[]): Promise<PapierPourDeduction[]>;
}

/**
 * Les sources réelles : la table `personnes` et les papiers. ⚠️ Un nom ou un papier ILLISIBLE
 * fait échouer la lecture (`DechiffrementError`) : la passe le rend en `illisible`, jamais en
 * « aucun papier », qui enverrait chercher du mauvais côté.
 */
export function sourcesDeduction(db: Base, pieces: DepotPiecesLecture, cle: Cle): SourcesDeduction {
  return {
    async nomsDeMarc() {
      const rows = await db.select({ id: schema.personnes.id, nom: schema.personnes.nom }).from(schema.personnes).where(eq(schema.personnes.estMarc, true));
      return rows.map((r) => dechiffrer(cle, r.nom, `personne|${r.id}`, NIVEAU_MESSAGE));
    },
    async papiersDe(noms) {
      // Les titulaires sont groupés par une clé keyée qui ne connaît pas l'ordre des mots : on
      // ouvre un représentant de chaque groupe, et on garde les groupes dont le nom est celui de Marc.
      const voulus = new Set(noms.map(cleNom));
      const facettes = await pieces.facettes("titulaire", TITULAIRES_MAX, 3);
      if (facettes.length === TITULAIRES_MAX) throw new Error(`titulaires tronqués à ${TITULAIRES_MAX} : la passe ne verrait pas tout`);
      const cles = facettes
        .filter((f) => {
          const nom = ouvrirFacette(cle, f.valeurChiffree, f.representantId, f.representantNiveau);
          return nom !== null && voulus.has(cleNom(nom));
        })
        .map((f) => f.cle);
      if (cles.length === 0) return [];
      const rows = await pieces.chercher({ titulaireCles: cles, limite: PAPIERS_MAX });
      // Lecture INTERNE, jamais servie : la date d'un papier N3 se lit ici pour être calculée.
      const politique = { inclureN2: true, n2Autorise: true, inclureN3: true, n3Autorise: true, inclureProposes: true };
      return rows.flatMap((r) => {
        const l = rendreLisiblePiece(r, politique, cle);
        if (l === null || l.forme !== "complete") return [];
        const principal = l.exemplaires.find((x) => x.principal) ?? l.exemplaires[0];
        return [{ id: l.id, fileId: principal ? principal.fileId : null, titulaire: l.titulaire, champsLibres: l.champsLibres }];
      });
    },
  };
}

/**
 * Une passe. Même jour, mêmes papiers ⇒ rien de neuf (`inchange`, par l'empreinte du fait). Le
 * jour anniversaire, l'âge change : le nouveau fait est validé, et l'ancien devient `perime`
 * (`valider`, prédicat à une seule valeur), jamais effacé.
 */
export async function passeDeduction(p: {
  sources: SourcesDeduction;
  faits: DepotFaits;
  admin: Pick<DepotAdmin, "valider">;
  cle: Cle;
  maintenant: Date;
}): Promise<ResultatDeduction> {
  const jour = jourQuebec(p.maintenant);
  let papiers: PapierPourDeduction[];
  let noms: string[];
  try {
    noms = await p.sources.nomsDeMarc();
    if (noms.length === 0) return { fin: "aucun-nom", papiers: 0 };
    papiers = await p.sources.papiersDe(noms);
  } catch (err) {
    if (err instanceof DechiffrementError) return { fin: "illisible", papiers: 0 };
    throw err;
  }

  const n = naissanceDeMarc(papiers, noms, jour);
  if (!n.ok) return { fin: n.motif, papiers: n.dates };
  const source = n.papiers[0]!;
  const periode = periodeAge(n.date, jour);

  let r;
  try {
    r = await ecrireLot(
      [
        {
          sujet: "marc",
          predicat: PREDICAT_AGE,
          valeur: `${age(n.date, jour)} ans`,
          valeur_type: "texte",
          valide_de: periode.de,
          valide_a: periode.a,
          fiabilite_source: "document-officiel",
          // Le fileId NU, comme DriveAI l'écrit (`Memoire.gs`) : c'est ce qui relie l'âge aux faits
          // du même papier par la règle `meme-source` du graphe (tâche MemoryAI 186).
          provenance: { source_type: "document", source_ref: source.fileId, extracteur: EXTRACTEUR_DEDUCTION, date_source: jour },
        },
      ],
      ECRIVAIN_DEDUCTION,
      p.cle,
      p.faits,
      p.maintenant,
    );
  } catch (err) {
    if (err instanceof SauvetageEnCoursError) return { fin: "sauvetage", papiers: n.papiers.length };
    throw err;
  }

  const id = r.idsCrees[0];
  if (id !== undefined) {
    // ADR 0023 : un fait déduit de papiers actifs se valide seul, et périme l'âge d'avant.
    await p.admin.valider(id, p.maintenant);
    return { fin: "ecrit", papiers: n.papiers.length };
  }
  if (r.dejaPresents > 0 || r.refuses[0]?.code === "doublon_valide") return { fin: "inchange", papiers: n.papiers.length };
  // Un refus (oubli de Marc, niveau) se dit par son code dans le journal serveur, jamais par une valeur.
  console.error("[deduction] âge refusé", r.refuses[0]?.code ?? "inconnu");
  return { fin: "refuse", papiers: n.papiers.length };
}
