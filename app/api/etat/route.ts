// app/api/etat/route.ts — CE QUE LA MÉMOIRE SAIT, EN CHIFFRES, POUR UNE APP QUI L'ALIMENTE.
//
// ── POURQUOI CETTE ROUTE EXISTE ───────────────────────────────────────────────────────────
//
// Marc, le 23/09/2026, devant l'onglet « Lecture » de DriveAI : « manque aussi des infos sur
// la vitesse, sur ce qu'il reste, sur ce qui est validé SÉPARÉMENT par driveai et memory ai —
// je comprends pas la page ».
//
// DriveAI sait ce qu'il a ENVOYÉ ; il ne sait rien de ce qu'il en est DEVENU. « 590 acceptés »
// et « 343 faits validés » ne sont pas la même grandeur, et l'écran qui n'en montre qu'une
// laisse croire que l'autre n'existe pas. Cette route donne à l'appelant l'autre moitié —
// et rien d'autre.
//
// ── CE QUI SORT, ET CE QUI NE SORT PAS ────────────────────────────────────────────────────
//
// Des NOMBRES. Aucun fait, aucun papier, aucun nom de fichier, aucun domaine, aucune date de
// document. La frontière de l'ADR 0001 n'est pas élargie d'un pouce : on publie des comptes
// sur la mémoire, jamais un morceau de son contenu. `dernierValideLe` est un horodatage de
// TRAITEMENT, pas une date lue dans un papier.
//
// ⚠️ LE GEL NE BLOQUE PAS CETTE ROUTE, il est PUBLIÉ. `MEMORYAI_GEL` arrête ce qui ÉCRIT ;
// répondre 503 ici cacherait l'état au moment précis où l'on cherche à comprendre pourquoi
// plus rien n'avance — c'est-à-dire exactement quand cette route sert. L'appelant lit `gele`
// et le dit.
//
// ⚠️ UNE BASE INJOIGNABLE REND 503, JAMAIS DES ZÉROS. Un cumul à 0 se lit « la mémoire est
// vide » — un fait, et le plus alarmant possible — là où la vérité est « je n'ai pas pu
// lire ». C'est la règle du parc (« une donnée illisible se COMPTE, elle ne se rabat pas sur
// zéro »), appliquée au cas où il n'y a rien à compter du tout.
//
// ⚠️ UN JETON DE LECTURE SUFFIT, et c'est le plus petit droit qui répond à la question : rien
// ici n'écrit. Les trois refus (jeton absent, mal formé, faux) restent INDISCERNABLES — les
// distinguer ferait de cette route un oracle qui dit à un inconnu s'il a trouvé un nom de
// variable.

import { baseConfiguree, db } from "@/lib/db";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { estGele } from "@/lib/gel";
import { identifierEcrivain, jetonDepuisEntete, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { composerEtatPublic } from "@/lib/etatPublic";
import { papiersVraisParLia } from "@/lib/pieces/depotRelecture";
import { valideesParLia } from "@/lib/relectureLia";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const appelant = identifierEcrivain(jetonDepuisEntete(request.headers.get("authorization")));
  // Ouverte à tout jeton connu (ADR 0015 §2.3, tranché par pole-securite) ; le refus est le refus commun.
  if (!appelant) return refusJeton();

  if (!baseConfiguree()) {
    return Response.json(
      { error: "base_absente", message: "DATABASE_URL n'est pas configurée : aucun compte n'a pu être lu." },
      { status: 503, headers: NO_STORE },
    );
  }

  // ⚠️ Comme les autres routes de ce dépôt : une migration jamais appliquée ferait échouer la
  // première requête avec un message de Postgres, pas avec le nôtre.
  await assurerMigrations();

  const faits = await depotLectureDrizzle(db).comptes();
  const pieces = depotPiecesLectureDrizzle(db);
  const papiers = await pieces.comptes();
  const extracteurs = await pieces.comptesParExtracteur();
  // Ce que LIA a tranché seule : Marc ne juge plus rien (tâche MemoryAI 231).
  const parLia = { faits: await valideesParLia(db), papiers: await papiersVraisParLia(db) };

  // ⚠️ La composition est PURE et vit dans `lib/etatPublic.ts` : c'est elle que les tests
  // perturbent, sans base. Une seconde mise en forme écrite ici serait « une règle et demie ».
  return Response.json(composerEtatPublic(faits, papiers, extracteurs, estGele(), parLia), { headers: NO_STORE });
}
