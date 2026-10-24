// lib/accueil/tableaux.ts — les tuiles des panneaux de la maison (maquette v5, écart B) : une
// question en tête, puis un tableau de tuiles repliables. PUR : la page lit la base, ce module
// compose, `components/TableauEspace.tsx` dessine.
//
// ⚠️ « Exactement comme la maquette » (Marc, 23/10) : chaque tuile de la maquette est là, à sa
// place, avec son titre et son icône. ⚠️ NO FAKE DATA : une tuile sans donnée réelle se dessine
// VIDE (`genre: "vide"`), avec une ligne qui dit ce qui manque ; jamais un chiffre de la maquette.

import { jourQuebec } from "@/lib/coutChat";
import { FUSEAU } from "@/lib/fuseau";

/** Les noms des tracés de `components/IconeEspace.tsx` employés ici (lib ne dépend pas des composants). */
type IconeTuile = "globe" | "eye" | "cal" | "target" | "shield" | "bulb" | "grid" | "chart" | "croix" | "tool" | "lock" | "spark" | "search" | "star";

export type Corps =
  | { genre: "vide"; texte: string }
  | { genre: "texte"; texte: string; lien?: { href: string; libelle: string } }
  | { genre: "chiffres"; chiffres: { icone: IconeTuile; valeur: string; libelle: string }[] }
  /** Un classement en barres horizontales (`part` rapportée au plus grand). */
  | { genre: "barres"; barres: { libelle: string; valeur: string; part: number }[]; resume: string }
  | { genre: "pastilles"; elements: string[] };

interface TuileEspace {
  cle: string;
  largeur: 4 | 6 | 12;
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

/** Minuit du 1er du mois de Québec qui contient `instant` (le début de « ce mois-ci »). */
export function debutDuMoisQuebec(instant: Date): Date {
  const minuitUtc = new Date(`${jourQuebec(instant).slice(0, 7)}-01T00:00:00Z`);
  // Le décalage de Québec à cet instant (« GMT-4 » ou « GMT-5 ») : son minuit tombe plus tard en UTC.
  const nom = new Intl.DateTimeFormat("en-US", { timeZone: FUSEAU, timeZoneName: "shortOffset" }).formatToParts(minuitUtc).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return new Date(minuitUtc.getTime() - Number(nom.replace("GMT", "") || 0) * 3_600_000);
}

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
