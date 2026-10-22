// lib/lia/ask.ts — ce que LIA reçoit du hub et ce qu'elle lui rend (ADR 0016). PUR.
//
// Le contrat est celui du fil Assistant (trois sauts : navigateur → app → hub → MemoryAI) : une
// question, la page où Marc se trouve, l'app d'où il parle ; une réponse `{ text, chips?, mood? }`.
// La route (`app/api/ask/route.ts`) fait l'I/O ; tout ce qui DÉCIDE est ici, et testé.
//
// ⚠️ PROPRIÉTAIRE SEUL. Une app peut avoir des invités (accès à deux étages) ; MemoryAI n'en a
// jamais. Le hub sait qui parle (session ou jeton d'app) et le DIT par `proprietaire: true` ;
// absent ou faux, on refuse. Ce n'est pas une politesse : sans ce champ, un invité de BatchChef
// interrogerait la mémoire de Marc.
//
// ⚠️ LECTURE SEULE. `OUTILS_LIA_HUB` est une LISTE BLANCHE : un outil ajouté demain au MCP n'est
// pas offert ici tant que quelqu'un ne l'a pas décidé. Aucun n'écrit (ni `proposer`, ni
// `demander`, ni `consigner`).

import { z } from "zod";
import type { ContexteOutils } from "../mcp/outils";

/** Au-delà, 413 avant même de lire le JSON (contrat : « corps > 8 Ko »). */
export const TAILLE_MAX_CORPS = 8 * 1024;
const LONGUEUR_MAX_QUESTION = 2000;
export const LONGUEUR_MAX_TEXTE = 8000;

/** Le lecteur inscrit au journal d'accès. Hors de `LECTEURS_N3` : le niveau 3 lui reste fermé. */
export const LECTEUR_LIA_HUB = "lia-hub";

/** Les outils offerts au modèle quand LIA répond au hub : lire, jamais écrire. */
export const OUTILS_LIA_HUB: ReadonlySet<string> = new Set([
  "memoryai_contexte",
  "memoryai_chercher",
  "memoryai_etat",
  "memoryai_inventaire",
  "memoryai_papiers_facettes",
  "memoryai_papiers_chercher",
]);

/**
 * Les conversations, FERMÉES : le type exige le champ, aucun outil offert ne l'emploie, et la
 * route n'importe pas le dépôt (`tests/conversations.test.ts` : aucune app n'atteint les
 * conversations). Un appel qui y arriverait quand même échoue au lieu d'écrire.
 */
export const CONVERSATIONS_FERMEES: ContexteOutils["conversations"] = {
  demarrer: () => Promise.reject(new Error("Conversations fermées à LIA depuis le hub (ADR 0016).")),
  consigner: () => Promise.reject(new Error("Conversations fermées à LIA depuis le hub (ADR 0016).")),
  parId: () => Promise.reject(new Error("Conversations fermées à LIA depuis le hub (ADR 0016).")),
};

const DemandeAsk = z.object({
  question: z.string().trim().min(1).max(LONGUEUR_MAX_QUESTION),
  // Une page est un chemin, rien d'autre : elle finit dans le message envoyé au modèle.
  page: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_.-]*$/)
    .optional(),
  source: z.string().regex(/^[a-z0-9-]{1,40}$/),
  proprietaire: z.boolean().optional(),
});

export type DemandeAsk = z.infer<typeof DemandeAsk>;

export type LectureDemande =
  | { ok: true; demande: DemandeAsk }
  | { ok: false; status: 400 | 403 | 413; code: string; message: string };

/**
 * Lit le corps BRUT. La taille se mesure en octets avant le JSON ; le refus « pas le
 * propriétaire » vient APRÈS la validation, pour qu'un corps mal formé reste un 400.
 */
export function lireDemande(brut: string): LectureDemande {
  if (Buffer.byteLength(brut, "utf8") > TAILLE_MAX_CORPS) {
    return { ok: false, status: 413, code: "corps_trop_gros", message: `Corps au-delà de ${TAILLE_MAX_CORPS} octets.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "JSON attendu." };
  }
  const r = DemandeAsk.safeParse(json);
  if (!r.success) {
    // Les CHEMINS des champs fautifs, jamais leur valeur : la question ne se répète nulle part.
    const champs = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(racine)"))].join(", ");
    return { ok: false, status: 400, code: "corps_invalide", message: `Champs invalides : ${champs}.` };
  }
  if (r.data.proprietaire !== true) {
    return { ok: false, status: 403, code: "reserve_au_proprietaire", message: "LIA ne répond qu'au propriétaire." };
  }
  return { ok: true, demande: r.data };
}

/**
 * Le message envoyé au modèle : d'où Marc parle, puis sa question. `source` et `page` sont
 * passés par leurs regex, ils ne portent aucune balise ; la question reste le texte de Marc.
 */
export function composerQuestion(d: DemandeAsk): string {
  const ou = d.source === "hub" ? "l'accueil du hub" : `l'app ${d.source}`;
  const page = d.page ? `, page ${d.page}` : "";
  return `(Marc te parle depuis ${ou}${page}. Réponds court.)\n\n${d.question}`;
}

/**
 * La réponse rendue au hub. Les citations `[→/fait/…]` pointent MemoryAI : relatives, elles
 * mèneraient nulle part depuis une autre app, donc elles deviennent absolues. Le texte est
 * borné au contrat ; une réponse vide n'est pas une réponse (l'appelant rend 503).
 */
export function composerReponse(texte: string, origine: string): { text: string } | null {
  const absolu = texte.replace(/\[→\/(fait|pieces)\//g, `[→${origine}/$1/`).trim();
  if (absolu.length === 0) return null;
  const text = absolu.length > LONGUEUR_MAX_TEXTE ? `${absolu.slice(0, LONGUEUR_MAX_TEXTE - 1)}…` : absolu;
  return { text };
}
