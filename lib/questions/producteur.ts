// lib/questions/producteur.ts — ce que la mémoire NE SAIT PAS, transformé en questions (lot 16).
//
// Marc, le 16/09 : « je veux pas valider chaque fait a la main, je veux que l'IA lise tout et
// ensuite me pose des questions précises et simple a repondre, si besoin ». La page
// `/questions` existait depuis le lot 7 — avec son plafond de cinq ouvertes, sa dédup en base
// et sa validation — mais AUCUN producteur ne l'alimentait : le HANDOVER l'écrivait en toutes
// lettres, « rien ne pose encore de question tout seul ».
//
// ══ CE QUE LE MODÈLE VOIT, ET C'EST TRÈS PEU ════════════════════════════════════════════════
//
// Il reçoit le VOCABULAIRE et, pour chaque prédicat, COMBIEN de faits validés il porte. Rien
// d'autre. **Aucune valeur, aucun fait, aucune conversation.** Ce n'est pas une précaution
// tiède : c'est ce qui rend ce producteur sûr par construction. « `sante.allergie` : 0 fait »
// ne dit rien sur Marc — ça dit ce que la mémoire ignore, ce qui est exactement la question
// qu'on lui pose. Le corollaire est agréable : pas de déchiffrement, pas de niveau à arbitrer,
// pas de N2 à autoriser, rien à baliser. La surface d'injection est nulle parce qu'il n'entre
// aucun texte que quelqu'un d'autre a écrit.
//
// ⚠️ Ce qui est proposé mais pas validé n'entre PAS ici non plus : sa place est `/a-valider`.
// Ce producteur comble les TROUS, il ne double pas la file.
//
// ⚠️ Le plafond de cinq ouvertes et la dédup sont appliqués par `depotQuestions.poser`, pas
// ici : la garde qui décide doit être celle que le point d'ÉCRITURE consulte.

import { z } from "zod";
import type { ClientModele } from "../chat/agent";
import { budgetOuvert, coutUsd, jourQuebec, lireUsage, type IdModele } from "../coutChat";
import { PlafondApprentissageError } from "../conversations/extraction";
import type { DepotAdmin } from "../depotAdmin";
import type { DepotQuestions } from "../depotQuestions";
import { MAX_OUVERTES, validerQuestion } from "../questions";
import { vocabulaire } from "../vocabulaire";

export const MAX_QUESTIONS_PROPOSEES = MAX_OUVERTES;
export const MAX_TOKENS_SORTIE = 1500;

export const PROMPT_QUESTIONS = [
  "Tu aides une mémoire personnelle à combler ses trous sur Marc (Québec).",
  "",
  "On te donne le vocabulaire des faits qu'elle sait tenir, et COMBIEN de faits validés chacun porte.",
  "Tu ne vois AUCUNE valeur : c'est voulu, tu n'en as pas besoin pour repérer un trou.",
  "",
  `Rends UNIQUEMENT un objet JSON {"questions":[{"question":…,"predicat_vise":…,"motif":…}]}, au plus ${MAX_QUESTIONS_PROPOSEES}, sans texte autour, sans bloc de code.`,
  "",
  "RÈGLES, dans l'ordre :",
  "1. Une question SIMPLE, répondable en une phrase ou deux. Jamais « parle-moi de ta santé » : « as-tu des allergies ? ».",
  "2. `predicat_vise` DOIT appartenir au vocabulaire ci-dessous — la réponse deviendra un fait de ce prédicat.",
  "3. Vise ce qui est VIDE ou presque, et qui vaut la peine : un employeur inconnu compte, un genre musical préféré non.",
  "4. Jamais un montant, une adresse, un numéro d'identité, une position. Ne demande pas ça, même en passant.",
  "5. Une question par prédicat. La question finit par un point d'interrogation, fait au plus 200 caractères, sans URL ni retour à la ligne.",
  "6. `motif` dit en une phrase pourquoi tu la poses (ex. « aucun employeur enregistré »).",
  "7. Mieux vaut TROIS bonnes questions que cinq dont deux sont creuses. Une liste vide est une réponse acceptable.",
].join("\n");

const SchemaQuestions = z
  .object({
    questions: z
      .array(
        z
          .object({ question: z.string().max(4000), predicat_vise: z.string().max(200), motif: z.string().max(4000) })
          .strict(),
      )
      .max(MAX_QUESTIONS_PROPOSEES),
  })
  .strict();

