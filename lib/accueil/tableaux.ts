// lib/accueil/tableaux.ts — les tuiles des panneaux de la maison (maquette v5, écart B) : une
// question en tête, puis un tableau de tuiles repliables. PUR : la page lit la base, ce module
// compose, `components/TableauEspace.tsx` dessine.
//
// ⚠️ « Exactement comme la maquette » (Marc, 23/10) : chaque tuile de la maquette est là, à sa
// place, avec son titre et son icône. ⚠️ NO FAKE DATA : une tuile sans donnée réelle se dessine
// VIDE (`genre: "vide"`), avec une ligne qui dit ce qui manque ; jamais un chiffre de la maquette.

import { jourQuebec, POSTES, type Poste } from "@/lib/coutChat";
import { FUSEAU } from "@/lib/fuseau";
import { heureQuebec, libelleLecteur } from "@/lib/memoire/acces";
import { SOURCE_METEO, type LectureMeteo } from "@/lib/monde/meteo";
import { SOURCE_ACTUALITE, type Actualite } from "@/lib/monde/actualite";

/** Les noms des tracés de `components/IconeEspace.tsx` employés ici (lib ne dépend pas des composants). */
type IconeTuile = "globe" | "eye" | "cal" | "target" | "shield" | "bulb" | "grid" | "chart" | "croix" | "tool" | "lock" | "spark" | "search" | "star" | "coin" | "clock" | "layers" | "pie" | "bell"
  | "chat" | "path" | "folder" | "alert" | "pulse" | "heart" | "moon" | "phone" | "thermo"
  | "map" | "list" | "gauge" | "num" | "table" | "net" | "radar" | "funnel" | "flow" | "heat" | "kanban" | "tree" | "doc" | "cardok";

export type Corps =
  | { genre: "vide"; texte: string }
  | { genre: "texte"; texte: string; lien?: { href: string; libelle: string } }
  | { genre: "chiffres"; chiffres: { icone: IconeTuile; valeur: string; libelle: string }[] }
  /** Un classement en barres horizontales (`part` rapportée au plus grand). */
  | { genre: "barres"; barres: { libelle: string; valeur: string; part: number }[]; resume: string }
  | { genre: "pastilles"; elements: string[] }
  /** Un anneau : les parts d'un total face à un plafond (la dépense du jour par poste). */
  | { genre: "anneau"; parts: { libelle: string; valeur: number; teinte: Teinte }[]; centre: string; sous: string; plafond: number; resume: string }
  /** Des lignes « libellé · valeur » avec une barre de remplissage (`part` entre 0 et 1, `null` : pas de barre). */
  | { genre: "jauges"; lignes: { libelle: string; valeur: string; part: number | null; alerte?: boolean }[] }
  | { genre: "histogramme"; barres: { cle: string; etiquette: string; valeur: number; texte: string }[]; resume: string; unite: string }
  | { genre: "liste"; elements: { libelle: string; detail?: string }[] }
  /** Des bulles dont l'aire suit la valeur (les thèmes de la mémoire). */
  | { genre: "bulles"; bulles: { libelle: string; valeur: number }[]; resume: string };

/** Les teintes de `globals.css` (`.teinte-*`) : jamais une couleur ici. */
type Teinte = "repere" | "accent";

interface TuileEspace {
  cle: string;
  largeur: 4 | 5 | 6 | 7 | 12;
  icone: IconeTuile;
  titre: string;
  repliee?: boolean;
  corps: Corps[];
}

export interface Tableau {
  /** La question en tête du panneau, à côté de LIA (`tete2` de la maquette). */
  question: string;
  tuiles: TuileEspace[];
}

const vide = (texte: string): Corps => ({ genre: "vide", texte });

const dollars = (v: number) => `${v.toFixed(2).replace(".", ",")} $`;

const LIBELLE_POSTE: Record<Poste, string> = { chat: "Parler", apprentissage: "Apprendre" };
const TEINTE_POSTE: Record<Poste, Teinte> = { chat: "repere", apprentissage: "accent" };

/** Au-delà de cette part d'un plafond, la barre passe en alerte (le seuil « proche » de la maison). */
const SEUIL_ALERTE = 0.8;
/** En dessous de ces jours de dépense dans le mois, on n'estime pas la fin du mois. */
const JOURS_MIN_ESTIMATION = 3;
/** Le rythme de l'estimation : la moyenne des derniers jours. */
const JOURS_RYTHME = 7;

export interface EntreesBudget {
  /** Jour de Québec, `AAAA-MM-JJ`. */
  jour: string;
  depense: Record<Poste, number>;
  plafonds: Record<Poste, number>;
  /** Les jours les plus récents qui portent une dépense, dans l'ordre (`depenseParJour`). */
  parJour: readonly { jour: string; parPoste: Record<Poste, number> }[];
  /** Sur les trente derniers jours. */
  parModele: readonly { modele: string; usd: number }[];
}

