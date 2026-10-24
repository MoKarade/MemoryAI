// tests/accueilRendu.test.ts — ce que la maison de LIA rend au premier affichage (rendu serveur,
// avant toute animation) : huit espaces nommés, la pastille « à juger » seulement si elle existe,
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

const contenus = contenuEspaces({ aJuger: { total: 2, titre: "2 à juger" }, budget: null, outils: ["memoryai_etat"], formes: ["carte"] });

function rendre(aJuger: { titre: string; detail: string } | null) {
  return renderToStaticMarkup(createElement(AccueilClient, { contenus, aJuger }));
}

describe("la maison de LIA, au premier affichage", () => {
  it("montre les huit espaces, chacun un bouton nommé", () => {
    const html = rendre(null);
    for (const nom of ["Souvenirs", "Santé", "Sa journée", "Monde", "Budget", "Outils", "Formes"]) {
      expect(html).toContain(`aria-label="${nom}"`);
    }
    // Idées porte son compte réel dans son nom accessible.
    expect(html).toContain('aria-label="Idées, 2 en attente"');
    expect(html.match(/class="maison-espace /g)).toHaveLength(8);
  });

  it("le panneau est fermé, et rien de son contenu n'est rendu", () => {
    const html = rendre(null);
    expect(html).toMatch(/<aside class="maison-panneau"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("maison-panneau-tete");
  });

  it("la pastille « à juger » n'apparaît que s'il y a quelque chose à juger", () => {
    expect(rendre(null)).not.toContain("pastille-juger");
    const html = rendre({ titre: "2 à juger", detail: "2 questions" });
    expect(html).toContain('href="/questions"');
    expect(html).toContain('aria-label="2 à juger : 2 questions"');
  });

  it("en haut, un seul bouton à droite, « Mémoire », comme la maquette (écart A1)", () => {
    const html = rendre(null);
    const droite = html.match(/<nav class="maison-droite"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(droite.match(/<a /g)).toHaveLength(1);
    expect(droite).toContain('href="/memoire"');
    // Ni « Parler » ni le menu de l'app dans l'en-tête : la conversation s'ouvre par `/` ou en
    // touchant LIA, les sections par la Mémoire et les liens des espaces.
    expect(html).not.toContain('href="/chat"');
    expect(html).not.toContain("menu-bouton");
  });
});
