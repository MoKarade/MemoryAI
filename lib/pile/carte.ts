// lib/pile/carte.ts — ce qu'une carte « papier » MONTRE (ADR 0012 §2.1). PUR.
//
// Une carte par papier, et pas une par champ (arbitrage de Marc, 24/09) : elle doit se juger
// d'un coup d'œil, donc elle porte peu. Trois à cinq champs clés, choisis dans cet ordre —
// les NUMÉROS d'abord (c'est ce qu'une lecture rate le plus, et ce que Marc recopiera), puis
// les montants, les personnes, les lieux.

import type { PieceLisible } from "../pieces/lecture";

export const MAX_CHAMPS_CARTE = 5;
const ORDRE_FAMILLES = ["numeros", "montants", "personnes", "lieux"] as const;

export interface ChampCarte {
  libelle: string;
  valeur: string;
}

/** Les champs clés d'un papier, au plus `max`. Une entrée mal formée est ignorée, jamais rendue « [object Object] ». */
export function champsCles(p: Pick<PieceLisible, "champsStructures" | "champsLibres">, max = MAX_CHAMPS_CARTE): ChampCarte[] {
  const sortie: ChampCarte[] = [];
  const s = p.champsStructures ?? {};
  for (const famille of ORDRE_FAMILLES) {
    const entrees = s[famille];
    if (!Array.isArray(entrees)) continue;
    for (const e of entrees as { libelle?: unknown; valeur?: unknown }[]) {
      if (sortie.length >= max) return sortie;
      if (typeof e?.libelle === "string" && typeof e?.valeur === "string" && e.valeur.trim()) {
        sortie.push({ libelle: e.libelle, valeur: e.valeur });
      }
    }
  }
  // Les champs LIBRES ne complètent que si les structurés n'ont pas rempli la carte : ils
  // portent ce qui n'avait pas de case, donc rarement ce qu'on vérifie en premier.
  for (const [libelle, valeur] of Object.entries(p.champsLibres ?? {})) {
    if (sortie.length >= max) break;
    if (typeof valeur === "string" && valeur.trim()) sortie.push({ libelle, valeur });
  }
  return sortie;
}

/** La certitude sur le titulaire, dite en mots : un pourcentage seul ne dit pas quoi faire. */
export function phraseTitulaire(titulaire: string | null, confiance: number | null): string | null {
  if (!titulaire) return null;
  if (confiance === null) return `Titulaire lu : ${titulaire}`;
  const pc = Math.round(confiance * 100);
  return confiance < 0.8
    ? `Titulaire lu : ${titulaire} — lecture incertaine (${pc} %). Est-ce bien le bon nom ?`
    : `Titulaire lu : ${titulaire} (${pc} %)`;
}
