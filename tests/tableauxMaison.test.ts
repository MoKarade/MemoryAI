// tests/tableauxMaison.test.ts — les tuiles des panneaux de la maison (maquette v5, écart B) :
// chaque tuile de la maquette est là, et une tuile sans donnée réelle se dessine VIDE.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanneauEspace } from "@/components/PanneauEspace";
import { contenuEspaces, ESPACES, type IdEspace } from "@/lib/accueil/espaces";
import { debutDuMoisQuebec, tableauIdees, tableauMonde, tableauOutils } from "@/lib/accueil/tableaux";

vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});

const entrees = { aJuger: null, budget: null, outils: [], formes: [] };

function rendre(id: IdEspace, aJuger: { total: number; titre: string } | null = null) {
  const espace = ESPACES.find((e) => e.id === id) ?? null;
  const contenu = contenuEspaces({ ...entrees, aJuger })[id];
  return renderToStaticMarkup(createElement(PanneauEspace, { espace, contenu, choisir: () => undefined, fermer: () => undefined }));
}

describe("Monde, comme la maquette", () => {
  it("a les cinq tuiles de la maquette, à leur place, les deux dernières repliées", () => {
    const t = tableauMonde();
    expect(t.question).toBe("Ce que LIA regarde dans le monde");
    expect(t.tuiles.map((x) => x.titre)).toEqual(["Météo", "Actualité", "Sept jours", "Bornes proches", "Sources"]);
    expect(t.tuiles.map((x) => x.largeur)).toEqual([6, 6, 12, 6, 6]);
    expect(t.tuiles.filter((x) => x.repliee).map((x) => x.cle)).toEqual(["bornes", "sources"]);
  });

  it("sans source, chaque tuile est vide : aucun chiffre de la maquette", () => {
    const t = tableauMonde();
    expect(t.tuiles.every((x) => x.corps.every((c) => c.genre === "vide"))).toBe(true);
    const html = rendre("monde");
    expect(html).toContain("Pas de météo : aucune source branchée.");
    expect(html).not.toMatch(/\d+ ?°/);
  });
});

describe("Idées, comme la maquette", () => {
  it("a les quatre tuiles de la maquette, « Refusées » repliée", () => {
    const t = tableauIdees(null);
    expect(t.tuiles.map((x) => x.titre)).toEqual(["Boîte à idées", "Où elles en sont", "Utilité estimée", "Refusées, jamais reproposées"]);
    expect(t.tuiles.find((x) => x.cle === "refusees")?.repliee).toBe(true);
  });

  it("rien à juger : la boîte le dit vide, sans lien", () => {
    const boite = tableauIdees(null).tuiles[0];
    expect(boite?.corps).toEqual([{ genre: "vide", texte: "Elle ne propose pas encore d'idées pour tes apps." }]);
  });

  it("des faits à juger : la boîte mène à /questions, avec le vrai compte", () => {
    const boite = tableauIdees({ total: 3, titre: "3 à juger" }).tuiles[0];
    expect(boite?.corps[0]).toEqual({
      genre: "texte",
      texte: "3 à juger : ce qu'elle a déduit ou lu attend ton avis.",
      lien: { href: "/questions", libelle: "Juger maintenant" },
    });
    expect(rendre("idees", { total: 3, titre: "3 à juger" })).toContain('href="/questions"');
  });
});

