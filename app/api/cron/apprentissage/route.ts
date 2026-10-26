// app/api/cron/apprentissage/route.ts — l'HORLOGE de l'apprentissage (lot 16).
//
// Une passe par jour : elle lit les conversations neuves, en tire des faits `propose`, puis
// demande à Marc ce qui manque encore. C'est le second déclencheur ; le premier est la fin
// d'un tour de chat (`app/api/chat/route.ts`), plus réactif mais qui ne voit que le chat —
// celui-ci ramasse aussi ce que claude.ai et Claude Code ont consigné.
//
// ⚠️ SECRET DÉDIÉ, jamais un jeton d'écrivain. Ce que cette route déclenche est une DÉPENSE
// et une écriture de masse : c'est un pouvoir qu'aucune app n'a de raison d'avoir, et qui se
// propagerait à chacune. `CRON_SECRET` absent côté serveur ⇒ 503 ; faux ⇒ 401. La
// distinction EST le diagnostic (l'un envoie sur Vercel, l'autre sur le planificateur).
// Patron repris de `/api/cron/releve` de Hubperso (son ADR 0003).
//
// ⚠️ Elle traverse le middleware par `isPublicPath`, jamais par le matcher — comme les autres
// routes machine. Elle n'est pas OUVERTE : elle est authentifiée AUTREMENT, parce qu'un
// planificateur n'a pas de cookie de session à présenter.
//
// ⚠️ Vercel (plan gratuit) n'autorise QUE des crons QUOTIDIENS. La réactivité ne vient donc
// pas d'ici : elle vient du chat. Ne pas mettre `0 */2 * * *` — le déploiement ÉCHOUE.

