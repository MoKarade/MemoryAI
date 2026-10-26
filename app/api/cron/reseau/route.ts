// app/api/cron/reseau/route.ts — l'HORLOGE du réseau de LIA (tâche MemoryAI 186). Une passe par
// jour : elle recalcule les liens des règles, puis les liens DEVINÉS par le petit modèle local.
//
// ⚠️ POURQUOI UNE ROUTE À PART, et pas une étape de `/api/cron/apprentissage`. Le modèle pèse
// ≈ 280 Mo et se charge en quelques secondes, puis compare des milliers de faits : dans la même
// fonction que l'apprentissage, une passe longue couperait l'autre à la borne des 300 s, et ce qui
// serait perdu ne se verrait pas. Ici chaque horloge a sa borne et sa réponse.
//
// ⚠️ Même garde que l'apprentissage : secret DÉDIÉ `CRON_SECRET` (503 absent, 401 faux), jamais
// un jeton d'écrivain ; GET = POST parce que Vercel Cron appelle en GET. Elle traverse le
// middleware par l'exclusion du matcher et `isPublicPath`. La réponse dit des COMPTES, jamais un texte.

import { timingSafeEqual, createHash } from "node:crypto";
import { depotLiensDrizzle, type Recalcul } from "@/lib/depotLiens";
import { estGele } from "@/lib/gel";
import { accesDonnees } from "@/lib/pageDonnees";
import { plongeurLocal } from "@/lib/plongement";

export const dynamic = "force-dynamic";
/** Télécharger le modèle, le charger, comparer : la borne maximale du plan gratuit. */
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function memeSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Ce qu'une étape rend dans la réponse : ses comptes, ou l'échec dit. */
type Etape = (Omit<Recalcul, "abstentions"> & { abstentions: number }) | "echec";

const resumer = (r: Recalcul): Etape => ({ faitsLus: r.faitsLus, illisibles: r.illisibles, liensEcrits: r.liensEcrits, abstentions: r.abstentions.length });

export async function POST(req: Request): Promise<Response> {
  const attendu = process.env.CRON_SECRET?.trim();
  if (!attendu) {
    return Response.json({ erreur: "cron_non_configure", motif: "CRON_SECRET absent côté serveur" }, { status: 503, headers: NO_STORE });
  }
  const presente = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!memeSecret(presente, attendu)) {
    return Response.json({ erreur: "non_autorise" }, { status: 401, headers: NO_STORE });
  }

  // Un gel ou une base absente sont des ÉTATS, dits avec un 200 : un 500 ferait rougir le
  // planificateur tous les jours pour une intégration simplement éteinte.
  if (estGele()) return Response.json({ fin: "gel" }, { headers: NO_STORE });
  const acces = await accesDonnees();
  if (!acces.ok) return Response.json({ fin: acces.manque === "base" ? "base-absente" : "cle-absente" }, { headers: NO_STORE });

  const depot = depotLiensDrizzle(acces.db);
  const maintenant = new Date();
  let regles: Etape;
  try {
    regles = resumer(await depot.recalculer(acces.cle, maintenant));
  } catch (err) {
    console.error("[reseau] règles impossibles", err);
    regles = "echec";
  }
  // ⚠️ Un échec du modèle (téléchargement, moteur) laisse les liens devinés d'hier en place et se
  // DIT : `devines: "echec"`, jamais une fin muette ni un réseau vidé.
  let devines: Etape;
  try {
    devines = resumer(await depot.recalculerSens(acces.cle, maintenant, await plongeurLocal()));
  } catch (err) {
    console.error("[reseau] liens devinés impossibles", err);
    devines = "echec";
  }
  return Response.json({ fin: "ok", regles, devines }, { headers: NO_STORE });
}

/** Vercel Cron appelle en GET (voir `/api/cron/apprentissage`). Même garde. */
export const GET = POST;
