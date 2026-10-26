// lib/idees/tableau.ts — les quatre tuiles de l'espace « Idées » (ADR 0027) : la boîte, où elles en
// sont, l'utilité estimée, les écartées. PUR : le texte est un GABARIT du code, le nom de la demande
// n'y entre que comme valeur citée entre guillemets, jamais comme phrase.
//
// ⚠️ NO FAKE DATA. Aucune idée : l'écran le dit (« tu n'as encore rien demandé deux fois au hub »).
// L'utilité s'écrit toujours « ≈ … / 100 » et la tuile dit que c'est une estimation.

import { tableauIdees, type Corps, type Tableau } from "../accueil/tableaux";
import type { EtatIdee, IdeeAffichee, Raisons } from "./regles";

const APP: Readonly<Record<string, string>> = {
  hub: "le hub",
  financeai: "FinanceAI",
  driveai: "DriveAI",
  batchchef: "BatchChef",
  carai: "CarAI",
  jobai: "JobAI",
  memoryai: "MemoryAI",
};
const GENRE: Readonly<Record<string, string>> = {
  tuile: "la tuile",
  bouton: "le bouton",
  page: "la page",
  graphique: "le graphique",
  texte: "le texte",
  autre: "l'élément",
};
const ETAPES: readonly { etat: EtatIdee; libelle: string }[] = [
  { etat: "proposee", libelle: "Proposées" },
  { etat: "retenue", libelle: "Retenues" },
  { etat: "faite", libelle: "Faites" },
  { etat: "ecartee", libelle: "Écartées" },
];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."] as const;
/** Combien de lignes montrent la boîte et la tuile d'utilité (les plus utiles d'abord). */
const LIGNES_BOITE = 8;
const LIGNES_UTILITE = 5;

const vide = (texte: string): Corps => ({ genre: "vide", texte });
const appDe = (i: IdeeAffichee) => APP[i.app] ?? i.app;
const phrase = (i: IdeeAffichee) => `Revoir ${GENRE[i.genre] ?? "l'élément"} « ${i.nom} » dans ${appDe(i)}`;

/** « 2026-10-24 » → « 24 oct. ». Le jour est DÉJÀ celui du Québec : on le lit, on ne le convertit pas. */
function jourMois(jour: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(jour);
  const mois = m ? MOIS[Number(m[1]) - 1] : undefined;
  return m && mois ? `${Number(m[2])} ${mois}` : jour;
}
const raison = (r: Raisons) => `demandé ${r.jours} jours sur ${r.fenetre}, la dernière fois le ${jourMois(r.derniere)}`;

function corpsIdees(idees: readonly IdeeAffichee[]): Record<string, Corps[]> {
  if (idees.length === 0) {
    return {
      boite: [vide("Aucune idée : tu n'as encore rien demandé deux fois au hub.")],
      etapes: [vide("Aucune idée proposée : rien à suivre.")],
      utilite: [vide("Rien à estimer tant qu'elle n'a pas d'idée.")],
      refusees: [vide("Aucune idée écartée.")],
    };
  }
  const actives = idees.filter((i) => i.etat === "proposee" || i.etat === "retenue").sort((a, b) => b.utilite - a.utilite);
  const ecartees = idees.filter((i) => i.etat === "ecartee");
  const comptes = ETAPES.map((e) => ({ libelle: e.libelle, n: idees.filter((i) => i.etat === e.etat).length }));
  const max = Math.max(...comptes.map((c) => c.n));
  const reste = actives.length - LIGNES_BOITE;
  const classees = actives.slice(0, LIGNES_UTILITE);
  return {
    boite: actives.length
      ? [
          {
            genre: "liste",
            elements: [
              ...actives.slice(0, LIGNES_BOITE).map((i) => ({ libelle: phrase(i), detail: `${i.etat === "retenue" ? "Retenue · " : ""}${raison(i.raisons)}` })),
              ...(reste > 0 ? [{ libelle: `Et ${reste} autre${reste > 1 ? "s" : ""}` }] : []),
            ],
          },
          { genre: "texte", texte: "Nées de tes demandes « Que peut-on changer ici ? » du hub, comptées sans modèle." },
        ]
      : [vide("Aucune idée en attente : toutes sont faites ou écartées.")],
    etapes: [
      {
        genre: "barres",
        barres: comptes.map((c) => ({ libelle: c.libelle, valeur: String(c.n), part: max > 0 ? c.n / max : 0 })),
        resume: `Idées par étape : ${comptes.map((c) => `${c.libelle.toLowerCase()} ${c.n}`).join(", ")}.`,
      },
    ],
    utilite: classees.length
      ? [
          {
            genre: "barres",
            barres: classees.map((i) => ({ libelle: `${i.nom} (${appDe(i)})`, valeur: `≈ ${i.utilite} / 100`, part: i.utilite / 100 })),
            resume: `Utilité estimée, sur 100, des idées les mieux classées : ${classees.map((i) => `${i.nom} ${i.utilite}`).join(", ")}.`,
          },
          { genre: "texte", texte: "Estimation, pas une mesure : elle monte avec le nombre de jours où la demande revient et baisse avec le temps depuis la dernière." },
        ]
      : [vide("Rien à estimer : toutes les idées sont faites ou écartées.")],
    refusees: ecartees.length
      ? [{ genre: "liste", elements: ecartees.map((i) => ({ libelle: phrase(i), detail: "Écartée : elle ne la reproposera pas." })) }]
      : [vide("Aucune idée écartée.")],
  };
}

/**
 * Les tuiles de l'espace « Idées ». `undefined` : les idées ne sont pas lues (les tuiles vides
 * d'avant) ; `null` : la base ne répond pas ; une liste vide : rien n'est né des demandes.
 */
export function tableauIdeesLues(idees: readonly IdeeAffichee[] | null | undefined): Tableau {
  const base = tableauIdees();
  if (idees === undefined) return base;
  const panne = [vide("La base ne répond pas : les idées ne sont pas lisibles.")];
  const corps = idees === null ? { boite: panne, etapes: panne, utilite: panne, refusees: panne } : corpsIdees(idees);
  return { ...base, tuiles: base.tuiles.map((t) => ({ ...t, corps: corps[t.cle] ?? t.corps })) };
}
