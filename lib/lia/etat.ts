// lib/lia/etat.ts — l'état du corps de LIA à l'écran, tel que `@mokarade/lia-ui` (≥ v0.15.0) le
// passe en 3e argument de `ask` : humeur, silhouette, cible du regard. PUR, sans I/O : lu par la
// route (validation du corps) et par le `ask` du navigateur (rien de non conforme n'est envoyé).
//
// Listes fermées, jamais de texte libre : ces valeurs finissent dans le message envoyé au modèle.
// `humeur` et `silhouette` viennent des listes exportées par le paquet épinglé (elles bougent avec
// le re-pin, jamais seules) ; `regard` a la forme de `data-lia-cible` (minuscules, chiffres, tirets).

import { z } from "zod";
import { HUMEURS_DETAILLEES, SILHOUETTES_LIA } from "@mokarade/lia-ui";

const Regard = z.string().regex(/^[a-z0-9-]{1,40}$/);
const HUMEURS: ReadonlySet<string> = new Set(HUMEURS_DETAILLEES);
const SILHOUETTES: ReadonlySet<string> = new Set(SILHOUETTES_LIA);

export const EtatLia = z
  .object({
    humeur: z.string().refine((v) => HUMEURS.has(v)),
    silhouette: z.string().refine((v) => SILHOUETTES.has(v)),
    regard: Regard.nullable(),
  })
  .strict();
export type EtatLia = z.infer<typeof EtatLia>;

/** Ce que le navigateur envoie : l'état s'il est conforme, rien sinon (LIA répond quand même). */
export function etatAEnvoyer(contexte: unknown): EtatLia | undefined {
  if (contexte === undefined || contexte === null) return undefined;
  const lu = EtatLia.safeParse(contexte);
  return lu.success ? lu.data : undefined;
}