import { timingSafeEqual, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { depotBancDrizzle, passeBanc, sourcesPapiers, type FinPasseBanc } from "@/lib/banc/passe";
import { passeApprentissage, passeVide, MOTIFS_FIN_PASSE, type ResultatPasse } from "@/lib/apprentissage";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { MODELE_DEFAUT } from "@/lib/coutChat";
import { comptesParPredicatValides, depotAdminDrizzle } from "@/lib/depotAdmin";
import { passeDeduction, sourcesDeduction, type ResultatDeduction } from "@/lib/deductionPasse";
import { depotDrizzle } from "@/lib/depotFaits";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { estGele } from "@/lib/gel";
import { passeIdees, type ResultatIdees } from "@/lib/idees/depot";
import { rendreLisible } from "@/lib/lecture";
import { accesDonnees } from "@/lib/pageDonnees";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { depotRelectureDrizzle } from "@/lib/relectureLia";
import { purgerSorties, type ResultatPurge } from "@/lib/sorties/retention";

export const dynamic = "force-dynamic";
/** Une passe lit plusieurs conversations et appelle le modèle : la seconde par défaut ne suffit pas. */
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function memeSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function rendre(
  r: ResultatPasse,
  banc: FinPasseBanc | "echec" | null = null,
  deduction: ResultatDeduction | "echec" | null = null,
  idees: ResultatIdees | "echec" | null = null,
  sorties: ResultatPurge | "echec" | null = null,
): Response {
  return Response.json({ ...r, motif: MOTIFS_FIN_PASSE[r.fin], banc, deduction, idees, sorties }, { status: 200, headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const attendu = process.env.CRON_SECRET?.trim();
  // 503 et 401 ne disent pas la même chose : « je ne suis pas configurée » envoie sur Vercel,
  // « tu n'es pas le bon » envoie sur le planificateur. Les confondre coûte un diagnostic.
  if (!attendu) {
    return Response.json({ erreur: "cron_non_configure", motif: "CRON_SECRET absent côté serveur" }, { status: 503, headers: NO_STORE });
  }
  const presente = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!memeSecret(presente, attendu)) {
    return Response.json({ erreur: "non_autorise" }, { status: 401, headers: NO_STORE });
  }

  // ⚠️ Un gel, une base absente ou une clé absente NE SONT PAS des pannes : ce sont des états,
  // et une passe qui les rencontre le DIT avec un 200. Un 500 ferait rougir le planificateur
  // tous les jours pour une intégration simplement éteinte, et on prendrait l'habitude du rouge.
  if (estGele()) return rendre(passeVide("gel"));
  const acces = await accesDonnees();
  if (!acces.ok) return rendre(passeVide(acces.manque === "base" ? "base-absente" : "cle-absente"));

  // Le banc de la refonte LIA (MemoryAI#69) : Postgres seul, aucun modèle, donc AVANT la clé
  // Anthropic. ⚠️ Son échec ne bloque pas l'apprentissage, mais il se VOIT : journal serveur,
  // et `banc: "echec"` dans la réponse — jamais une fin muette.
  let banc: FinPasseBanc | "echec";
  try {
    banc = (
      await passeBanc({
        depot: depotBancDrizzle(acces.db),
        sources: sourcesPapiers(depotPiecesLectureDrizzle(acces.db), acces.cle),
        cle: acces.cle,
        maintenant: () => new Date(),
      })
    ).fin;
  } catch (err) {
    console.error("[banc] passe impossible", err);
    banc = "echec";
  }

  // Les faits déduits (ADR 0023, tâche MemoryAI 185) : une règle, aucun modèle, donc AVANT la clé
  // Anthropic aussi. Même contrat que le banc : un échec se voit (`deduction: "echec"`), il ne
  // bloque rien. Une passe par jour suffit : l'âge ne change qu'une fois par an.
  let deduction: ResultatDeduction | "echec";
  try {
    deduction = await passeDeduction({
      sources: sourcesDeduction(acces.db, depotPiecesLectureDrizzle(acces.db), acces.cle),
      faits: depotDrizzle(acces.db),
      admin: depotAdminDrizzle(acces.db),
      cle: acces.cle,
      maintenant: new Date(),
    });
  } catch (err) {
    console.error("[deduction] passe impossible", err);
    deduction = "echec";
  }

  // Les idées de LIA pour tes apps (ADR 0027, tâche MemoryAI 233) : des comptes sur les demandes
  // du hub, aucun modèle, donc AVANT la clé Anthropic. Même contrat : un échec se voit
  // (`idees: "echec"`), il ne bloque rien. La réponse ne porte que des nombres.
  let idees: ResultatIdees | "echec";
  try {
    idees = await passeIdees(acces.db, acces.cle, new Date());
  } catch (err) {
    console.error("[idees] passe impossible", err);
    idees = "echec";
  }

  // La rétention des sorties des apps (ADR 0031 § 4, tâche MemoryAI 281) : 180 jours puis 2 000 par app, aucun
  // modèle, donc AVANT la clé Anthropic. Même contrat : un échec se voit (`sorties: "echec"`), il ne bloque rien.
  let sorties: ResultatPurge | "echec";
  try {
    sorties = await purgerSorties(acces.db, new Date());
  } catch (err) {
    console.error("[sorties] purge impossible", err);
    sorties = "echec";
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return rendre(passeVide("cle-absente"), banc, deduction, idees, sorties);

  const anthropic = new Anthropic({ apiKey });
  const r = await passeApprentissage({
    // Même passerelle que `extraireAction` : le SDK expose un type d'union (stream ou non)
    // que notre contrat `ClientModele` restreint volontairement au cas non-stream.
    client: { create: (p) => anthropic.messages.create(p as Parameters<typeof anthropic.messages.create>[0]) as never },
    modele: MODELE_DEFAUT,
    cle: acces.cle,
    conversations: depotConversationsDrizzle(acces.db),
    ecriture: depotDrizzle(acces.db),
    admin: depotAdminDrizzle(acces.db),
    questions: depotQuestionsDrizzle(acces.db),
    maintenant: () => new Date(),
    /**
     * Les faits candidats à une contradiction, DÉCHIFFRÉS ici — `lib/apprentissage.ts` ne
     * porte pas la clé, comme il ne porte pas la base.
     *
     * ⚠️ Un fait ILLISIBLE est ÉCARTÉ, jamais rendu avec une valeur vide : deux faits
     * illisibles auraient tous deux la valeur `""`, donc se compteraient comme une seule
     * valeur distincte — et une vraie contradiction entre eux disparaîtrait. C'est la même
     * règle que le graphe (lot 13) : un fait illisible sort du calcul, il ne s'y rabat pas.
     */
    faitsEnConflit: async () => {
      const rows = await depotLectureDrizzle(acces.db).faits({ statuts: ["valide", "propose"], limite: 2000 });
      return rows.flatMap((r) => {
        try {
          const lisible = rendreLisible(r, acces.cle);
          return [
            {
              id: lisible.id,
              predicat: lisible.predicat,
              valeur: lisible.valeur,
              fiabiliteSource: r.fait.fiabiliteSource,
              extracteur: r.provenance?.extracteur ?? null,
              statut: r.fait.statut === "valide" ? ("valide" as const) : ("propose" as const),
            },
          ];
        } catch {
          return [];
        }
      });
    },
    comptesParPredicat: () => comptesParPredicatValides(acces.db),
    // ADR 0025 : LIA valide seule ce que deux signaux confirment ; ses comptes sortent dans la réponse.
    relecture: depotRelectureDrizzle(acces.db),
  });
  return rendre(r, banc, deduction, idees, sorties);
}

/**
 * ⚠️ VERCEL CRON APPELLE EN **GET**, jamais en POST (doc Vercel, « Manage cron jobs » : le
 * gestionnaire d'exemple est un `GET`). Cette route n'exportait que `POST` : le cron quotidien
 * de `vercel.json` recevait donc un 405 et n'a jamais lancé une seule passe — mesuré le 24/09,
 * aucune requête sur ce chemin dans les journaux de 09:00 UTC. Avec des secrets GitHub absents
 * jusqu'au même jour, l'apprentissage n'avait AUCUN réveil qui marche, et le producteur de
 * questions n'a jamais tourné : d'où « je n'ai jamais de question » (Marc, 24/09).
 * Même gestionnaire, même garde : la méthode ne change rien à l'authentification.
 */
export const GET = POST;
