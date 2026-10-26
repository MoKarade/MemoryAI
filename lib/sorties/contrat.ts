// lib/sorties/contrat.ts — le corps de `POST /api/sorties`, lu et borné (ADR 0031). PUR.
//
// ⚠️ TITRE ET RÉSUMÉ SONT DES DONNÉES, jamais des instructions : ils viennent d'une app, donc d'un
// texte que Marc ou un tiers a écrit (une offre d'emploi, un nom de recette). Ils sortent d'ici sur
// une ligne, sans balise ni caractère de contrôle, et sont refusés (pas coupés) au-delà de leur
// borne : un texte tronqué dirait autre chose.
// ⚠️ L'APP NE SE LIT JAMAIS ICI : elle vient du nom de la variable qui a reconnu le jeton (ADR 0015).
// Une clé `app` dans le corps est ignorée, et son NOM seul (borné) revient dans `ignores`.

import { createHash } from "node:crypto";

export const EVENEMENTS_MAX = 50;
export const TITRE_MAX = 120;
export const RESUME_MAX = 600;
/** La taille du corps, en caractères : cinquante événements au plus tiennent largement dessous. */
export const CORPS_MAX = 64_000;
const PASSE_MAX_MS = 400 * 86_400_000;
const AVANCE_MAX_MS = 86_400_000;
/** ISO avec décalage explicite : une heure sans fuseau serait lue en UTC par Vercel. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const TYPE = /^[a-z0-9_]{1,40}$/;
/** L'identifiant de l'objet dans l'app : ASCII imprimable sans espace. Jamais affiché, seulement haché. */
const REF = /^[\x21-\x7e]{1,80}$/;
const NOM_CLE = /^[A-Za-z0-9_]{1,40}$/;
const CLES_ENVOI = new Set(["source", "evenements"]);
const CLES_EVENEMENT = new Set(["type", "date", "titre", "resume", "ref", "niveau"]);

/**
 * Le niveau MINIMUM de ce que chaque app envoie (ADR 0031 § 3). Une app peut monter un niveau, jamais
 * le descendre. Une app absente d'ici n'a pas la porte (`APPS_SORTIES`) ; au cas où, le défaut est le
 * plus fermé.
 */
const PLANCHER_NIVEAU: Readonly<Record<string, number>> = { batchchef: 1, carai: 2, driveai: 2, financeai: 3, jobai: 2 };
/** Les apps qui ont la porte : une liste fermée, dans le code. En ajouter une est une décision de frontière. */
export const APPS_SORTIES: ReadonlySet<string> = new Set(Object.keys(PLANCHER_NIVEAU));

/** `max(niveau reçu, plancher de l'app)` : le niveau ne descend jamais. PURE. */
export function niveauRetenu(app: string, recu: number | null): number {
  return Math.max(recu ?? 1, PLANCHER_NIVEAU[app] ?? 3);
}

type CodeRefus = "forme_invalide" | "type_invalide" | "date_invalide" | "titre_invalide" | "resume_invalide" | "ref_invalide" | "niveau_invalide";

export interface SortieLue {
  /** Sa place dans l'envoi : le refus d'un voisin ne la décale pas. */
  position: number;
  type: string;
  date: Date;
  titre: string;
  resume: string | null;
  ref: string | null;
  /** Le niveau DÉCLARÉ par l'app, ou rien : `niveauRetenu` le relève au plancher. */
  niveau: number | null;
}

export interface EnvoiSorties {
  sorties: SortieLue[];
  refuses: { index: number; code: CodeRefus }[];
  ignores: string[];
}

export type LectureEnvoi = { ok: true; envoi: EnvoiSorties } | { ok: false; code: string; message: string };

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Un texte sur une ligne, sans balise ni caractère de contrôle. `null` : trop court ou trop long. PURE. */
function nettoyerLigne(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= min && t.length <= max ? t : null;
}

