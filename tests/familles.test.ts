// tests/familles.test.ts — plusieurs graphies du même émetteur se DISENT, elles ne se
// fusionnent pas.
//
// ⚠️ La fixture reprend la FORME du relevé fait le 17/09 par `memoryai_papiers_facettes` sur
// 2 723 papiers (mêmes effectifs, mêmes graphies multiples), mais les noms d'émetteurs et de
// personnes sont FICTIFS (décision du 15/10 : aucune donnée personnelle dans le dépôt). Pas un
// jeu d'essai imaginé : c'est ce relevé qui a montré que
// « Qu'est-ce que j'ai comme papiers de Banque Aurore ? » rend 56 au lieu de 75, et une fixture
// écrite à la main aurait encodé la forme que je croyais trouver.
//
// ⚠️ Et c'est la question n° 8 du socle qui avait nommé ce défaut AVANT que le code existe :
// son `ceQueLEchecDesigne` dit « émetteur et année ne se croisent pas, ou l'émetteur est écrit
// de trois façons ». Une mesure figée avant l'implémentation vaut mieux qu'un test écrit après.

import { describe, it, expect } from "vitest";
import { famillesDeFacettes, noteFamilles, racine, RACINE_MIN } from "../lib/pieces/familles";

/** Les 25 premiers émetteurs, tels que les facettes les ont rendus le 17/09 (noms fictifs). */
const RELEVE_REEL = [
  { valeur: "Inconnu", nombre: 1568 },
  { valeur: "Facebook", nombre: 151 },
  { valeur: "Banque Aurore", nombre: 56 },
  { valeur: "Zenith inc.", nombre: 49 },
  { valeur: "Jean Exemple", nombre: 33 },
  { valeur: "École Delta", nombre: 22 },
  { valeur: "Alphatech", nombre: 15 },
  { valeur: "Banque Aurore Assurances", nombre: 12 },
  { valeur: "ALPHATECH INDUSTRIES INC.", nombre: 11 },
  { valeur: "Anthropic, PBC", nombre: 10 },
  { valeur: "Claire Modèle", nombre: 10 },
  { valeur: "Facebook - Meta", nombre: 9 },
  { valeur: "Alphatech Industries", nombre: 9 },
  { valeur: "Garage du Parc", nombre: 8 },
  { valeur: "Collège de Valmont", nombre: 8 },
  { valeur: "Anthropic, PBC_2", nombre: 8 },
  { valeur: "Assurances du Nord", nombre: 8 },
  { valeur: "Caisse du Lac", nombre: 7 },
  { valeur: "Banque Aurore Assurances Générales", nombre: 7 },
  { valeur: "Rail Exemple", nombre: 7 },
  { valeur: "Revenu Québec", nombre: 7 },
  { valeur: "Meta-Facebook", nombre: 7 },
  { valeur: "Facebook Marketplace", nombre: 6 },
  { valeur: "Zenith", nombre: 6 },
  { valeur: "Préfecture Exemple", nombre: 6 },
];

