// lib/agenda/depot.ts — écrire et lire l'agenda du jour (ADR 0029). I/O.
//
// ⚠️ UN ENVOI REMPLACE LE JOUR SANS TRANSACTION (le pilote HTTP de Neon n'en a pas) : les
// événements du nouvel envoi entrent d'abord sous leur propre `envoi`, puis la ligne du jour dans
// `agenda_envois` bascule sur lui (une seule écriture, le point de bascule), et enfin ce qui
// n'appartient plus à l'envoi courant est effacé. Coupé au milieu, l'agenda reste celui d'avant ;
// deux envois simultanés : le dernier à basculer gagne, et le ménage ne touche jamais au gagnant.
// ⚠️ AUCUN TITRE NE SORT D'ICI VERS UN JOURNAL : le résultat de l'écriture est fait de nombres.

import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { chiffrer, dechiffrer, DechiffrementError, type Cle } from "../chiffrement";
import type { EnvoiAgenda } from "./contrat";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le niveau d'un titre d'agenda (ADR 0029 § 5) : il peut dire un rendez-vous intime. */
const NIVEAU_AGENDA = 2;

const aad = (envoi: string, position: number) => `agenda|${envoi}|${position}`;

const veille = (jour: string) => new Date(Date.parse(`${jour}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export interface ResultatEnvoi {
  ecrits: number;
  /** Les événements de l'envoi précédent du même jour, remplacés. */
  remplaces: number;
}

/** Remplace l'agenda du jour par cet envoi, puis efface ce qui précède la veille de `aujourdhui`. */
export async function remplacerJour(db: Base, cle: Cle, envoi: EnvoiAgenda, app: string, aujourdhui: string, maintenant: Date): Promise<ResultatEnvoi> {
  const id = randomUUID();
  const [avant] = await db.select({ nombre: schema.agendaEnvois.nombre }).from(schema.agendaEnvois).where(eq(schema.agendaEnvois.jour, envoi.jour));
  if (envoi.evenements.length > 0) {
    await db.insert(schema.agendaEvenements).values(
      envoi.evenements.map((e) => ({
        envoi: id,
        jour: envoi.jour,
        position: e.position,
        debut: e.debut,
        dureeMin: e.dureeMin,
        journeeEntiere: e.journeeEntiere,
        titre: chiffrer(cle, e.titre, aad(id, e.position), NIVEAU_AGENDA),
      })),
    );
  }
  const bascule = { envoi: id, app, nombre: envoi.evenements.length, luLe: envoi.luLe, recuLe: maintenant };
  await db
    .insert(schema.agendaEnvois)
    .values({ jour: envoi.jour, ...bascule })
    .onConflictDoUpdate({ target: schema.agendaEnvois.jour, set: bascule });
  // Le ménage : l'envoi courant est relu DANS la requête, jamais pris de la mémoire du processus.
  await db
    .delete(schema.agendaEvenements)
    .where(
      and(
        eq(schema.agendaEvenements.jour, envoi.jour),
        sql`${schema.agendaEvenements.envoi} <> (SELECT ${schema.agendaEnvois.envoi} FROM ${schema.agendaEnvois} WHERE ${schema.agendaEnvois.jour} = ${envoi.jour})`,
      ),
    );
  const garde = veille(aujourdhui);
  await db.delete(schema.agendaEvenements).where(lt(schema.agendaEvenements.jour, garde));
  await db.delete(schema.agendaEnvois).where(lt(schema.agendaEnvois.jour, garde));
  return { ecrits: envoi.evenements.length, remplaces: avant?.nombre ?? 0 };
}

export interface AgendaDuJour {
  jour: string;
  luLe: Date;
  evenements: { debut: Date; dureeMin: number; journeeEntiere: boolean; titre: string }[];
  /** Les titres qui ne se déchiffrent pas : comptés, jamais montrés ni devinés. */
  illisibles: number;
}

/** L'agenda reçu pour ce jour, dans l'ordre des heures. `null` : DriveAI n'a rien envoyé pour lui. */
export async function lireAgendaDuJour(db: Base, cle: Cle, jour: string): Promise<AgendaDuJour | null> {
  const [envoi] = await db.select().from(schema.agendaEnvois).where(eq(schema.agendaEnvois.jour, jour));
  if (!envoi) return null;
  const lignes = await db
    .select()
    .from(schema.agendaEvenements)
    .where(eq(schema.agendaEvenements.envoi, envoi.envoi))
    .orderBy(asc(schema.agendaEvenements.debut), asc(schema.agendaEvenements.position));
  let illisibles = 0;
  const evenements: AgendaDuJour["evenements"] = [];
  for (const l of lignes) {
    try {
      evenements.push({ debut: l.debut, dureeMin: l.dureeMin, journeeEntiere: l.journeeEntiere, titre: dechiffrer(cle, l.titre, aad(l.envoi, l.position), NIVEAU_AGENDA) });
    } catch (err) {
      if (!(err instanceof DechiffrementError)) throw err;
      illisibles++;
    }
  }
  return { jour, luLe: envoi.luLe, evenements, illisibles };
}

/** Pour `GET /api/etat` : le compte et l'heure de lecture du jour, jamais un titre. */
export async function comptesAgenda(db: Base, jour: string): Promise<{ jour: string; evenements: number; luLe: string } | null> {
  const [envoi] = await db.select({ nombre: schema.agendaEnvois.nombre, luLe: schema.agendaEnvois.luLe }).from(schema.agendaEnvois).where(eq(schema.agendaEnvois.jour, jour));
  return envoi ? { jour, evenements: envoi.nombre, luLe: envoi.luLe.toISOString() } : null;
}
