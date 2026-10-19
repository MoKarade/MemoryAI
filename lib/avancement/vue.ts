// lib/avancement/vue.ts — ce que l'onglet « Avancement » affirme, calculé sans base ni React
// (ADR 0009 §3). PUR : on lui donne des comptes, il rend des étages, des écarts et des phrases.
//
// Sur un tableau de bord, chaque chiffre est une affirmation. Trois règles tiennent ce module :
//
// ⚠️ 1. « NON MESURÉ » N'EST JAMAIS ZÉRO. Tant que DriveAI n'a rien poussé, ses étages valent
//    `null`, et l'écran dit « DriveAI n'a encore rien envoyé ». Un zéro se lirait « rien n'a été
//    classé » — le plus alarmant des faits, là où la vérité est « personne n'a encore compté ».
//
// ⚠️ 2. CHAQUE ÉCART S'EXPLIQUE, DANS LES DEUX SENS. Deux apps qui comptent ne comptent pas la
//    même chose : DriveAI compte des documents classés et un CUMUL d'envois, la Mémoire compte
//    des papiers vivants. Un écart négatif n'est pas une erreur de calcul, c'est une différence
//    de définition — et il se dit comme tel au lieu d'être rabattu à zéro.
//
// ⚠️ 3. LA LECTURE ÉCRIT DES PAPIERS, PAS DES FAITS. Il n'y a donc PAS d'étage « faits nés de
//    la lecture » : il vaudrait zéro pour toujours, et ce zéro se lirait « la lecture ne sert à
//    rien ». Les faits validés s'affichent À CÔTÉ de l'entonnoir, avec cette phrase (leçon n° 43 :
//    le compteur de faits est structurellement incapable de monter sous l'effet de la lecture).

import type { Avancement, JourLuDriveai } from "./contrat";

/** Au-delà, DriveAI a manqué quatre envois (il pousse toutes les 30 min au plus). */
export const SEUIL_RETARD_MIN = 120;

/**
 * Les dossiers de DriveAI. ⚠️ Posés ICI, jamais reçus du réseau : un libellé venu d'ailleurs
 * serait du texte non maîtrisé affiché tel quel (ADR 0009 §2.2).
 */
const LIBELLES_DOSSIER: Readonly<Record<string, string>> = {
  "01": "Administratif & identité",
  "02": "Finances",
  "03": "Logement & véhicule",
  "04": "Immigration",
  "05": "Carrière",
  "06": "Études & diplômes",
  "07": "Santé",
  "08": "Perso & projets",
  "09": "Voyages",
};

export function libelleDossier(code: string): string {
  return LIBELLES_DOSSIER[code] ?? `Dossier ${code}`;
}

export type EtatSource =
  | { etat: "jamais" }
  | { etat: "illisible"; recuIlYaMin: number }
  | { etat: "present"; recuIlYaMin: number; mesureIlYaMin: number; enRetard: boolean };

const minutesEntre = (avant: Date, apres: Date) => Math.max(0, Math.round((apres.getTime() - avant.getTime()) / 60_000));

export function etatSource(
  lu: { etat: "absent" } | { etat: "illisible"; recuLe: Date } | { etat: "present"; mesureLe: Date; recuLe: Date },
  maintenant: Date,
): EtatSource {
  if (lu.etat === "absent") return { etat: "jamais" };
  const recuIlYaMin = minutesEntre(lu.recuLe, maintenant);
  if (lu.etat === "illisible") return { etat: "illisible", recuIlYaMin };
  return {
    etat: "present",
    recuIlYaMin,
    mesureIlYaMin: minutesEntre(lu.mesureLe, maintenant),
    enRetard: recuIlYaMin > SEUIL_RETARD_MIN,
  };
}

/** « il y a 3 min », « il y a 2 h », « il y a 4 j » — une durée qu'on lit d'un coup d'œil. */
export function ilYa(minutes: number): string {
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return `il y a ${Math.round(minutes / (24 * 60))} j`;
}

type SourceEtage = "DriveAI" | "Mémoire";

export interface Etage {
  cle: "classes" | "envoyes" | "connus" | "lus";
  libelle: string;
  source: SourceEtage;
  /** `null` = non mesuré. Jamais 0 à la place. */
  valeur: number | null;
  /** Ce que le nombre ne dit pas tout seul, quand il y a quelque chose à dire. */
  note: string | null;
}

export interface Ecart {
  de: Etage["cle"];
  a: Etage["cle"];
  /** `de − a`. `null` quand l'un des deux n'est pas mesuré : on n'explique pas un écart inconnu. */
  valeur: number | null;
  explication: string;
}

export interface ComptesMemoire {
  /** Papiers vivants, lus ou non. */
  connus: number;
  /** Papiers lus par un modèle (tout extracteur autre que l'inventaire). */
  lus: number;
  /** Papiers essayés sans résultat — ils restent « à lire ». */
  tentees: number;
}

