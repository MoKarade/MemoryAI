// app/api/avancement/route.ts — une app pousse ses COMPTES à la Mémoire (ADR 0009).
//
//   POST /api/avancement   { version: 1, mesureLe, classes, envoi, fileLecture, joursLus }
//        200 { ok: true, recu: true }
//
// ── POURQUOI ─────────────────────────────────────────────────────────────────────────────
//
// Marc, le 23/09 : une interface « Avancement » dans la Mémoire, pareille à celle de DriveAI.
// La Mémoire sait ce qu'elle a REÇU et LU ; elle ne sait rien de ce que DriveAI a classé, envoyé,
// ni du dossier où il lit en ce moment. La Mémoire ne détient AUCUN jeton (ADR 0001) : elle ne
// peut pas aller le lire. C'est donc DriveAI qui pousse.
//
// ── CE QUI ENTRE, ET CE QUI N'ENTRE PAS ──────────────────────────────────────────────────
//
// Des NOMBRES, des dates, des codes de dossier (`lib/avancement/contrat.ts`, `.strict()`). Aucun
// nom de fichier, aucun texte libre, aucun fait. Rien n'est servi à un modèle.
//
// ⚠️ L'APP VIENT DU JETON, JAMAIS DU CORPS : une app ne peut pas écrire l'avancement d'une autre.
// ⚠️ UN JETON D'ÉCRITURE est exigé, et un jeton de lecture reçoit le MÊME 401 qu'un jeton faux :
// cette route n'a pas à dire à un inconnu qu'il a trouvé un nom de variable valide.
// ⚠️ LE GEL REFUSE : `MEMORYAI_GEL` arrête ce qui ÉCRIT, et cette route écrit (contrairement à
// `GET /api/etat`, qui ne fait que lire et publie le gel au lieu de s'arrêter).

import { validerAvancement, TAILLE_MAX_OCTETS } from "@/lib/avancement/contrat";
import { depotAvancementDrizzle } from "@/lib/avancement/depot";
import { baseConfiguree, db } from "@/lib/db";
import { estGele, reponseGelee } from "@/lib/gel";
import { ecrivainAutorise, refusJeton } from "@/lib/jetons";
import { assurerMigrations } from "@/lib/migrations";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function erreur(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: code, ...extra }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return reponseGelee();

  // ⚠️ Lecture et inconnu confondus EXPRÈS : même code, même corps (`refusJeton`, ADR 0015 §2.3).
  const ecrivain = ecrivainAutorise(request.headers.get("authorization"));
  if (!ecrivain) return refusJeton();

  if (!baseConfiguree()) return erreur(503, "base_absente", { message: "DATABASE_URL manquante." });

  // ⚠️ La taille se juge sur les OCTETS lus, pas sur `content-length`, qu'un appelant peut omettre
  // ou mentir. Un corps plus gros que tout envoi légitime n'est même pas analysé.
  const texte = await request.text();
  if (Buffer.byteLength(texte, "utf8") > TAILLE_MAX_OCTETS) return erreur(413, "trop_gros");

  let corps: unknown;
  try {
    corps = JSON.parse(texte);
  } catch {
    return erreur(400, "corps_invalide", { message: "Le corps doit être du JSON." });
  }

  const v = validerAvancement(corps);
  if (!v.ok) {
    return v.code === "version_inconnue"
      ? erreur(422, "version_inconnue", {
          message: "Cette version de la Mémoire ne lit pas encore ce format : c'est elle qui est à mettre à jour.",
        })
      : // Les CHEMINS des champs refusés, jamais leurs valeurs.
        erreur(422, "schema_refuse", { champs: v.chemins });
  }

  await assurerMigrations();
  await depotAvancementDrizzle(db).enregistrer(ecrivain.appId, v.avancement);
  return Response.json({ ok: true, recu: true }, { status: 200, headers: NO_STORE });
}
