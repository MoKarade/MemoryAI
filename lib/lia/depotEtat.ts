// lib/lia/depotEtat.ts — la ligne de l'état partagé de LIA (`lia_etat`, migration 0025), et ce
// que les deux portes en font (`/api/lia/etat` pour la maison, `/api/etat-lia` pour le hub).
//
// L'écriture est ATOMIQUE : une seule instruction, qui ne remplace la ligne que si la version
// reçue dépasse la sienne. Deux pages qui écrivent en même temps ne s'écrasent pas : la seconde
// reçoit 409 et l'état gardé, qu'elle adopte (contrat d'`etatHttp`).
//
// ⚠️ LA DISCUSSION (ADR 0030, migration 0034) est du texte de Marc : elle n'entre JAMAIS dans le
// JSON `etat`. Elle est retirée de l'état, chiffrée au niveau 2 (AAD `lia_etat|discussion|2`) dans
// la colonne `discussion`, écrite dans la MÊME instruction que la version, puis remise à la lecture.
// Une ligne illisible (autre clé, octets altérés) n'est jamais rendue. Sans clé de chiffrement,
// l'état marche et la discussion ni ne se lit ni ne s'écrit : la colonne reste telle quelle.

import { eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { chiffrer, ClefAbsenteError, cleDepuisEnv, dechiffrer, DechiffrementError, type Cle } from "../chiffrement";
import * as schema from "../db/schema";
import { lireEtat, relireEtat, separerDiscussion, type EtatPartage } from "./etatPartage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Ce qui lie la discussion à CETTE colonne : déplacée ailleurs, elle ne se déchiffre plus. */
const ID_DISCUSSION = "lia_etat|discussion";
const NIVEAU_DISCUSSION = 2;

export interface DepotEtatLia {
  /** L'état gardé, ou `null` s'il n'y en a aucun (ou s'il est abîmé : jamais rendu tel quel). */
  lire(): Promise<EtatPartage | null>;
  /** `garde: true` si la ligne a été remplacée ; sinon l'état gardé, plus récent ou égal. */
  ecrire(etat: EtatPartage): Promise<{ garde: boolean; etat: EtatPartage | null }>;
}

/** La clé de chiffrement, ou `null` quand elle manque : l'état marche encore, la discussion non. */
export function cleDeLaDiscussion(): Cle | null {
  try {
    return cleDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return null;
    throw err;
  }
}

/** La discussion déchiffrée, ou `undefined` : pas de clé, pas de discussion, ou ligne illisible (dit, sans citer de texte). */
function lireDiscussion(cle: Cle | null, scelle: string | null): unknown {
  if (!cle || !scelle) return undefined;
  try {
    return JSON.parse(dechiffrer(cle, scelle, ID_DISCUSSION, NIVEAU_DISCUSSION));
  } catch (err) {
    if (err instanceof DechiffrementError || err instanceof SyntaxError) {
      console.error("[lia/etat] discussion illisible : non rendue");
      return undefined;
    }
    throw err;
  }
}

export function depotEtatLiaDrizzle(db: Base, cle: Cle | null = null): DepotEtatLia {
  const lire = async () => {
    const r = await db
      .select({ etat: schema.liaEtat.etat, discussion: schema.liaEtat.discussion })
      .from(schema.liaEtat)
      .where(eq(schema.liaEtat.id, 1))
      .limit(1);
    return r.length > 0 ? relireEtat(r[0]!.etat, lireDiscussion(cle, r[0]!.discussion)) : null;
  };
  return {
    lire,
    async ecrire(etat) {
      const { sansDiscussion, discussion } = separerDiscussion(etat);
      // Sans clé, la colonne n'est pas touchée (ni lue, ni écrite, ni vidée).
      const colonne = cle
        ? { discussion: discussion ? chiffrer(cle, JSON.stringify(discussion), ID_DISCUSSION, NIVEAU_DISCUSSION) : null }
        : {};
      const ecrites = await db
        .insert(schema.liaEtat)
        .values({ id: 1, version: etat.version, maj: etat.maj, etat: sansDiscussion, ...colonne })
        .onConflictDoUpdate({
          target: schema.liaEtat.id,
          set: { version: etat.version, maj: etat.maj, etat: sansDiscussion, ...colonne, modifieLe: sql`now()` },
          setWhere: lt(schema.liaEtat.version, etat.version),
        })
        .returning({ id: schema.liaEtat.id });
      if (ecrites.length > 0) return { garde: true, etat: cle ? etat : sansDiscussion };
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