describe("le panneau qui a ses tuiles", () => {
  it("montre la question à côté de LIA et les tuiles, plus la phrase d'avant", () => {
    const html = rendre("monde");
    expect(html).toContain('class="tab-question"');
    expect(html).toContain("<p>Ce que LIA regarde dans le monde</p>");
    expect(html.match(/<details class="tuile-m/g)).toHaveLength(5);
    expect(html).not.toContain("maison-vide");
  });

  it("un espace sans tuiles garde son corps d'avant", () => {
    const html = rendre("sante");
    expect(html).toContain("maison-vide");
    expect(html).not.toContain("tab-question");
  });
});

describe("Outils, comme la maquette", () => {
  const outils = ["memoryai_etat", "memoryai_chercher"];
  const formes = ["carte", "liste", "courbe"];

  it("a les tuiles de la maquette, à leur place", () => {
    const t = tableauOutils({ outils, formes, appels: [] });
    expect(t.question).toBe("Tout ce qu'elle sait faire");
    expect(t.tuiles.map((x) => x.titre)).toEqual([
      "En chiffres",
      "Les plus utilisés",
      "Une idée d'outil ?",
      "Lire · 2",
      "Agir dans les apps · 0",
      "Le monde · 0",
      "Elle-même · 0",
      "Afficher · 3",
    ]);
  });

  it("en chiffres : les vrais comptes, un tiret pour ce que rien ne mesure", () => {
    const t = tableauOutils({ outils, formes, appels: [{ outil: "memoryai_etat", n: 1200 }, { outil: "memoryai_chercher", n: 3 }] });
    expect(t.tuiles[0]?.corps[0]).toMatchObject({
      genre: "chiffres",
      chiffres: [
        { valeur: "2", libelle: "outils" },
        { valeur: "4", libelle: "niveaux" },
        { valeur: (1203).toLocaleString("fr-CA"), libelle: "appels ce mois" },
        { valeur: "—", libelle: "refusés à tort" },
      ],
    });
  });

  it("les plus utilisés : cinq au plus, dits pour Marc, rapportés au plus grand", () => {
    const appels = ["a", "b", "c", "d", "e", "f"].map((o, i) => ({ outil: o, n: 60 - i * 10 }));
    appels[0] = { outil: "memoryai_etat", n: 60 };
    const corps = tableauOutils({ outils, formes, appels }).tuiles[1]?.corps[0];
    expect(corps?.genre).toBe("barres");
    if (corps?.genre !== "barres") return;
    expect(corps.barres).toHaveLength(5);
    expect(corps.barres[0]).toEqual({ libelle: "L'état de sa mémoire", valeur: "60", part: 1 });
    expect(corps.barres[1]?.part).toBeCloseTo(50 / 60);
  });

  it("sans base, ni compte ni barre inventés", () => {
    const t = tableauOutils({ outils, formes, appels: null });
    expect(t.tuiles[0]?.corps[0]).toMatchObject({ chiffres: [{}, {}, { valeur: "—" }, {}] });
    expect(t.tuiles[1]?.corps[0]?.genre).toBe("vide");
    expect(tableauOutils({ outils, formes, appels: [] }).tuiles[1]?.corps).toEqual([{ genre: "vide", texte: "Aucun appel ce mois-ci." }]);
  });

  it("le panneau Outils dessine les chiffres, les barres et les familles", () => {
    const contenu = contenuEspaces({ ...entrees, outils, formes, appels: [{ outil: "memoryai_etat", n: 7 }] }).outils;
    const espace = ESPACES.find((e) => e.id === "outils") ?? null;
    const html = renderToStaticMarkup(createElement(PanneauEspace, { espace, contenu, choisir: () => undefined, fermer: () => undefined }));
    expect(html).toContain('class="tab-chiffres"');
    expect(html).toContain('aria-label="Les outils les plus appelés ce mois-ci : L&#x27;état de sa mémoire 7."');
    expect(html).toContain("<li>Chercher un fait</li>");
    expect(html).toContain("<li>courbe</li>");
  });
});

describe("le début de « ce mois-ci », à l'heure de Québec", () => {
  it("minuit du 1er à Québec, en heure d'été (UTC−4) comme en heure normale (UTC−5)", () => {
    expect(debutDuMoisQuebec(new Date("2026-10-24T05:00:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(debutDuMoisQuebec(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("le 1er à 2 h UTC, c'est encore le mois d'avant à Québec", () => {
    expect(debutDuMoisQuebec(new Date("2026-11-01T02:00:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });
});