const somme = (r: Record<Poste, number>) => POSTES.reduce((t, p) => t + (r[p] ?? 0), 0);
const borne01 = (x: number) => Math.max(0, Math.min(1, x));

/** Le nombre de jours du mois de `jour` (`AAAA-MM-JJ`). */
function joursDuMois(jour: string): number {
  const [a, m] = jour.split("-").map(Number);
  return new Date(Date.UTC(a ?? 1970, m ?? 1, 0)).getUTCDate();
}

/** `jour` moins `n` jours, en `AAAA-MM-JJ` (calcul de calendrier, sans fuseau). */
export function jourMoins(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (j ?? 1) - n)).toISOString().slice(0, 10);
}

/**
 * La fin du mois au rythme des sept derniers jours : ce qui est déjà dépensé ce mois-ci, plus la
 * moyenne de ces jours pour chaque jour qui reste. `null` avant trois jours de dépense dans le
 * mois : une estimation sur un jour ou deux serait un chiffre inventé qui se croit mesuré.
 */
export function finDuMois(b: Pick<EntreesBudget, "jour" | "parJour">): { usd: number; deja: number } | null {
  const mois = b.jour.slice(0, 7);
  const duMois = b.parJour.filter((d) => d.jour.startsWith(mois) && d.jour <= b.jour);
  if (duMois.length < JOURS_MIN_ESTIMATION) return null;
  const deja = duMois.reduce((t, d) => t + somme(d.parPoste), 0);
  const depuis = jourMoins(b.jour, JOURS_RYTHME - 1);
  // Un jour sans ligne dans la fenêtre a dépensé zéro : la moyenne se fait sur les SEPT jours.
  const recents = b.parJour.filter((d) => d.jour >= depuis && d.jour <= b.jour).reduce((t, d) => t + somme(d.parPoste), 0);
  const restants = joursDuMois(b.jour) - Number(b.jour.slice(8, 10));
  return { usd: deja + (recents / JOURS_RYTHME) * restants, deja };
}

