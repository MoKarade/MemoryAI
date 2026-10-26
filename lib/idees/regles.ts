// lib/idees/regles.ts — les idées de LIA pour les apps (ADR 0027, tâche MemoryAI 233). PUR : aucune
// base, aucune horloge, aucun réseau ; on lui donne des demandes déjà lues et le jour.
//
// ⚠️ UNE RÈGLE SUR DES COMPTES, PAS UN MODÈLE. Une idée naît d'un signal compté : la même demande
// du hub, faite au moins deux jours différents en 30 jours. Son texte est un gabarit du code
// (`lib/idees/tableau.ts`) dans lequel le nom de la demande n'entre que comme VALEUR citée : rien
// n'est rédigé par un modèle, donc rien n'est inventé et rien ne peut devenir une consigne.
// ⚠️ L'UTILITÉ EST UNE ESTIMATION et se dit telle. Elle croît avec le nombre de jours où la demande
// revient et décroît avec le temps depuis la dernière ; aucun chiffre ne vient d'un modèle.
// ⚠️ ÉCARTÉE OU FAITE, UNE IDÉE NE REVIENT JAMAIS : elle garde son empreinte, la règle ne la recrée
// pas et ne la retouche pas, même si la demande revient.

import { jourQuebec } from "../coutChat";

const ETATS_IDEE = ["proposee", "retenue", "faite", "ecartee"] as const;
export type EtatIdee = (typeof ETATS_IDEE)[number];

/** La seule règle de ce lot : la même demande revient (ADR 0027 § 2). */
export const REGLE_DEMANDE_REPETEE = "demande-repetee" as const;

/** La fenêtre où se comptent les jours de demande, et le minimum de jours pour qu'une idée naisse. */
export const FENETRE_JOURS = 30;
const JOURS_MIN = 2;
/** À ce nombre de jours, la répétition pèse à plein dans l'utilité. */
const JOURS_PLEIN = 5;
/** Part de la répétition dans l'utilité ; le reste est la fraîcheur de la dernière demande. */
const PART_REPETITION = 0.7;

/** Pourquoi l'idée existe : des nombres et un jour, jamais du texte libre. */
export interface Raisons {
  /** Combien de jours différents (heure du Québec) la demande a été faite dans la fenêtre. */
  jours: number;
  fenetre: number;
  /** Le jour de la dernière demande, `AAAA-MM-JJ`. */
  derniere: string;
}

export interface DemandePourIdee {
  app: string;
  genre: string;
  nom: string;
  demandeLe: Date;
}

interface IdeeCalculee {
  regle: typeof REGLE_DEMANDE_REPETEE;
  app: string;
  genre: string;
  nom: string;
  utilite: number;
  raisons: Raisons;
}

/** Ce que l'écran montre d'une idée : le nom est déjà déchiffré. */
export interface IdeeAffichee {
  id: string;
  app: string;
  genre: string;
  nom: string;
  etat: EtatIdee;
  utilite: number;
  raisons: Raisons;
}

interface IdeeStockee {
  empreinte: string;
  etat: EtatIdee;
  utilite: number;
  raisons: Raisons;
}

