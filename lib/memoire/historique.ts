// lib/memoire/historique.ts — l'onglet Historique de la page Mémoire (MemoryAI#74, maquette v5) :
// ce que LIA a écrit, lu et dépensé, jour par jour. Fonctions pures ; les lectures vivent dans
// `lib/memoire/depotHistorique.ts`.
//
// ⚠️ NO FAKE DATA : la maquette dessine aussi son humeur sur 14 jours, ses relances et ses
// corrections. Rien de cela n'est mesuré aujourd'hui (l'humeur de `lia-ui` n'est pas
// enregistrée) : ces blocs n'existent pas ici, au lieu d'exister faux.

/** Les jours `AAAA-MM-JJ` de la fenêtre, du plus ancien à `aujourdhui` compris. */
export function joursFenetre(aujourdhui: string, n: number): string[] {
  const fin = Date.parse(`${aujourdhui}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(fin - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Une série complète sur la fenêtre : un jour sans ligne en base vaut 0 (rien ce jour-là),
 * pas un trou. Les jours hors fenêtre sont ignorés.
 */
export function serieJours(comptes: readonly { jour: string; n: number }[], aujourdhui: string, n: number): { jour: string; n: number }[] {
  const par = new Map(comptes.map((c) => [c.jour, c.n]));
  return joursFenetre(aujourdhui, n).map((jour) => ({ jour, n: par.get(jour) ?? 0 }));
}

export interface GrilleEcritures {
  /** `semaines[s][j]` : le compte du jour `j` (0 = lundi) de la semaine `s`, `null` après aujourd'hui. */
  semaines: (number | null)[][];
  max: number;
  total: number;
}

/** La grille des écritures, une colonne par semaine (lundi en haut), la dernière finit aujourd'hui. */
export function grilleEcritures(comptes: readonly { jour: string; n: number }[], aujourdhui: string, nSemaines: number): GrilleEcritures {
  // Lundi = 0 : `getUTCDay` rend 0 pour dimanche.
  const jourSemaine = (new Date(`${aujourdhui}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nJours = (nSemaines - 1) * 7 + jourSemaine + 1;
  const serie = serieJours(comptes, aujourdhui, nJours);
  const semaines: (number | null)[][] = [];
  for (let s = 0; s < nSemaines; s++) {
    semaines.push(Array.from({ length: 7 }, (_, j) => serie[s * 7 + j]?.n ?? null));
  }
  const valeurs = serie.map((x) => x.n);
  return { semaines, max: Math.max(0, ...valeurs), total: valeurs.reduce((a, b) => a + b, 0) };
}

/** Les sources de conversation, en mots (`lib/db/schema.ts`, `SOURCES_CONVERSATION`). */
export const LIBELLE_SOURCE: Record<string, string> = {
  memoryai: "Ici, avec LIA",
  "claude-ai": "Claude",
  "claude-code": "Claude Code",
};