export function tableauBudget(b: EntreesBudget | null): Tableau {
  const question = "Ce que LIA coûte ce mois-ci";
  if (!b) {
    const panne = vide("La base ne répond pas : la dépense n'est pas lisible.");
    return {
      question,
      tuiles: [
        { cle: "plafond", largeur: 6, icone: "coin", titre: "Plafond du jour", corps: [panne] },
        { cle: "rythme", largeur: 6, icone: "clock", titre: "Rythme", corps: [panne] },
        { cle: "trente", largeur: 12, icone: "chart", titre: "Trente jours", corps: [panne] },
        { cle: "modele", largeur: 6, icone: "layers", titre: "Par modèle", corps: [panne] },
        { cle: "fin", largeur: 6, icone: "pie", titre: "Fin du mois", corps: [panne] },
        { cle: "garde", largeur: 12, icone: "bell", titre: "Garde-fous du budget", repliee: true, corps: [panne] },
      ],
    };
  }
  const total = somme(b.depense);
  const plafond = somme(b.plafonds);
  const mois = b.jour.slice(0, 7);
  const duMois = b.parJour.filter((d) => d.jour.startsWith(mois)).reduce((t, d) => t + somme(d.parPoste), 0);
  const fin = finDuMois(b);
  const modeles = b.parModele.filter((m) => m.usd > 0);
  const maxModele = Math.max(...modeles.map((m) => m.usd), 0);
  const totalModeles = modeles.reduce((t, m) => t + m.usd, 0);
  const trente = b.parJour.slice(-30);

  return {
    question,
    tuiles: [
      {
        cle: "plafond",
        largeur: 6,
        icone: "coin",
        titre: `Plafond de ${dollars(plafond)} par jour`,
        corps: [
          {
            genre: "anneau",
            parts: POSTES.map((p) => ({ libelle: LIBELLE_POSTE[p], valeur: b.depense[p] ?? 0, teinte: TEINTE_POSTE[p] })),
            centre: dollars(total),
            sous: `sur ${dollars(plafond)}`,
            plafond,
            resume: `${dollars(total)} dépensés aujourd'hui sur un plafond de ${dollars(plafond)} par jour.`,
          },
        ],
      },
      {
        cle: "rythme",
        largeur: 6,
        icone: "clock",
        titre: "Rythme",
        corps: [
          {
            genre: "jauges",
            lignes: [
              { libelle: "Aujourd'hui", valeur: `${dollars(total)} / ${dollars(plafond)}`, part: plafond > 0 ? borne01(total / plafond) : null },
              ...POSTES.map((p) => {
                const part = (b.plafonds[p] ?? 0) > 0 ? (b.depense[p] ?? 0) / b.plafonds[p] : null;
                return { libelle: LIBELLE_POSTE[p], valeur: `${dollars(b.depense[p] ?? 0)} / ${dollars(b.plafonds[p] ?? 0)}`, part: part === null ? null : borne01(part), alerte: part !== null && part >= SEUIL_ALERTE };
              }),
              // Pas de plafond au mois : la ligne n'a pas de barre, on ne la rapporte à rien d'inventé.
              { libelle: "Ce mois-ci", valeur: dollars(duMois), part: null },
            ],
          },
        ],
      },
      {
        cle: "trente",
        largeur: 12,
        icone: "chart",
        titre: "Trente jours",
        corps: trente.length
          ? [
              {
                genre: "histogramme",
                barres: trente.map((d) => ({ cle: d.jour, etiquette: d.jour.slice(5), valeur: somme(d.parPoste), texte: dollars(somme(d.parPoste)) })),
                resume: `Dépense de chacun des ${trente.length} derniers jours qui en portent une.`,
                unite: "$ US",
              },
              { genre: "texte", texte: "Le détail, jour par jour et poste par poste :", lien: { href: "/depenses", libelle: "Toutes les dépenses" } },
            ]
          : [vide("Aucune dépense enregistrée pour l'instant.")],
      },
      {
        cle: "modele",
        largeur: 6,
        icone: "layers",
        titre: "Par modèle",
        corps: modeles.length
          ? [
              {
                genre: "barres",
                barres: modeles.map((m) => ({ libelle: m.modele, valeur: `${Math.round((m.usd / totalModeles) * 100)} %`, part: maxModele > 0 ? m.usd / maxModele : 0 })),
                resume: `Part de chaque modèle dans la dépense des trente derniers jours : ${modeles.map((m) => `${m.modele} ${Math.round((m.usd / totalModeles) * 100)} %`).join(", ")}.`,
              },
            ]
          : [vide("Aucune dépense sur les trente derniers jours.")],
      },
      {
        cle: "fin",
        largeur: 6,
        icone: "pie",
        titre: "Fin du mois",
        corps: fin
          ? [
              { genre: "chiffres", chiffres: [{ icone: "pie", valeur: `≈ ${dollars(fin.usd)}`, libelle: "d'ici la fin du mois" }] },
              { genre: "texte", texte: `Estimation : ${dollars(fin.deja)} déjà dépensés ce mois-ci, puis le rythme des ${JOURS_RYTHME} derniers jours.` },
            ]
          : [vide(`Pas encore d'estimation : il faut au moins ${JOURS_MIN_ESTIMATION} jours de dépense ce mois-ci.`)],
      },
      {
        cle: "garde",
        largeur: 12,
        icone: "bell",
        titre: "Garde-fous du budget",
        repliee: true,
        corps: [
          {
            genre: "liste",
            elements: [
              { libelle: `Parler : ${dollars(b.plafonds.chat ?? 0)} par jour`, detail: "plafond atteint, elle ne répond plus jusqu'au lendemain (heure de Québec)" },
              { libelle: `Apprendre : ${dollars(b.plafonds.apprentissage ?? 0)} par jour`, detail: "plafond atteint, la passe s'arrête et reprend le lendemain" },
              { libelle: "Relu à chaque appel", detail: "un plafond baissé s'applique tout de suite, même au milieu d'une passe" },
              { libelle: "0 $ met en pause", detail: "un plafond existe toujours, il ne se désactive pas" },
            ],
          },
          { genre: "texte", texte: "Les plafonds se règlent dans Dépenses.", lien: { href: "/depenses", libelle: "Régler les plafonds" } },
        ],
      },
    ],
  };
}


export function tableauSouvenirs(): Tableau {
  const attend = (quoi: string) => vide(`${quoi} arrivera avec la lecture des messages.`);
  return {
    question: "Retrouver un message, mot pour mot",
    tuiles: [
      { cle: "fil", largeur: 7, icone: "chat", titre: "Fil", corps: [attend("Le fil d'un message retrouvé")] },
      { cle: "filtre", largeur: 5, icone: "search", titre: "Filtre", corps: [attend("Le filtre par jour et par personne")] },
      { cle: "chemin", largeur: 12, icone: "path", titre: "Chemin", repliee: true, corps: [vide("Le chemin de sa recherche se dessinera à la première vraie recherche.")] },
      { cle: "journee", largeur: 12, icone: "clock", titre: "Journée", repliee: true, corps: [vide("La journée autour d'un message viendra avec l'agenda.")] },
      {
        cle: "recherche",
        largeur: 12,
        icone: "search",
        titre: "Recherche",
        corps: [
          { genre: "texte", texte: "Tes conversations avec elle sont déjà là :", lien: { href: "/conversations", libelle: "Anciennes conversations" } },
          { genre: "texte", texte: "Et tout ce qu'elle sait :", lien: { href: "/pieces", libelle: "Ce qu'elle sait" } },
        ],
      },
      { cle: "autour", largeur: 6, icone: "cal", titre: "Autour de ce jour", repliee: true, corps: [vide("Le jour d'un message (météo, lieu, personnes) viendra avec l'agenda.")] },
      { cle: "papiers", largeur: 6, icone: "folder", titre: "Papiers liés", repliee: true, corps: [attend("Le lien entre un message et ses papiers")] },
    ],
  };
}

