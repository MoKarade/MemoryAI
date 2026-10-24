// lib/pieces/secondeLecture.ts — PUR : comparer la seconde lecture d'un papier à la première (ADR 0026).
//
// MemoryAI ne garde pas le document : seule une relecture À L'AVEUGLE par DriveAI, par un autre
// canal, prouve quelque chose. Ce module ne fait que COMPARER ; il ne lit ni n'écrit rien.
// ⚠️ Un champ présent d'un côté et absent de l'autre DIVERGE, et toute divergence laisse le papier à Marc.

import { z } from "zod";
import { estCanari } from "../canari";
import { LONGUEUR_MAX_COURTE } from "./validerPiece";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Les champs que les deux lectures doivent rendre pareils. Leur NOM seul sort dans la trace. */
export const CHAMPS_COMPARES = ["titulaire", "emetteur", "dateDocument", "dateEcheance"] as const;
type Champ = (typeof CHAMPS_COMPARES)[number];

/** Une lecture, réduite à ce qui se compare. `null` = la lecture n'a rien trouvé. */
export type Lecture = Record<Champ, string | null>;

/** Au plus tant de relectures par appel : au-delà, rien n'est écrit (comme `/api/pieces`). */
export const LOT_MAX_RELECTURES = 50;

const texte = z.string().min(1).max(LONGUEUR_MAX_COURTE).nullable();
const date = z.string().regex(DATE).nullable();

/** Le contrat d'une relecture envoyée par DriveAI : des champs bornés, aucun texte libre. */
export const schemaRelecture = z
  .object({
    file_id: z.string().min(1).max(200),
    titulaire: texte,
    emetteur: texte,
    date_document: date,
    date_echeance: date,
    extracteur: z.string().min(1).max(LONGUEUR_MAX_COURTE),
  })
  .strict();

/** Sans casse, sans accents, mots triés ; c'est elle qu'on empreinte : concorder = même empreinte. */
export function forme(v: string): string {
  return v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Les champs qui divergent entre les deux lectures ; vide = concordance complète. */
export function divergents(premiere: Lecture, seconde: Lecture): Champ[] {
  return CHAMPS_COMPARES.filter((c) => {
    const a = premiere[c];
    const b = seconde[c];
    if (a === null || b === null) return a !== b;
    return forme(a) !== forme(b) || forme(a) === "";
  });
}

/** Ce que MemoryAI sait du papier avant de comparer (en clair, sans le déchiffrer). */
export interface EtatPapier {
  niveau: number;
  statut: string;
  supprime: boolean;
}

export type DecisionPapier =
  | { genre: "vrai" }
  | { genre: "doute"; champs: Champ[] }
  | { genre: "exclu"; motif: "niveau" | "canari" | "inactif" | "rien-a-comparer" };

/**
 * La décision, dans cet ordre : un papier inactif ou sensible n'est jamais jugé seul ; un canari
 * dans l'une ou l'autre lecture non plus ; deux lectures vides ne confirment rien ; sinon, la
 * concordance complète seule fait « vrai ».
 */
export function deciderPapier(etat: EtatPapier, premiere: Lecture, seconde: Lecture): DecisionPapier {
  if (etat.supprime || etat.statut !== "active") return { genre: "exclu", motif: "inactif" };
  if (etat.niveau >= 2) return { genre: "exclu", motif: "niveau" };
  if ([...Object.values(premiere), ...Object.values(seconde)].some((v) => v !== null && estCanari(v))) return { genre: "exclu", motif: "canari" };
  if (CHAMPS_COMPARES.every((c) => premiere[c] === null && seconde[c] === null)) return { genre: "exclu", motif: "rien-a-comparer" };
  const champs = divergents(premiere, seconde);
  return champs.length === 0 ? { genre: "vrai" } : { genre: "doute", champs };
}

const LIBELLES: Record<Champ, string> = {
  titulaire: "le titulaire",
  emetteur: "l'émetteur",
  dateDocument: "la date du document",
  dateEcheance: "l'échéance",
};

/** Ce que la carte dit d'un doute : les champs, jamais leurs valeurs. */
export function phraseDoutePapier(champs: readonly string[]): string {
  const noms = champs.filter((c): c is Champ => c in LIBELLES).map((c) => LIBELLES[c]);
  if (noms.length === 0) return "LIA a relu ce papier : les deux lectures ne concordent pas.";
  const liste = noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`;
  return `LIA a relu ce papier : ${liste} ne concorde${noms.length > 1 ? "nt" : ""} pas entre les deux lectures.`;
}
