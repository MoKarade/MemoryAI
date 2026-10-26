// lib/accueil/tuileBornes.ts — la tuile « Bornes proches » de l'espace Monde (ADR 0028, tâche
// MemoryAI 234). PURE : elle reçoit ce que `lib/monde/bornes.ts` a lu et rend le tableau du monde
// avec la tuile remplie, sans toucher à `tableauMonde`.
//
// ⚠️ NO FAKE DATA. Chaque cas se dit : base muette, ville sans position, fichier injoignable, aucun
// parc dans le rayon. L'attribution exigée par la licence entre dans la tuile « Sources ».

import { FUSEAU } from "@/lib/fuseau";
import { RAYON_KM, SOURCE_BORNES, type LectureBornes, type Parc } from "@/lib/monde/bornes";
import type { Corps, Tableau } from "./tableaux";

const km = (d: number) => `${d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d)} km`;
const kw = (v: number) => `${String(v).replace(".", ",")} kW`;
/** « 24 oct. » : l'abréviation du mois porte déjà son point. */
const JOUR_DU_FICHIER = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, day: "numeric", month: "short" });

const vide = (texte: string): Corps => ({ genre: "vide", texte });

/** Un parc en une ligne : « Parc fictif · à 1,2 km », et « Niveau 2, 7,2 kW · 2 bornes ». */
function ligneParc(p: Parc): { libelle: string; detail: string } {
  const quoi = [p.niveaux.join(", "), p.puissanceMaxKw === null ? null : kw(p.puissanceMaxKw)].filter(Boolean).join(", ");
  const combien = `${p.bornes} borne${p.bornes > 1 ? "s" : ""}`;
  return { libelle: `${p.parc} · à ${km(p.distanceKm)}`, detail: quoi ? `${quoi} · ${combien}` : combien };
}

/** `null` : sans base ; sinon ce que le fichier a rendu, ou pourquoi rien. */
function corpsBornes(b: LectureBornes | null): Corps[] {
  if (b === null) return [vide("La base ne répond pas : les bornes ne sont pas lisibles.")];
  if (!b.ok) return [vide(b.raison === "sans-position" ? "Pas de bornes : la ville de la météo n'a pas de position." : "Bornes indisponibles : le Circuit électrique ne répond pas.")];
  if (b.bornes.parcs.length === 0) return [vide(`Aucune borne du Circuit électrique à moins de ${RAYON_KM} km de ta ville.`)];
  const reseau = `Réseau du Circuit électrique seulement.${b.bornes.fichierLe ? ` Fichier du ${JOUR_DU_FICHIER.format(new Date(b.bornes.fichierLe))}` : ""}`;
  return [{ genre: "liste", elements: b.bornes.parcs.map(ligneParc) }, { genre: "texte", texte: `Les plus proches de ta ville, à vol d'oiseau. ${reseau}` }];
}

/**
 * Le tableau du monde avec la tuile « Bornes proches » remplie et l'attribution dans « Sources ».
 * `undefined` : les bornes ne sont pas lues, le tableau reste tel quel (la tuile le dit déjà).
 */
export function avecBornes(t: Tableau, b: LectureBornes | null | undefined): Tableau {
  if (b === undefined) return t;
  const attribution: Corps = { genre: "texte", texte: `${SOURCE_BORNES}.` };
  return {
    ...t,
    tuiles: t.tuiles.map((u) => {
      if (u.cle === "bornes") return { ...u, corps: corpsBornes(b) };
      if (u.cle === "sources" && b?.ok) return { ...u, corps: [...u.corps.filter((c) => c.genre !== "vide"), attribution] };
      return u;
    }),
  };
}