export function tableauSante(): Tableau {
  const attend = vide("Rien encore : les données arriveront par Health Connect, sur ton téléphone.");
  return {
    question: "D'après mon historique, est-ce que je suis malade ?",
    tuiles: [
      { cle: "signaux", largeur: 12, icone: "alert", titre: "Signaux", corps: [vide("Aucun signal : sans données de santé, elle ne compare rien à ton habituel.")] },
      { cle: "ressemblance", largeur: 12, icone: "globe", titre: "Ressemblance", corps: [vide("Elle rapprochera un jour d'un épisode passé quand elle en aura l'historique.")] },
      { cle: "21", largeur: 12, icone: "pulse", titre: "21 jours", repliee: true, corps: [attend] },
      { cle: "12", largeur: 12, icone: "cal", titre: "12 mois", repliee: true, corps: [attend] },
      { cle: "activite", largeur: 6, icone: "heart", titre: "Activité", corps: [attend] },
      { cle: "sommeil", largeur: 6, icone: "moon", titre: "Sommeil, 7 nuits", corps: [attend] },
      {
        cle: "consulter",
        largeur: 12,
        icone: "phone",
        titre: "Quand consulter",
        corps: [
          {
            genre: "liste",
            elements: [
              { libelle: "Surveiller", detail: "quelques jours, du repos" },
              { libelle: "811 (Info-Santé)", detail: "si ça dure ou si la fièvre monte" },
              { libelle: "911", detail: "souffle court, douleur à la poitrine" },
            ],
          },
        ],
      },
      { cle: "symptomes", largeur: 6, icone: "thermo", titre: "Symptômes, 7 jours", repliee: true, corps: [vide("Aucun symptôme noté.")] },
      { cle: "rdv", largeur: 6, icone: "cal", titre: "Rendez-vous", repliee: true, corps: [vide("Les rendez-vous viendront avec l'agenda.")] },
    ],
  };
}

/** Le plafond des lectures du jour lues pour « Sa journée » ; atteint, le compte se dit « au moins ». */
export const LECTURES_DU_JOUR_MAX = 2000;
/** Combien de lectures du jour « Journal » montre, les plus récentes d'abord. */
const LIGNES_JOURNAL = 8;
const HEURE_MINUTE = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, hour: "numeric", minute: "2-digit", hourCycle: "h23" });

/** Une lecture du journal en une ligne : « 9 h 05 · Chercher un fait », et qui a lu. */
export function ligneLecture(l: { ts: Date; lecteur: string; outil: string }): { libelle: string; detail: string } {
  return { libelle: `${HEURE_MINUTE.format(l.ts).replace(":", " h ")} · ${libelleOutil(l.outil)}`, detail: libelleLecteur(l.lecteur) };
}

/** Ce qu'elle vérifie elle-même, dans l'ordre de la tuile « Ce qu'elle surveille » (tâche MemoryAI 232). */
const VERIFICATIONS = ["meteo", "actualite", "budget", "faits", "papiers", "lectures"] as const;
type Verification = (typeof VERIFICATIONS)[number];

const LIBELLE_VERIFICATION: Record<Verification, string> = {
  meteo: "La météo (Environnement Canada)",
  actualite: "L'actualité (Radio-Canada)",
  budget: "Sa dépense du jour",
  faits: "La relecture des faits",
  papiers: "La seconde lecture des papiers",
  lectures: "Qui lit ta mémoire",
};

/**
 * Ce que LIA a fait aujourd'hui, COMPTÉ dans ses journaux (aucun texte, rien de déchiffré), et la
 * dernière fois que chaque vérification a tourné (`null` : jamais). Les lectures du jour viennent à
 * part (`lectures`), elles servent aussi l'histogramme.
 */
export interface ActiviteDuJour {
  /** Jour de Québec, `AAAA-MM-JJ`. */
  jour: string;
  /** Les appels au modèle du jour, par poste (`depenses_chat`). */
  appels: Record<Poste, number>;
  /** Les faits relus par LIA ce jour (`validations_lia`). */
  faitsRelus: number;
  /** Les papiers passés en seconde lecture ce jour (`relectures_pieces`). */
  papiersRelus: number;
  dernieres: Record<Verification, Date | null>;
}

const JOUR_MOIS = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, day: "numeric", month: "short" });

/** « aujourd'hui, 9 h 05 », « le 24 oct., 9 h 05 », ou « pas encore » : la dernière fois, à Québec. */
export function quandQuebec(ts: Date | null, jour: string): string {
  if (ts === null) return "pas encore";
  const heure = HEURE_MINUTE.format(ts).replace(":", " h ");
  return jourQuebec(ts) === jour ? `aujourd'hui, ${heure}` : `le ${JOUR_MOIS.format(ts)}, ${heure}`;
}

