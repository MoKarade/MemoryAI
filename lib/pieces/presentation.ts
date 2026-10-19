// lib/pieces/presentation.ts — comment un papier se PRÉSENTE à Marc. PUR, donc testable.
//
// ⚠️ POURQUOI CE FICHIER EXISTE. Le 21/09/2026, Marc a écrit de l'écran des papiers : « pour
// l'instant ça sert à rien je comprends rien ». Il avait raison, et la cause n'était pas le
// style : la page affichait « — | N1 | — | moteur-inventaire-v1 | ouvrir ↗ | Retirer ». Six
// colonnes, aucune qui dise CE QUE C'EST. Le nom de l'extracteur, en particulier, portait à
// lui seul l'information la plus importante de l'écran — « ce papier n'a jamais été ouvert » —
// sous une forme que personne ne peut lire.
//
// Le vocabulaire des extracteurs est celui du contrat (`lib/pieces/lignee.ts`) ; il se
// TRADUIT ici, il ne se ré-invente pas. Un extracteur inconnu se CITE plutôt que de tomber
// dans le cas le plus fréquent : un écran qui range une nouveauté dans une catégorie
// existante fait croire qu'on a lu ce qu'on n'a pas lu.

import { EXTRACTEUR_MIGRATION } from "./migration";

export interface LibelleExtracteur {
  /** Deux mots pour une case de tableau. */
  court: string;
  /** Une phrase qui dit ce que ça implique, pour la page de détail. */
  phrase: string;
  /** Le document a-t-il été OUVERT par un modèle ? */
  lu: boolean;
}

const MODELES: Record<string, string> = {
  "haiku-4.5-piece-v1": "Haiku 4.5",
  "haiku-4.5-piece-v2": "Haiku 4.5 (v2)",
  "sonnet-5-vision-piece-v3": "Sonnet 5, lecture de l'image (v3)",
};

export function libelleExtracteur(extracteur: string): LibelleExtracteur {
  const e = String(extracteur ?? "").trim();
  if (e === EXTRACTEUR_MIGRATION) {
    return {
      court: "Pas encore lu",
      phrase:
        "Ce papier vient de l'INVENTAIRE : DriveAI a signalé que le document existe et où il " +
        "est, à partir de son nom de fichier. Personne ne l'a ouvert — c'est pour ça qu'il n'a " +
        "ni résumé ni champs.",
      lu: false,
    };
  }
  const modele = MODELES[e];
  if (modele) {
    return {
      court: `Lu · ${modele}`,
      phrase: `Le document a été ouvert et lu par le modèle ${modele}. Ce qui suit vient de cette lecture.`,
      lu: true,
    };
  }
  // ⚠️ On CITE ce qu'on ne connaît pas, au lieu de le ranger dans « lu » ou « pas lu » : les
  // deux affirmations seraient inventées, et l'une des deux est exactement ce que Marc vérifie.
  return {
    court: `Lu · ${e || "?"}`,
    phrase: `Extrait par « ${e || "?"} » — un extracteur que cet écran ne connaît pas encore. Le document a bien été ouvert.`,
    lu: true,
  };
}

/**
 * Le titre d'un papier dans une liste : ce qui permet de le reconnaître d'un coup d'œil.
 *
 * ⚠️ Rend `null` quand rien ne le nomme, JAMAIS « Sans titre » : c'est à l'écran de décider
 * quoi dire d'un papier anonyme, et les deux cas qui produisent ce vide n'ont rien à voir —
 * un papier de niveau 3 dont le contenu est protégé, et un papier dont la lecture n'a rien
 * tiré. Les confondre ici les rendrait indistinguables partout en aval.
 */
export function titrePiece(p: { type: string | null; emetteur: string | null }): string | null {
  const type = (p.type ?? "").trim();
  const emetteur = (p.emetteur ?? "").trim();
  if (type && emetteur) return `${type} — ${emetteur}`;
  return type || emetteur || null;
}
