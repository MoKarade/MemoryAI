// lib/accueil/espaces.ts — les huit espaces autour de LIA (MemoryAI#74, maquette v5) et ce que
// chacun montre. PUR : la page lit la base, cette fonction compose, le client dessine.
//
// ⚠️ NO FAKE DATA, espace par espace. La maquette montre des chiffres FICTIFS (sommeil, météo,
// messages de « Julie ») ; ici, un espace sans source réelle le DIT (`vide`) au lieu de les
// recopier. Un espace se remplit quand le lot qui produit sa donnée est livré, pas avant.

import type { Poste } from "@/lib/coutChat";
import { LIBELLE_OUTIL, tableauBudget, tableauIdees, tableauMonde, tableauOutils, type EntreesBudget, type Tableau } from "./tableaux";

export const IDS_ESPACES = ["souvenirs", "sante", "journee", "idees", "monde", "budget", "outils", "formes"] as const;
export type IdEspace = (typeof IDS_ESPACES)[number];

export type Icone = "search" | "heart" | "clock" | "bulb" | "globe" | "coin" | "tool" | "grid";

export interface Espace {
  id: IdEspace;
  libelle: string;
  titre: string;
  icone: Icone;
  /** Ce qu'elle fait en allant le voir (une des 39 actions de `lia-ui`), comme la maquette. */
  activite: "souvient" | "verifie" | "surveille" | "apprend" | "cherche" | "calcule" | "planifie" | "image";
  /** Classe de teinte, définie dans `app/globals.css` (jamais une couleur ici). */
  teinte: "repere" | "alerte" | "accent" | "succes" | "info" | "budget";
}

/** L'ordre de la maquette : Souvenirs en haut, puis dans le sens des aiguilles d'une montre. */
export const ESPACES: readonly Espace[] = [
  { id: "souvenirs", libelle: "Souvenirs", titre: "Souvenirs", icone: "search", teinte: "repere", activite: "souvient" },
  { id: "sante", libelle: "Santé", titre: "Santé", icone: "heart", teinte: "alerte", activite: "verifie" },
  { id: "journee", libelle: "Sa journée", titre: "Sa journée", icone: "clock", teinte: "accent", activite: "surveille" },
  { id: "idees", libelle: "Idées", titre: "Idées", icone: "bulb", teinte: "succes", activite: "apprend" },
  { id: "monde", libelle: "Monde", titre: "Monde", icone: "globe", teinte: "info", activite: "cherche" },
  { id: "budget", libelle: "Budget", titre: "Budget", icone: "coin", teinte: "budget", activite: "calcule" },
  { id: "outils", libelle: "Outils", titre: "Outils", icone: "tool", teinte: "repere", activite: "planifie" },
  { id: "formes", libelle: "Formes", titre: "Comment elle répond", icone: "grid", teinte: "accent", activite: "image" },
];

interface Lien {
  href: string;
  libelle: string;
}

export interface ContenuEspace {
  /** Une phrase, toujours vraie. */
  phrase: string;
  /** Ce que LIA dit en allant le voir (`data-lia-dit`), à la première personne, toujours vrai. */
  dit: string;
  /** Vrai quand ce qu'elle en dit mérite qu'elle le dise seule (quelque chose attend Marc, une dépense du jour). */
  remarque?: boolean;
  /** Vrai quand l'espace n'a encore aucune source : le client le montre en état vide. */
  vide: boolean;
  lignes?: { libelle: string; valeur: string }[];
  puces?: string[];
  liens?: Lien[];
  /** Pastille sur l'orbite : un COMPTE réel, jamais décoratif. */
  pastille?: number;
  /** Les tuiles du panneau, comme la maquette (écart B) ; absent : la phrase, les lignes, les liens. */
  tableau?: Tableau;
}

export interface EntreesEspaces {
  /** « N à juger » de la pile (`bandeauAJuger`), ou null sans base / rien à juger. */
  aJuger: { total: number; titre: string } | null;
  /** Dépense du jour et plafond par poste (+ le détail des tuiles Budget) ; null sans base (on ne devine pas un zéro). */
  budget: ({ depense: Record<Poste, number>; plafonds: Record<Poste, number> } & Partial<Pick<EntreesBudget, "jour" | "parJour" | "parModele">>) | null;
  outils: readonly string[];
  formes: readonly string[];
  /** Les appels de ce mois par outil (journal d'accès) ; null sans base, absent : non lus. */
  appels?: readonly { outil: string; n: number }[] | null;
}

const LIBELLE_POSTE: Record<Poste, string> = { chat: "Parler", apprentissage: "Apprendre" };

const dollars = (v: number) => `${v.toFixed(2).replace(".", ",")} $`;

/** Part d'un plafond au-delà de laquelle elle le dit « proche ». */
const PROCHE_DU_PLAFOND = 0.8;

