// app/api/lia/ask/route.ts — LIA dans sa maison : la bulle de LIA sur les pages de MemoryAI
// (`components/LiaMaison.tsx`). DERRIÈRE le middleware de session ET revérifiée ici ; aucun jeton
// dans le navigateur. Même tour que la porte du hub (`lib/lia/repondre.ts`, ADR 0016 § 7) :
// niveaux 0 et 1, outils en lecture seule, blocs sourcés. Le chat plein écran garde ses bascules.
//
// Réponses : 503 gelée · 401 sans session · 413 / 400 corps · 503 LIA indisponible (nommé) ·
// 500 le reste · 200 `{ text, blocks? }`. `source` et `proprietaire` sont IMPOSÉS ici, jamais lus
// du navigateur : MemoryAI n'a pas d'invités.

import { estGele } from "@/lib/gel";
import { DEMANDE_MAISON, LECTEUR_LIA_MAISON, lireDemande } from "@/lib/lia/ask";
import { erreurLia as erreur, repondreLia } from "@/lib/lia/repondre";
import { NonAutorise, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (estGele()) return erreur(503, "gelee", "MemoryAI est gelée : LIA ne répond pas.");
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) return erreur(401, "non_autorise", err.message);
    throw err;
  }
  const lu = lireDemande(await request.text(), DEMANDE_MAISON);
  if (!lu.ok) return erreur(lu.status, lu.code, lu.message);
  return repondreLia(lu.demande, new URL(request.url).origin, LECTEUR_LIA_MAISON);
}
