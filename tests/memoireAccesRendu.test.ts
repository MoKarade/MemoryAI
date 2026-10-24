// tests/memoireAccesRendu.test.ts — ce que l'onglet Accès rend, sur une base FICTIVE : chaque
// bloc montre ce que la base dit, et dit « rien » quand elle ne dit rien.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DepotAcces } from "@/lib/memoire/depotAcces";

vi.mock("next/navigation", () => ({ usePathname: () => "/memoire/acces", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));
vi.mock("@/components/Nav", () => ({ Nav: () => null }));
vi.mock("@/lib/pageDonnees", () => ({ accesDonnees: vi.fn(async () => ({ ok: true, db: {} })), MESSAGES_MANQUE: { base: "base absente", cle: "clé absente" } }));

let depot: DepotAcces;
vi.mock("@/lib/memoire/depotAcces", () => ({ depotAccesDrizzle: () => depot }));
let questions: { id: string; question: string; motif: string; creeLe: Date }[] = [];
vi.mock("@/lib/depotQuestions", () => ({ depotQuestionsDrizzle: () => ({ ouvertes: async () => questions }) }));

const { default: AccesPage } = await import("@/app/memoire/acces/page");

async function rendre(niveau?: string, qui?: string) {
  return renderToStaticMarkup(await AccesPage({ searchParams: Promise.resolve({ ...(niveau ? { niveau } : {}), ...(qui ? { qui } : {}) }) }));
}

describe("l'onglet Accès", () => {
  beforeEach(() => {
    depot = {
      faitsParNiveau: async () => ({ 0: 6, 1: 3, 2: 1 }),
      journal: async (_limite, filtre) =>
        [
          { id: 2, ts: new Date("2026-07-15T14:30:00Z"), lecteur: "claude-ai", outil: "memoryai_chercher", niveauMaxServi: 1, nFaits: 3, nPieces: 0 },
          { id: 1, ts: new Date("2026-07-15T13:00:00Z"), lecteur: "chat", outil: "profil", niveauMaxServi: 2, nFaits: null, nPieces: 2 },
        ].filter((l) => filtre === null || (filtre === "toi" ? l.lecteur === "chat" : l.niveauMaxServi === filtre)),
      lecturesDepuis: async () => [{ ts: new Date("2026-07-15T14:30:00Z"), lecteur: "claude-ai" }],
      oublis: async () => ({ total: 2, derniers: [new Date("2026-07-10T12:00:00Z")] }),
    };
    questions = [];
  });

  it("montre les vraies parts, le journal, la carte horaire, les oublis et les garde-fous", async () => {
    const html = await rendre();
    expect(html).toContain("N0 60 %, N1 30 %, N2 10 %, N3 0 %");
    expect(html).toContain("Claude");
    expect(html).toContain("memoryai_chercher");
    // Une liste illisible se dit « ? », jamais zéro.
    expect(html).toContain("? faits");
    expect(html).toContain("2 papiers");
    expect(html).toContain('class="carte-heures"');
    expect(html).toContain('<p class="chiffre">2</p>');
    expect(html).toContain("Échec fermé");
    expect(html).toMatch(/aria-label="Accès" aria-current="page"/);
  });

  it("le filtre de niveau ne garde que les lectures de ce niveau", async () => {
    const html = await rendre("2");
    expect(html).toContain("profil");
    expect(html).not.toContain("memoryai_chercher");
    expect(html).toMatch(/href="\/memoire\/acces\?niveau=2"[^>]*aria-current="true"/);
  });

  it("le filtre « Toi » ne garde que ta conversation, et se marque", async () => {
    const html = await rendre(undefined, "toi");
    expect(html).toContain("profil");
    expect(html).not.toContain("memoryai_chercher");
    expect(html).toMatch(/href="\/memoire\/acces\?qui=toi"[^>]*aria-current="true"/);
  });

  it("À confirmer montre les questions ouvertes ; Outils et niveaux, la matrice réelle", async () => {
    questions = [{ id: "q1", question: "Question fictive ?", motif: "motif fictif", creeLe: new Date() }];
    const html = await rendre();
    expect(html).toContain("Question fictive ?");
    expect(html).toContain('href="/questions"');
    expect(html).toContain('class="matrice-niveaux"');
    // Sans les bascules posées (tests), N2 et N3 restent fermés : 3 portes × 2 niveaux.
    expect(html.match(/data-permis="non"/g)).toHaveLength(6);
    expect(html.match(/data-permis="oui"/g)).toHaveLength(6);
  });

  it("une base vide le dit, bloc par bloc", async () => {
    depot = { faitsParNiveau: async () => ({}), journal: async () => [], lecturesDepuis: async () => [], oublis: async () => ({ total: 0, derniers: [] }) };
    const html = await rendre();
    expect(html).toContain("Aucun fait validé");
    expect(html).toContain("Personne n&#x27;a encore lu la mémoire.");
    expect(html).toContain("Aucune lecture ces 30 derniers jours.");
    expect(html).not.toContain('class="empile"');
    expect(html).toContain("Rien à confirmer");
  });
});
