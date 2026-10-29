// lib/lia/longueur.ts — la longueur d'une réponse de LIA, MESURÉE (tâche MemoryAI 291). PUR.
//
// Le prompt dit « deux phrases » (`lib/chat/prompt.ts`) mais un modèle peut l'ignorer (tâche
// MemoryAI 444 : 28 tours sur 35 dépassaient). `longueSansBloc` COMPTE ; `couperSansBloc` ramène
// un mur de texte à ses deux premières phrases, sans jamais perdre une source citée.
// ⚠️ Rien n'est gardé ni journalisé : le texte entre, le texte sort.

/** Au-delà, un texte seul est un mur : le prompt demande un bloc (`lia_blocs`) plutôt. */
const LONGUEUR_SANS_BLOC = 280;

/** Vrai si la réponse dépasse 280 caractères alors qu'elle ne porte aucun bloc. */
export function longueSansBloc(texte: string, nbBlocs: number): boolean {
  return nbBlocs === 0 && texte.trim().length > LONGUEUR_SANS_BLOC;
}

/** Les citations de source : faits, papiers et leur lien Drive (voir `lib/chat/liens.ts`). */
const MOTIF_SOURCE = /\[→\/(?:fait|pieces)\/[0-9a-fA-F-]{36}\]|\[↗https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view\]/g;

/** Fin de phrase, sauf quand ce qui suit est une source ou une marque : elle reste avec sa phrase. */
const FIN_DE_PHRASE = /(?<=[.!?…](?:\s*\[[→↗][^\]]*\])*)\s+(?!\[[→↗]|\((?:à confirmer|non sourcé|déduit|sommaire)\))/;

/**
 * Sans bloc, une réponse de plus de 280 caractères est ramenée à ses deux premières phrases ; les
 * sources citées dans la partie retirée sont ajoutées à la fin, aucune n'est perdue. Une réponse
 * courte, ou qui porte un bloc, est rendue telle quelle.
 */
export function couperSansBloc(texte: string, nbBlocs: number): string {
  if (!longueSansBloc(texte, nbBlocs)) return texte;
  const gardee = texte.trim().split(FIN_DE_PHRASE).slice(0, 2).join(" ");
  const perdues = [...new Set(texte.match(MOTIF_SOURCE) ?? [])].filter((s) => !gardee.includes(s));
  return perdues.length > 0 ? `${gardee} ${perdues.join(" ")}` : gardee;
}
