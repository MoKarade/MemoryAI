// lib/chat/messageDeReponse.ts — ce que l'ÉCRAN du chat dit d'une réponse qui n'a pas abouti.
// PUR, et importable par le navigateur (aucune dépendance) : le classement des refus du modèle,
// lui, vit côté serveur dans `erreursModele.ts`.

/**
 * Le message à afficher pour une réponse HTTP qui n'a pas abouti — y compris quand le corps
 * est VIDE ou n'est pas du JSON. C'est ce cas-là qui produisait « Unexpected end of JSON
 * input » : le texte se lit d'abord, puis on tente le JSON dessus.
 */
export function messageDeReponse(status: number, corpsTexte: string): string {
  if (corpsTexte.trim()) {
    try {
      const c = JSON.parse(corpsTexte) as { message?: unknown; error?: unknown };
      if (typeof c.message === "string" && c.message) return c.message;
      if (typeof c.error === "string" && c.error) return `Erreur ${status} : ${c.error}`;
    } catch {
      /* pas du JSON : on retombe sur le statut, sans afficher une page HTML */
    }
  }
  return `Le serveur a répondu ${status} sans explication. Le détail est dans ses journaux.`;
}
