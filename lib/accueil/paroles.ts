// lib/accueil/paroles.ts — ce que LIA dit seule dans sa maison (maquette v5, écart A3). PUR : l'heure
// et les contenus se passent en paramètres ; le client les lit, `lia-ui` décide du moment.
//
// Comme sur le hub (`Hubperso/lib/liaParole.ts`) : elle ne dit que ce que les espaces disent déjà
// (`ContenuEspace.dit`, calculé des vraies données) et se tait (`null`) quand rien n'attend Marc.
// Le reste du temps, elle parle d'elle-même (`parolePropre` de `lia-ui`), jamais de lui.

import type { ContenuEspace, IdEspace } from "./espaces";
import { IDS_ESPACES } from "./espaces";

export type MotifParole = "salut" | "rien" | "relance";

/** Le salut de la maquette, à l'heure de Québec (0 à 23). */
export function salutSelonHeure(heure: number): string {
  if (heure < 6) return "Il est tard. Je veille.";
  if (heure < 12) return "Bonjour. Café ?";
  if (heure < 18) return "Bon après-midi.";
  return "Bonsoir.";
}

/** Ce qu'elle peut dire seule, dans l'ordre des espaces (Idées avant Budget). */
function remarques(contenus: Record<IdEspace, ContenuEspace>): string[] {
  return IDS_ESPACES.filter((id) => contenus[id].remarque).map((id) => contenus[id].dit);
}

/**
 * Ce que LIA dit seule, ou `null`. `salut` : le salut de l'heure, suivi de la première remarque ;
 * `rien` et `relance` : une remarque à tour de rôle (`tour` compte les appels), ou rien.
 */
export function parleSeuleMaison(motif: MotifParole, contenus: Record<IdEspace, ContenuEspace>, heure: number, tour = 0): string | null {
  const r = remarques(contenus);
  if (motif === "salut") return r[0] ? `${salutSelonHeure(heure)} ${r[0]}` : salutSelonHeure(heure);
  return r[tour % Math.max(1, r.length)] ?? null;
}