/** Un instant ISO AVEC décalage, ou `null`. Une seule définition : la porte d'écriture et l'outil de lecture s'en servent. PURE. */
export function instant(v: unknown): Date | null {
  if (typeof v !== "string" || !INSTANT.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function lireSortie(v: unknown, maintenant: Date): Omit<SortieLue, "position"> | CodeRefus {
  if (!estObjet(v)) return "forme_invalide";
  const type = v.type;
  if (typeof type !== "string" || !TYPE.test(type)) return "type_invalide";
  const date = instant(v.date);
  const t = maintenant.getTime();
  if (!date || date.getTime() < t - PASSE_MAX_MS || date.getTime() > t + AVANCE_MAX_MS) return "date_invalide";
  const titre = nettoyerLigne(v.titre, 1, TITRE_MAX);
  if (titre === null) return "titre_invalide";
  let resume: string | null = null;
  if (v.resume !== undefined && v.resume !== null) {
    const r = nettoyerLigne(v.resume, 0, RESUME_MAX);
    if (r === null) return "resume_invalide";
    resume = r === "" ? null : r;
  }
  let ref: string | null = null;
  if (v.ref !== undefined && v.ref !== null) {
    const r = v.ref;
    if (typeof r !== "string" || !REF.test(r)) return "ref_invalide";
    ref = r;
  }
  let niveau: number | null = null;
  if (v.niveau !== undefined && v.niveau !== null) {
    const n = v.niveau;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 3) return "niveau_invalide";
    niveau = n;
  }
  return { type, date, titre, resume, ref, niveau };
}

/**
 * L'identité d'une sortie, pour qu'un même événement renvoyé ne se double jamais. Avec `ref` (l'identifiant
 * de l'objet dans l'app), c'est le type et la `ref` ; sans, le type, l'instant et le titre. PURE.
 */
export function empreinte(s: Pick<SortieLue, "type" | "date" | "titre" | "ref">): string {
  const base = s.ref !== null ? `${s.type}|ref:${s.ref}` : `${s.type}|${s.date.toISOString()}|${s.titre}`;
  return createHash("sha256").update(base, "utf8").digest("hex");
}

/**
 * Lit un envoi. Un défaut de l'ENVOI (source, liste, nombre) le refuse entier ; un défaut d'un ÉVÉNEMENT
 * ne refuse que lui, compté dans `refuses` avec son index et un code fermé. PURE.
 */
export function lireEnvoiSorties(corps: unknown, maintenant: Date): LectureEnvoi {
  if (!estObjet(corps)) return { ok: false, code: "corps_invalide", message: "Le corps doit être un objet JSON." };
  if (corps.source !== "sorties") return { ok: false, code: "source_inconnue", message: "Seule la source « sorties » est reconnue ici." };
  const liste = corps.evenements;
  if (!Array.isArray(liste) || liste.length === 0) {
    return { ok: false, code: "evenements_invalides", message: "evenements doit être une liste d'au moins un événement." };
  }
  if (liste.length > EVENEMENTS_MAX) {
    return { ok: false, code: "trop_d_evenements", message: `Au plus ${EVENEMENTS_MAX} événements par envoi.` };
  }

  const ignores = new Set<string>();
  const noter = (o: Record<string, unknown>, connues: ReadonlySet<string>) => {
    for (const k of Object.keys(o)) if (!connues.has(k)) ignores.add(NOM_CLE.test(k) ? k : "?");
  };
  noter(corps, CLES_ENVOI);

  const lues: SortieLue[] = [];
  const refuses: EnvoiSorties["refuses"] = [];
  liste.forEach((v, index) => {
    if (estObjet(v)) noter(v, CLES_EVENEMENT);
    const s = lireSortie(v, maintenant);
    if (typeof s === "string") refuses.push({ index, code: s });
    else lues.push({ ...s, position: index });
  });
  return { ok: true, envoi: { sorties: lues, refuses, ignores: [...ignores].sort() } };
}
