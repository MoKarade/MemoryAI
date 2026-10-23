// lib/sauvetage/oracle.ts — demander une page à l'ancien déploiement (ADR 0019 §2).
//
// Le déploiement de 12:37Z garde dans son environnement figé les clés perdues ; il est le seul
// « oracle » qui sache encore déchiffrer. On lui demande `/fait/[id]` et `/pieces/[id]`, comme
// Marc le ferait dans son navigateur, avec deux sésames :
//
//   1. `x-vercel-protection-bypass` : l'adresse propre d'un déploiement est fermée par la
//      protection de Vercel (302 vers la connexion Vercel, vérifié le 23/10). Le secret de
//      contournement pour l'automatisation (`VERCEL_AUTOMATION_BYPASS_SECRET`, variable système
//      que Vercel pose dans les déploiements créés après sa génération) l'ouvre.
//   2. une SESSION de Marc, fabriquée ici : un JWT Auth.js chiffré sous `AUTH_SECRET` (la même
//      valeur que le hub et que l'ancien déploiement) pour `AUTHORIZED_EMAIL`. L'ancien
//      déploiement la lit comme celle que le hub pose. Elle vit dix minutes.
//
// ⚠️ RIEN DE CE QUI PASSE ICI NE SE JOURNALISE : ni la page (elle porte des clairs), ni le
// cookie, ni le secret. Une erreur dit son GENRE (refus, introuvable, panne), jamais un contenu.
// ⚠️ L'adresse de l'oracle est contrainte à `https://<nom>.vercel.app` : c'est vers elle que
// partent une session de Marc et le secret de contournement. Une variable mal saisie ne doit
// pas pouvoir les envoyer ailleurs. Les redirections ne sont pas suivies, pour la même raison.

import { encode } from "next-auth/jwt";

/** Le nom FIXE du cookie de session (`lib/sessionPartagee.ts`) : c'est aussi le sel du JWT. */
export const COOKIE_SESSION = "__Secure-authjs.session-token";
const DUREE_SESSION_S = 600;
const DELAI_MS = 20_000;
const SOURCE_PERMISE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

export interface ConfigOracle {
  source: string;
  contournement: string;
  authSecret: string;
  email: string;
}

/** Ce que l'oracle a rendu. Le GENRE d'un échec seulement, jamais un corps. */
export type Lecture = { ok: true; html: string } | { ok: false; raison: "refus" | "introuvable" | "panne" };

export interface Oracle {
  fait(id: string): Promise<Lecture>;
  piece(id: string): Promise<Lecture>;
}

/** Les quatre réglages, ou les NOMS de ceux qui manquent. Jamais une valeur. */
export function configOracle(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: ConfigOracle } | { ok: false; manque: string[] } {
  const source = env.MEMORYAI_SAUVETAGE_SOURCE?.trim().replace(/\/+$/, "") ?? "";
  const contournement = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
  const authSecret = env.AUTH_SECRET?.trim() ?? "";
  const email = env.AUTHORIZED_EMAIL?.trim() ?? "";
  const manque = [
    SOURCE_PERMISE.test(source) ? null : "MEMORYAI_SAUVETAGE_SOURCE",
    contournement ? null : "VERCEL_AUTOMATION_BYPASS_SECRET",
    authSecret ? null : "AUTH_SECRET",
    email ? null : "AUTHORIZED_EMAIL",
  ].filter((x): x is string => x !== null);
  return manque.length > 0 ? { ok: false, manque } : { ok: true, config: { source, contournement, authSecret, email } };
}

/** Une session de Marc, telle que le hub la poserait. */
export async function sessionDeMarc(config: ConfigOracle): Promise<string> {
  return encode({
    token: { email: config.email },
    secret: config.authSecret,
    salt: COOKIE_SESSION,
    maxAge: DUREE_SESSION_S,
  });
}

export function oracleAncienDeploiement(config: ConfigOracle, fetchImpl: typeof fetch = fetch): Oracle {
  let session: { jeton: string; expire: number } | null = null;

  async function lire(chemin: string): Promise<Lecture> {
    const maintenant = Date.now();
    // Refaite avant qu'elle n'expire : une passe peut durer plusieurs minutes.
    if (!session || session.expire - maintenant < 60_000) {
      session = { jeton: await sessionDeMarc(config), expire: maintenant + DUREE_SESSION_S * 1000 };
    }
    let reponse: Response;
    try {
      reponse = await fetchImpl(`${config.source}${chemin}`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(DELAI_MS),
        headers: {
          "x-vercel-protection-bypass": config.contournement,
          cookie: `${COOKIE_SESSION}=${session.jeton}`,
        },
      });
    } catch {
      // Délai dépassé ou réseau coupé : une panne, que la relance reprendra. La cause exacte
      // n'est pas rendue, elle pourrait citer l'adresse et ses en-têtes.
      return { ok: false, raison: "panne" };
    }
    // Une redirection, c'est la porte : la protection de Vercel ou `/login` de l'app.
    if (reponse.status >= 300 && reponse.status < 400) return { ok: false, raison: "refus" };
    if (reponse.status === 401 || reponse.status === 403) return { ok: false, raison: "refus" };
    if (reponse.status === 404) return { ok: false, raison: "introuvable" };
    if (!reponse.ok) return { ok: false, raison: "panne" };
    return { ok: true, html: await reponse.text() };
  }

  const uuid = /^[0-9a-f-]{36}$/;
  return {
    fait: (id) => (uuid.test(id) ? lire(`/fait/${id}`) : Promise.resolve({ ok: false, raison: "introuvable" })),
    piece: (id) => lire(`/pieces/${encodeURIComponent(id)}`),
  };
}
