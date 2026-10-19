// app/api/faits/route.ts — le contrat d'écriture des apps (ADR 0001 §5.1).
//
// Cette route traduit HTTP ↔ `ecrireLot` et rien d'autre. Elle est HORS du middleware de
// session (`isPublicPath`, égalité stricte) : un serveur qui appelle un serveur n'a pas de
// cookie à présenter — elle porte SA PROPRE authentification, le jeton d'écrivain.
//
// Les réponses, dans l'ordre où elles se décident, chacune distincte de la suivante :
//   503 `memoire_gelee`   — MEMORYAI_GEL=1 : rien n'est écrit, et on le dit ;
//   401 `refusJeton()`    — jeton absent, mal formé, faux, de LECTURE, ou écriture retirée par
//                           Marc : INDISCERNABLES, code ET corps (ADR 0015 §2.3) ;
//   503 `cle_absente`     — MEMORYAI_CHIFFREMENT manquante : fermé, rien n'est écrit ;
//   503 `base_absente`    — DATABASE_URL manquante ;
//   400 `corps_invalide`  — pas du JSON, ou pas `{ faits: [...] }` ;
//   422 `lot_trop_grand`  — plus de 50 faits : rien n'est écrit ;
//   200 { recus, acceptes, dejaPresents, refuses: [{ index, code, raison }] }.
// Une PANNE n'est jamais rendue comme un REFUS (503 ≠ 401), sinon l'écrivain jette son jeton.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { depotDrizzle } from "@/lib/depotFaits";
import { ecrireLot, EcritureRetireeError, LotTropGrandError } from "@/lib/ecrireFaits";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  // ADR 0015 §2.3 — identité ET rôle AVANT la clé et la base : un jeton hors rôle ne voit jamais un 503.
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"));
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
  const faits = (corps as { faits?: unknown } | null)?.faits;
  if (!corps || typeof corps !== "object" || !Array.isArray(faits)) {
    return erreur(400, "corps_invalide", "Le corps doit être { faits: [...] }.");
  }

  await assurerMigrations();
  try {
    const resultat = await ecrireLot(faits, ecrivain, cle, depotDrizzle(db));
    // ⚠️ LE CONTRAT, PAS L'OBJET INTERNE. `ResultatLot` porte aussi `idsCrees` — utile à un
    // appelant EN PROCESSUS (la page de questions lie la réponse de Marc au fait qu'elle
    // vient de créer), sans aucune raison de partir chez un écrivain distant. Renvoyer
    // l'objet entier élargirait le contrat public au premier champ ajouté, en silence.
    const { recus, acceptes, dejaPresents, refuses } = resultat;
    return Response.json({ recus, acceptes, dejaPresents, refuses }, { status: 200, headers: NO_STORE });
  } catch (err) {
    if (err instanceof LotTropGrandError) return erreur(422, "lot_trop_grand", err.message);
    if (err instanceof EcritureRetireeError) return refusJeton();
    throw err;
  }
}