function expliquer(cle: `${Etage["cle"]}>${Etage["cle"]}`, e: number, tentees: number): string {
  switch (cle) {
    case "classes>envoyes":
      if (e > 0) return `${e} document(s) classé(s) pas encore envoyé(s) à la Mémoire : l’envoi avance chaque jour.`;
      if (e < 0) {
        return `DriveAI a envoyé ${-e} document(s) de plus qu’il n’en compte aujourd’hui : l’envoi est un CUMUL depuis le début, qui garde des documents supprimés ou déplacés depuis.`;
      }
      return "Tout ce qui est classé a été envoyé.";
    case "envoyes>connus":
      if (e > 0) {
        return `${e} envoi(s) ne sont pas devenus des papiers : la Mémoire a reconnu des doublons, ou tu as retiré ces papiers.`;
      }
      if (e < 0) return `La Mémoire connaît ${-e} papier(s) arrivé(s) par un autre chemin que l’inventaire.`;
      return "Chaque envoi est devenu un papier.";
    case "connus>lus":
      if (e <= 0) return "Tous les papiers connus ont été lus.";
      return tentees > 0
        ? `${e} papier(s) pas encore lu(s), dont ${tentees} déjà essayé(s) sans résultat (photo sans texte, fichier disparu…).`
        : `${e} papier(s) pas encore lu(s) : la mémoire sait qu’ils existent, aucun modèle ne les a encore ouverts.`;
    default:
      return "";
  }
}

export function composerEntonnoir(driveai: Avancement | null, memoire: ComptesMemoire): { etages: Etage[]; ecarts: Ecart[] } {
  const classes = driveai?.classes ?? null;
  const etages: Etage[] = [
    {
      cle: "classes",
      libelle: "Documents classés dans ton Drive",
      source: "DriveAI",
      valeur: classes?.distincts ?? null,
      note:
        classes === null
          ? null
          : classes.distincts === null
            ? `${classes.lignes} lignes d’index, pas encore recomptées en documents`
            : classes.sansFileId > 0
              ? `sans les ${classes.sansFileId} pièces jointes de courriel sans identifiant`
              : null,
    },
    {
      cle: "envoyes",
      libelle: "Envoyés à la Mémoire",
      source: "DriveAI",
      valeur: driveai?.envoi?.acceptes ?? null,
      note: null,
    },
    { cle: "connus", libelle: "Papiers que la Mémoire connaît", source: "Mémoire", valeur: memoire.connus, note: null },
    { cle: "lus", libelle: "Papiers lus par un modèle", source: "Mémoire", valeur: memoire.lus, note: null },
  ];
  const ecarts: Ecart[] = [];
  for (let i = 0; i + 1 < etages.length; i++) {
    const de = etages[i]!;
    const a = etages[i + 1]!;
    const valeur = de.valeur === null || a.valeur === null ? null : de.valeur - a.valeur;
    ecarts.push({
      de: de.cle,
      a: a.cle,
      valeur,
      explication:
        valeur === null
          ? "Écart inconnu : l’une des deux applications n’a pas encore compté."
          : expliquer(`${de.cle}>${a.cle}`, valeur, memoire.tentees),
    });
  }
  return { etages, ecarts };
}

export interface LigneDossier {
  code: string;
  libelle: string;
  /** Selon la Mémoire. */
  lus: number;
  connus: number;
  /** Selon DriveAI : ce qu'il lui reste à lire dans ce dossier. `null` s'il ne l'a pas dit. */
  resteDriveai: number | null;
  enCours: boolean;
}

/**
 * Les dossiers, fusionnés. ⚠️ `lus`/`connus` viennent de la MÉMOIRE (c'est elle qui sait ce qui
 * est lu) ; `resteDriveai` et `enCours` viennent de DRIVEAI (c'est lui qui sait où il lit). Deux
 * colonnes, deux sources, et l'écran les nomme — les additionner fabriquerait un nombre
 * qu'aucune des deux apps n'a mesuré.
 */
export function composerDossiers(
  memoire: readonly { code: string; lus: number; connus: number }[],
  driveai: Avancement | null,
): LigneDossier[] {
  const parCode = new Map<string, LigneDossier>();
  for (const m of memoire) {
    parCode.set(m.code, { code: m.code, libelle: libelleDossier(m.code), lus: m.lus, connus: m.connus, resteDriveai: null, enCours: false });
  }
  for (const d of driveai?.fileLecture ?? []) {
    const l = parCode.get(d.code) ?? { code: d.code, libelle: libelleDossier(d.code), lus: 0, connus: 0, resteDriveai: null, enCours: false };
    l.resteDriveai = d.restants;
    l.enCours = d.enCours;
    parCode.set(d.code, l);
  }
  return [...parCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * La série « reste à lire » de DriveAI, sur son tag COURANT seulement. ⚠️ Un bump de tag remet
 * les cumuls à zéro : une série qui le traverse plongerait sans raison. Et les jours au reste
 * inconnu (`null`) sont retirés, jamais tracés à zéro.
 */
export function serieReste(joursLus: readonly JourLuDriveai[]): { jour: string; reste: number }[] {
  if (!joursLus.length) return [];
  const tries = [...joursLus].sort((a, b) => a.jour.localeCompare(b.jour));
  const tag = tries[tries.length - 1]!.tag;
  return tries.filter((j) => j.tag === tag && j.restants !== null).map((j) => ({ jour: j.jour, reste: j.restants as number }));
}