describe("regrouper les graphies d'un même émetteur", () => {
  it("MUTATION — retirer le regroupement fait rougir ce cas", () => {
    const familles = famillesDeFacettes(RELEVE_REEL);
    const parTete = new Map(familles.map((f) => [f.tete, f]));

    // LE cas qui a déclenché ce module : 56 + 12 + 7 = 75, et non 56.
    const banque = parTete.get("Banque Aurore");
    expect(banque).toBeDefined();
    expect(banque!.total).toBe(75);
    expect(banque!.valeurs.map((v) => v.valeur)).toEqual([
      "Banque Aurore",
      "Banque Aurore Assurances",
      "Banque Aurore Assurances Générales",
    ]);

    // Les trois autres familles du corpus mesuré.
    // ⚠️ 166 et non 173 : « Meta-Facebook » (7) n'est PAS rattaché, parce que son premier mot
    // est « Meta ». Mon attendu disait 173 — c'était l'attendu qui était faux, pas le code, et
    // la limite est écrite dans le module plutôt que contournée. Élargir la règle à
    // « n'importe quel mot en commun » regrouperait aussi tout ce qui contient « Assurances »
    // ou « Québec » : on préfère manquer une graphie que fabriquer une fausse famille, parce
    // qu'un faux regroupement fait perdre confiance dans toute la note.
    expect(parTete.get("Facebook")?.total).toBe(151 + 9 + 6);
    expect(parTete.get("Alphatech")?.total).toBe(15 + 11 + 9);
    // « Zenith inc. » et « Zenith » se regroupent parce qu'on ne garde que le PREMIER mot —
    // pas grâce à un filtre de suffixes juridiques, qui ne pouvait rien changer (« inc » est
    // toujours le second mot). Une mutation l'a montré : le retirer laissait tout vert, donc
    // il a été retiré du code.
    expect(parTete.get("Zenith inc.")?.total).toBe(49 + 6);
  });

  it("la TÊTE est la graphie la plus employée, pas la première rencontrée", () => {
    // Marc reconnaîtra « Banque Aurore » (56) plus vite que « Banque Aurore Assurances » (12), et
    // c'est aussi la graphie que le modèle a le plus de chances d'avoir déjà vue.
    const f = famillesDeFacettes([
      { valeur: "Banque Aurore Assurances", nombre: 12 },
      { valeur: "Banque Aurore", nombre: 56 },
    ]);
    expect(f[0]!.tete).toBe("Banque Aurore");
  });

  it("MUTATION — abaisser RACINE_MIN fait rougir ce cas", () => {
    // ⚠️ Sans seuil, deux mots courts sans rapport se ressemblent tout le temps. Le relevé
    // réel porte « Jean Exemple » et « Meta-Facebook » : à 2 caractères, « je » et « me »
    // seraient déjà des familles.
    expect(RACINE_MIN).toBeGreaterThanOrEqual(4);
    const familles = famillesDeFacettes(RELEVE_REEL);
    // Aucun faux regroupement sur les 25 émetteurs du relevé : chaque famille partage un nom
    // d'entité, jamais deux premières lettres.
    for (const f of familles) {
      const racines = new Set(f.valeurs.map((v) => racine(v.valeur)));
      expect(racines.size).toBe(1);
      expect([...racines][0]!.length).toBeGreaterThanOrEqual(RACINE_MIN);
    }
    // Et les entités DISTINCTES du corpus ne sont jamais regroupées ensemble.
    const tetes = familles.map((f) => f.tete);
    expect(tetes).not.toContain("Jean Exemple");
    expect(tetes).not.toContain("Revenu Québec");
    expect(tetes).not.toContain("Rail Exemple");
  });

  it("la LIMITE connue : un nom réordonné n'est pas rattrapé, et c'est assumé", () => {
    // « Meta-Facebook » appartient bien à la famille Facebook pour un humain. La règle du
    // premier mot ne le voit pas, et l'élargir coûterait plus qu'elle ne rapporte. Ce cas
    // existe pour que la limite soit MESURÉE plutôt que découverte plus tard : la valeur
    // reste listée dans les facettes, donc le modèle la voit — elle n'est simplement pas
    // signalée comme parente.
    const familles = famillesDeFacettes(RELEVE_REEL);
    const facebook = familles.find((f) => f.tete === "Facebook");
    expect(facebook!.valeurs.map((v) => v.valeur)).not.toContain("Meta-Facebook");
    expect(racine("Meta-Facebook")).toBe("meta");
  });

  it("une valeur SEULE n'est pas une famille — le contrôle négatif", () => {
    // Sinon la note parlerait de chaque émetteur du corpus, et une note qui parle tout le
    // temps ne se lit plus.
    expect(famillesDeFacettes([{ valeur: "Revenu Québec", nombre: 7 }])).toEqual([]);
    expect(famillesDeFacettes([])).toEqual([]);
    expect(noteFamilles([{ valeur: "Revenu Québec", nombre: 7 }])).toBeNull();
  });

  it("la note NOMME les graphies exactes à repasser en filtre", () => {
    const note = noteFamilles(RELEVE_REEL);
    expect(note).not.toBeNull();
    // ⚠️ C'est la seule chose actionnable : un modèle à qui l'on dit « il y a plusieurs
    // graphies » sans les lui donner devinera, et c'est précisément ce qu'on corrige.
    expect(note).toContain("Banque Aurore Assurances Générales");
    expect(note).toContain("emetteurs");
    // Et elle dit qu'on ne fusionne PAS, sinon le modèle croirait la base nettoyée.
    expect(note).toContain("pas fusionnées");
  });

  it("les accents et la casse sont rabattus pour COMPARER, jamais pour stocker", () => {
    expect(racine("ALPHATECH INDUSTRIES INC.")).toBe(racine("Alphatech"));
    expect(racine("Collège de Valmont")).toBe("college");
    // La valeur d'origine ressort INTACTE : le regroupement est un affichage, pas une
    // normalisation — c'est ce qui le distingue d'une garde d'écriture.
    const f = famillesDeFacettes([
      { valeur: "ALPHATECH INDUSTRIES INC.", nombre: 11 },
      { valeur: "Alphatech", nombre: 15 },
    ]);
    expect(f[0]!.valeurs.map((v) => v.valeur)).toContain("ALPHATECH INDUSTRIES INC.");
  });
});
