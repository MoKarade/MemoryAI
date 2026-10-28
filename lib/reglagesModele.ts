// lib/reglagesModele.ts — réglages d'appel propres à chaque modèle du sélecteur.
//
// POURQUOI : la famille 5.5 PENSE par défaut, et la pensée compte dans `max_tokens`. Une extraction
// ou une relecture plafonnée à 1 000 jetons serait mangée par la pensée avant la réponse. Et
// `temperature` est refusée (400) : on ne la règle plus.
//
// Règles de l'API (skill claude-api, `shared/model-migration.md`, relu le 28/10/2026) :
//   · Haiku 5.5 : `thinking: {type:"disabled"}` accepté à effort ≤ high ;
//   · Sonnet 5.5 : `disabled` → 400, le plus bas est `between_tools` ;
//   · Opus 5.5 : la pensée ne se coupe pas, l'effort la borne.
// PURE : aucune E/S, un test verrouille les trois cas.

import type { IdModele } from "./coutChat";

export type Effort = "low" | "medium" | "high";

export interface ReglagesModele {
  thinking?: { type: "disabled" } | { type: "between_tools" };
  output_config?: { effort: Effort };
}

/** Lecture, extraction, relecture : on veut un JSON, pas une réflexion. */
export function reglagesLecture(modele: IdModele): ReglagesModele {
  switch (modele) {
    case "claude-haiku-5-5":
      return { thinking: { type: "disabled" }, output_config: { effort: "low" } };
    case "claude-sonnet-5-5":
      return { thinking: { type: "between_tools" }, output_config: { effort: "medium" } };
    case "claude-opus-5-5":
      return { output_config: { effort: "low" } };
  }
}

/** Conversation avec outils (LIA) : la pensée adaptative reste, l'effort la borne (même réglage pour les trois modèles). */
export function reglagesChat(): ReglagesModele {
  return { output_config: { effort: "medium" } };
}
