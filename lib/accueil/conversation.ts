// lib/accueil/conversation.ts — le fil du panneau « Parler » (maquette v5, écart A7). PUR ; l'envoi
// vit dans `app/AccueilClient.tsx` (`POST /api/lia/ask`, comme la bulle de LIA).
// ⚠️ Échec fermé : une question sans réponse lisible devient « indisponible », jamais une réponse
// inventée. Les blocs passent tels quels à `rendreBlocs` (`lia-ui`), qui les revérifie.

/** Les noms des tracés de `components/IconeEspace.tsx` employés ici (lib ne dépend pas des composants). */
type NomIcone = "db" | "layers" | "folder" | "search" | "heart" | "coin" | "cal" | "chart";

/** Comme la route (`lib/lia/ask.ts`) : au-delà, elle refuserait (400). */
export const LONGUEUR_MAX_QUESTION = 2000;

export const MESSAGE_INDISPONIBLE = "Je suis indisponible pour l'instant. Réessaie dans un moment.";

/** Au lieu de celles de la maquette (FICTIVES) : des questions auxquelles ses outils savent répondre. */
export const SUGGESTIONS: readonly { icone: NomIcone; libelle: string; question: string }[] = [
  { icone: "db", libelle: "Moi", question: "Que sais-tu sur moi ?" },
  { icone: "layers", libelle: "Thèmes", question: "Qu'est-ce que tu sais, thème par thème ?" },
  { icone: "folder", libelle: "Papiers", question: "Quelles sortes de papiers as-tu lus ?" },
  { icone: "search", libelle: "Chercher", question: "Trouve mes papiers d'assurance." },
  { icone: "heart", libelle: "Santé", question: "Que sais-tu de ma santé ?" },
  { icone: "coin", libelle: "Argent", question: "Que sais-tu de mes finances ?" },
  { icone: "cal", libelle: "Dates", question: "Quelles dates importantes connais-tu ?" },
  { icone: "chart", libelle: "Sa mémoire", question: "Où en est ta mémoire ?" },
];

export interface Tour {
  id: string;
  question: string;
  etat: "attente" | "repondu" | "echec";
  texte?: string;
  blocs?: readonly unknown[];
}

/** La question telle qu'elle partira, ou `null` si elle est vide ou trop longue. */
export function questionPrete(brute: string): string | null {
  const q = brute.trim();
  return q.length > 0 && q.length <= LONGUEUR_MAX_QUESTION ? q : null;
}

/** Vrai tant qu'une réponse est attendue : on n'en pose pas une seconde par-dessus. */
export function enAttente(fil: readonly Tour[]): boolean {
  return fil.some((t) => t.etat === "attente");
}

export function poser(fil: readonly Tour[], id: string, question: string): Tour[] {
  return [...fil, { id, question, etat: "attente" }];
}

export function repondre(fil: readonly Tour[], id: string, reponse: { text: string; blocks?: readonly unknown[] }): Tour[] {
  return fil.map((t) => (t.id === id && t.etat === "attente" ? { ...t, etat: "repondu", texte: reponse.text, blocs: reponse.blocks } : t));
}

export function echouer(fil: readonly Tour[], id: string): Tour[] {
  return fil.map((t) => (t.id === id && t.etat === "attente" ? { ...t, etat: "echec", texte: MESSAGE_INDISPONIBLE } : t));
}
