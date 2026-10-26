// lib/idees/depot.ts — la passe quotidienne des idées et leur lecture (ADR 0027). I/O : le calcul
// est dans `lib/idees/regles.ts`, qui reste pur.
//
// ⚠️ LA PASSE LIT LES DEMANDES DU HUB (table `demandes`) et rien d'autre : ni les résumés des apps,
// ni leurs erreurs. Le nom d'une demande est une DONNÉE (ADR 0021) : déchiffré ici, il ne sort que
// comme valeur citée par l'écran, et n'entre dans aucun prompt.
// ⚠️ `oublis` est consulté avant toute insertion : une idée que Marc a oubliée ne revient pas.
// ⚠️ Aucun modèle, aucun réseau, aucun coût : une passe est quelques lectures et écritures en base.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { chiffrer, dechiffrer, DechiffrementError, empreinte, type Cle } from "../chiffrement";
import { jourQuebec } from "../coutChat";
import * as schema from "../db/schema";
import { calculerIdees, FENETRE_JOURS, planifierIdees, type DemandePourIdee, type EtatIdee, type IdeeAffichee } from "./regles";
import { idees } from "./table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le niveau d'un nom de demande : celui qu'il a dans `demandes` (ADR 0021). */
const NIVEAU_CIBLE = 1;
/** Au-delà, la passe le dit plutôt que de compter à moitié. */
const DEMANDES_MAX = 2000;
const IDEES_MAX = 200;
const MS_JOUR = 86_400_000;

export interface ResultatIdees {
  /** Les demandes lues dans la fenêtre. */
  demandes: number;
  /** Les noms de demande illisibles : comptés, jamais devinés. */
  illisibles: number;
  creees: number;
  majs: number;
}

/** Une passe. Même jour, mêmes demandes : rien de neuf (`creees` et `majs` à 0). */
export async function passeIdees(db: Base, cle: Cle, maintenant: Date): Promise<ResultatIdees> {
  const jour = jourQuebec(maintenant);
  // Une marge d'un jour : le filtre exact se fait par jour de Québec, dans la règle pure.
  const depuis = new Date(maintenant.getTime() - (FENETRE_JOURS + 1) * MS_JOUR);
  const lignes = await db.select().from(schema.demandes).where(gte(schema.demandes.demandeLe, depuis)).limit(DEMANDES_MAX);
  if (lignes.length === DEMANDES_MAX) throw new Error(`demandes tronquées à ${DEMANDES_MAX} : la passe ne verrait pas tout`);

  let illisibles = 0;
  const demandes: DemandePourIdee[] = [];
  for (const l of lignes) {
    try {
      demandes.push({ app: l.app, genre: l.genre, nom: dechiffrer(cle, l.nom, `demande|${l.id}`, NIVEAU_CIBLE), demandeLe: l.demandeLe });
    } catch (err) {
      if (!(err instanceof DechiffrementError)) throw err;
      illisibles++;
    }
  }

  const calculees = calculerIdees(demandes, jour).map((c) => ({ ...c, empreinte: empreinte(cle, "idee", c.regle, c.app, c.genre, c.nom) }));
  const stockees = (await db.select().from(idees)).map((l) => ({ empreinte: l.empreinte, etat: l.etat as EtatIdee, utilite: l.utilite, raisons: l.raisons }));
  const oubliees =
    calculees.length === 0
      ? new Set<string>()
      : new Set((await db.select({ e: schema.oublis.empreinte }).from(schema.oublis).where(inArray(schema.oublis.empreinte, calculees.map((c) => c.empreinte)))).map((r) => r.e));

  const plan = planifierIdees(calculees, stockees, oubliees, jour);
  if (plan.creer.length > 0) {
    await db
      .insert(idees)
      .values(
        plan.creer.map((c) => {
          const id = randomUUID();
          return {
            id,
            regle: c.regle,
            app: c.app,
            genre: c.genre,
            cible: chiffrer(cle, c.nom, `idee|${id}`, NIVEAU_CIBLE),
            empreinte: c.empreinte,
            etat: "proposee",
            utilite: c.utilite,
            raisons: c.raisons,
            creeLe: maintenant,
            majLe: maintenant,
          };
        }),
      )
      .onConflictDoNothing({ target: idees.empreinte });
  }
  for (const m of plan.majs) {
    // Seules les idées encore en jeu se retouchent : un geste de Marc entre deux lectures ne s'écrase pas.
    await db
      .update(idees)
      .set({ utilite: m.utilite, raisons: m.raisons, majLe: maintenant })
      .where(and(eq(idees.empreinte, m.empreinte), inArray(idees.etat, ["proposee", "retenue"])));
  }
  return { demandes: demandes.length, illisibles, creees: plan.creer.length, majs: plan.majs.length };
}

/** Les idées, la plus utile d'abord, noms déchiffrés. Une cible illisible n'est pas montrée : un nom deviné serait pire qu'une idée de moins. */
export async function lireIdees(db: Base, cle: Cle): Promise<IdeeAffichee[]> {
  const lignes = await db.select().from(idees).orderBy(desc(idees.utilite), asc(idees.creeLe)).limit(IDEES_MAX);
  const lues: IdeeAffichee[] = [];
  for (const l of lignes) {
    try {
      lues.push({ id: l.id, app: l.app, genre: l.genre, nom: dechiffrer(cle, l.cible, `idee|${l.id}`, NIVEAU_CIBLE), etat: l.etat as EtatIdee, utilite: l.utilite, raisons: l.raisons });
    } catch (err) {
      if (!(err instanceof DechiffrementError)) throw err;
    }
  }
  return lues;
}
