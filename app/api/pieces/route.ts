// app/api/pieces/route.ts — le contrat d'écriture des PIÈCES (ADR 0004 §6.2).
//
// Jumelle de `POST /api/faits`, et volontairement écrite dans le même ordre : une seule
// différence de comportement entre les deux routes serait une différence que personne ne
// pourrait expliquer. Elle est HORS du middleware de session (`isPublicPath`, égalité
// stricte) : un serveur qui appelle un serveur n'a pas de cookie à présenter.
//
// Les réponses, dans l'ordre où elles se décident :
//   503 `memoire_gelee`   — MEMORYAI_GEL=1 : rien n'est écrit, et on le dit ;
//   401 (corps minimal)   — jeton absent, mal formé ou faux : INDISCERNABLES, par choix ;
//   503 `cle_absente`     — MEMORYAI_CHIFFREMENT manquante : fermé, rien n'est écrit ;
//   503 `base_absente`    — DATABASE_URL manquante ;
//   400 `corps_invalide`  — pas du JSON, ou pas `{ pieces: [...] }` ;
//   403 `ecriture_retiree`— jeton de lecture, ou périmètre restreint par Marc ;
//   422 `lot_trop_grand`  — plus de 50 pièces : rien n'est écrit ;
//   200 { recus, acceptees, remplacees, dejaPresentes, oubliees,
//         refusees: [{ index, code, raison }] }.
//
// ⚠⚠ `remplacees` EST LA MOITIÉ UTILE DE LA RÉPONSE POUR L'APPELANT, et c'est pour ça qu'il
// est publié ici et pas seulement compté en interne. DriveAI paie un appel de modèle par
// document ; sans ce champ, un enrichissement réussi et un « rien fait » rendent la MÊME
// réponse (`acceptees: 1`) — donc une boucle qui dépense sans changer l'état serait
// indistinguable d'une boucle qui travaille. C'est le défaut que l'ADR 0006 corrige, et le
// laisser hors de la réponse le recommettrait un cran plus haut.
//
// ⚠️ `oubliees` est RENDU, et ce n'est pas un détail d'affichage. Sans lui, un écrivain qui
// repousse une pièce que Marc a oubliée voit « 0 acceptée » et croit à une panne — il
// réessaie, et le refus silencieux devient une boucle. Un compte qui ne dit pas POURQUOI
// rien n'a été écrit vaut un commentaire (leçon DriveAI du 15/09, payée en production).

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { APPS_PIECES } from "@/lib/pieces/lignee";
import { assurerMigrations } from "@/lib/migrations";
import { reponseSauvetage, SauvetageEnCoursError } from "@/lib/sauvetage/porte";
import { depotPiecesDrizzle } from "@/lib/pieces/depot";
import { ecrireLotPieces, EcriturePiecesRetireeError, LotPiecesTropGrandError } from "@/lib/pieces/ecrire";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  // ADR 0015 §2.1 et §2.3 — seules les apps de `APPS_PIECES` écrivent un papier ; les autres,
  // comme un jeton de lecture ou un inconnu, reçoivent le même refus, AVANT la clé et la base.
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
  const pieces = (corps as { pieces?: unknown } | null)?.pieces;
  if (!corps || typeof corps !== "object" || !Array.isArray(pieces)) {
    return erreur(400, "corps_invalide", "Le corps doit être { pieces: [...] }.");
  }

  await assurerMigrations();
  try {
    const r = await ecrireLotPieces(pieces, ecrivain, cle, depotPiecesDrizzle(db));
    // Le CONTRAT, pas l'objet interne : `idsCrees` sert en processus, jamais à un écrivain
    // distant. Le renvoyer élargirait le contrat public au premier champ ajouté, en silence.
    const { recus, acceptees, remplacees, dejaPresentes, oubliees, refusees } = r;
    return Response.json(
      { recus, acceptees, remplacees, dejaPresentes, oubliees, refusees },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    // ADR 0019 : une PANNE pour l'écrivain (503), qui retente plus tard — jamais un refus.
    if (err instanceof SauvetageEnCoursError) return reponseSauvetage();
    if (err instanceof LotPiecesTropGrandError) return erreur(422, "lot_trop_grand", err.message);
    if (err instanceof EcriturePiecesRetireeError) return refusJeton();
    throw err;
  }
}
