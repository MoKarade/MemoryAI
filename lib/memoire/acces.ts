// lib/memoire/acces.ts — l'onglet Accès de la page Mémoire (MemoryAI#74, maquette v5) : qui lit
// la mémoire, à quel niveau, quand, et ce qui la protège. Fonctions pures ; les lectures vivent
// dans `lib/memoire/depotAcces.ts`.
//
// ⚠️ NO FAKE DATA : la maquette dessine des parts, un journal et une carte horaire FICTIFS. Ici
// chaque chiffre vient de la base (faits validés, `acces_journal`, `oublis`). Le journal ne
// porte que des métadonnées signées (lecteur, outil, niveau, nombres d'ids) : jamais une
// question, jamais une valeur.

import { FUSEAU } from "@/lib/fuseau";
import type { Niveau } from "@/lib/vocabulaire";

export const NIVEAUX: readonly Niveau[] = [0, 1, 2, 3];

/** Ce que chaque niveau permet, tel que le code l'applique (`lib/lecture.ts`, règle 2). */
export const REGLE_NIVEAU: Record<Niveau, string> = {
  0: "toujours servi",
  1: "toujours servi",
  2: "sur demande, un appel à la fois, si tu l'as permis",
  3: "jamais de contenu : son existence, une date, un lien",
};

export interface PartNiveau {
  niveau: Niveau;
  total: number;
  /** Arrondie à l'unité ; `null` quand il n'y a aucun fait (une part de rien n'existe pas). */
  part: number | null;
}

export function partsParNiveau(comptes: Partial<Record<Niveau, number>>): PartNiveau[] {
  const total = NIVEAUX.reduce<number>((s, n) => s + (comptes[n] ?? 0), 0);
  return NIVEAUX.map((niveau) => {
    const n = comptes[niveau] ?? 0;
    return { niveau, total: n, part: total > 0 ? Math.round((n / total) * 100) : null };
  });
}

/** Les lecteurs inscrits au journal (`app/api/chat`, `app/api/mcp`, `lib/lia/ask.ts`). */
const LECTEURS: Record<string, string> = {
  chat: "Conversation",
  "claude-ai": "Claude",
  "lia-hub": "LIA dans le hub",
  "lia-maison": "LIA ici",
};

/** Un lecteur inconnu s'affiche tel quel : le renommer au jugé cacherait qui a lu. */
export function libelleLecteur(lecteur: string): string {
  return LECTEURS[lecteur] ?? lecteur;
}

export interface LigneJournal {
  id: number;
  ts: Date;
  lecteur: string;
  outil: string;
  niveauMaxServi: number;
  /** `null` : liste illisible, affichée « ? » plutôt qu'un zéro inventé. */
  nFaits: number | null;
  nPieces: number | null;
}

/** Le nombre d'ids d'une liste JSON du journal ; une liste illisible compte pour `null`, pas 0. */
export function compterIds(json: string): number | null {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.length : null;
  } catch {
    // Une colonne illisible ne fait pas tomber la page : la ligne dira « ? ».
    return null;
  }
}

const HEURE = new Intl.DateTimeFormat("fr-CA", { hour: "numeric", hourCycle: "h23", timeZone: FUSEAU });

/** L'heure de Québec (0 à 23) d'un instant. */
export function heureQuebec(ts: Date): number {
  const h = Number(HEURE.formatToParts(ts).find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

export interface CarteHoraire {
  lecteurs: string[];
  /** `cases[i][h]` = lectures du lecteur `i` à l'heure `h` (Québec). */
  cases: number[][];
  max: number;
}

/** Quand chaque lecteur lit, heure par heure ; les lecteurs les plus actifs d'abord. */
export function carteHoraire(entrees: readonly { ts: Date; lecteur: string }[]): CarteHoraire {
  const parLecteur = new Map<string, number[]>();
  for (const e of entrees) {
    const ligne = parLecteur.get(e.lecteur) ?? Array.from({ length: 24 }, () => 0);
    const h = heureQuebec(e.ts);
    ligne[h] = (ligne[h] ?? 0) + 1;
    parLecteur.set(e.lecteur, ligne);
  }
  const tries = [...parLecteur.entries()].sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));
  const cases = tries.map(([, l]) => l);
  return { lecteurs: tries.map(([l]) => l), cases, max: Math.max(0, ...cases.flat()) };
}

/**
 * Ce qui protège la mémoire, chaque ligne vraie dans le code aujourd'hui (CLAUDE.md, ADR 0007).
 * ⚠️ Une ligne ajoutée ici est une affirmation : elle doit pointer vers la garde qui la tient.
 */
export const GARDE_FOUS: readonly { texte: string; ou: string }[] = [
  { texte: "Échec fermé : sans session valide, rien ne s'affiche", ou: "lib/session.ts" },
  { texte: "Toi seul : aucun invité, jamais", ou: "lib/authorized.ts" },
  { texte: "Aucun jeton détenu vers une app ou vers Google", ou: "CLAUDE.md" },
  { texte: "Chaque lecture est journalisée et signée, en chaîne", ou: "lib/journalAcces.ts" },
  { texte: "Les oublis sont consultés avant toute insertion", ou: "lib/db/schema.ts (oublis)" },
  { texte: "Papiers de niveau 3 : seulement dans ta conversation, sous deux verrous", ou: "lib/lecture.ts (LECTEURS_N3)" },
  { texte: "Dépense de l'IA plafonnée chaque jour", ou: "lib/coutChat.ts" },
];
