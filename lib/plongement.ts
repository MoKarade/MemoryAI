// lib/plongement.ts — le petit modèle gratuit qui transforme un texte en vecteur (tâche MemoryAI
// 186, partie B). Il tourne DANS la fonction, sur le processeur : aucun service, aucun coût, et
// aucun texte de Marc ne sort de MemoryAI. Seuls les POIDS du modèle entrent, téléchargés depuis
// Hugging Face à la première passe du jour.
//
// ⚠️ MODÈLE ET RÉVISION ÉPINGLÉS. Un modèle qui change sous nos pieds changerait tous les liens
// devinés sans qu'aucun code ne bouge. Le choix (26/10/2026, phrases FICTIVES) : le mpnet
// multilingue range en tête les trois vraies paires d'un petit banc, là où le MiniLM multilingue
// et e5-small les mélangeaient avec des paires sans rapport. Changer de modèle est une PR.
//
// ⚠️ IMPORT DYNAMIQUE : la bibliothèque et son moteur ONNX ne chargent que dans la passe qui en a
// besoin. Une page de l'app ne les embarque jamais (`next.config.mjs`, traçage limité).

/** Le modèle et sa révision exacte sur Hugging Face. */
const MODELE_SENS = { nom: "Xenova/paraphrase-multilingual-mpnet-base-v2", revision: "e5d116277351513fd260955ece953ecddde7046e", dtype: "q8" } as const;

/** Rend un vecteur NORMÉ par texte, dans l'ordre reçu. */
export type Plongeur = (textes: readonly string[]) => Promise<number[][]>;

/** Par paquets : un seul appel sur 3 000 textes prendrait toute la mémoire de la fonction. */
const PAQUET = 32;

/**
 * Charge le modèle (≈ 280 Mo, dans `/tmp`, le seul dossier inscriptible d'une fonction Vercel) et
 * rend le plongeur. Lève si le téléchargement ou le moteur échoue : l'appelant le DIT, il ne
 * remplace jamais les liens devinés par rien.
 */
export async function plongeurLocal(): Promise<Plongeur> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = "/tmp/memoryai-modeles";
  env.allowLocalModels = false;
  const extraire = await pipeline("feature-extraction", MODELE_SENS.nom, {
    revision: MODELE_SENS.revision,
    dtype: MODELE_SENS.dtype,
    device: "cpu",
  });
  return async (textes) => {
    const sortie: number[][] = [];
    for (let i = 0; i < textes.length; i += PAQUET) {
      const t = await extraire([...textes.slice(i, i + PAQUET)], { pooling: "mean", normalize: true });
      sortie.push(...(t.tolist() as number[][]));
    }
    return sortie;
  };
}
