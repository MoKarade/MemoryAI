// lib/accueil/tableaux.ts — les tuiles des panneaux de la maison (maquette v5, écart B) : une
// question en tête, puis un tableau de tuiles repliables. PUR : la page lit la base, ce module
// compose, `components/TableauEspace.tsx` dessine.
//
// ⚠️ « Exactement comme la maquette » (Marc, 23/10) : chaque tuile de la maquette est là, à sa
// place, avec son titre et son icône. ⚠️ NO FAKE DATA : une tuile sans donnée réelle se dessine
// VIDE (`genre: "vide"`), avec une ligne qui dit ce qui manque ; jamais un chiffre de la maquette.

/** Les noms des tracés de `components/IconeEspace.tsx` employés ici (lib ne dépend pas des composants). */
type IconeTuile = "globe" | "eye" | "cal" | "target" | "shield" | "bulb" | "grid" | "chart" | "croix";

export type Corps = { genre: "vide"; texte: string } | { genre: "texte"; texte: string; lien?: { href: string; libelle: string } };

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
