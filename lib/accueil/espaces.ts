// lib/accueil/espaces.ts — les huit espaces autour de LIA (MemoryAI#74, maquette v5) et ce que
// chacun montre. PUR : la page lit la base, cette fonction compose, le client dessine.
//
// ⚠️ NO FAKE DATA, espace par espace. La maquette montre des chiffres FICTIFS (sommeil, météo,
// messages de « Julie ») ; ici, un espace sans source réelle le DIT (`vide`) au lieu de les
// recopier. Un espace se remplit quand le lot qui produit sa donnée est livré, pas avant.

import type { Poste } from "@/lib/coutChat";

export const IDS_ESPACES = ["souvenirs", "sante", "journee", "idees", "monde", "budget", "outils", "formes"] as const;
export type IdEspace = (typeof IDS_ESPACES)[number];

export type Icone = "search" | "heart" | "clock" | "bulb" | "globe" | "coin" | "tool" | "grid";

export interface Espace {
  id: IdEspace;
  libelle: string;
  titre: string;
  icone: Icone;
  /** Classe de teinte, définie dans `app/globals.css` (jamais une couleur ici). */
  teinte: "repere" | "alerte" | "accent" | "succes" | "info" | "budget";
}

/** L'ordre de la maquette : Souvenirs en haut, puis dans le sens des aiguilles d'une montre. */
export const ESPACES: readonly Espace[] = [
  { id: "souvenirs", libelle: "Souvenirs", titre: "Souvenirs", icone: "search", teinte: "repere" },
  { id: "sante", libelle: "Santé", titre: "Santé", icone: "heart", teinte: "alerte" },
  { id: "journee", libelle: "Sa journée", titre: "Sa journée", icone: "clock", teinte: "accent" },
  { id: "idees", libelle: "Idées", titre: "Idées", icone: "bulb", teinte: "succes" },
  { id: "monde", libelle: "Monde", titre: "Monde", icone: "globe", teinte: "info" },
  { id: "budget", libelle: "Budget", titre: "Budget", icone: "coin", teinte: "budget" },
  { id: "outils", libelle: "Outils", titre: "Outils", icone: "tool", teinte: "repere" },
  { id: "formes", libelle: "Formes", titre: "Comment elle répond", icone: "grid", teinte: "accent" },
];

interface Lien {
  href: string;
  libelle: string;
}

export interface ContenuEspace {
  /** Une phrase, toujours vraie. */
  phrase: string;
  /** Vrai quand l'espace n'a encore aucune source : le client le montre en état vide. */
  vide: boolean;
  lignes?: { libelle: string; valeur: string }[];
  puces?: string[];
  liens?: Lien[];
  /** Pastille sur l'orbite : un COMPTE réel, jamais décoratif. */
  pastille?: number;
}

export interface EntreesEspaces {
  /** « N à juger » de la pile (`bandeauAJuger`), ou null sans base / rien à juger. */
  aJuger: { total: number; titre: string } | null;
  /** Dépense du jour et plafond par poste ; null sans base (on ne devine pas un zéro). */
  budget: { depense: Record<Poste, number>; plafonds: Record<Poste, number> } | null;
  outils: readonly string[];
  formes: readonly string[];
}

const LIBELLE_OUTIL: Record<string, string> = {
  memoryai_contexte: "Ce qu'elle sait de toi, en bref",
  memoryai_chercher: "Chercher un fait",
  memoryai_etat: "L'état de sa mémoire",
  memoryai_inventaire: "L'inventaire de ce qu'elle sait",
  memoryai_papiers_facettes: "Les sortes de papiers",
  memoryai_papiers_chercher: "Chercher dans les papiers",
};

const LIBELLE_POSTE: Record<Poste, string> = { chat: "Parler", apprentissage: "Apprendre" };

const dollars = (v: number) => `${v.toFixed(2).replace(".", ",")} $`;

export function contenuEspaces(e: EntreesEspaces): Record<IdEspace, ContenuEspace> {
  return {
    souvenirs: {
      phrase: "Retrouver un message ou un papier mot pour mot arrive avec la lecture des messages. D'ici là, tes conversations et ce qu'elle sait sont ici.",
      vide: false,
      liens: [
        { href: "/conversations", libelle: "Anciennes conversations" },
        { href: "/pieces", libelle: "Ce qu'elle sait" },
      ],
    },
    sante: {
      phrase: "Pas encore de données de santé. Elles arriveront par Health Connect, sur ton téléphone.",
      vide: true,
    },
    journee: {
      phrase: "Elle ne tient pas encore le journal de sa journée. Il viendra quand elle agira seule.",
      vide: true,
    },
    idees: e.aJuger
      ? {
          phrase: "Ce qu'elle a déduit ou lu attend ton avis : vrai ou faux.",
          vide: false,
          liens: [{ href: "/questions", libelle: e.aJuger.titre }],
          pastille: e.aJuger.total,
        }
      : { phrase: "Rien à juger pour l'instant.", vide: true },
    monde: {
      phrase: "Pas encore de source pour la météo ni l'actualité.",
      vide: true,
    },
    budget: e.budget
      ? {
          phrase: "Ce qu'elle a dépensé aujourd'hui, poste par poste, et le plafond de chacun.",
          vide: false,
          lignes: (Object.keys(LIBELLE_POSTE) as Poste[]).map((p) => ({
            libelle: LIBELLE_POSTE[p],
            valeur: `${dollars(e.budget?.depense[p] ?? 0)} sur ${dollars(e.budget?.plafonds[p] ?? 0)}`,
          })),
          liens: [{ href: "/depenses", libelle: "Toutes les dépenses" }],
        }
      : { phrase: "La base n'est pas joignable : la dépense du jour n'est pas lisible.", vide: true },
    outils: {
      phrase: `${e.outils.length} outils, tous en lecture seule : depuis ici, elle ne change rien.`,
      vide: e.outils.length === 0,
      puces: e.outils.map((o) => LIBELLE_OUTIL[o] ?? o),
    },
    formes: {
      phrase: `Elle choisit la forme de sa réponse parmi ${e.formes.length} : chacune cite ses sources.`,
      vide: e.formes.length === 0,
      puces: [...e.formes],
    },
  };
}
