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
  | { genre: "liste"; elements: { libelle: string; detail?: string }[] };

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

/**
 * Sa journée : ses lectures du jour (journal d'accès, le plus récent d'abord ; `null` sans base).
 * Le reste (son temps, ses relances, ton agenda, ce qu'elle surveille) n'a pas encore de source.
 */
export function tableauJournee(lectures: readonly { ts: Date; lecteur: string; outil: string }[] | null): Tableau {
  const panne = vide("La base ne répond pas : le journal du jour n'est pas lisible.");
  const rien = vide("Aucune lecture aujourd'hui.");
  const parHeure = Array.from({ length: 24 }, (_, h) => (lectures ?? []).filter((l) => heureQuebec(l.ts) === h).length);
  const attend = vide("Elle ne tient pas encore le journal de son temps : il viendra quand elle agira seule.");
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
              ? [{ genre: "liste", elements: lectures.slice(0, LIGNES_JOURNAL).map((l) => ({ libelle: `${HEURE_MINUTE.format(l.ts).replace(":", " h ")} · ${libelleOutil(l.outil)}`, detail: libelleLecteur(l.lecteur) })) }]
              : [rien],
      },
      { cle: "temps", largeur: 12, icone: "globe", titre: "Son temps", repliee: true, corps: [attend] },
      { cle: "relances", largeur: 5, icone: "bell", titre: "Relances", repliee: true, corps: [vide("Aucune relance pour l'instant.")] },
      { cle: "aujourdhui", largeur: 6, icone: "cal", titre: "Aujourd'hui", corps: [vide("Ton agenda du jour viendra avec l'agenda.")] },
      { cle: "surveille", largeur: 6, icone: "eye", titre: "Ce qu'elle surveille", repliee: true, corps: [vide("Elle ne surveille encore aucune app.")] },
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

export function tableauIdees(aJuger: { total: number; titre: string } | null): Tableau {
  return {
    question: "Les idées de LIA pour tes apps",
    tuiles: [
      {
        cle: "boite",
        largeur: 12,
        icone: "bulb",
        titre: "Boîte à idées",
        corps: [
          ...(aJuger ? [{ genre: "texte", texte: `${aJuger.titre} : ce qu'elle a déduit ou lu attend ton avis.`, lien: { href: "/questions", libelle: "Juger maintenant" } } as const] : []),
          vide("Elle ne propose pas encore d'idées pour tes apps."),
        ],
      },
      { cle: "etapes", largeur: 6, icone: "grid", titre: "Où elles en sont", corps: [vide("Aucune idée proposée : rien à suivre.")] },
      { cle: "utilite", largeur: 6, icone: "chart", titre: "Utilité estimée", corps: [vide("Elle estimera l'utilité de chaque idée quand elle en proposera.")] },
      { cle: "refusees", largeur: 6, icone: "croix", titre: "Refusées, jamais reproposées", repliee: true, corps: [vide("Aucune idée refusée.")] },
    ],
  };
}

export function tableauMonde(): Tableau {
  return {
    question: "Ce que LIA regarde dans le monde",
    tuiles: [
      { cle: "meteo", largeur: 6, icone: "globe", titre: "Météo", corps: [vide("Pas de météo : aucune source branchée.")] },
      { cle: "actualite", largeur: 6, icone: "eye", titre: "Actualité", corps: [vide("Pas d'actualité : aucune source branchée.")] },
      { cle: "sept", largeur: 12, icone: "cal", titre: "Sept jours", corps: [vide("Les sept prochains jours viendront avec la météo.")] },
      { cle: "bornes", largeur: 6, icone: "target", titre: "Bornes proches", repliee: true, corps: [vide("Aucune source de bornes de recharge branchée.")] },
      { cle: "sources", largeur: 6, icone: "shield", titre: "Sources", repliee: true, corps: [vide("Aucune source du monde n'est branchée pour l'instant.")] },
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
};
const libelleOutil = (o: string) => LIBELLE_OUTIL[o] ?? o;

export interface EntreesOutils {
  /** Les outils de LIA (liste blanche, `OUTILS_LIA_HUB`), tous en lecture. */
  outils: readonly string[];
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
      { cle: "monde", largeur: 12, icone: "globe", titre: "Le monde · 0", corps: [vide("Aucune source du monde branchée (météo, actualité).")] },
      { cle: "elle", largeur: 12, icone: "bulb", titre: "Elle-même · 0", corps: [vide("Elle ne se corrige pas seule : c'est toi qui valides, corriges et oublies.")] },
      { cle: "afficher", largeur: 12, icone: "grid", titre: `Afficher · ${e.formes.length}`, corps: e.formes.length ? [{ genre: "pastilles", elements: [...e.formes] }] : [vide("Aucune forme de réponse.")] },
    ],
  };
}
