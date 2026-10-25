// tests/panneauEspace.test.ts — un espace ouvert de la maison de LIA (MemoryAI#74) : il montre ce
// que `contenuEspaces` a composé, le dit quand il n'a pas de source, et fermé il ne contient rien.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanneauEspace } from "@/components/PanneauEspace";
import { contenuEspaces, ESPACES, type IdEspace } from "@/lib/accueil/espaces";

vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});

const contenus = contenuEspaces({
  budget: { depense: { chat: 0.25, apprentissage: 0 }, plafonds: { chat: 1, apprentissage: 2 } },
  outils: ["memoryai_etat"],
  formes: ["carte"],
});

function rendre(id: IdEspace | null) {
  const espace = ESPACES.find((e) => e.id === id) ?? null;
  return renderToStaticMarkup(createElement(PanneauEspace, { espace, contenu: id ? contenus[id] : null, choisir: () => undefined, fermer: () => undefined }));
}

describe("le panneau d'un espace", () => {
  it("fermé, il est caché et vide", () => {
    const html = rendre(null);
    expect(html).toMatch(/<aside class="maison-panneau"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("data-ouvert");
    expect(html).not.toContain("maison-panneau-tete");
  });

  it("ouvert sur Budget, il montre les vraies dépenses en tuiles et le lien vers les dépenses", () => {
    const html = rendre("budget");
    expect(html).toContain("data-ouvert");
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain("<span>Parler</span><span class=\"tab-valeur\">0,25 $ / 1,00 $</span>");
    expect(html).toContain('href="/depenses"');
    // La mini-barre marque l'espace courant, et lui seul.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    // Huit espaces, plus « Parler » en tête (maquette v5).
    expect(html.match(/<button type="button" aria-label="/g)).toHaveLength(ESPACES.length + 1);
    expect(html).toContain('aria-label="Parler" aria-current="false"');
  });

  it("ouvert sur « Parler », il titre « LIA » et porte la conversation (écart A7)", () => {
    const html = renderToStaticMarkup(
      createElement(PanneauEspace, { espace: null, contenu: null, choisir: () => undefined, fermer: () => undefined, parler: createElement("p", null, "conversation") }),
    );
    expect(html).toContain("data-ouvert");
    expect(html).toContain('aria-label="LIA"');
    expect(html).toContain("<h2>LIA</h2>");
    expect(html).toContain('aria-label="Parler" aria-current="true"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("<p>conversation</p>");
  });

  it("sans source réelle, il le dit au lieu d'inventer", () => {
    const html = rendre("sante");
    expect(html).toContain('class="tuile-vide"');
    expect(html).toContain("Health Connect");
    expect(html).not.toContain("maison-lignes");
  });
});
