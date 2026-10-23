// lib/memoire/apprentissage.ts — l'onglet Apprentissage de la page Mémoire (MemoryAI#74,
// maquette v5) : ce que LIA retrouve au banc, mesure après mesure, ce qu'elle a tiré des
// conversations et ce qu'elle demande. Fonctions pures ; les lectures vivent dans
// `lib/memoire/depotApprentissage.ts`.
//
// ⚠️ NO FAKE DATA : la maquette dessine une courbe d'entraînement, une porte de qualité, des
// versions de réseau, des habitudes en pourcentage et des exemples par type. Aucun réseau n'est
// entraîné aujourd'hui : ces blocs n'existent pas ici, au lieu d'exister faux. Ce qui se mesure
// vraiment, c'est le banc (`lib/banc/banc.ts`) et la passe d'apprentissage (`lib/apprentissage.ts`).

import { z } from "zod";
import { CAPACITES, type Mesure } from "@/lib/banc/banc";
import { STATUTS, STATUTS_QUESTION } from "@/lib/db/schema";

type Capacite = (typeof CAPACITES)[number];

/** Les cinq capacités du banc, en mots (`lib/banc/banc.ts`, d'après LongMemEval). */
export const LIBELLE_CAPACITE: Record<Capacite, string> = {
  extraction: "Trouver un papier",
  "multi-sources": "En trouver plusieurs",
  temporel: "Situer dans le temps",
  "mise-a-jour": "Prendre le plus récent",
  abstention: "Dire « je n'ai rien »",
};

const part = z.number().min(0).max(1).nullable();
const schemaMesure = z.object({
  k: z.number().int().positive(),
  questions: z.number().int().nonnegative(),
  parCapacite: z.object(Object.fromEntries(CAPACITES.map((c) => [c, z.object({ questions: z.number().int().nonnegative(), rappel: part })])) as Record<Capacite, z.ZodObject<{ questions: z.ZodNumber; rappel: typeof part }>>),
  rappel: part,
  abstentionCorrecte: part,
});

/**
 * Une mesure relue de la base. ⚠️ Une ligne illisible rend `null`, jamais une mesure à zéro :
 * « on ne sait pas lire » n'est pas « elle n'a rien retrouvé ».
 */
export function lireMesure(json: string): Mesure | null {
  try {
    const r = schemaMesure.safeParse(JSON.parse(json));
    return r.success ? (r.data as Mesure) : null;
  } catch {
    // Du JSON cassé : la ligne est écartée, et la page dit combien l'ont été.
    return null;
  }
}

/** Une part en pourcentage, ou « — » quand il n'y a rien à mesurer. */
export function pourcent(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)} %`;
}

export interface PointBanc {
  mesureLe: Date;
  rappel: number | null;
  abstention: number | null;
}

/** La courbe du banc, de la plus ancienne mesure à la plus récente ; les illisibles sont comptées à part. */
export function serieBanc(lignes: readonly { mesureLe: Date; resultat: string }[]): { points: PointBanc[]; illisibles: number; derniere: Mesure | null } {
  const lues = [...lignes]
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime())
    .map((l) => ({ mesureLe: l.mesureLe, m: lireMesure(l.resultat) }));
  const valides = lues.filter((x): x is { mesureLe: Date; m: Mesure } => x.m !== null);
  return {
    points: valides.map((x) => ({ mesureLe: x.mesureLe, rappel: x.m.rappel, abstention: x.m.abstentionCorrecte })),
    illisibles: lues.length - valides.length,
    derniere: valides.at(-1)?.m ?? null,
  };
}

/** Un compte par statut, dans l'ordre du schéma : un statut sans ligne vaut 0. */
function completer<S extends string>(ordre: readonly S[], lignes: readonly { statut: string; n: number }[]): { statut: S; n: number }[] {
  const par = new Map<string, number>();
  for (const l of lignes) par.set(l.statut, (par.get(l.statut) ?? 0) + l.n);
  return ordre.map((statut) => ({ statut, n: par.get(statut) ?? 0 }));
}

export const comptesFaits = (lignes: readonly { statut: string; n: number }[]) => completer(STATUTS, lignes);
export const comptesQuestions = (lignes: readonly { statut: string; n: number }[]) => completer(STATUTS_QUESTION, lignes);

export const LIBELLE_STATUT_FAIT: Record<(typeof STATUTS)[number], string> = {
  propose: "À valider",
  valide: "Validés par toi",
  rejete: "Rejetés",
  perime: "Remplacés depuis",
};

export const LIBELLE_STATUT_QUESTION: Record<(typeof STATUTS_QUESTION)[number], string> = {
  ouverte: "Ouvertes",
  repondue: "Répondues",
  ecartee: "Écartées",
};

/** Comment elle apprend, étape par étape ; chaque étape nomme le code qui la fait. */
export const ETAPES: readonly { texte: string; ou: string }[] = [
  { texte: "Elle relit les conversations neuves, dès quatre messages non lus.", ou: "lib/apprentissage.ts" },
  { texte: "Elle en tire des faits proposés, jamais validés d'office.", ou: "lib/conversations/extraction.ts" },
  { texte: "Tu valides ou tu rejettes dans « À valider ».", ou: "app/a-valider/page.tsx" },
  { texte: "Elle te demande ce qui manque encore, ou ce qui se contredit.", ou: "lib/questions/producteur.ts" },
  { texte: "Le banc mesure chaque jour ce qu'elle retrouve, sur les mêmes questions.", ou: "lib/banc/passe.ts" },
];
