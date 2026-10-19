// app/api/pieces/file/route.ts — [L35] la FILE DE LECTURE (ADR 0007).
//
//   GET  /api/pieces/file?extracteur=<nom>&limite=<n>
//        200 { file: [{ file_id }], restants, extracteur }
//   POST /api/pieces/file   { extracteur, verdicts: [{ file_id, motif }] }
//        200 { notes, inconnus }
//
// ⚠️ MÊME JETON, MÊME RÔLE que `POST /api/pieces` : demander la file et noter un verdict sont
// les deux moitiés du travail d'ÉCRIVAIN. Un jeton de lecture n'a rien à y faire — il n'a
// aucun papier à lire, et un verdict est une écriture (il sort un document de la file).
//
// ⚠️ CE QUI SORT : des `fileId`, rendus à l'app qui les a elle-même fournis à l'inventaire.
// Aucun type, aucun émetteur, aucun résumé. L'ordre (« Revenu Québec d'abord, Facebook en
// dernier ») est calculé ICI sur des clés keyées, et seul son résultat voyage.
//
// ⚠️ `restants` EST DANS LA RÉPONSE, et ce n'est pas du confort : c'est ce qui permet à
// l'écrivain de distinguer « file vide parce que tout est lu » de « file vide parce que ma
// limite valait zéro » — deux états que sa Santé doit dire différemment.

import { cleDepuisEnv, ClefAbsenteError, type Cle } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { APPS_PIECES } from "@/lib/pieces/lignee";
import { assurerMigrations } from "@/lib/migrations";
import {
  depotFileDeLectureDrizzle,
  extracteurValide,
  limiteDeFile,
  validerVerdicts,
} from "@/lib/pieces/fileDeLecture";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

/** Les gardes communes aux deux verbes. Rend la réponse de refus, ou la clé. */
function entrer(request: Request): { refus: Response } | { cle: Cle } {
  if (estGele()) return { refus: reponseGelee() };
  // ⚠️ Re-vérifié ICI, pas seulement au moment d'écrire, et pour la LECTURE de la file aussi
  // (ADR 0015 §2.1) : la file est celle de DriveAI. Un jeton de lecture, d'une autre app ou
  // inconnu reçoit le même refus (§2.3), avant la clé et la base.
  if (!ecrivainAutorise(request.headers.get("authorization"), APPS_PIECES)) return { refus: refusJeton() };
  try {
    const cle = cleDepuisEnv();
    if (!baseConfiguree()) return { refus: erreur(503, "base_absente", "DATABASE_URL manquante.") };
    return { cle };
  } catch (err) {
    if (err instanceof ClefAbsenteError) return { refus: erreur(503, "cle_absente", err.message) };
    throw err;
  }
}

export async function GET(request: Request): Promise<Response> {
  const e = entrer(request);
  if ("refus" in e) return e.refus;

  const url = new URL(request.url);
  const extracteur = extracteurValide(url.searchParams.get("extracteur"));
  if (!extracteur) return erreur(400, "extracteur_requis", "`extracteur` doit nommer le lecteur qui demande.");
  const limite = limiteDeFile(url.searchParams.get("limite"));

  await assurerMigrations();
  const depot = depotFileDeLectureDrizzle(db, e.cle);
  const [file, restants] = await Promise.all([depot.prochains(extracteur, limite), depot.restants(extracteur)]);
  return Response.json(
    { file: file.map((file_id) => ({ file_id })), restants, extracteur },
    { status: 200, headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<Response> {
  const e = entrer(request);
  if ("refus" in e) return e.refus;

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return erreur(400, "corps_invalide", "Le corps doit être du JSON.");
  }
  const extracteur = extracteurValide((corps as { extracteur?: unknown } | null)?.extracteur);
  if (!extracteur) return erreur(400, "extracteur_requis", "`extracteur` doit nommer le lecteur qui a essayé.");
  const v = validerVerdicts((corps as { verdicts?: unknown } | null)?.verdicts);
  if (!v.ok) return erreur(400, "verdicts_invalides", v.message);

  await assurerMigrations();
  const r = await depotFileDeLectureDrizzle(db, e.cle).noterVerdicts(extracteur, v.verdicts);
  return Response.json(r, { status: 200, headers: NO_STORE });
}
