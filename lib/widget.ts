// lib/widget.ts — ce qu'une app hôte a le droit de voir dans l'iframe (ADR 0002 §5.4).
//
// PURE. Le widget est en LECTURE SEULE et borné au périmètre que Marc a réglé dans `/apps`
// (lot 11). Sans périmètre, il ne montre RIEN : c'est l'inverse du contrat d'écriture, où
// l'absence de ligne laisse le jeton décider.
//
// ⚠️ POURQUOI L'INVERSE. Un jeton d'écriture est posé par Marc, dans Vercel, avec intention.
// Une iframe, elle, est embarquée par du CODE d'app : si l'absence de réglage voulait dire
// « tout », il suffirait d'ajouter une iframe dans JobAI pour lui ouvrir la mémoire entière,
// sans que Marc ait rien décidé. « Un défaut de configuration n'est pas une décision »
// (CLAUDE.md §9 n° 8) — ici, le défaut sûr est le vide.

import type { Perimetre } from "./db/schema";
import type { FaitLisible } from "./lecture";

export const APP_ID_VALIDE = /^[a-z0-9]{2,32}$/;

export interface PolitiqueWidget {
  /** Les domaines du vocabulaire que l'app peut voir. Vide = rien. */
  domaines: readonly string[];
  /** 0, 1 ou 2. Jamais 3 : le N3 n'a aucun contenu (`/apps` refuse déjà de l'accorder). */
  niveauMax: number;
  /** Le domicile sort-il ? Exige `niveauMax >= 2` — la garde est ici ET dans `/apps`. */
  domicile: boolean;
}

/** Aucun périmètre ⇒ aucune vue. Le défaut sûr est le VIDE, pas « tout ». */
export const RIEN: PolitiqueWidget = { domaines: [], niveauMax: 0, domicile: false };

export function politiqueDepuisPerimetre(p: Perimetre | null): PolitiqueWidget {
  if (!p) return RIEN;
  let domaines: string[];
  try {
    const lu: unknown = JSON.parse(p.domaines);
    // ⚠️ Un JSON VALIDE qui n'est pas un tableau est aussi illisible qu'un JSON cassé : dans
    // les deux cas on ne sait pas ce que Marc a accordé. On rend RIEN ENTIER, pas seulement
    // des domaines vides — sinon le niveau et le domicile de la ligne survivraient à une
    // colonne qu'on vient de déclarer incompréhensible.
    if (!Array.isArray(lu)) return RIEN;
    domaines = lu.filter((d): d is string => typeof d === "string");
  } catch {
    return RIEN;
  }
  const niveauMax = Math.max(0, Math.min(2, p.niveauMax));
  return { domaines, niveauMax, domicile: p.domicile && niveauMax >= 2 };
}

/**
 * Le filtre du widget, appliqué APRÈS `rendreServables` (qui a déjà écarté les canaris, les
 * rejetés, les périmés et les supprimés). Il RESTREINT, il n'ouvre rien : un fait qui n'est
 * pas servable ne le devient pas parce qu'une app le demande.
 */
export function filtrerPourWidget(faits: readonly FaitLisible[], p: PolitiqueWidget): FaitLisible[] {
  // ⚠️ REDONDANT, et c'est écrit ici parce que la mutation l'a montré : retirer cette ligne
  // ne change RIEN au résultat — le `Set` vide juste en dessous rejette déjà tout. Elle reste
  // pour éviter de construire un ensemble et de parcourir la liste pour rien, pas parce
  // qu'elle garde quelque chose. La garde, c'est `permis.has(domaine)`.
  if (p.domaines.length === 0) return [];
  const permis = new Set(p.domaines);
  return faits.filter((f) => {
    if (f.niveau > p.niveauMax) return false;
    const domaine = f.predicat.split(".")[0] ?? "";
    if (!permis.has(domaine)) return false;
    // Le domicile est un cas NOMMÉ (ADR 0001, Q3) : il ne sort que sur une case cochée, même
    // quand son domaine et son niveau seraient permis.
    if (!p.domicile && f.predicat.startsWith("logement.adresse")) return false;
    return true;
  });
}

/** Ce que l'écran dit quand il ne montre rien — jamais un vide qui ressemble à une panne. */
export function raisonDuVide(p: PolitiqueWidget, faitsDansLePerimetre: number): string | null {
  if (p.domaines.length === 0) {
    return "Cette app n'a encore accès à aucun domaine. C'est un réglage, pas une panne : ouvre « Apps » dans MemoryAI pour lui en accorder.";
  }
  if (faitsDansLePerimetre === 0) {
    return "Rien à montrer dans le périmètre accordé à cette app. La mémoire n'est pas vide — c'est ce périmètre-ci qui l'est.";
  }
  return null;
}