/**
 * Ce qu'elle dit du budget du jour, comme la maquette (« 0,11 $ aujourd'hui, tout va bien. ») mais
 * avec la vraie dépense : le total, puis le poste le plus près de son plafond s'il en est proche.
 * Un plafond nul ou absent ne compte pas : on ne dit pas « dépassé » d'un plafond qui n'existe pas.
 */
function ditBudget(b: NonNullable<EntreesEspaces["budget"]>): string {
  const postes = Object.keys(LIBELLE_POSTE) as Poste[];
  const total = postes.reduce((t, p) => t + (b.depense[p] ?? 0), 0);
  const parts = postes
    .filter((p) => (b.plafonds[p] ?? 0) > 0)
    .map((p) => ({ p, part: (b.depense[p] ?? 0) / b.plafonds[p] }))
    .sort((x, y) => y.part - x.part);
  const pire = parts[0];
  const suite =
    pire && pire.part >= 1
      ? `plafond atteint pour « ${LIBELLE_POSTE[pire.p]} ».`
      : pire && pire.part >= PROCHE_DU_PLAFOND
        ? `« ${LIBELLE_POSTE[pire.p]} » est proche de son plafond.`
        : "tout va bien.";
  return `${dollars(total)} aujourd'hui, ${suite}`;
}

export function contenuEspaces(e: EntreesEspaces): Record<IdEspace, ContenuEspace> {
  return {
    souvenirs: {
      phrase: "Retrouver un message ou un papier mot pour mot arrive avec la lecture des messages. D'ici là, tes conversations et ce qu'elle sait sont ici.",
      dit: "Tes conversations et ce que je sais sont ici.",
      vide: false,
      liens: [
        { href: "/conversations", libelle: "Anciennes conversations" },
        { href: "/pieces", libelle: "Ce qu'elle sait" },
      ],
    },
    sante: {
      phrase: "Pas encore de données de santé. Elles arriveront par Health Connect, sur ton téléphone.",
      dit: "Rien sur ta santé pour l'instant : j'attends Health Connect.",
      vide: true,
    },
    journee: {
      phrase: "Elle ne tient pas encore le journal de sa journée. Il viendra quand elle agira seule.",
      dit: "Je ne tiens pas encore le journal de ma journée.",
      vide: true,
    },
    idees: e.aJuger
      ? {
          phrase: "Ce qu'elle a déduit ou lu attend ton avis : vrai ou faux.",
          dit: `${e.aJuger.titre}. On regarde ensemble ?`,
          remarque: true,
          vide: false,
          liens: [{ href: "/questions", libelle: e.aJuger.titre }],
          pastille: e.aJuger.total,
          tableau: tableauIdees(e.aJuger),
        }
      : { phrase: "Rien à juger pour l'instant.", dit: "Rien à juger pour l'instant.", vide: true, tableau: tableauIdees(null) },
    monde: {
      phrase: "Pas encore de source pour la météo ni l'actualité.",
      dit: "Je n'ai encore ni météo ni actualité.",
      vide: true,
      tableau: tableauMonde(),
    },
    budget: e.budget
      ? {
          phrase: "Ce qu'elle a dépensé aujourd'hui, poste par poste, et le plafond de chacun.",
          dit: ditBudget(e.budget),
          remarque: true,
          vide: false,
          lignes: (Object.keys(LIBELLE_POSTE) as Poste[]).map((p) => ({
            libelle: LIBELLE_POSTE[p],
            valeur: `${dollars(e.budget?.depense[p] ?? 0)} sur ${dollars(e.budget?.plafonds[p] ?? 0)}`,
          })),
          liens: [{ href: "/depenses", libelle: "Toutes les dépenses" }],
          tableau: tableauBudget({ jour: e.budget.jour ?? "", depense: e.budget.depense, plafonds: e.budget.plafonds, parJour: e.budget.parJour ?? [], parModele: e.budget.parModele ?? [] }),
        }
      : {
          phrase: "La base n'est pas joignable : la dépense du jour n'est pas lisible.",
          dit: "Je ne lis pas la dépense du jour : la base ne répond pas.",
          vide: true,
          tableau: tableauBudget(null),
        },
    outils: {
      phrase: `${e.outils.length} outils, tous en lecture seule : depuis ici, elle ne change rien.`,
      dit: `J'ai ${e.outils.length} outils, tous en lecture.`,
      vide: e.outils.length === 0,
      puces: e.outils.map((o) => LIBELLE_OUTIL[o] ?? o),
      tableau: tableauOutils({ outils: e.outils, formes: e.formes, appels: e.appels ?? null }),
    },
    formes: {
      phrase: `Elle choisit la forme de sa réponse parmi ${e.formes.length} : chacune cite ses sources.`,
      dit: `Carte, courbe, liste… je choisis parmi ${e.formes.length} formes.`,
      vide: e.formes.length === 0,
      puces: [...e.formes],
    },
  };
}
