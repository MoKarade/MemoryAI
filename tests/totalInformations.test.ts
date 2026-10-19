// tests/totalInformations.test.ts — le compteur « informations sur toi » (L41).
//
// Ce que ces tests DÉFENDENT, et pourquoi chacun existe :
//   1. le total est la somme des postes DÉCLARÉS — pas d'un sous-ensemble oublié ;
//   2. un poste NON MESURÉ fait disparaître le total, il ne vaut pas zéro ;
//   3. la phrase de décomposition nomme AUTANT de postes que la somme en additionne —
//      c'est la garde DÉRIVÉE qui empêche « un compteur ajouté laisse son libellé derrière ».
//
// ⚠️ Le troisième ne s'écrit PAS en épinglant le texte attendu : une assertion sur « 3 faits ·
// 5 papiers » se re-baserait mécaniquement au prochain poste ajouté, c'est-à-dire le jour
// exact où il faut que quelque chose rougisse.

import { describe, it, expect } from "vitest";
import {
  POSTES_INFORMATIONS,
  NOM_POSTE,
  totalInformations,
  phraseInformations,
  type PostesInformations,
} from "../lib/totalInformations";

/** Tous les postes à la même valeur — construit depuis la LISTE, jamais à la main. */
function tousA(v: number | null): PostesInformations {
  const p = {} as PostesInformations;
  for (const cle of POSTES_INFORMATIONS) p[cle] = v;
  return p;
}

describe("totalInformations", () => {
  it("somme TOUS les postes déclarés", () => {
    expect(totalInformations(tousA(7))).toBe(7 * POSTES_INFORMATIONS.length);
  });

  it("additionne des valeurs différentes", () => {
    expect(totalInformations({ faits: 100, papiers: 2748 })).toBe(2848);
  });

  it("un zéro légitime reste un zéro", () => {
    expect(totalInformations(tousA(0))).toBe(0);
  });

  // ⚠️ Le cœur du module. Rendre la somme des postes LISIBLES afficherait un nombre trop
  // petit sous l'étiquette « en tout » — un cumul amputé se présente comme une mesure.
  it("refuse TOUT le total dès qu'UN SEUL poste n'est pas mesuré", () => {
    for (const cle of POSTES_INFORMATIONS) {
      const p = tousA(5);
      p[cle] = null;
      expect(totalInformations(p), `poste ${cle} non mesuré`).toBeNull();
    }
  });

  it("refuse une valeur non finie ou négative", () => {
    expect(totalInformations({ faits: Number.NaN, papiers: 3 })).toBeNull();
    expect(totalInformations({ faits: Number.POSITIVE_INFINITY, papiers: 3 })).toBeNull();
    expect(totalInformations({ faits: -1, papiers: 3 })).toBeNull();
  });
});

describe("phraseInformations", () => {
  // ⚠️ GARDE DÉRIVÉE : le nombre de segments de la phrase se compare à la LONGUEUR de la
  // liste sommée, jamais à un texte attendu. Un poste ajouté à la somme sans être nommé fait
  // rougir ce test ; épingler la phrase l'aurait simplement fait re-baser.
  it("nomme autant de postes que la somme en additionne", () => {
    const segments = phraseInformations(tousA(3)).split(" · ");
    expect(segments).toHaveLength(POSTES_INFORMATIONS.length);
  });

  it("chaque segment porte le nom de SON poste et sa valeur", () => {
    const phrase = phraseInformations({ faits: 100, papiers: 2748 });
    expect(phrase).toContain(`100 ${NOM_POSTE.faits}`);
    expect(phrase).toContain(`2748 ${NOM_POSTE.papiers}`);
  });

  // « je ne sais pas » et « il n'y en a aucun » n'appellent pas le même geste.
  it("écrit un tiret pour un poste non mesuré, jamais un zéro", () => {
    const phrase = phraseInformations({ faits: null, papiers: 12 });
    expect(phrase).toContain(`— ${NOM_POSTE.faits}`);
    expect(phrase).not.toContain(`0 ${NOM_POSTE.faits}`);
  });

  it("aucun poste ne porte un nom vide", () => {
    for (const cle of POSTES_INFORMATIONS) {
      expect(NOM_POSTE[cle].trim().length, `nom du poste ${cle}`).toBeGreaterThan(0);
    }
  });
});