const MS_JOUR = 86_400_000;
const midi = (jour: string) => Date.parse(`${jour}T12:00:00Z`);
const decaler = (jour: string, n: number) => new Date(midi(jour) + n * MS_JOUR).toISOString().slice(0, 10);
const ecartJours = (de: string, a: string) => Math.round((midi(a) - midi(de)) / MS_JOUR);
const borne01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * L'utilité estimée, de 0 à 100. 70 % pour la répétition (un jour : rien, cinq jours : plein), 30 %
 * pour la fraîcheur (la dernière demande d'aujourd'hui : plein, d'il y a 30 jours : rien).
 */
export function utiliteEstimee(jours: number, ilYA: number): number {
  const repetition = borne01((jours - 1) / (JOURS_PLEIN - 1));
  const fraicheur = 1 - borne01(ilYA / FENETRE_JOURS);
  return Math.round(100 * (PART_REPETITION * repetition + (1 - PART_REPETITION) * fraicheur));
}

/**
 * Les idées nées des demandes du hub au `jour` donné (heure du Québec) : une par demande (même app,
 * même genre, même nom) faite au moins deux jours différents dans les 30 derniers, la plus utile
 * d'abord. Une demande d'un jour à venir (horloge fausse) ne compte pas.
 */
export function calculerIdees(demandes: readonly DemandePourIdee[], jour: string): IdeeCalculee[] {
  const debut = decaler(jour, -(FENETRE_JOURS - 1));
  const groupes = new Map<string, { app: string; genre: string; nom: string; jours: Set<string> }>();
  for (const d of demandes) {
    const j = jourQuebec(d.demandeLe);
    if (j < debut || j > jour) continue;
    const cle = JSON.stringify([d.app, d.genre, d.nom]);
    const g = groupes.get(cle) ?? { app: d.app, genre: d.genre, nom: d.nom, jours: new Set<string>() };
    g.jours.add(j);
    groupes.set(cle, g);
  }
  const idees: IdeeCalculee[] = [];
  for (const g of groupes.values()) {
    if (g.jours.size < JOURS_MIN) continue;
    const jours = [...g.jours].sort();
    const derniere = jours[jours.length - 1] as string;
    idees.push({
      regle: REGLE_DEMANDE_REPETEE,
      app: g.app,
      genre: g.genre,
      nom: g.nom,
      utilite: utiliteEstimee(g.jours.size, ecartJours(derniere, jour)),
      raisons: { jours: g.jours.size, fenetre: FENETRE_JOURS, derniere },
    });
  }
  return idees.sort((a, b) => b.utilite - a.utilite || a.app.localeCompare(b.app) || a.genre.localeCompare(b.genre) || a.nom.localeCompare(b.nom));
}

interface PlanIdees {
  creer: (IdeeCalculee & { empreinte: string })[];
  majs: { empreinte: string; utilite: number; raisons: Raisons }[];
}

/**
 * Ce que la passe écrit : les idées neuves (sauf celles que Marc a oubliées), et la mise à jour de
 * celles qui sont encore en jeu. Une idée `faite` ou `ecartee` n'est jamais retouchée. Une idée en
 * jeu dont la demande ne tient plus dans la fenêtre garde ses dernières raisons connues, et son
 * utilité baisse avec le temps depuis sa dernière demande.
 */
export function planifierIdees(
  calculees: readonly (IdeeCalculee & { empreinte: string })[],
  stockees: readonly IdeeStockee[],
  oubliees: ReadonlySet<string>,
  jour: string,
): PlanIdees {
  const parEmpreinte = new Map(stockees.map((s) => [s.empreinte, s] as const));
  const vues = new Set<string>();
  const plan: PlanIdees = { creer: [], majs: [] };
  for (const c of calculees) {
    vues.add(c.empreinte);
    const s = parEmpreinte.get(c.empreinte);
    if (!s) {
      if (!oubliees.has(c.empreinte)) plan.creer.push(c);
      continue;
    }
    if (s.etat === "faite" || s.etat === "ecartee") continue;
    if (s.utilite !== c.utilite || s.raisons.jours !== c.raisons.jours || s.raisons.derniere !== c.raisons.derniere) {
      plan.majs.push({ empreinte: c.empreinte, utilite: c.utilite, raisons: c.raisons });
    }
  }
  for (const s of stockees) {
    if (vues.has(s.empreinte) || s.etat === "faite" || s.etat === "ecartee") continue;
    const utilite = utiliteEstimee(s.raisons.jours, ecartJours(s.raisons.derniere, jour));
    if (utilite !== s.utilite) plan.majs.push({ empreinte: s.empreinte, utilite, raisons: s.raisons });
  }
  return plan;
}
