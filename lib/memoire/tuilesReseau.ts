// lib/memoire/tuilesReseau.ts — les tuiles de l'onglet RÉSEAU (tâche MemoryAI 187, maquette v5).
// PUR : on lui donne des comptes et l'état partagé de LIA déjà lus, il rend des `Corps`.
//
// ⚠️ DES COMPTES ET DES DATES, jamais une valeur de fait : le réseau montre la FORME de la
// mémoire. Les libellés affichés sont des prédicats et des noms de règles, qui ne sont pas chiffrés.
//
// ⚠️ CE QUI VIENT DE LIA EST UNE SIMULATION, et l'écran le dit. Ses envies, son humeur et ses
// souvenirs sont un calcul du paquet `@mokarade/lia-ui` (aucun ressenti, aucun texte de Marc) : les
// présenter sans le dire ferait passer une animation pour une mesure.
//
// ⚠️ UNE TUILE SANS MESURE RESTE VIDE, dessinée à sa place (règle de Marc du 23/10/2026).

import { poidsActuel, type Envies, type Souvenir } from "@mokarade/lia-ui";
import type { Corps } from "@/lib/accueil/tableaux";
import { depuis } from "@/lib/memoire/tuilesMemoire";

/** Ce que la base dit du réseau enregistré. `derniere` : la dernière passe qui a écrit un lien. */
export interface EtatReseau {
  noeuds: number;
  domaines: number;
  /** Liens posés par une règle, et liens devinés par un modèle : jamais confondus. */
  etablis: number;
  devines: number;
  parType: readonly { type: string; n: number; poidsMoyen: number }[];
  derniere: Date | null;
}

/** Ce que l'état partagé de LIA porte d'utile ici. Jamais un texte. */
export interface EtatLiaLu {
  humeur: string;
  maj: number;
  envies: Envies;
  souvenirs: readonly Souvenir[];
}

const nb = (n: number) => n.toLocaleString("fr-CA");
const virgule = (n: number) => n.toFixed(2).replace(".", ",");

/** La tuile haute : la taille réelle du réseau, et quand il a été recalculé pour la dernière fois. */
export function corpsReseau(e: EtatReseau, maintenant: Date): Corps {
  if (e.etablis + e.devines === 0) {
    return {
      genre: "vide",
      texte:
        e.noeuds === 0
          ? "Aucun fait validé : le réseau se remplit à mesure que LIA apprend."
          : `${nb(e.noeuds)} fait(s) validé(s), aucun lien enregistré. La passe du réseau les posera.`,
    };
  }
  return {
    genre: "chiffres",
    chiffres: [
      { icone: "net", valeur: nb(e.noeuds), libelle: "neurones (faits validés)" },
      { icone: "path", valeur: nb(e.etablis), libelle: "liens établis par une règle" },
      { icone: "spark", valeur: nb(e.devines), libelle: "liens devinés par un modèle" },
      { icone: "target", valeur: nb(e.domaines), libelle: "domaines" },
      {
        icone: "chart",
        valeur: e.derniere ? depuis(e.derniere, maintenant) : "—",
        libelle: e.derniere ? "depuis la dernière passe" : "aucune passe enregistrée",
      },
    ],
  };
}

/** Quelle règle tient le réseau, et avec quelle force. La force est celle que la règle s'affirme. */
export function corpsParRegle(e: EtatReseau): Corps {
  const lignes = e.parType.filter((t) => t.n > 0).sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
  if (lignes.length === 0) return { genre: "vide", texte: "Aucun lien enregistré : rien ne tient encore le réseau." };
  const max = lignes[0]!.n;
  return {
    genre: "barres",
    barres: lignes.map((t) => ({ libelle: t.type, valeur: `${nb(t.n)} · force ${virgule(t.poidsMoyen)}`, part: t.n / max })),
    resume: `Liens par règle : ${lignes.map((t) => `${t.type} ${t.n}`).join(", ")}.`,
  };
}

/** Les six envies de LIA, dans l'ordre de la maquette : ce qui la pousse à faire quelque chose. */
const LIBELLE_ENVIE: readonly { cle: keyof Envies; libelle: string }[] = [
  { cle: "energie", libelle: "Énergie" },
  { cle: "curiosite", libelle: "Curiosité" },
  { cle: "social", libelle: "Envie de parler" },
  { cle: "joie", libelle: "Joie" },
  { cle: "inquiet", libelle: "Inquiétude" },
  { cle: "ennui", libelle: "Ennui" },
];

/** Ce qui l'anime maintenant : ses six envies, telles que son état partagé les porte. */
export function corpsAnime(etat: EtatLiaLu | null, maintenant: Date): Corps {
  if (!etat) return { genre: "vide", texte: "Son état n'est pas encore enregistré : rien ne dit ce qui l'anime." };
  return {
    genre: "jauges",
    lignes: [
      ...LIBELLE_ENVIE.map((e) => {
        const v = etat.envies[e.cle];
        const borne = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
        // Une envie absente ou non finie affiche « — », jamais 0 : les deux ne disent pas la même chose.
        return { libelle: e.libelle, valeur: borne === null ? "—" : virgule(borne), part: borne };
      }),
      { libelle: "Mise à jour", valeur: `il y a ${depuis(new Date(etat.maj), maintenant)}`, part: null },
    ],
  };
}

/**
 * Ses humeurs : l'humeur dominante, et sa mémoire affective sur plusieurs jours (`souvenirs`), dont
 * le poids décroît avec le temps. Un souvenir ne porte qu'un genre, un instant et un poids.
 */
export function corpsHumeurs(etat: EtatLiaLu | null, maintenant: Date): Corps {
  if (!etat) return { genre: "vide", texte: "Son humeur n'est pas encore enregistrée : rien à montrer." };
  const vivants = etat.souvenirs
    .map((s) => ({ genre: s.genre, poids: poidsActuel(s, maintenant.getTime()), quand: s.quand }))
    .filter((s) => s.poids > 0);
  if (vivants.length === 0) {
    return {
      genre: "liste",
      elements: [
        { libelle: "Son humeur maintenant", detail: etat.humeur },
        { libelle: "Ce qui l'a marquée", detail: "rien ces derniers jours : sa mémoire affective est vide" },
      ],
    };
  }
  const parGenre = new Map<string, { poids: number; n: number; dernier: number }>();
  for (const s of vivants) {
    const a = parGenre.get(s.genre) ?? { poids: 0, n: 0, dernier: 0 };
    parGenre.set(s.genre, { poids: a.poids + s.poids, n: a.n + 1, dernier: Math.max(a.dernier, s.quand) });
  }
  const lignes = [...parGenre].sort((a, b) => b[1].poids - a[1].poids || a[0].localeCompare(b[0]));
  return {
    genre: "liste",
    elements: [
      { libelle: "Son humeur maintenant", detail: etat.humeur },
      ...lignes.map(([genre, v]) => ({
        libelle: genre,
        detail: `${v.n} fois · poids ${virgule(v.poids)} · dernière il y a ${depuis(new Date(v.dernier), maintenant)}`,
      })),
    ],
  };
}
