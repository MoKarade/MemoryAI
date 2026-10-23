// tests/memoireHistorique.test.ts — l'onglet Historique de la page Mémoire (MemoryAI#74) : des
// séries complètes (un jour sans rien vaut 0), une grille de 26 semaines qui finit aujourd'hui,
// et une page qui ne dessine que ce qui est mesuré. Base FICTIVE.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { grilleEcritures, joursFenetre, serieJours } from "@/lib/memoire/historique";
import type { DepotHistorique } from "@/lib/memoire/depotHistorique";

vi.mock("next/navigation", () => ({ usePathname: () => "/memoire/historique", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));
vi.mock("@/components/Nav", () => ({ Nav: () => null }));
vi.mock("@/lib/pageDonnees", () => ({ accesDonnees: vi.fn(async () => ({ ok: true, db: {} })), MESSAGES_MANQUE: { base: "base absente", cle: "clé absente" } }));
vi.mock("@/lib/coutChat", () => ({ jourQuebec: () => "2026-10-22" }));

let depot: DepotHistorique;
let depenses: { jour: string; parPoste: Record<string, number> }[];
vi.mock("@/lib/memoire/depotHistorique", () => ({ depotHistoriqueDrizzle: () => depot }));
vi.mock("@/lib/depotAdmin", () => ({ depotAdminDrizzle: () => ({ depenseParJour: async () => depenses }) }));

const { default: HistoriquePage } = await import("@/app/memoire/historique/page");

describe("les séries par jour", () => {
  it("la fenêtre finit aujourd'hui et compte ses jours, même à cheval sur un mois", () => {
    expect(joursFenetre("2026-11-02", 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("un jour sans ligne vaut zéro ; un jour hors fenêtre est ignoré", () => {
    const s = serieJours([{ jour: "2026-10-21", n: 3 }, { jour: "2026-01-01", n: 9 }], "2026-10-22", 3);
    expect(s).toEqual([
      { jour: "2026-10-20", n: 0 },
      { jour: "2026-10-21", n: 3 },
      { jour: "2026-10-22", n: 0 },
    ]);
  });

  it("la grille a une colonne par semaine, lundi en haut, et rien après aujourd'hui", () => {
    // Le 22/10/2026 est un jeudi : la dernière colonne a quatre jours, puis trois cases vides.
    const g = grilleEcritures([{ jour: "2026-10-22", n: 4 }, { jour: "2026-10-19", n: 2 }], "2026-10-22", 26);
    expect(g.semaines).toHaveLength(26);
    const derniere = g.semaines[25] ?? [];
    expect(derniere).toEqual([2, 0, 0, 4, null, null, null]);
    expect(g.semaines[0]?.every((x) => x === 0)).toBe(true);
    expect(g.total).toBe(6);
    expect(g.max).toBe(4);
  });
});

describe("l'onglet Historique", () => {
  beforeEach(() => {
    depot = {
      faitsParJour: async () => [{ jour: "2026-10-22", n: 5 }],
      lecturesParJour: async () => [{ jour: "2026-10-21", n: 2 }],
      conversationsParSource: async () => [{ source: "claude-ai", conversations: 3, messages: 41, derniere: new Date("2026-10-20T15:00:00Z") }],
    };
    depenses = [{ jour: "2026-10-22", parPoste: { chat: 0.11, apprentissage: 0.2 } }];
  });

  it("montre les écritures, les conversations, les lectures et la dépense réelles", async () => {
    const html = renderToStaticMarkup(await HistoriquePage());
    expect(html).toContain("5 faits écrits en mémoire sur 26 semaines");
    expect(html).toContain("Claude");
    expect(html).toContain("41 messages");
    expect(html).toContain("2 lectures du 2026-10-09 au 2026-10-22");
    expect(html).toContain("0,31 $ en tout");
    expect(html).toMatch(/aria-label="Historique" aria-current="page"/);
  });

  it("une base vide le dit, bloc par bloc", async () => {
    depot = { faitsParJour: async () => [], lecturesParJour: async () => [], conversationsParSource: async () => [] };
    depenses = [];
    const html = renderToStaticMarkup(await HistoriquePage());
    expect(html).toContain("0 fait écrit");
    expect(html).toContain("Aucune conversation enregistrée.");
    expect(html).toContain("Aucune lecture ces 14 derniers jours.");
    expect(html).toContain("Aucune dépense ces 14 derniers jours.");
  });

  it("ne dessine pas ce qui n'est pas mesuré, et ne déchiffre rien", () => {
    // Le CODE, sans les commentaires : l'en-tête explique justement pourquoi l'humeur manque.
    const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const page = code("app/memoire/historique/page.tsx");
    const depotSrc = code("lib/memoire/depotHistorique.ts");
    expect(page).not.toMatch(/humeur/i);
    for (const src of [page, depotSrc]) expect(src).not.toMatch(/dechiffrer|\.titre\b/);
  });
});
