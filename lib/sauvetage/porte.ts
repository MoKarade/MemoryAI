// lib/sauvetage/porte.ts — les écritures des apps, fermées pendant le sauvetage (ADR 0019 §2).
//
// Tant que le sauvetage est ouvert et pas clos, un fait encore scellé `v1` peut être repoussé
// par son écrivain. Sa nouvelle empreinte ne reconnaîtrait pas l'ancienne : il entrerait en
// double, en `v2`, et la ligne sauvée heurterait ensuite son double sur l'index unique. Les
// routes d'écriture répondent donc 503 — une PANNE, que l'écrivain retente plus tard, jamais un
// refus qui lui ferait jeter son jeton (même règle que `cle_absente`).

/** Le mot que Marc tape pour clore le sauvetage (étape 6) : un geste qui rouvre les écritures. */
export const MOT_CLORE = "CLORE";

/** La réponse des routes d'écriture pendant le sauvetage. */
export function reponseSauvetage(): Response {
  return Response.json(
    {
      error: "sauvetage_en_cours",
      message: "La mémoire est en cours de sauvetage (ADR 0019) : rien n'est écrit pour l'instant. Réessaie plus tard.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export class SauvetageEnCoursError extends Error {
  constructor() {
    super("La mémoire est en cours de sauvetage : rien n'est écrit pour l'instant. Réessaie plus tard.");
    this.name = "SauvetageEnCoursError";
  }
}

/**
 * Un dépôt dont TOUTE méthode lève `SauvetageEnCoursError`, pour les outils MCP qui écrivent :
 * l'outil échoue avant la première lecture, et le modèle lit pourquoi. Fermer toutes les
 * méthodes plutôt que celles qui écrivent aujourd'hui : une méthode d'écriture ajoutée demain
 * serait fermée sans qu'on y pense.
 */
export function depotFerme<T extends object>(depot: T): T {
  return new Proxy(depot, {
    get(cible, nom, recepteur) {
      const v: unknown = Reflect.get(cible, nom, recepteur);
      return typeof v === "function"
        ? () => {
            throw new SauvetageEnCoursError();
          }
        : v;
    },
  });
}
