// tests/accueilRendu.test.ts — ce que la maison de LIA rend au premier affichage (rendu serveur,
// avant toute animation) : huit espaces nommés, jamais de pastille « à juger » (Marc ne juge plus rien),
// et le panneau fermé. Le corps de LIA n'est monté qu'au navigateur (il lui faut la maison).

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccueilClient } from "@/app/AccueilClient";
import { contenuEspaces } from "@/lib/accueil/espaces";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@mokarade/lia-ui/react", () => ({ Lia: () => null }));

const contenus = contenuEspaces({ budget: null, outils: ["memoryai_etat"], formes: ["carte"] });

function rendre() {
  return renderToStaticMarkup(createElement(AccueilClient, { contenus }));
}

describe("la maison de LIA, au premier affichage", () => {
  it("montre les huit espaces, chacun un bouton nommé", () => {
    const html = rendre();
    for (const nom of ["Souvenirs", "Santé", "Sa journée", "Monde", "Budget", "Outils", "Formes"]) {
      expect(html).toContain(`aria-label="${nom}"`);
    }
    // Idées porte son nom seul : plus aucun compte « en attente », Marc ne juge plus rien.
    expect(html).toContain('aria-label="Idées"');
    expect(html).not.toContain("en attente");
    expect(html.match(/class="maison-espace /g)).toHaveLength(8);
  });

  it("chaque espace est une cible de LIA, avec sa phrase et son geste (écart A3)", () => {
    const html = rendre();
    expect(html.match(/data-lia-cible="[a-z]+"/g)).toHaveLength(8);
    expect(html.match(/data-lia-dit="[^"]+"/g)).toHaveLength(8);
    expect(html).toContain('data-lia-cible="budget"');
    expect(html).toContain('data-lia-activite="calcule"');
  });

  it("le panneau est fermé, et rien de son contenu n'est rendu", () => {
    const html = rendre();
    expect(html).toMatch(/<aside class="maison-panneau"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("maison-panneau-tete");
  });

  it("plus jamais de « à juger » ni de lien vers la pile (tâche MemoryAI 231)", () => {
    const html = rendre();
    expect(html).not.toContain("pastille-juger");
    expect(html).not.toContain("à juger");
    expect(html).not.toContain('href="/questions"');
  });

  it("en haut, un seul bouton à droite, « Mémoire », comme la maquette (écart A1)", () => {
    const html = rendre();
    const droite = html.match(/<nav class="maison-droite"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(droite.match(/<a /g)).toHaveLength(1);
    expect(droite).toContain('href="/memoire"');
    // Ni « Parler » ni le menu de l'app dans l'en-tête : la conversation s'ouvre par `/` ou en
    // touchant LIA, les sections par la Mémoire et les liens des espaces.
    expect(html).not.toContain('href="/chat"');
    expect(html).not.toContain("menu-bouton");
  });
});
