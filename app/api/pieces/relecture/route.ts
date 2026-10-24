// app/api/pieces/relecture/route.ts — la seconde lecture des papiers par DriveAI (ADR 0026).
//
// Jumelle de `POST /api/pieces`, mêmes refus dans le même ordre ; hors du middleware de session.
//   200 { recus, vrais, doutes, exclus, dejaRelus, refusees: [{ index, code }] }
// ⚠️ Rien que des nombres et des codes fermés : rendre la première lecture, même pour dire où
// elle diverge, la donnerait à l'appelant, et la seconde ne serait plus aveugle.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";
import { depotRelectureDrizzle } from "@/lib/pieces/depotRelecture";
import { EcriturePiecesRetireeError } from "@/lib/pieces/ecrire";
import { APPS_PIECES } from "@/lib/pieces/lignee";
import { LotRelecturesTropGrandError, relireLot } from "@/lib/pieces/relire";
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

  await assurerMigrations();
  try {
    const r = await relireLot(relectures, ecrivain, cle, depotRelectureDrizzle(db));
    return Response.json(r, { status: 200, headers: NO_STORE });
  } catch (err) {
    if (err instanceof SauvetageEnCoursError) return reponseSauvetage();
    if (err instanceof LotRelecturesTropGrandError) return erreur(422, "lot_trop_grand", err.message);
    if (err instanceof EcriturePiecesRetireeError) return refusJeton();
    throw err;
  }
}
