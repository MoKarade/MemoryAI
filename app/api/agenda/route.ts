// app/api/agenda/route.ts — DriveAI envoie ici l'agenda du jour de Marc (ADR 0029).
//
//   POST /api/agenda   { source: "agenda", jour, lu_le, evenements: [{ debut, duree_min, titre, journee_entiere }] }
//        200 { jour, recus, ecrits, refuses: [{ index, code }], ignores: [noms de clés], remplaces }
//
// HORS du middleware de session (égalité stricte) : DriveAI n'a pas de cookie. Jeton d'ÉCRIVAIN de
// DriveAI seulement : c'est lui qui tient l'accès Google, et MemoryAI ne détient aucun jeton Google.
// Refus dans l'ordre des autres routes machine : gel, jeton (401 indiscernable), clé, base, taille,
// corps. ⚠️ PAS DE PORTE DE SAUVETAGE (ADR 0029 § 1) : les tables sont neuves, aucune ligne de
// l'ancienne clé ne peut s'y doubler (ADR 0019 § 2).
//
// ⚠️ LA RÉPONSE ET LES JOURNAUX NE PORTENT QUE DES NOMBRES ET DES CODES : aucun titre ne revient.

import { CORPS_MAX, lireEnvoiAgenda } from "@/lib/agenda/contrat";
import { remplacerJour } from "@/lib/agenda/depot";
import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { jourQuebec } from "@/lib/coutChat";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Seule l'app qui tient l'accès Google envoie l'agenda : en ajouter une est une décision de frontière. */
const APPS_AGENDA: ReadonlySet<string> = new Set(["driveai"]);

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_AGENDA);
  if (!ecrivain) return refusJeton();

  let cle;
  try {
    cle = cleDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return erreur(503, "cle_absente", err.message);
    throw err;
  }
  if (!baseConfiguree()) return erreur(503, "base_absente", "DATABASE_URL manquante : rien n'est écrit.");

  const texte = await request.text();
  if (texte.length > CORPS_MAX) return erreur(413, "corps_trop_grand", `Corps de plus de ${CORPS_MAX} caractères : rien n'est écrit.`);
  let corps: unknown;
  try {
    corps = JSON.parse(texte);
  } catch {
    return erreur(400, "corps_invalide", "Le corps doit être du JSON.");
  }

  const maintenant = new Date();
  const lu = lireEnvoiAgenda(corps, maintenant);
  if (!lu.ok) return erreur(lu.code === "corps_invalide" ? 400 : 422, lu.code, lu.message);
  const { envoi } = lu;

  await assurerMigrations();
  const r = await remplacerJour(db, cle, envoi, ecrivain.appId, jourQuebec(maintenant), maintenant);
  return Response.json(
    { jour: envoi.jour, recus: envoi.evenements.length + envoi.refuses.length, ecrits: r.ecrits, refuses: envoi.refuses, ignores: envoi.ignores, remplaces: r.remplaces },
    { status: 200, headers: NO_STORE },
  );
}
