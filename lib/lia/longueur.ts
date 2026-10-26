// lib/lia/longueur.ts — la longueur d'une réponse de LIA, MESURÉE (tâche MemoryAI 291). PUR.
//
// Le prompt dit « deux phrases » (`lib/chat/prompt.ts`) mais rien ne le borne : un modèle peut
// l'ignorer, et sans mesure on ne le saurait pas. Ce garde COMPTE, il ne coupe et ne réécrit
// jamais une réponse : couper un texte en plein milieu serait pire qu'un texte long.
// ⚠️ Il ne reçoit que la LONGUEUR et le nombre de blocs ; le texte n'est ni gardé ni journalisé.

/** Au-delà, un texte seul est un mur : le prompt demande un bloc (`lia_blocs`) plutôt. */
const LONGUEUR_SANS_BLOC = 280;

/** Vrai si la réponse dépasse 280 caractères alors qu'elle ne porte aucun bloc. */
export function longueSansBloc(texte: string, nbBlocs: number): boolean {
  return nbBlocs === 0 && texte.trim().length > LONGUEUR_SANS_BLOC;
}
