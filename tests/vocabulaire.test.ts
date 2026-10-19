// tests/vocabulaire.test.ts — le vocabulaire v1 : fermé, cohérent, et sans ce qui n'entre jamais.

import { describe, it, expect } from "vitest";
import {
  definition,
  domaines,
  estRefuseStructurellement,
  REFUS_STRUCTURELS,
  VERSION_COURANTE,
  vocabulaire,
} from "../lib/vocabulaire";

const V1 = vocabulaire(1);
const NOM = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;

describe("vocabulaire v1", () => {
  it("est la version courante, large (Q9 : « encore plus »)", () => {
    expect(VERSION_COURANTE).toBe(1);
    expect(V1.length).toBeGreaterThanOrEqual(90);
    expect(vocabulaire(2)).toEqual([]);
  });

  it("chaque prédicat est unique, bien formé, et rangé sous son domaine", () => {
    const noms = V1.map((p) => p.predicat);
    expect(new Set(noms).size).toBe(noms.length);
    for (const p of V1) {
      expect(p.predicat, p.predicat).toMatch(NOM);
      expect(p.predicat.startsWith(p.domaine + "."), p.predicat).toBe(true);
      expect(p.types.length, p.predicat).toBeGreaterThan(0);
      expect(p.description.length, p.predicat).toBeGreaterThan(3);
    }
    expect(domaines(1)).toContain("emploi");
    expect(domaines(1)).toContain("fiscal");
  });

  // LA règle de l'ADR §5.3 : identité, immigration, fiscal sont N3, et N3 n'a jamais de texte.
  it("identité, immigration et fiscal sont N3 ; aucun prédicat N3 n'accepte un texte", () => {
    for (const p of V1) {
      if (["identite", "immigration", "fiscal"].includes(p.domaine)) expect(p.niveauMin, p.predicat).toBe(3);
      if (p.niveauMin === 3) expect(p.types, p.predicat).not.toContain("texte");
    }
    expect(V1.filter((p) => p.niveauMin === 3).length).toBeGreaterThanOrEqual(6);
  });

  it("santé, relations, famille et finance sont au moins N2 ; le domicile est N2", () => {
    for (const p of V1) {
      if (["sante", "relation", "famille", "finance"].includes(p.domaine)) {
        expect(p.niveauMin, p.predicat).toBeGreaterThanOrEqual(2);
      }
    }
    expect(definition("logement.adresse")?.niveauMin).toBe(2);
  });

  it("un prédicat déprécié désigne un remplaçant qui existe", () => {
    for (const p of V1) {
      if (p.deprecie) expect(definition(p.deprecie), p.predicat).not.toBeNull();
    }
  });

  it("aucun prédicat n'est refusé structurellement — quelle que soit la version", () => {
    for (const p of V1) expect(estRefuseStructurellement(p.predicat), p.predicat).toBe(false);
  });

  it("les refus structurels attrapent bien ce qu'ils visent (anti-vacuité)", () => {
    expect(REFUS_STRUCTURELS.length).toBeGreaterThanOrEqual(4);
    for (const nom of [
      "position.domicile",
      "position.travail",
      // ⚠️ AJOUTÉS le 16/09 avec la quarantaine : une position en SECOND segment n'était
      // refusée que par le vocabulaire fermé. Ouvrir le vocabulaire sans élargir ici l'aurait
      // laissée entrer — « en quarantaine » veut dire « pas servi », jamais « pas stocké ».
      "logement.position",
      "vehicule.position.derniere",
      "trajet.positions",
      "logement.lat",
      "logement.gps",
      "logement.coordonnees",
      "relation.adresse_tiers",
      "contact.tiers.adresse",
      "identite.nas",
      "identite.passeport.numero",
      "vehicule.permis.numero",
      "finance.carte.numero",
    ]) {
      expect(estRefuseStructurellement(nom), nom).toBe(true);
    }
    // Un nom voisin, légitime, passe : la liste vise des formes, pas des mots.
    expect(estRefuseStructurellement("logement.ville")).toBe(false);
    expect(estRefuseStructurellement("identite.document")).toBe(false);
  });

  it("definition() rend null hors vocabulaire et hors version", () => {
    expect(definition("emploi.employeur")?.niveauMin).toBe(1);
    expect(definition("emploi.salaire")).toBeNull();
    expect(definition("emploi.employeur", 7)).toBeNull();
  });
});
