// lib/lia/autonomie.ts — ce que LIA fait seule, et ce qui la retient (ADR 0032, tâche MemoryAI 283). PUR :
// ni base, ni réseau, ni horloge.
//
// ⚠️ UNE LISTE FERMÉE. Une action autonome est une clé de `ACTIONS`, avec son niveau de risque et sa raison
// écrite UNE fois, ici, par une personne. La raison n'est jamais fabriquée à l'exécution : un journal qui
// raconterait ce que le code « croit avoir fait » mentirait le jour où le code change.
// ⚠️ JAMAIS `sort-de-memoryai` : le type l'exclut, la base le refuse (`actions_lia_niveau`), et le test le
// verrouille. Une action qui quitte MemoryAI reste un geste de Marc.

import type { NiveauRisque } from "./catalogueOutils";

/** Les niveaux qu'une action autonome peut avoir. */
type NiveauAutonome = Exclude<NiveauRisque, "sort-de-memoryai">;

export const ACTIONS = {
  relecture: {
    niveau: "ecriture-interne",
    raison: "Relit les faits proposés face à leur source : elle ne valide que ce que deux signaux confirment (ADR 0025).",
  },
  deduction: {
    niveau: "ecriture-interne",
    raison: "Déduit par règle les faits qui découlent de papiers actifs, comme ton âge (ADR 0023).",
  },
  idees: {
    niveau: "ecriture-interne",
    raison: "Compte les demandes faites au hub et propose une idée quand une règle s'y reconnaît (ADR 0027).",
  },
} as const satisfies Record<string, { niveau: NiveauAutonome; raison: string }>;

export type CleAction = keyof typeof ACTIONS;

/** Ce qui s'est passé : faite, en échec, arrêtée par le frein, ou sans budget. */
export type Issue = "faite" | "echec" | "frein" | "budget";

/** Combien de jours la base garde le journal (ADR 0032 § 4). */
export const RETENTION_JOURNAL_JOURS = 90;

interface LigneJournal {
  action: CleAction;
  niveau: NiveauAutonome;
  raison: string;
  n: number;
  issue: Issue;
}

/** La ligne du journal pour une action : niveau et raison viennent de `ACTIONS`, `n` est ramené à un entier ≥ 0. */
export function ligneJournal(action: CleAction, issue: Issue, n: number): LigneJournal {
  const def = ACTIONS[action];
  return { action, niveau: def.niveau, raison: def.raison, n: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0, issue };
}

// ── Ce que Marc lit (« Sa journée », Régler) ────────────────────────────────────────────────────────────

/** Le nom de chaque action pour Marc. `Record` : une action sans nom ne compile pas. */
export const LIBELLE_ACTION: Record<CleAction, string> = {
  relecture: "Relire les faits proposés",
  deduction: "Déduire des faits de tes papiers",
  idees: "Proposer des idées pour tes apps",
};

/** Ce qui s'est passé, dit pour Marc. */
export const LIBELLE_ISSUE: Record<Issue, string> = {
  faite: "Faite",
  echec: "En échec",
  frein: "Retenue par le frein",
  budget: "Arrêtée par le budget",
};

/** Une chaîne lue en base est-elle une action connue ? La base ne contraint pas `action` : on filtre à la lecture. */
export const estAction = (s: string): s is CleAction => Object.keys(ACTIONS).includes(s);

/** Même garde pour l'issue (la base la contraint, la lecture ne se fie pas à la base). */
export const estIssue = (s: string): s is Issue => Object.keys(LIBELLE_ISSUE).includes(s);

/** Le frein tel que la page le lit : `changeLe` est `null` tant que personne ne l'a touché. */
export interface EtatFrein {
  enPause: boolean;
  changeLe: Date | null;
}

/** Une ligne du journal telle que la page la lit (aucun contenu : des comptes et une raison fixe). */
export interface LigneLue {
  instant: Date;
  action: CleAction;
  raison: string;
  n: number;
  issue: Issue;
}
