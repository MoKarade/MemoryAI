// lib/agenda/contrat.ts — le corps de `POST /api/agenda`, lu et borné (ADR 0029). PUR.
//
// ⚠️ UN TITRE D'ÉVÉNEMENT EST UNE DONNÉE, jamais une instruction : il peut venir d'une invitation
// écrite par un tiers. Il sort d'ici sur une ligne, sans balise ni caractère de contrôle, et il est
// refusé (pas coupé) au-delà de 120 caractères : un titre tronqué dirait autre chose.
// ⚠️ RIEN D'AUTRE N'ENTRE : ni lieu, ni invités, ni description, ni identifiant Google. Une clé en
// trop est ignorée, et son NOM seul (borné) revient dans `ignores` pour que DriveAI le voie.

import { jourQuebec } from "../coutChat";

export const EVENEMENTS_MAX = 50;
export const TITRE_MAX = 120;
/** La taille du corps, en caractères : un agenda d'un jour tient largement dessous. */
export const CORPS_MAX = 32_000;
const AVANCE_MAX_MS = 5 * 60_000;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
/** ISO avec décalage explicite : une heure sans fuseau serait lue en UTC par Vercel. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const NOM_CLE = /^[A-Za-z0-9_]{1,40}$/;
const CLES_ENVOI = new Set(["source", "jour", "lu_le", "evenements"]);
const CLES_EVENEMENT = new Set(["debut", "duree_min", "titre", "journee_entiere"]);

type CodeRefus = "forme_invalide" | "debut_invalide" | "duree_invalide" | "titre_invalide" | "journee_invalide";

interface EvenementAgenda {
  debut: Date;
  dureeMin: number;
  titre: string;
  journeeEntiere: boolean;
}

export interface EnvoiAgenda {
  jour: string;
  luLe: Date;
  /** Chacun garde sa `position` dans l'envoi : le refus d'un voisin ne décale pas l'ordre. */
  evenements: (EvenementAgenda & { position: number })[];
  refuses: { index: number; code: CodeRefus }[];
  ignores: string[];
}

export type LectureEnvoi = { ok: true; envoi: EnvoiAgenda } | { ok: false; code: string; message: string };

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Un titre sur une ligne, sans balise ni caractère de contrôle. `null` : vide ou trop long. PURE. */
export function nettoyerTitre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 1 && t.length <= TITRE_MAX ? t : null;
}

function instant(v: unknown): Date | null {
  if (typeof v !== "string" || !INSTANT.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Le jour décalé de `n` jours (calendrier pur, sans heure). */
function decaler(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function jourValide(v: unknown): v is string {
  if (typeof v !== "string" || !JOUR.test(v)) return false;
  return new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
}

function lireEvenement(v: unknown): EvenementAgenda | CodeRefus {
  if (!estObjet(v)) return "forme_invalide";
  const debut = instant(v.debut);
  if (!debut) return "debut_invalide";
  const duree = v.duree_min;
  if (typeof duree !== "number" || !Number.isInteger(duree) || duree < 0 || duree > 1440) return "duree_invalide";
  const titre = nettoyerTitre(v.titre);
  if (titre === null) return "titre_invalide";
  // Absent vaut « non » : la plupart des événements ont une heure.
  const journee = v.journee_entiere ?? false;
  if (typeof journee !== "boolean") return "journee_invalide";
  return { debut, dureeMin: duree, titre, journeeEntiere: journee };
}

/**
 * Lit un envoi. Un défaut de l'ENVOI (source, jour, `lu_le`, liste) le refuse entier ; un défaut
 * d'un ÉVÉNEMENT ne refuse que lui, compté dans `refuses` avec son index. PURE.
 */
export function lireEnvoiAgenda(corps: unknown, maintenant: Date): LectureEnvoi {
  if (!estObjet(corps)) return { ok: false, code: "corps_invalide", message: "Le corps doit être un objet JSON." };
  if (corps.source !== "agenda") return { ok: false, code: "source_inconnue", message: "Seule la source « agenda » est reconnue ici." };
  if (!jourValide(corps.jour)) return { ok: false, code: "jour_invalide", message: "jour doit être une date AAAA-MM-JJ." };
  const aujourdhui = jourQuebec(maintenant);
  if (corps.jour < decaler(aujourdhui, -1) || corps.jour > decaler(aujourdhui, 1)) {
    return { ok: false, code: "jour_hors_fenetre", message: "jour doit être hier, aujourd'hui ou demain (heure du Québec)." };
  }
  const luLe = instant(corps.lu_le);
  if (!luLe || luLe.getTime() > maintenant.getTime() + AVANCE_MAX_MS) {
    return { ok: false, code: "lu_le_invalide", message: "lu_le doit être une heure ISO avec fuseau, pas dans le futur." };
  }
  if (!Array.isArray(corps.evenements)) return { ok: false, code: "evenements_invalides", message: "evenements doit être une liste (vide si rien n'est prévu)." };
  if (corps.evenements.length > EVENEMENTS_MAX) {
    return { ok: false, code: "trop_d_evenements", message: `Au plus ${EVENEMENTS_MAX} événements par envoi.` };
  }

  const ignores = new Set<string>();
  const noter = (o: Record<string, unknown>, connues: ReadonlySet<string>) => {
    for (const k of Object.keys(o)) if (!connues.has(k)) ignores.add(NOM_CLE.test(k) ? k : "?");
  };
  noter(corps, CLES_ENVOI);

  const evenements: EnvoiAgenda["evenements"] = [];
  const refuses: EnvoiAgenda["refuses"] = [];
  corps.evenements.forEach((v, index) => {
    if (estObjet(v)) noter(v, CLES_EVENEMENT);
    const e = lireEvenement(v);
    if (typeof e === "string") refuses.push({ index, code: e });
    else evenements.push({ ...e, position: index });
  });
  return { ok: true, envoi: { jour: corps.jour, luLe, evenements, refuses, ignores: [...ignores].sort() } };
}
