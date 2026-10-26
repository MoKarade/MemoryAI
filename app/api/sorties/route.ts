// app/api/sorties/route.ts — les apps envoient ici ce qu'elles produisent, pour que LIA le retrouve (ADR 0031).
//
//   POST /api/sorties   { source: "sorties", evenements: [{ type, date, titre, resume?, ref?, niveau? }] }
//        200 { recus, ecrits, doublons, refuses: [{ index, code }], ignores: [noms de clés] }
//
// HORS du middleware de session (égalité stricte) : une app n'a pas de cookie. Jeton d'ÉCRIVAIN d'une app de
// `APPS_SORTIES` : l'app vient du NOM de la variable qui a reconnu le jeton, jamais du corps (ADR 0015).
// Refus dans l'ordre des autres routes machine : gel, jeton (401 indiscernable), clé, base, taille, corps.
// ⚠️ PAS DE PORTE DE SAUVETAGE (ADR 0031 § 1) : les tables sont neuves, aucune ligne de l'ancienne clé ne
// peut s'y doubler (ADR 0019 § 2).
//
// ⚠️ LA RÉPONSE ET LES JOURNAUX NE PORTENT QUE DES NOMBRES ET DES CODES : aucun titre ni résumé ne revient.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";
import { APPS_SORTIES, CORPS_MAX, lireEnvoiSorties } from "@/lib/sorties/contrat";
import { ecrireSorties } from "@/lib/sorties/depot";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_SORTIES);
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

  const lu = lireEnvoiSorties(corps, new Date());
  if (!lu.ok) return erreur(lu.code === "corps_invalide" ? 400 : 422, lu.code, lu.message);
  const { envoi } = lu;

  await assurerMigrations();
  const r = await ecrireSorties(db, cle, ecrivain.appId, envoi.sorties);
  return Response.json(
    { recus: envoi.sorties.length + envoi.refuses.length, ecrits: r.ecrits, doublons: r.doublons, refuses: envoi.refuses, ignores: envoi.ignores },
    { status: 200, headers: NO_STORE },
  );
}
