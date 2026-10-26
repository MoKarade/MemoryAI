// lib/sorties/depot.ts — écrire ce qui sort des apps (ADR 0031). I/O.
//
// ⚠️ TITRE ET RÉSUMÉ SONT CHIFFRÉS au niveau retenu de la ligne, chacun avec sa propre donnée associée
// (`sorties|<id>|<colonne>`, puis le niveau) : un texte déplacé d'une colonne à l'autre ne se déchiffre pas.
// ⚠️ UN MÊME ÉVÉNEMENT RENVOYÉ NE SE DOUBLE JAMAIS : la clé unique (app, empreinte) l'écarte, et il est
// compté dans `doublons`. AUCUN TEXTE NE SORT D'ICI VERS UN JOURNAL : le résultat est fait de nombres.

import { randomUUID } from "node:crypto";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { chiffrer, type Cle } from "../chiffrement";
import { empreinte, niveauRetenu, type SortieLue } from "./contrat";
import { sorties } from "./table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

const aad = (id: string, colonne: "titre" | "resume") => `sorties|${id}|${colonne}`;

export interface ResultatSorties {
  ecrits: number;
  /** Les événements déjà reçus de cette app : écartés, pas réécrits. */
  doublons: number;
}

/** Écrit les sorties lues de `app` (celle du jeton). Le niveau de chaque ligne ne descend jamais sous le plancher de l'app. */
export async function ecrireSorties(db: Base, cle: Cle, app: string, lues: SortieLue[]): Promise<ResultatSorties> {
  if (lues.length === 0) return { ecrits: 0, doublons: 0 };
  const lignes = lues.map((s) => {
    const id = randomUUID();
    const niveau = niveauRetenu(app, s.niveau);
    return {
      id,
      app,
      type: s.type,
      date: s.date,
      niveau,
      empreinte: empreinte(s),
      titre: chiffrer(cle, s.titre, aad(id, "titre"), niveau),
      resume: s.resume === null ? null : chiffrer(cle, s.resume, aad(id, "resume"), niveau),
    };
  });
  const crees = await db
    .insert(sorties)
    .values(lignes)
    .onConflictDoNothing({ target: [sorties.app, sorties.empreinte] })
    .returning({ id: sorties.id });
  return { ecrits: crees.length, doublons: lues.length - crees.length };
}
