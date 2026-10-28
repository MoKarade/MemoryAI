// app/api/pieces/relecture/route.ts — la seconde lecture des papiers par DriveAI (ADR 0026).
//
// Jumelle de `POST /api/pieces`, mêmes refus dans le même ordre ; hors du middleware de session.
//   POST 200 { recus, vrais, doutes, departages, exclus, dejaRelus, refusees: [{ index, code }] }
//        corps { rang?: 2|3, relectures }. Rang 3 (28/10) : la troisième lecture d'un papier en doute.
//   GET  200 { aRelire: [{ file_id, extracteur }], parExtracteur: { <étiquette>: n } }
//        ?canal=texte|vision (le canal de la seconde lecture), ?limite=1..50 : ce qu'il reste à
//        relire, pour que DriveAI ne paie pas des lectures que la porte refuserait (25/10).
//   GET ?rang=3 : { aDepartager: [{ file_id, extracteurs: [première, seconde] }] }, les papiers en doute sans 3e lecture.
// ⚠️ Rien que des nombres et des codes fermés : rendre la première lecture, même pour dire où
// elle diverge, la donnerait à l'appelant, et la seconde ne serait plus aveugle.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";
import { aRelireParExtracteur, depotRelectureDrizzle, papiersADepartager, papiersARelire } from "@/lib/pieces/depotRelecture";
import { EcriturePiecesRetireeError } from "@/lib/pieces/ecrire";
import { APPS_PIECES } from "@/lib/pieces/lignee";
import { LotRelecturesTropGrandError, relireLot } from "@/lib/pieces/relire";
import { LOT_MAX_RELECTURES } from "@/lib/pieces/secondeLecture";
import { reponseSauvetage, SauvetageEnCoursError } from "@/lib/sauvetage/porte";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_PIECES);
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
  const relectures = (corps as { relectures?: unknown } | null)?.relectures;
  if (!corps || typeof corps !== "object" || !Array.isArray(relectures)) {
    return erreur(400, "corps_invalide", "Le corps doit être { relectures: [...] }.");
  }

  const rang = (corps as { rang?: unknown }).rang;
  if (rang !== undefined && rang !== 2 && rang !== 3) return erreur(400, "rang_invalide", "rang : 2 (seconde lecture) ou 3 (départage).");

  await assurerMigrations();
  try {
    const r = await relireLot(relectures, ecrivain, cle, depotRelectureDrizzle(db), new Date(), rang ?? 2);
    return Response.json(r, { status: 200, headers: NO_STORE });
  } catch (err) {
    if (err instanceof SauvetageEnCoursError) return reponseSauvetage();
    if (err instanceof LotRelecturesTropGrandError) return erreur(422, "lot_trop_grand", err.message);
    if (err instanceof EcriturePiecesRetireeError) return refusJeton();
    throw err;
  }
}

/**
 * Ce qu'il reste à relire. Le même jeton d'écrivain que le POST : un lecteur n'a rien à relire.
 * ⚠️ Le gel ne bloque pas ce GET : il n'écrit rien (comme `GET /api/etat`).
 */
export async function GET(request: Request): Promise<Response> {
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_PIECES);
  if (!ecrivain) return refusJeton();
  if (!baseConfiguree()) return erreur(503, "base_absente", "DATABASE_URL manquante : rien n'est lu.");

  const url = new URL(request.url);
  const rang = url.searchParams.get("rang");
  const canal = url.searchParams.get("canal");
  if (rang !== null && rang !== "3") return erreur(400, "rang_invalide", "rang=3 : les papiers en doute à départager.");
  if (rang === null && canal !== "texte" && canal !== "vision") return erreur(400, "canal_invalide", "canal=texte ou canal=vision : le canal de la seconde lecture.");
  const brut = url.searchParams.get("limite");
  const limite = brut === null ? LOT_MAX_RELECTURES : Number(brut);
  if (!Number.isInteger(limite) || limite < 1 || limite > LOT_MAX_RELECTURES) {
    return erreur(400, "limite_invalide", `limite entre 1 et ${LOT_MAX_RELECTURES}.`);
  }

  await assurerMigrations();
  if (rang === "3") {
    const aDepartager = await papiersADepartager(db, limite);
    return Response.json({ aDepartager: aDepartager.map((l) => ({ file_id: l.fileId, extracteurs: l.extracteurs })) }, { headers: NO_STORE });
  }
  const [lignes, parExtracteur] = await Promise.all([papiersARelire(db, canal as "texte" | "vision", limite), aRelireParExtracteur(db)]);
  return Response.json({ aRelire: lignes.map((l) => ({ file_id: l.fileId, extracteur: l.extracteur })), parExtracteur }, { headers: NO_STORE });
}
