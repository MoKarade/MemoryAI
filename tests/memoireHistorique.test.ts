// tests/memoireHistorique.test.ts — l'onglet Historique de la page Mémoire (MemoryAI#74) : des
// séries complètes (un jour sans rien vaut 0), une grille de 26 semaines qui finit aujourd'hui,
// et une page qui ne dessine que ce qui est mesuré. Base FICTIVE.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { corpsCeQuElleAFait, corpsCorrections, grilleEcritures, journees, joursFenetre, lireFiltreFait, serieJours } from "@/lib/memoire/historique";
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
let dernieres: { id: number; ts: Date; lecteur: string; outil: string; niveauMaxServi: number; nFaits: number | null; nPieces: number | null }[] = [];
vi.mock("@/lib/memoire/depotAcces", () => ({ depotAccesDrizzle: () => ({ journal: async () => dernieres }) }));

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
      corrections: async () => [{ predicat: "fictif.corrige" }],
    };
    dernieres = [{ id: 1, ts: new Date("2026-10-22T13:05:00Z"), lecteur: "lia-maison", outil: "memoryai_chercher", niveauMaxServi: 0, nFaits: 1, nPieces: 0 }];
    depenses = [{ jour: "2026-10-22", parPoste: { chat: 0.11, apprentissage: 0.2 } }];
  });

  it("montre les écritures, les conversations, les lectures et la dépense réelles", async () => {
    const html = renderToStaticMarkup(await HistoriquePage());
    expect(html).toContain("5 faits écrits en mémoire sur 26 semaines");
    expect(html).toContain("Claude");
    expect(html).toContain("41 messages");
    expect(html).toContain("2 lectures du 2026-10-09 au 2026-10-22");
    expect(html).toContain("0,31 $ en tout sur 14 jours");
    expect(html).toContain("9 h 05 · Chercher un fait");
    expect(html).toContain("fictif.corrige");
    expect(html).toMatch(/aria-label="Historique" aria-current="page"/);
  });

  it("une base vide le dit, bloc par bloc", async () => {
    depot = { faitsParJour: async () => [], lecturesParJour: async () => [], conversationsParSource: async () => [], corrections: async () => [] };
    depenses = [];
    dernieres = [];
    const html = renderToStaticMarkup(await HistoriquePage());
    expect(html).toContain("0 fait écrit");
    expect(html).toContain("Aucune conversation enregistrée.");
    expect(html).toContain("Aucune lecture ces 14 derniers jours.");
    expect(html).toContain("Aucune lecture ni dépense ces 14 derniers jours.");
    expect(html).toContain("Aucun fait corrigé pour l&#x27;instant.");
  });

  it("dessine VIDE ce qui n'est pas mesuré (humeur, relances), et ne déchiffre rien", async () => {
    // Règle de Marc du 23/10 : un bloc de la maquette sans donnée est dessiné vide, jamais rempli.
    const html = renderToStaticMarkup(await HistoriquePage());
    expect(html).toMatch(/Son humeur, 14 jours[\s\S]*?class="tuile-vide[^"]*"[^>]*>Son humeur n&#x27;est pas encore gardée/);
    expect(html).toMatch(/Ses relances[\s\S]*?class="tuile-vide[^"]*"[^>]*>Aucune relance/);
    const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const src of [code("app/memoire/historique/page.tsx"), code("lib/memoire/depotHistorique.ts")]) expect(src).not.toMatch(/dechiffrer|\.titre\b/);
  });

  it("le filtre « Plus tard » dit qu'il n'a pas de source, au lieu d'inventer", async () => {
    const html = renderToStaticMarkup(await HistoriquePage({ searchParams: Promise.resolve({ fait: "plus-tard" }) }));
    expect(html).toMatch(/href="\/memoire\/historique\?fait=plus-tard"[^>]*aria-current="true"/);
    expect(html).toContain("Rien de remis à plus tard");
    expect(html).not.toContain("Chercher un fait");
  });
});

describe("les tuiles de l'Historique", () => {
  const maintenant = new Date("2026-10-22T15:00:00Z");

  it("Ses journées : la plus récente d'abord, lectures et dépense du jour, zéro un jour sans rien", () => {
    const j = journees(["2026-10-21", "2026-10-22"], [{ jour: "2026-10-21", n: 3 }], new Map([["2026-10-22", 0.25]]));
    expect(j).toEqual([
      { jour: "2026-10-22", etiquette: "22 oct.", lectures: 0, depense: 0.25 },
      { jour: "2026-10-21", etiquette: "21 oct.", lectures: 3, depense: 0 },
    ]);
  });

  it("Ce qu'elle a corrigé : le prédicat seul, jamais une valeur ; vide sans correction", () => {
    expect(corpsCorrections([])).toEqual({ genre: "vide", texte: "Aucun fait corrigé pour l'instant." });
    expect(corpsCorrections([{ predicat: "fictif.corrige" }])).toEqual({
      genre: "liste",
      elements: [{ libelle: "fictif.corrige", detail: "remplacé par une valeur plus récente, ou dépassé" }],
    });
  });

  it("Ce qu'elle a fait : le filtre inconnu retombe sur « Tout » ; « Refusé » n'a pas de source", () => {
    expect(lireFiltreFait("n'importe quoi")).toBe("tous");
    expect(lireFiltreFait("refuse")).toBe("refuse");
    expect(corpsCeQuElleAFait([], "fait")).toEqual({ genre: "vide", texte: "Elle n'a encore rien lu dans la mémoire." });
    expect(corpsCeQuElleAFait([{ ts: maintenant, lecteur: "chat", outil: "x" }], "refuse").genre).toBe("vide");
  });
});
