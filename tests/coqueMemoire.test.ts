// tests/coqueMemoire.test.ts — la coque de la page Mémoire et sa tuile (maquette v5, MemoryAI#74) :
// les cinq onglets dans l'ordre de la maquette, le retour vers LIA, la tuile repliable, et l'onglet
// Réseau dessiné à vide, honnêtement, puisque ce réseau n'existe pas encore.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/memoire/reseau", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));

const { CoqueMemoire, ONGLETS_MEMOIRE } = await import("@/components/CoqueMemoire");
const { Tuile } = await import("@/components/Tuile");
const { default: ReseauPage } = await import("@/app/memoire/reseau/page");

describe("la coque de la Mémoire", () => {
  it("porte les cinq onglets de la maquette, dans son ordre, et un retour vers LIA", () => {
    expect(ONGLETS_MEMOIRE.map((o) => o.libelle)).toEqual(["Mémoire", "Réseau", "Apprentissage", "Historique", "Accès"]);
    const html = renderToStaticMarkup(CoqueMemoire({ actif: "historique", children: "corps" }));
    expect(html).toMatch(/<a href="\/" class="bouton-rond" aria-label="Retour à LIA">/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Historique" aria-current="page"/);
    expect(html).toContain("<main class=\"coque-memoire-corps\">corps</main>");
  });

  it("aucune page de la Mémoire ne remet le menu de l'app (la maquette n'en a pas)", () => {
    const pages = ["app/memoire/page.tsx", ...readdirSync("app/memoire", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `app/memoire/${d.name}/page.tsx`)];
    expect(pages.length).toBe(ONGLETS_MEMOIRE.length);
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/components\/Nav"/);
      expect(src, p).toMatch(/<CoqueMemoire actif=/);
    }
  });
});

describe("la tuile", () => {
  it("s'ouvre par défaut, et reste repliée quand la maquette la replie", () => {
    const ouverte = renderToStaticMarkup(Tuile({ largeur: 7, icone: "db", titre: "Ce qu’elle a écrit", children: "x" }));
    expect(ouverte).toMatch(/^<details class="tuile-m tuile-m--7" open="">/);
    expect(ouverte).toContain("<h2>Ce qu’elle a écrit</h2>");
    const repliee = renderToStaticMarkup(Tuile({ largeur: 12, icone: "layers", titre: "Les six couches", repliee: true, children: "x" }));
    expect(repliee).toMatch(/^<details class="tuile-m tuile-m--12">/);
  });
});

describe("l'onglet Réseau", () => {
  it("dessine les quatre tuiles de la maquette, vides, sans un chiffre inventé", async () => {
    const html = renderToStaticMarkup(await ReseauPage());
    const titres = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(titres).toEqual(["Son réseau de neurones", "Ce qui l’anime maintenant", "Ses humeurs", "Les six couches"]);
    const vides = [...html.matchAll(/<p class="tuile-vide[^"]*">([^<]+)<\/p>/g)].map((m) => m[1] ?? "");
    expect(vides).toHaveLength(4);
    for (const v of vides) expect(v.replaceAll("&#x27;", "'")).not.toMatch(/\d/);
  });
});
