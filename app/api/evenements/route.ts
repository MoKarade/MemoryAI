// app/api/evenements/route.ts — DriveAI pousse ici un export Messenger qu'il a relu (ADR 0020).
//
//   POST /api/evenements   { source: "messenger", file_id, html }
//        200 { lus, ecrits, dejaPresents, datesIllisibles, personnesNouvelles, secretsRetires, oublie }
//
// HORS du middleware de session (égalité stricte) : DriveAI n'a pas de cookie. Jeton d'ÉCRIVAIN
// de DriveAI seulement : c'est lui qui tient le Drive, et MemoryAI ne détient aucun jeton Google.
//
// ⚠️ LA RÉPONSE ET LES JOURNAUX NE PORTENT QUE DES NOMBRES. Ni texte, ni nom, ni fil : un journal
// Vercel n'est pas chiffré, et une erreur qui citerait un message le publierait.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { importerExport } from "@/lib/evenements/depot";
import { lireExportMessenger } from "@/lib/evenements/messenger";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Seule l'app qui tient le Drive écrit des messages : en ajouter une est une décision de frontière. */
const APPS_EVENEMENTS: ReadonlySet<string> = new Set(["driveai"]);
/** Sous la limite de corps de Vercel (4,5 Mo) : un export plus gros est refusé, pas tronqué. */
const HTML_MAX = 4_000_000;
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_EVENEMENTS);
  if (!ecrivain) return refusJeton();

  let cle;
  try {
    cle = cleDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return erreur(503, "cle_absente", err.message);
    throw err;
  }
  if (!baseConfiguree()) return erreur(503, "base_absente", "DATABASE_URL manquante : rien n'est écrit.");

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return erreur(400, "corps_invalide", "Le corps doit être du JSON.");
  }
  const { source, file_id: fileId, html } = (corps ?? {}) as Record<string, unknown>;
  if (source !== "messenger") return erreur(422, "source_inconnue", "Seule la source « messenger » est reconnue.");
  if (typeof fileId !== "string" || !FILE_ID.test(fileId)) return erreur(422, "file_id_invalide", "file_id doit être un identifiant Drive.");
  if (typeof html !== "string" || html.length === 0) return erreur(422, "html_absent", "html doit être le contenu de l'export.");
  if (html.length > HTML_MAX) return erreur(413, "export_trop_grand", `Export de plus de ${HTML_MAX} caractères : rien n'est écrit.`);

  await assurerMigrations();
  const r = await importerExport(db, cle, lireExportMessenger(html), fileId, ecrivain.appId);
  return Response.json(r, { status: 200, headers: NO_STORE });
}