/** Son temps : une barre par genre d'action, dans un ordre fixe ; tout à zéro, la tuile le dit. */
function corpsTemps(nLectures: number, a: ActiviteDuJour): Corps {
  const lignes = [
    { libelle: "Lectures de ta mémoire", n: nLectures, auMoins: nLectures >= LECTURES_DU_JOUR_MAX },
    { libelle: "Appels au modèle pour parler", n: a.appels.chat, auMoins: false },
    { libelle: "Appels au modèle pour apprendre", n: a.appels.apprentissage, auMoins: false },
    { libelle: "Faits relus", n: a.faitsRelus, auMoins: false },
    { libelle: "Papiers en seconde lecture", n: a.papiersRelus, auMoins: false },
  ];
  const max = Math.max(...lignes.map((l) => l.n));
  if (max === 0) return vide("Elle n'a encore rien fait aujourd'hui.");
  return {
    genre: "barres",
    barres: lignes.map((l) => ({ libelle: l.libelle, valeur: `${l.auMoins ? "au moins " : ""}${l.n}`, part: l.n / max })),
    resume: "Ce qu'elle a fait aujourd'hui, compté dans ses journaux (heure du Québec).",
  };
}

/** La fenêtre des relances : les échéances passées depuis 7 jours au plus, et celles d'ici 60 jours. */
export const RELANCES_JOURS_PASSES = 7;
export const RELANCES_JOURS_A_VENIR = 60;
/** Combien d'échéances la tuile montre, la plus ancienne d'abord. */
export const LIGNES_RELANCES = 6;

/**
 * Les échéances lues dans les papiers (tâche MemoryAI 232). Ce sont des colonnes EN CLAIR par
 * conception (`lib/db/schema.ts` : la date et le dossier), les mêmes que la pile lit déjà pour son
 * ordre : rien n'est déchiffré, ni le type ni l'émetteur.
 */
export interface Relances {
  /** Jour de Québec, `AAAA-MM-JJ` : celui d'où se comptent les jours. */
  jour: string;
  echeances: { dateEcheance: string; domaine: string | null }[];
  /** Toutes les échéances de la fenêtre, même au-delà des lignes montrées. */
  total: number;
}

const JOUR_MS = 86_400_000;
const jourUtc = (jour: string) => Date.parse(`${jour}T12:00:00Z`);

/** « aujourd'hui », « demain », « le 3 nov., dans 9 jours », « passée depuis 2 jours (le 23 oct.) ». */
export function quandEcheance(echeance: string, jour: string): string {
  const n = Math.round((jourUtc(echeance) - jourUtc(jour)) / JOUR_MS);
  const date = JOUR_MOIS.format(new Date(jourUtc(echeance)));
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n < 0) return `passée depuis ${-n} jour${n < -1 ? "s" : ""} (le ${date})`;
  return `le ${date}, dans ${n} jours`;
}

function corpsRelances(r: Relances | null | undefined): Corps[] {
  if (r === undefined) return [vide("Aucune relance : elle ne lit pas encore tes échéances.")];
  if (r === null) return [vide("La base ne répond pas : tes échéances ne sont pas lisibles.")];
  if (r.total === 0) return [vide(`Aucune échéance dans tes papiers : rien de passé depuis ${RELANCES_JOURS_PASSES} jours, rien d'ici ${RELANCES_JOURS_A_VENIR} jours.`)];
  const montrees = r.echeances.length < r.total ? ` (les ${r.echeances.length} premières)` : "";
  return [
    { genre: "liste", elements: r.echeances.map((e) => ({ libelle: quandEcheance(e.dateEcheance, r.jour), detail: e.domaine ?? "Sans dossier" })) },
    { genre: "texte", texte: `${r.total} échéance${r.total > 1 ? "s" : ""} lue${r.total > 1 ? "s" : ""} dans tes papiers${montrees}, dans l'ordre des dates.` },
  ];
}

/**
 * Sa journée : ses lectures du jour (journal d'accès, le plus récent d'abord ; `null` sans base),
 * puis son temps et ce qu'elle surveille (`activite` ; `null` sans base, absent : non lus), et les
 * relances (`relances`, mêmes conventions). Ton agenda n'a pas encore de source.
 */
