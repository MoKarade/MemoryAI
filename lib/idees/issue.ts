// lib/idees/issue.ts — « En faire une tâche » (ADR 0027 §5) : l'adresse de la page « nouvelle issue »
// de GitHub, préremplie avec l'idée. PUR : aucun réseau.
//
// ⚠️ AUCUN JETON, AUCUNE ÉCRITURE. LIA ne crée jamais l'issue : Marc ouvre la page, relit le texte et
// la crée lui-même sur GitHub. Le texte préremplit la demande telle que Marc l'a faite au hub, donc
// il se relit avant d'être envoyé (un dépôt public le montrerait à tout le monde).

const PROPRIETAIRE = "MoKarade";
/** L'app d'une idée (`demandes.app`) → son dépôt. Une app inconnue n'a pas de lien : jamais un dépôt deviné. */
const DEPOT: Readonly<Record<string, string>> = {
  hub: "Hubperso",
  financeai: "FinanceAI",
  driveai: "DriveAI",
  batchchef: "batchchef-",
  carai: "CarAI",
  jobai: "JobAI",
  memoryai: "MemoryAI",
};
/** En caractères (pas en unités UTF-16 : couper une paire de substitution ferait lever `encodeURIComponent`). */
const TITRE_MAX = 120;

/**
 * `titre` : la phrase de l'idée, déjà dite pour Marc ; `detail` : pourquoi elle est née ; `utilite` :
 * l'estimation sur 100. `null` quand l'app n'a pas de dépôt connu.
 */
export function urlNouvelleIssue(e: { app: string; titre: string; detail: string; utilite: number }): string | null {
  const depot = DEPOT[e.app];
  if (!depot) return null;
  const titre = [...`Idée de LIA : ${e.titre}`].slice(0, TITRE_MAX).join("");
  const corps = [
    `**Avant** : ${e.titre}, ${e.detail}.`,
    "**Après** : à préciser avant de prendre la tâche.",
    "**Fini quand** : à écrire comme une commande vérifiable en production.",
    "**Fichiers touchés** : non déterminés",
    `**Source** : idée de LIA, utilité estimée ≈ ${e.utilite} / 100 (une estimation, pas une mesure), née des demandes du hub.`,
  ].join("\n");
  return `https://github.com/${PROPRIETAIRE}/${depot}/issues/new?title=${encodeURIComponent(titre)}&body=${encodeURIComponent(corps)}`;
}
