// lib/accueil/tuileSeule.ts — la tuile « Ce qu'elle a fait seule » de « Sa journée » (ADR 0032, tâche
// MemoryAI 283). PURE : elle reçoit ce que `lib/lia/journal.ts` a lu et rend le tableau de la journée avec la
// tuile ajoutée, sans toucher à `tableauJournee`.
//
// ⚠️ NO FAKE DATA. Trois cas se disent : base muette, rien fait aujourd'hui, frein posé. Une ligne ne porte
// que son heure, le nom de l'action, son issue, un compte et la raison écrite une fois dans `ACTIONS`.

import { FUSEAU } from "@/lib/fuseau";
import { LIBELLE_ACTION, LIBELLE_ISSUE, type EtatFrein, type LigneLue } from "@/lib/lia/autonomie";
import { quandQuebec, type Corps, type Tableau } from "./tableaux";

/** Ce que la page a lu : le jour de Québec, le frein et les lignes du jour. */
export interface JournalLia {
  jour: string;
  frein: EtatFrein;
  lignes: readonly LigneLue[];
}

const HEURE_MINUTE = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, hour: "numeric", minute: "2-digit", hourCycle: "h23" });

const vide = (texte: string): Corps => ({ genre: "vide", texte });

/** Le frein en une phrase, avec le lien qui le règle. */
function corpsFrein(f: EtatFrein, jour: string): Corps {
  if (f.enPause) {
    const depuis = f.changeLe ? ` (${quandQuebec(f.changeLe, jour)})` : "";
    return { genre: "texte", texte: `Frein posé${depuis} : elle n'agit plus seule tant que tu ne le lèves pas.`, lien: { href: "/regler", libelle: "Lever le frein" } };
  }
  return {
    genre: "texte",
    texte: "Pas de frein : elle agit seule dans ses limites (rien d'effacé, rien d'envoyé hors de MemoryAI) et note chaque action ici.",
    lien: { href: "/regler", libelle: "Poser le frein" },
  };
}

/** Une ligne : « 9 h 05 · Relire les faits proposés », puis comment ça s'est passé et pourquoi. */
function ligne(l: LigneLue): { libelle: string; detail: string } {
  const combien = l.issue === "faite" && l.n > 0 ? `, ${l.n} élément${l.n > 1 ? "s" : ""}` : "";
  return { libelle: `${HEURE_MINUTE.format(l.instant).replace(":", " h ")} · ${LIBELLE_ACTION[l.action]}`, detail: `${LIBELLE_ISSUE[l.issue]}${combien}. ${l.raison}` };
}

function corps(j: JournalLia | null): Corps[] {
  if (j === null) return [vide("La base ne répond pas : ce qu'elle a fait seule n'est pas lisible.")];
  return [corpsFrein(j.frein, j.jour), j.lignes.length ? { genre: "liste", elements: j.lignes.map(ligne) } : vide("Elle n'a rien fait seule aujourd'hui.")];
}

/**
 * Le tableau de la journée avec la tuile « Ce qu'elle a fait seule » juste après « Journal ».
 * `undefined` : le journal n'est pas lu, le tableau reste tel quel. `null` : la base ne répond pas.
 */
export function avecJournalLia(t: Tableau, j: JournalLia | null | undefined): Tableau {
  if (j === undefined) return t;
  const tuile: Tableau["tuiles"][number] = { cle: "seule", largeur: 12, icone: "spark", titre: "Ce qu'elle a fait seule", corps: corps(j) };
  const apres = t.tuiles.findIndex((u) => u.cle === "journal");
  const tuiles = [...t.tuiles];
  tuiles.splice(apres < 0 ? tuiles.length : apres + 1, 0, tuile);
  return { ...t, tuiles };
}