export function tableauJournee(lectures: readonly { ts: Date; lecteur: string; outil: string }[] | null, activite?: ActiviteDuJour | null, relances?: Relances | null): Tableau {
  const panne = vide("La base ne répond pas : le journal du jour n'est pas lisible.");
  const rien = vide("Aucune lecture aujourd'hui.");
  const parHeure = Array.from({ length: 24 }, (_, h) => (lectures ?? []).filter((l) => heureQuebec(l.ts) === h).length);
  const attend = vide("Elle ne tient pas encore le journal de son temps : il viendra quand elle agira seule.");
  const temps = activite === undefined ? attend : activite === null || lectures === null ? panne : corpsTemps(lectures.length, activite);
  const surveille: Corps =
    activite === undefined
      ? vide("Elle ne surveille encore aucune app.")
      : activite === null
        ? panne
        : { genre: "liste", elements: VERIFICATIONS.map((v) => ({ libelle: LIBELLE_VERIFICATION[v], detail: quandQuebec(activite.dernieres[v], activite.jour) })) };
  return {
    question: "Qu'a fait LIA aujourd'hui ?",
    tuiles: [
      {
        cle: "24h",
        largeur: 5,
        icone: "clock",
        titre: "24 h",
        corps:
          lectures === null
            ? [panne]
            : lectures.length
              ? [{ genre: "histogramme", barres: parHeure.map((n, h) => ({ cle: String(h), etiquette: `${h} h`, valeur: n, texte: String(n) })), resume: `${lectures.length >= LECTURES_DU_JOUR_MAX ? "Au moins " : ""}${lectures.length} lectures aujourd'hui, heure par heure (Québec).`, unite: "lectures" }]
              : [rien],
      },
      {
        cle: "journal",
        largeur: 7,
        icone: "chat",
        titre: "Journal",
        corps:
          lectures === null
            ? [panne]
            : lectures.length
              ? [{ genre: "liste", elements: lectures.slice(0, LIGNES_JOURNAL).map(ligneLecture) }]
              : [rien],
      },
      { cle: "temps", largeur: 12, icone: "globe", titre: "Son temps", repliee: true, corps: [temps] },
      { cle: "relances", largeur: 5, icone: "bell", titre: "Relances", repliee: true, corps: corpsRelances(relances) },
      { cle: "aujourdhui", largeur: 6, icone: "cal", titre: "Aujourd'hui", corps: [vide("Ton agenda du jour viendra avec l'agenda.")] },
      { cle: "surveille", largeur: 6, icone: "eye", titre: "Ce qu'elle surveille", repliee: true, corps: [surveille] },
    ],
  };
}

/** Les 22 formes de la maquette (`TYPES_BLOCS`) : leur nom pour Marc, leur icône, ce qu'elles montrent. */
const FORMES: Readonly<Record<string, { titre: string; icone: IconeTuile; dit: string }>> = {
  carte: { titre: "Carte", icone: "map", dit: "Des lieux sur une carte." },
  chrono: { titre: "Chronologie", icone: "clock", dit: "Des moments, dans l'ordre." },
  liste: { titre: "Liste", icone: "list", dit: "Des éléments, un par ligne." },
  chat: { titre: "Fil de chat", icone: "chat", dit: "Un échange de messages." },
  courbe: { titre: "Courbes", icone: "chart", dit: "Une évolution dans le temps." },
  barres: { titre: "Barres", icone: "chart", dit: "Des quantités côte à côte." },
  camembert: { titre: "Parts", icone: "pie", dit: "Les parts d'un tout." },
  jauge: { titre: "Jauge", icone: "gauge", dit: "Une valeur entre son minimum et son maximum." },
  chiffre: { titre: "Chiffre", icone: "num", dit: "Un nombre clé, en grand." },
  tableau: { titre: "Tableau", icone: "table", dit: "Des lignes et des colonnes." },
  calendrier: { titre: "Calendrier", icone: "cal", dit: "Des jours marqués." },
  reseau: { titre: "Réseau", icone: "net", dit: "Des choses reliées entre elles." },
  comparaison: { titre: "Avant et après", icone: "layers", dit: "Deux à quatre colonnes, face à face." },
  radar: { titre: "Radar", icone: "radar", dit: "Plusieurs mesures d'un coup d'œil." },
  entonnoir: { titre: "Entonnoir", icone: "funnel", dit: "Ce qui reste à chaque étape." },
  flux: { titre: "Flux", icone: "flow", dit: "Ce qui passe d'un endroit à l'autre." },
  heatmap: { titre: "Carte de chaleur", icone: "heat", dit: "Une intensité, case par case." },
  kanban: { titre: "Colonnes", icone: "kanban", dit: "Des cartes rangées par étape." },
  arbre: { titre: "Arbre", icone: "tree", dit: "Une hiérarchie, de la racine aux branches." },
  document: { titre: "Document", icone: "doc", dit: "Un papier, avec son émetteur et sa date." },
  cadran: { titre: "Cadran 24 h", icone: "clock", dit: "Une journée sur un cadran." },
  confirmation: { titre: "Confirmation", icone: "cardok", dit: "Une action qu'elle propose et que tu confirmes." },
};

/** Le panneau Formes : chaque forme de son catalogue fermé, et comment elle les combine (`lib/lia/blocs.ts`). */
export function tableauFormes(formes: readonly string[], maxBlocs: number): Tableau {
  return {
    question: "Elle choisit la forme de sa réponse",
    tuiles: [
      {
        cle: "combine",
        largeur: 12,
        icone: "bulb",
        titre: "Elle combine",
        corps: [{ genre: "texte", texte: `Dans une réponse, elle combine jusqu'à ${maxBlocs} formes parmi ${formes.length}. Chacune cite les faits qu'elle montre, sauf la confirmation, qui ne montre rien.` }],
      },
      ...formes.map((f): TuileEspace => {
        const d = FORMES[f];
        return { cle: f, largeur: 4, icone: d?.icone ?? "grid", titre: d?.titre ?? f, corps: [{ genre: "texte", texte: d?.dit ?? f }] };
      }),
    ],
  };
}

