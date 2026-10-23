// app/api/conversations/route.ts — Claude Code pousse ses sessions ici (ADR 0002 §5.2, lot 10).
//
// HORS du middleware de session (`isPublicPath`, égalité stricte) : un script qui appelle un
// serveur n'a pas de cookie à présenter. Elle porte SA PROPRE authentification — le jeton
// `MEMORYAI_TOKEN_CLAUDECODE_ECRITURE`, reconnu par le même `identifierEcrivain` que
// `POST /api/faits`, donc app et rôle déduits du NOM de la variable, jamais du corps.
//
// Les réponses, chacune distincte de la suivante :
//   503 `memoire_gelee`          — MEMORYAI_GEL=1 ;
//   401 `refusJeton()`           — jeton absent, mal formé, faux, de lecture, ou d'une autre app
//                                  que claudecode : INDISCERNABLES, sans nom d'app (ADR 0015 §2.3) ;
//   503 `cle_absente` / `base_absente` ;
//   400 / 422 selon `validerEntree` — dont `resultat_outil_interdit`, la garde qui compte ;
//   200 { conversationId, ecrits, secretsRetires }.
//
// ⚠️ `secretsRetires` est RENDU à l'appelant. C'est voulu : le script de Marc affiche ce
// nombre avant de rendre la main, et un envoi qui masque quinze fragments est une information
// qu'il doit voir — pas un chiffre qui dort dans une table.

import { cleDepuisEnv, ClefAbsenteError } from "@/lib/chiffrement";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { validerEntree } from "@/lib/conversations/entree";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";
import { depotSauvetageDrizzle } from "@/lib/sauvetage/depot";
import { reponseSauvetage } from "@/lib/sauvetage/porte";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * La SEULE app autorisée à consigner une conversation par cette route. Un jeton de DriveAI
 * écrit des faits ; il n'a aucune raison d'écrire une conversation, et le lui permettre
 * élargirait son périmètre sans décision — exactement la « permission nue » que l'ADR refuse.
 */
const APPS_AUTORISEES: Readonly<Record<string, "claude-code">> = { claudecode: "claude-code" };
const APPS_CONVERSATIONS: ReadonlySet<string> = new Set(Object.keys(APPS_AUTORISEES));

function erreur(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  // ADR 0015 §2.3 — une autre app reçoit EXACTEMENT le refus d'un inconnu : ni 403, ni son nom.
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"), APPS_CONVERSATIONS);
  const source = ecrivain ? APPS_AUTORISEES[ecrivain.appId] : undefined;
  if (!source) return refusJeton();

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

  // La source est IMPOSÉE par le jeton, jamais lue dans le corps : c'est le jeton qui
  // identifie l'appelant, comme pour `POST /api/faits`.
  const v = validerEntree(corps, source);
  if (!v.ok) {
    const status = v.code === "corps_invalide" || v.code === "champ_inconnu" ? 400 : 422;
    return erreur(status, v.code, v.raison);
  }

  await assurerMigrations();
  if (await depotSauvetageDrizzle(db).ecrituresFermees()) return reponseSauvetage();
  const depot = depotConversationsDrizzle(db);
  const maintenant = new Date();
  const existante = v.conversationId !== null ? await depot.parId(v.conversationId) : null;
  const id = existante?.id ?? (await depot.demarrer(source, maintenant));
  const r = await depot.consigner(id, v.messages, cle, maintenant);

  return Response.json(
    { conversationId: r.conversationId, ecrits: r.ecrits, secretsRetires: r.secretsRetires },
    { status: 200, headers: NO_STORE },
  );
}
