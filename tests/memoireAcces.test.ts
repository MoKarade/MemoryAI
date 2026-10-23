// tests/memoireAcces.test.ts — l'onglet Accès de la page Mémoire (MemoryAI#74) : des parts
// vraies, un journal qui ne devine pas, une carte horaire à l'heure de Québec, des garde-fous
// qui pointent vers le code qui les tient, et des onglets qui mènent à une page qui existe.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { carteHoraire, compterIds, GARDE_FOUS, heureQuebec, libelleLecteur, partsParNiveau } from "@/lib/memoire/acces";
import { ONGLETS_MEMOIRE } from "@/components/OngletsMemoire";

describe("les parts par niveau", () => {
  it("se calculent sur les faits comptés, arrondies", () => {
    const p = partsParNiveau({ 0: 46, 1: 33, 2: 17, 3: 4 });
    expect(p.map((x) => x.part)).toEqual([46, 33, 17, 4]);
    expect(p.map((x) => x.total)).toEqual([46, 33, 17, 4]);
  });

  it("un niveau absent compte zéro fait", () => {
    const p = partsParNiveau({ 1: 3 });
    expect(p.find((x) => x.niveau === 1)?.part).toBe(100);
    expect(p.find((x) => x.niveau === 3)).toEqual({ niveau: 3, total: 0, part: 0 });
  });

  it("sans aucun fait, aucune part n'est inventée", () => {
    for (const x of partsParNiveau({})) expect(x.part).toBeNull();
  });
});

describe("le journal", () => {
  it("compte les ids d'une liste, et dit « inconnu » plutôt que zéro quand elle est illisible", () => {
    expect(compterIds('["a","b"]')).toBe(2);
    expect(compterIds("[]")).toBe(0);
    expect(compterIds("pas du json")).toBeNull();
    expect(compterIds('{"a":1}')).toBeNull();
  });

  it("nomme les lecteurs connus, et montre tel quel un lecteur inconnu", () => {
    expect(libelleLecteur("claude-ai")).toBe("Claude");
    expect(libelleLecteur("lia-maison")).toBe("LIA ici");
    expect(libelleLecteur("api:batchchef")).toBe("api:batchchef");
  });

  it("les lecteurs nommés sont ceux que le code inscrit au journal", () => {
    const sources = ["app/api/chat/route.ts", "app/api/mcp/route.ts", "lib/lia/ask.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const l of ["chat", "claude-ai", "lia-hub", "lia-maison"]) expect(sources, l).toContain(`"${l}"`);
  });
});

describe("la carte horaire", () => {
  it("place chaque lecture à l'heure de Québec, pas à l'heure UTC du serveur", () => {
    // 14 h 30 UTC un jour d'hiver = 9 h 30 à Québec (UTC−5) ; en été, 10 h 30 (UTC−4).
    expect(heureQuebec(new Date("2026-01-15T14:30:00Z"))).toBe(9);
    expect(heureQuebec(new Date("2026-07-15T14:30:00Z"))).toBe(10);
    expect(heureQuebec(new Date("2026-07-15T04:10:00Z"))).toBe(0);
  });

  it("compte par lecteur et par heure, le plus actif d'abord", () => {
    const c = carteHoraire([
      { ts: new Date("2026-07-15T14:30:00Z"), lecteur: "chat" },
      { ts: new Date("2026-07-15T14:50:00Z"), lecteur: "claude-ai" },
      { ts: new Date("2026-07-16T14:05:00Z"), lecteur: "claude-ai" },
    ]);
    expect(c.lecteurs).toEqual(["claude-ai", "chat"]);
    expect(c.cases[0]?.[10]).toBe(2);
    expect(c.cases[1]?.[10]).toBe(1);
    expect(c.cases[0]?.reduce((s, x) => s + x, 0)).toBe(2);
    expect(c.max).toBe(2);
  });

  it("sans lecture, une carte vide et un maximum nul", () => {
    expect(carteHoraire([])).toEqual({ lecteurs: [], cases: [], max: 0 });
  });
});

describe("les garde-fous", () => {
  it("chacun pointe vers un fichier qui existe", () => {
    for (const g of GARDE_FOUS) {
      const fichier = g.ou.split(" ")[0] ?? "";
      expect(existsSync(fichier), `${g.texte} → ${fichier}`).toBe(true);
    }
  });

  it("le niveau 3 n'est ouvert qu'à la conversation, comme l'affirme la page", () => {
    expect(readFileSync("lib/lecture.ts", "utf8")).toMatch(/LECTEURS_N3[^=]*=\s*new Set\(\["chat"\]\)/);
  });
});

describe("les onglets de la Mémoire", () => {
  it("ne listent que des pages qui existent", () => {
    for (const o of ONGLETS_MEMOIRE) expect(existsSync(`app${o.href}/page.tsx`), o.href).toBe(true);
  });

  it("l'onglet Accès lit la base sans rien déchiffrer", () => {
    const page = readFileSync("app/memoire/acces/page.tsx", "utf8");
    const depot = readFileSync("lib/memoire/depotAcces.ts", "utf8");
    expect(page).toMatch(/\brequireSession\(\)/);
    for (const src of [page, depot]) expect(src).not.toMatch(/dechiffrer|questionEmpreinte/);
  });
});