export interface ResultatProduction {
  /** Ce que le modèle a proposé, avant la porte. */
  proposees: number;
  /** Ce qui a franchi `validerQuestion` ET le dépôt (une déjà posée ne compte pas). */
  posees: number;
  coutUsd: number;
  /** Rempli quand la réponse n'avait pas la forme attendue. Jamais avalé. */
  refusDeForme: string | null;
}

/**
 * L'état de la mémoire, en une page de texte, SANS une seule valeur.
 * PURE : c'est elle qu'on teste pour prouver qu'aucune donnée de Marc ne part au modèle.
 */
export function etatPourPrompt(comptes: Record<string, number>): string {
  const lignes = vocabulaire()
    .filter((p) => !p.deprecie)
    .map((p) => `- ${p.predicat} : ${comptes[p.predicat] ?? 0} fait(s) — ${p.description}`);
  return ["Vocabulaire et ce que la mémoire porte déjà :", ...lignes].join("\n");
}

/** Lit la réponse. Tolérante sur la FORME, stricte sur le FOND — jumelle de `lireProposition`. */
export function lireQuestions(
  brut: string,
): { ok: true; questions: z.infer<typeof SchemaQuestions>["questions"] } | { ok: false; raison: string } {
  const sansCloture = brut.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const debut = sansCloture.indexOf("{");
  const fin = sansCloture.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return { ok: false, raison: "aucun objet JSON dans la réponse" };
  let json: unknown;
  try {
    json = JSON.parse(sansCloture.slice(debut, fin + 1));
  } catch {
    return { ok: false, raison: "JSON illisible" };
  }
  const parsed = SchemaQuestions.safeParse(json);
  if (!parsed.success) return { ok: false, raison: parsed.error.issues[0]?.message ?? "forme inattendue" };
  return { ok: true, questions: parsed.data.questions };
}

export async function produireDesQuestions(params: {
  client: ClientModele;
  modele: IdModele;
  admin: DepotAdmin;
  questions: DepotQuestions;
  comptesParPredicat: Record<string, number>;
  maintenant: () => Date;
}): Promise<ResultatProduction> {
  const { client, modele, admin, questions, comptesParPredicat } = params;
  const jour = jourQuebec(params.maintenant());

  const depense = await admin.depenseDuJourUsd(jour, "apprentissage");
  const plafondsEffectifs = await admin.plafonds();
  if (!budgetOuvert(depense, "apprentissage", plafondsEffectifs))
    throw new PlafondApprentissageError(depense, plafondsEffectifs.apprentissage);

  // ⚠️ La file est-elle déjà pleine ? Poser au-dessus du plafond écarterait une question que
  // Marc n'a pas encore lue — payer un appel pour faire disparaître une question est le
  // contraire du but. On ne demande donc rien quand il n'y a pas de place.
  const ouvertes = await questions.ouvertes(MAX_OUVERTES + 1);
  if (ouvertes.length >= MAX_OUVERTES) return { proposees: 0, posees: 0, coutUsd: 0, refusDeForme: null };

  const reponse = await client.create({
    model: modele,
    max_tokens: MAX_TOKENS_SORTIE,
    system: PROMPT_QUESTIONS,
    tools: [],
    messages: [{ role: "user", content: etatPourPrompt(comptesParPredicat) }],
  });

  // COMPTÉ AVANT D'ÊTRE LU : l'appel est facturé même si la réponse est inutilisable.
  const { usage } = lireUsage(reponse.usage);
  const cout = coutUsd(modele, usage);
  await admin.enregistrerDepense({ jour, poste: "apprentissage", modele, ...usage, coutUsd: cout });

  const texte = reponse.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const lu = lireQuestions(texte);
  if (!lu.ok) return { proposees: 0, posees: 0, coutUsd: cout, refusDeForme: lu.raison };

  let posees = 0;
  for (const brute of lu.questions) {
    // `origine` vient de l'APPELANT, jamais du corps — comme la fiabilité d'un fait vient du
    // jeton. Une question produite ici n'est pas une question du chat.
    const v = validerQuestion(brute, "regle");
    if (!v.ok) continue;
    const r = await questions.poser(v, params.maintenant());
    if (r.etat === "posee") posees++;
  }
  return { proposees: lu.questions.length, posees, coutUsd: cout, refusDeForme: null };
}
