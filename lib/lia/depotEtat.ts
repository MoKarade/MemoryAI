// lib/lia/depotEtat.ts — la ligne de l'état partagé de LIA (`lia_etat`, migration 0025), et ce
// que les deux portes en font (`/api/lia/etat` pour la maison, `/api/etat-lia` pour le hub).
//
// L'écriture est ATOMIQUE : une seule instruction, qui ne remplace la ligne que si la version
// reçue dépasse la sienne. Deux pages qui écrivent en même temps ne s'écrasent pas : la seconde
// reçoit 409 et l'état gardé, qu'elle adopte (contrat d'`etatHttp`).

import { eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { lireEtat, relireEtat, type EtatPartage } from "./etatPartage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotEtatLia {
  /** L'état gardé, ou `null` s'il n'y en a aucun (ou s'il est abîmé : jamais rendu tel quel). */
  lire(): Promise<EtatPartage | null>;
  /** `garde: true` si la ligne a été remplacée ; sinon l'état gardé, plus récent ou égal. */
  ecrire(etat: EtatPartage): Promise<{ garde: boolean; etat: EtatPartage | null }>;
}

export function depotEtatLiaDrizzle(db: Base): DepotEtatLia {
  const lire = async () => {
    const r = await db.select({ etat: schema.liaEtat.etat }).from(schema.liaEtat).where(eq(schema.liaEtat.id, 1)).limit(1);
    return r.length > 0 ? relireEtat(r[0]!.etat) : null;
  };
  return {
    lire,
    async ecrire(etat) {
      const ecrites = await db
        .insert(schema.liaEtat)
        .values({ id: 1, version: etat.version, maj: etat.maj, etat })
        .onConflictDoUpdate({
          target: schema.liaEtat.id,
          set: { version: etat.version, maj: etat.maj, etat, modifieLe: sql`now()` },
          setWhere: lt(schema.liaEtat.version, etat.version),
        })
        .returning({ id: schema.liaEtat.id });
      if (ecrites.length > 0) return { garde: true, etat };
      return { garde: false, etat: await lire() };
    },
  };
}

const ENTETES = { "Cache-Control": "no-store" } as const;

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: ENTETES });
}

/** GET : 200 + l'état, 204 s'il n'y en a aucun. */
export async function repondreLecture(depot: DepotEtatLia): Promise<Response> {
  const etat = await depot.lire();
  return etat ? Response.json(etat, { headers: ENTETES }) : new Response(null, { status: 204, headers: ENTETES });
}

/** PUT : 200 + l'état gardé ; 409 + l'état gardé si la version ne dépasse pas la sienne ; 400 / 413 corps. */
export async function repondreEcriture(depot: DepotEtatLia, brut: string): Promise<Response> {
  const lu = lireEtat(brut);
  if (!lu.ok) return erreur(lu.status, lu.code, lu.message);
  const r = await depot.ecrire(lu.etat);
  if (r.garde) return Response.json(r.etat, { headers: ENTETES });
  // Refusée : on rend ce qui est gardé pour que la page l'adopte. Une ligne abîmée, jamais rendue,
  // laisse la page sur son état local (409 sans corps exploitable : elle réessaiera plus haut).
  return Response.json(r.etat ?? { error: "version_depassee" }, { status: 409, headers: ENTETES });
}
