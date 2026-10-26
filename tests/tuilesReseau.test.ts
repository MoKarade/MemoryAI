// tests/tuilesReseau.test.ts — les tuiles de l'onglet Réseau (tâche MemoryAI 187). Données FICTIVES.
//
// Ce qui est prouvé : les liens établis et devinés ne se confondent jamais, une tuile sans mesure
// reste vide avec une phrase qui dit pourquoi, une envie absente affiche « — » et non 0, un
// souvenir éteint ne compte plus, et aucun corps ne porte un texte de fait.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { corpsAnime, corpsHumeurs, corpsParRegle, corpsReseau, type EtatLiaLu, type EtatReseau } from "@/lib/memoire/tuilesReseau";

const MAINTENANT = new Date("2026-10-26T18:00:00Z");
const JOUR = 86_400_000;

const etat = (x: Partial<EtatReseau> = {}): EtatReseau => ({
  noeuds: 120,
  domaines: 9,
  etablis: 340,
  devines: 42,
  parType: [
    { type: "meme-source", n: 200, poidsMoyen: 0.9 },
    { type: "dates-proches", n: 140, poidsMoyen: 0.4 },
    { type: "sens-proche", n: 42, poidsMoyen: 0.61 },
  ],
  derniere: new Date(MAINTENANT.getTime() - 3 * 3_600_000),
  ...x,
});

const lia = (x: Partial<EtatLiaLu> = {}): EtatLiaLu => ({
  humeur: "calme",
  maj: MAINTENANT.getTime() - 25 * 60_000,
  envies: { energie: 0.8, curiosite: 0.42, social: 0.1, inquiet: 0, joie: 0.55, ennui: 0.2 },
  souvenirs: [],
  ...x,
});

describe("la tuile du réseau", () => {
  it("dit les neurones, les liens établis, les devinés à part, et depuis quand la dernière passe", () => {
    const c = corpsReseau(etat(), MAINTENANT);
    expect(c.genre).toBe("chiffres");
    if (c.genre !== "chiffres") throw new Error("genre inattendu");
    expect(c.chiffres.map((x) => [x.valeur, x.libelle])).toEqual([
      ["120", "neurones (faits validés)"],
      ["340", "liens établis par une règle"],
      ["42", "liens devinés par un modèle"],
      ["9", "domaines"],
      ["3 h", "depuis la dernière passe"],
    ]);
  });

  it("aucune passe enregistrée : le dit, sans inventer de date", () => {
    const c = corpsReseau(etat({ derniere: null }), MAINTENANT);
    if (c.genre !== "chiffres") throw new Error("genre inattendu");
    expect(c.chiffres.at(-1)).toEqual({ icone: "chart", valeur: "—", libelle: "aucune passe enregistrée" });
  });

  it("des faits mais aucun lien : tuile vide qui dit ce qui la remplira", () => {
    expect(corpsReseau(etat({ etablis: 0, devines: 0 }), MAINTENANT)).toEqual({
      genre: "vide",
      texte: "120 fait(s) validé(s), aucun lien enregistré. La passe du réseau les posera.",
    });
    expect(corpsReseau(etat({ noeuds: 0, etablis: 0, devines: 0 }), MAINTENANT).genre).toBe("vide");
  });

  it("par règle : triées par nombre, avec la force que la règle s'affirme", () => {
    const c = corpsParRegle(etat());
    if (c.genre !== "barres") throw new Error("genre inattendu");
    expect(c.barres.map((b) => [b.libelle, b.valeur, b.part])).toEqual([
      ["meme-source", "200 · force 0,90", 1],
      ["dates-proches", "140 · force 0,40", 0.7],
      ["sens-proche", "42 · force 0,61", 0.21],
    ]);
    expect(corpsParRegle(etat({ parType: [] })).genre).toBe("vide");
  });
});

describe("ce qui l'anime, et ses humeurs", () => {
  it("les six envies, bornées, plus la date de mise à jour", () => {
    const c = corpsAnime(lia(), MAINTENANT);
    if (c.genre !== "jauges") throw new Error("genre inattendu");
    expect(c.lignes.map((l) => l.libelle)).toEqual(["Énergie", "Curiosité", "Envie de parler", "Joie", "Inquiétude", "Ennui", "Mise à jour"]);
    expect(c.lignes[0]).toEqual({ libelle: "Énergie", valeur: "0,80", part: 0.8 });
    expect(c.lignes.at(-1)).toEqual({ libelle: "Mise à jour", valeur: "il y a 25 min", part: null });
  });

  it("une envie non finie affiche « — », jamais 0 (no fake data)", () => {
    const c = corpsAnime(lia({ envies: { ...lia().envies, curiosite: Number.NaN } }), MAINTENANT);
    if (c.genre !== "jauges") throw new Error("genre inattendu");
    expect(c.lignes[1]).toEqual({ libelle: "Curiosité", valeur: "—", part: null });
  });

  it("sans état partagé, les deux tuiles restent vides et disent pourquoi", () => {
    expect(corpsAnime(null, MAINTENANT).genre).toBe("vide");
    expect(corpsHumeurs(null, MAINTENANT)).toEqual({ genre: "vide", texte: "Son humeur n'est pas encore enregistrée : rien à montrer." });
  });

  it("l'humeur courante, puis sa mémoire affective groupée par genre", () => {
    const c = corpsHumeurs(
      lia({
        souvenirs: [
          { quand: MAINTENANT.getTime() - JOUR, genre: "gentil", poids: 0.8 },
          { quand: MAINTENANT.getTime() - 2 * JOUR, genre: "gentil", poids: 0.6 },
          { quand: MAINTENANT.getTime() - JOUR, genre: "panne", poids: 0.5 },
        ],
      }),
      MAINTENANT,
    );
    if (c.genre !== "liste") throw new Error("genre inattendu");
    expect(c.elements[0]).toEqual({ libelle: "Son humeur maintenant", detail: "calme" });
    expect(c.elements[1]!.libelle).toBe("gentil");
    expect(c.elements[1]!.detail).toContain("2 fois");
    expect(c.elements.map((e) => e.libelle)).toEqual(["Son humeur maintenant", "gentil", "panne"]);
  });

  it("un souvenir trop vieux ne compte plus : le dire plutôt que de le garder affiché", () => {
    const c = corpsHumeurs(lia({ souvenirs: [{ quand: MAINTENANT.getTime() - 40 * JOUR, genre: "brusque", poids: 1 }] }), MAINTENANT);
    if (c.genre !== "liste") throw new Error("genre inattendu");
    expect(c.elements[1]).toEqual({ libelle: "Ce qui l'a marquée", detail: "rien ces derniers jours : sa mémoire affective est vide" });
  });
});

describe("la page de l'onglet", () => {
  const source = readFileSync(resolve(process.cwd(), "app/memoire/reseau/page.tsx"), "utf8");

  it("ne lit aucune valeur de fait : ni déchiffrement, ni lecture de faits", () => {
    expect(source).not.toMatch(/dechiffrer|rendreLisible|depotLecture/);
  });

  it("garde les quatre tuiles de la maquette, « Les six couches » toujours dessinée", () => {
    for (const titre of ["Son réseau de neurones", "Ce qui l’anime maintenant", "Ses humeurs", "Les six couches"]) {
      expect(source, `la tuile « ${titre} » doit rester`).toContain(titre);
    }
  });
});
