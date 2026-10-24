// tests/tableauxMaison.test.ts — les tuiles des panneaux de la maison (maquette v5, écart B) :
// chaque tuile de la maquette est là, et une tuile sans donnée réelle se dessine VIDE.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanneauEspace } from "@/components/PanneauEspace";
import { contenuEspaces, ESPACES, type IdEspace } from "@/lib/accueil/espaces";
import { tableauIdees, tableauMonde } from "@/lib/accueil/tableaux";

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
