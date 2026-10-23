// tests/memoireApprentissage.test.ts — l'onglet Apprentissage de la page Mémoire (MemoryAI#74) :
// une mesure illisible n'est jamais un zéro, les statuts sans ligne valent 0, chaque étape nomme
// un fichier qui existe, et la page ne dessine que ce qui est mesuré. Base FICTIVE.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { comptesFaits, comptesQuestions, ETAPES, lireMesure, pourcent, serieBanc } from "@/lib/memoire/apprentissage";
import type { DepotApprentissage } from "@/lib/memoire/depotApprentissage";

vi.mock("next/navigation", () => ({ usePathname: () => "/memoire/apprentissage", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));
vi.mock("@/components/Nav", () => ({ Nav: () => null }));
vi.mock("@/lib/pageDonnees", () => ({ accesDonnees: vi.fn(async () => ({ ok: true, db: {} })), MESSAGES_MANQUE: { base: "base absente", cle: "clé absente" } }));

let depot: DepotApprentissage;
vi.mock("@/lib/memoire/depotApprentissage", () => ({ depotApprentissageDrizzle: () => depot }));

const { default: ApprentissagePage } = await import("@/app/memoire/apprentissage/page");

const score = (questions: number, rappel: number | null) => ({ questions, rappel });
const mesure = (rappel: number | null, abstention: number | null) =>
  JSON.stringify({
    k: 20,
    questions: 40,
    parCapacite: {
      extraction: score(8, 0.75),
      "multi-sources": score(8, 0.5),
      temporel: score(8, rappel),
      "mise-a-jour": score(0, null),
      abstention: score(8, abstention),
    },
    rappel,
    abstentionCorrecte: abstention,
  });

describe("les mesures du banc", () => {
  it("relit une mesure valide, et rend null pour du JSON cassé ou hors bornes", () => {
    expect(lireMesure(mesure(0.6, 0.25))?.rappel).toBe(0.6);
    expect(lireMesure("{pas du json")).toBeNull();
    expect(lireMesure(mesure(1.4, 0.25))).toBeNull();
    expect(lireMesure(JSON.stringify({ k: 20 }))).toBeNull();
  });

  it("met la courbe dans l'ordre du temps et compte les illisibles à part", () => {
    const s = serieBanc([
      { mesureLe: new Date("2026-10-22T08:00:00Z"), resultat: mesure(0.7, 0.5) },
      { mesureLe: new Date("2026-10-21T08:00:00Z"), resultat: "cassé" },
      { mesureLe: new Date("2026-10-20T08:00:00Z"), resultat: mesure(0.5, null) },
    ]);
    expect(s.points.map((p) => p.rappel)).toEqual([0.5, 0.7]);
    expect(s.points[0]?.abstention).toBeNull();
    expect(s.illisibles).toBe(1);
    expect(s.derniere?.rappel).toBe(0.7);
  });

  it("une part absente s'écrit « — », jamais 0 %", () => {
    expect(pourcent(null)).toBe("—");
    expect(pourcent(0)).toBe("0 %");
    expect(pourcent(0.666)).toBe("67 %");
  });
});

describe("les comptes", () => {
  it("chaque statut a sa ligne, dans l'ordre du schéma", () => {
    expect(comptesFaits([{ statut: "valide", n: 3 }])).toEqual([
      { statut: "propose", n: 0 },
      { statut: "valide", n: 3 },
      { statut: "rejete", n: 0 },
      { statut: "perime", n: 0 },
    ]);
    expect(comptesQuestions([{ statut: "ouverte", n: 2 }]).map((c) => c.n)).toEqual([2, 0, 0]);
  });

  it("chaque étape nomme un fichier qui existe", () => {
    for (const e of ETAPES) expect(existsSync(e.ou), e.ou).toBe(true);
  });
});

describe("l'onglet Apprentissage", () => {
  beforeEach(() => {
    depot = {
      mesures: async () => [
        { mesureLe: new Date("2026-10-22T08:00:00Z"), chercheur: "plein-texte-mots-cles", resultat: mesure(0.62, 0.5) },
        { mesureLe: new Date("2026-10-21T08:00:00Z"), chercheur: "plein-texte-mots-cles", resultat: mesure(0.55, 0.375) },
      ],
      faitsAppris: async () => [
        { statut: "propose", n: 4 },
        { statut: "valide", n: 9 },
      ],
      questionsParStatut: async () => [{ statut: "repondue", n: 6 }],
    };
  });

  it("montre la courbe, les capacités, les faits appris et les questions réelles", async () => {
    const html = renderToStaticMarkup(await ApprentissagePage());
    expect(html).toContain("2 mesures du banc. Dernière : 62 %");
    expect(html).toContain("Trouver un papier");
    expect(html).toContain("75 %");
    // Une capacité sans question ne se dessine pas : « — », et pas de jauge.
    expect(html).toMatch(/Prendre le plus récent[\s\S]*?<b>—<\/b>/);
    expect(html).toContain("Validés par toi");
    expect(html).toContain("Répondues");
    expect(html).toMatch(/aria-current="page"[^>]*>Apprentissage/);
  });

  it("une base vide le dit, bloc par bloc", async () => {
    depot = { mesures: async () => [], faitsAppris: async () => [], questionsParStatut: async () => [] };
    const html = renderToStaticMarkup(await ApprentissagePage());
    expect(html).toContain("Aucune mesure du banc pour l&#x27;instant");
    expect(html).toContain("Rien à montrer tant que le banc");
    expect(html).toContain("Aucun fait tiré d&#x27;une conversation");
    expect(html).toContain("Aucune question posée");
    expect(html).not.toContain("courbe-banc");
  });

  it("ne dessine pas ce qui n'est pas mesuré, et ne déchiffre rien", () => {
    const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const page = code("app/memoire/apprentissage/page.tsx");
    expect(page).not.toMatch(/version|habitude|entra[iî]nement/i);
    for (const src of [page, code("lib/memoire/depotApprentissage.ts")]) expect(src).not.toMatch(/dechiffrer|contenu|valeur\b/);
  });
});
