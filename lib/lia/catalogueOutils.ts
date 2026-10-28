// lib/lia/catalogueOutils.ts — tout ce que LIA sait faire, en UNE liste, chaque outil avec son niveau
// de risque (tâche MemoryAI 282).
//
// Avant : les outils étaient éparpillés (`OUTILS` du MCP, plus `lia_blocs`, `lia_note`,
// `monde_meteo` et `monde_actualite`, ajoutés à la main dans `lib/chat/agent.ts`) et rien ne disait
// lesquels lisent, lesquels écrivent, lesquels sortent de MemoryAI.
//
// Trois niveaux, du plus sûr au plus exposé :
//   - `lecture` : ne change rien, ni ici ni ailleurs ;
//   - `ecriture-interne` : écrit dans MemoryAI seulement, jamais hors de la base ;
//   - `sort-de-memoryai` : l'appel quitte MemoryAI (une requête part vers un service tiers).
//
// ⚠️ Le niveau d'un outil se DÉCIDE ici, par une personne, au moment où l'outil naît : aucun code ne
// le devine à sa place. C'est le sens de `exigerNiveaux` : un outil offert au modèle qui n'est pas dans
// cette liste est refusé, avant tout appel au modèle. `tests/catalogueOutils.test.ts` tient les deux
// sens (rien d'offert sans niveau, aucune entrée fantôme).
//
// ⚠️ DÉCISION à relire : `monde_meteo` et `monde_actualite` sont classés `sort-de-memoryai`, parce que
// l'appel part vers Environnement Canada et vers des fils RSS. Rien de Marc n'y est lu ; pour la météo,
// la ville réglée voyage dans la requête. Le niveau « lecture » serait défendable (ils ne changent rien) ;
// on a pris le côté prudent, qui se desserre d'une ligne si Marc le veut.

export type NiveauRisque = "lecture" | "ecriture-interne" | "sort-de-memoryai";

export interface EntreeCatalogue {
  readonly nom: string;
  /** Ce que l'outil fait, en langage courant : c'est la phrase que la page affiche. */
  readonly fait: string;
  readonly niveau: NiveauRisque;
  /** Vrai : claude.ai seulement (`OUTILS_MCP_SEULS`). LIA ne l'offre pas, la page ne le liste pas. */
  readonly mcpSeul?: true;
}

export const CATALOGUE: readonly EntreeCatalogue[] = [
  { nom: "memoryai_contexte", fait: "relire les faits qu'elle connaît sur toi, les validés d'abord", niveau: "lecture" },
  { nom: "memoryai_chercher", fait: "chercher dans les faits à partir d'une question", niveau: "lecture" },
  { nom: "memoryai_etat", fait: "dire l'état de la mémoire, en nombres et jamais en contenu", niveau: "lecture" },
  { nom: "memoryai_inventaire", fait: "lister le vocabulaire fermé qu'elle sait tenir", niveau: "lecture" },
  { nom: "memoryai_papiers_facettes", fait: "lister les types, émetteurs et titulaires de tes papiers, avec leur nombre", niveau: "lecture" },
  { nom: "memoryai_papiers_chercher", fait: "chercher dans le contenu de tes papiers", niveau: "lecture" },
  { nom: "memoryai_proposer", fait: "proposer un fait à la mémoire (jamais validé d'office)", niveau: "ecriture-interne" },
  { nom: "memoryai_demander", fait: "poser une question quand la mémoire ne sait pas", niveau: "ecriture-interne" },
  { nom: "memoryai_consigner", fait: "garder un échange dans la mémoire, chiffré", niveau: "ecriture-interne" },
  { nom: "memoryai_notes_lia", fait: "relire les notes de LIA au coordinateur (les marque lues)", niveau: "ecriture-interne", mcpSeul: true },
  { nom: "memoryai_sorties", fait: "relire ce que les apps ont envoyé à MemoryAI", niveau: "lecture", mcpSeul: true },
  { nom: "lia_blocs", fait: "montrer sa réponse en blocs visuels (n'écrit rien)", niveau: "lecture" },
  { nom: "lia_note", fait: "laisser une note courte au coordinateur", niveau: "ecriture-interne" },
  { nom: "lia_retenir", fait: "retenir seule ce que tu lui dis sur toi, après ses propres vérifications", niveau: "ecriture-interne" },
  { nom: "monde_meteo", fait: "lire la météo d'Environnement Canada pour ta ville", niveau: "sort-de-memoryai" },
  { nom: "monde_actualite", fait: "lire des titres d'actualité de fils publics", niveau: "sort-de-memoryai" },
];

/** Comment la page dit chaque niveau : une phrase, pas un code. */
export const LIBELLE_NIVEAU: Readonly<Record<NiveauRisque, string>> = {
  lecture: "lit seulement",
  "ecriture-interne": "écrit dans MemoryAI",
  "sort-de-memoryai": "sort de MemoryAI",
};

/** Le niveau d'un outil, ou `undefined` : un outil inconnu n'a PAS de niveau par défaut. */
export function niveauDe(nom: string): NiveauRisque | undefined {
  return CATALOGUE.find((e) => e.nom === nom)?.niveau;
}

/**
 * Refuse un jeu d'outils dont un seul n'a pas de niveau. Appelée par `tourDeChat` AVANT le premier
 * appel au modèle : un outil sans niveau n'atteint jamais un modèle, même par oubli.
 */
export function exigerNiveaux(noms: readonly string[]): void {
  const sans = noms.filter((n) => niveauDe(n) === undefined);
  if (sans.length > 0) throw new Error(`Outil sans niveau de risque au catalogue : ${sans.join(", ")}`);
}

/** Ce que LIA sait faire elle-même : le catalogue, moins les outils réservés à claude.ai. */
export function outilsDeLia(): EntreeCatalogue[] {
  return CATALOGUE.filter((e) => !e.mcpSeul);
}
