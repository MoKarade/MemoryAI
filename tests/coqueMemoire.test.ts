// tests/coqueMemoire.test.ts — la coque de la page Mémoire et sa tuile (maquette v5, MemoryAI#74) :
// les cinq onglets dans l'ordre de la maquette, le retour vers LIA, la tuile repliable, et l'onglet
// Réseau, qui dit les vrais chiffres du réseau enregistré (tâche MemoryAI 187) et reste honnêtement
// vide quand il n'y a rien à dire. Comptes et état de LIA FICTIFS.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/memoire/reseau", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));
vi.mock("@/lib/pageDonnees", async (origine) => ({
  ...(await origine<typeof import("@/lib/pageDonnees")>()),
  accesDonnees: vi.fn(async () => ({ ok: false as const, manque: "base" as const })),
}));
vi.mock("@/lib/memoire/depotMemoire", () => ({ depotMemoireDrizzle: vi.fn() }));
vi.mock("@/lib/lia/depotEtat", () => ({ depotEtatLiaDrizzle: vi.fn() }));

const { CoqueMemoire, ONGLETS_MEMOIRE } = await import("@/components/CoqueMemoire");
const { Tuile } = await import("@/components/Tuile");
const { default: ReseauPage } = await import("@/app/memoire/reseau/page");
const { accesDonnees } = await import("@/lib/pageDonnees");
const { depotMemoireDrizzle } = await import("@/lib/memoire/depotMemoire");
const { depotEtatLiaDrizzle } = await import("@/lib/lia/depotEtat");

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
  const brancher = (etatReseau: unknown, etatLia: unknown) => {
    vi.mocked(accesDonnees).mockResolvedValue({ ok: true, cle: {} as never, db: {} as never });
    vi.mocked(depotMemoireDrizzle).mockReturnValue({ etatReseau: async () => etatReseau } as never);
    vi.mocked(depotEtatLiaDrizzle).mockReturnValue({ lire: async () => etatLia } as never);
  };

  it("sans base branchée, dit ce qui manque et n'invente aucun chiffre", async () => {
    vi.mocked(accesDonnees).mockResolvedValue({ ok: false, manque: "base" });
    const html = renderToStaticMarkup(await ReseauPage());
    expect(html).toContain("Aucune base branchée");
    expect(html).not.toMatch(/<h2>/);
  });

  it("dessine les quatre tuiles de la maquette, avec les comptes que la base rend", async () => {
    brancher(
      {
        noeuds: 42,
        domaines: 5,
        etablis: 17,
        devines: 3,
        parType: [{ type: "meme-source", n: 17, poidsMoyen: 0.9 }],
        derniere: new Date(Date.now() - 3_600_000),
      },
      { humeur: "calme", maj: Date.now() - 60_000, envies: { energie: 0.5, curiosite: 0.5, social: 0.5, inquiet: 0, joie: 0.5, ennui: 0.1 }, souvenirs: [] },
    );
    const html = renderToStaticMarkup(await ReseauPage());
    const titres = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(titres).toEqual(["Son réseau de neurones", "Ce qui l’anime maintenant", "Ses humeurs", "Les six couches"]);
    // Les chiffres viennent de la base, et les liens devinés restent comptés à part.
    expect(html).toContain("neurones (faits validés)");
    expect(html).toMatch(/17.*liens établis par une règle/s);
    expect(html).toMatch(/3.*liens devinés par un modèle/s);
    expect(html).toContain("calme");
  });

  it("une mémoire vide reste dessinée, et dit pourquoi au lieu d'afficher des zéros", async () => {
    brancher({ noeuds: 0, domaines: 0, etablis: 0, devines: 0, parType: [], derniere: null }, null);
    const html = renderToStaticMarkup(await ReseauPage());
    expect([...html.matchAll(/<h2>([^<]+)<\/h2>/g)]).toHaveLength(4);
    const vides = [...html.matchAll(/<p class="tuile-vide[^"]*">([^<]+)<\/p>/g)].map((m) => m[1] ?? "");
    expect(vides.length).toBeGreaterThanOrEqual(4);
    for (const v of vides) expect(v.replaceAll("&#x27;", "'")).not.toMatch(/\d/);
  });
});