export function tableauIdees(): Tableau {
  return {
    question: "Les idées de LIA pour tes apps",
    tuiles: [
      {
        cle: "boite",
        largeur: 12,
        icone: "bulb",
        titre: "Boîte à idées",
        corps: [vide("Elle ne propose pas encore d'idées pour tes apps.")],
      },
      { cle: "etapes", largeur: 6, icone: "grid", titre: "Où elles en sont", corps: [vide("Aucune idée proposée : rien à suivre.")] },
      { cle: "utilite", largeur: 6, icone: "chart", titre: "Utilité estimée", corps: [vide("Elle estimera l'utilité de chaque idée quand elle en proposera.")] },
      { cle: "refusees", largeur: 6, icone: "croix", titre: "Refusées, jamais reproposées", repliee: true, corps: [vide("Aucune idée refusée.")] },
    ],
  };
}

const HEURE = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit" });
/** La tuile Actualité montre les titres les plus récents, pas tous. */
const TITRES_TUILE = 5;
const degres = (v: number) => `${String(v).replace(".", ",")} °C`;

/** `meteo` : `null` quand la page ne l'a pas lue (sans base) ; sinon ce qu'ECCC a rendu, ou pourquoi rien. */
export function tableauMonde(meteo: LectureMeteo | null = null, actualite: Actualite | null = null): Tableau {
  const m = meteo?.ok ? meteo.meteo : null;
  const sources = [...(m ? [SOURCE_METEO] : []), ...(actualite?.titres.length ? [SOURCE_ACTUALITE] : [])];
  const absente = meteo && !meteo.ok && meteo.raison === "non-reglee" ? "Pas de météo : aucune ville réglée." : meteo ? "Météo indisponible : Environnement Canada ne répond pas." : "Pas de météo : aucune source branchée.";
  return {
    question: "Ce que LIA regarde dans le monde",
    tuiles: [
      {
        cle: "meteo",
        largeur: 6,
        icone: "globe",
        titre: "Météo",
        corps: m
          ? [
              {
                genre: "chiffres",
                chiffres: [
                  { icone: "thermo", valeur: m.temperature === null ? "—" : degres(m.temperature), libelle: m.condition ?? "condition non dite" },
                  { icone: "clock", valeur: HEURE.format(new Date(m.observeLe)), libelle: `observée à ${m.ville}` },
                ],
              },
              ...m.alertes.map((a): Corps => ({ genre: "texte", texte: `Alerte : ${a}` })),
            ]
          : [vide(absente)],
      },
      {
        cle: "actualite",
        largeur: 6,
        icone: "eye",
        titre: "Actualité",
        corps: actualite?.titres.length
          ? [{ genre: "liste", elements: actualite.titres.slice(0, TITRES_TUILE).map((t) => ({ libelle: t.titre, ...(t.le && { detail: HEURE.format(new Date(t.le)) }) })) }]
          : [vide(actualite ? "Actualité indisponible : les fils ne répondent pas." : "Pas d'actualité : aucune source branchée.")],
      },
      {
        cle: "sept",
        largeur: 12,
        icone: "cal",
        titre: "Sept jours",
        corps: m?.previsions.length ? [{ genre: "liste", elements: m.previsions.map((p) => ({ libelle: p.periode, detail: p.resume })) }] : [vide("Les sept prochains jours viendront avec la météo.")],
      },
      { cle: "bornes", largeur: 6, icone: "target", titre: "Bornes proches", repliee: true, corps: [vide("Aucune source de bornes de recharge branchée.")] },
      { cle: "sources", largeur: 6, icone: "shield", titre: "Sources", repliee: true, corps: sources.length ? sources.map((s): Corps => ({ genre: "texte", texte: `${s}.` })) : [vide("Aucune source du monde n'est branchée pour l'instant.")] },
    ],
  };
}

/** Minuit à Québec le jour `AAAA-MM-JJ`, en instant (heure d'été comme d'hiver). */
export function minuitQuebec(jour: string): Date {
  const minuitUtc = new Date(`${jour}T00:00:00Z`);
  // Le décalage de Québec à cet instant (« GMT-4 » ou « GMT-5 ») : son minuit tombe plus tard en UTC.
  const nom = new Intl.DateTimeFormat("en-US", { timeZone: FUSEAU, timeZoneName: "shortOffset" }).formatToParts(minuitUtc).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return new Date(minuitUtc.getTime() - Number(nom.replace("GMT", "") || 0) * 3_600_000);
}

/** Minuit du 1er du mois de Québec qui contient `instant` (le début de « ce mois-ci »). */
export const debutDuMoisQuebec = (instant: Date) => minuitQuebec(`${jourQuebec(instant).slice(0, 7)}-01`);

/** Ce que fait chaque outil de LIA, dit pour Marc (le nom technique reste en repli). */
export const LIBELLE_OUTIL: Readonly<Record<string, string>> = {
  memoryai_contexte: "Ce qu'elle sait de toi, en bref",
  memoryai_chercher: "Chercher un fait",
  memoryai_etat: "L'état de sa mémoire",
  memoryai_inventaire: "L'inventaire de ce qu'elle sait",
  memoryai_papiers_facettes: "Les sortes de papiers",
  memoryai_papiers_chercher: "Chercher dans les papiers",
  monde_meteo: "La météo",
  monde_actualite: "L'actualité",
};
const libelleOutil = (o: string) => LIBELLE_OUTIL[o] ?? o;

export interface EntreesOutils {
  /** Les outils de LIA (liste blanche, `OUTILS_LIA_HUB`), tous en lecture. */
  outils: readonly string[];
  /** Les outils du monde branchés (`monde_meteo`), hors du MCP ; absents : aucun. */
  monde?: readonly string[];
  /** Les formes de réponse (`TYPES_BLOCS`). */
  formes: readonly string[];
  /** Les lectures journalisées ce mois-ci, par outil, la plus fréquente d'abord ; `null` sans base. */
  appels: readonly { outil: string; n: number }[] | null;
}

/** Combien de lignes « Les plus utilisés » montre (la maquette en montre cinq). */
const TOP_OUTILS = 5;

export function tableauOutils(e: EntreesOutils): Tableau {
  const appels = e.appels;
  const total = appels?.reduce((t, a) => t + a.n, 0) ?? null;
  const top = (appels ?? []).slice(0, TOP_OUTILS);
  const max = Math.max(...top.map((a) => a.n), 0);
  const nombre = (n: number) => n.toLocaleString("fr-CA");
  return {
    question: "Tout ce qu'elle sait faire",
    tuiles: [
      {
        cle: "chiffres",
        largeur: 12,
        icone: "tool",
        titre: "En chiffres",
        corps: [
          {
            genre: "chiffres",
            chiffres: [
              { icone: "tool", valeur: String(e.outils.length), libelle: "outils" },
              // Les niveaux du vocabulaire (N0 à N3) : un fait dit toujours le sien.
              { icone: "lock", valeur: "4", libelle: "niveaux" },
              { icone: "chart", valeur: total === null ? "—" : nombre(total), libelle: "appels ce mois" },
              // Rien ne mesure encore un refus à tort : un tiret, jamais un zéro qui se croirait mesuré.
              { icone: "shield", valeur: "—", libelle: "refusés à tort" },
            ],
          },
        ],
      },
      {
        cle: "utilises",
        largeur: 6,
        icone: "chart",
        titre: "Les plus utilisés",
        corps:
          appels === null
            ? [vide("La base ne répond pas : le journal des lectures n'est pas lisible.")]
            : top.length
              ? [
                  {
                    genre: "barres",
                    barres: top.map((a) => ({ libelle: libelleOutil(a.outil), valeur: nombre(a.n), part: max > 0 ? a.n / max : 0 })),
                    resume: `Les outils les plus appelés ce mois-ci : ${top.map((a) => `${libelleOutil(a.outil)} ${a.n}`).join(", ")}.`,
                  },
                ]
              : [vide("Aucun appel ce mois-ci.")],
      },
      { cle: "idee", largeur: 6, icone: "spark", titre: "Une idée d'outil ?", corps: [vide("Lui proposer un outil arrivera avec la boîte à idées. D'ici là, elle n'en ajoute aucun seule.")] },
      { cle: "lire", largeur: 12, icone: "search", titre: `Lire · ${e.outils.length}`, corps: e.outils.length ? [{ genre: "pastilles", elements: e.outils.map(libelleOutil) }] : [vide("Aucun outil de lecture.")] },
      { cle: "agir", largeur: 12, icone: "star", titre: "Agir dans les apps · 0", corps: [vide("Elle n'agit dans aucune app : depuis ici, tout est en lecture.")] },
      {
        cle: "monde",
        largeur: 12,
        icone: "globe",
        titre: `Le monde · ${e.monde?.length ?? 0}`,
        corps: e.monde?.length ? [{ genre: "pastilles", elements: e.monde.map(libelleOutil) }] : [vide("Aucune source du monde branchée (météo, actualité).")],
      },
      { cle: "elle", largeur: 12, icone: "bulb", titre: "Elle-même · 0", corps: [vide("Elle ne se corrige pas seule : c'est toi qui valides, corriges et oublies.")] },
      { cle: "afficher", largeur: 12, icone: "grid", titre: `Afficher · ${e.formes.length}`, corps: e.formes.length ? [{ genre: "pastilles", elements: [...e.formes] }] : [vide("Aucune forme de réponse.")] },
    ],
  };
}
