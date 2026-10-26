// tests/memoireReseau.test.ts — le réseau de la page Mémoire (MemoryAI#74). Faits FICTIFS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { construireReseau, domaineDe, filtrerVisibles, JETON_NIVEAU, voisinsDe, type FaitReseau, type LienReseau } from "@/lib/memoire/reseau";

const faits: FaitReseau[] = [
  { id: "f1", predicat: "emploi.employeur", niveau: 1 },
  { id: "f2", predicat: "emploi.poste", niveau: 0 },
  { id: "f3", predicat: "logement.ville", niveau: 2 },
  { id: "f4", predicat: "sante.allergie", niveau: 3 },
  { id: "f5", predicat: "logement.type", niveau: 1 },
];
const liens: LienReseau[] = [
  { faitA: "f1", faitB: "f2", poids: 1 },
  { faitA: "f1", faitB: "f3", poids: 0.5 },
  { faitA: "f9", faitB: "f1", poids: 1 },
];

describe("construireReseau", () => {
  it("met un centre par domaine, puis un point par fait, sans valeur", () => {
    const r = construireReseau(faits, liens);
    expect(r.domaines).toEqual(["emploi", "logement", "sante"]);
    expect(r.noeuds.slice(0, 3).every((n) => n.centre && n.id === null && n.jeton === "--repere")).toBe(true);
    expect(r.noeuds.filter((n) => !n.centre).map((n) => n.id).sort()).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    // Le réseau ne porte que la forme : aucune clé ne peut tenir une valeur de fait.
    for (const n of r.noeuds) expect(Object.keys(n).sort()).toEqual(["centre", "degre", "domaine", "etiquette", "id", "jeton", "niveau", "pos", "rayon"]);
    expect(r.omis).toBe(0);
  });

  it("colore par niveau et grossit les faits les plus reliés", () => {
    const r = construireReseau(faits, liens);
    const f = (id: string) => r.noeuds.find((n) => n.id === id)!;
    expect(f("f4").jeton).toBe(JETON_NIVEAU[3]);
    expect(f("f2").jeton).toBe(JETON_NIVEAU[0]);
    expect(f("f1").degre).toBe(3);
    expect(f("f1").rayon).toBeGreaterThan(f("f5").rayon);
    expect(f("f1").etiquette).toBe("employeur");
  });

  it("ne trace un lien que si ses deux bouts sont dessinés, et relie chaque fait à son domaine", () => {
    const r = construireReseau(faits, liens);
    // 5 fils fait → domaine, 2 liens entre faits dessinés ; f9 n'existe pas.
    expect(r.aretes).toHaveLength(7);
    const domaines = r.domaines.length;
    for (const [a, b] of r.aretes) {
      expect(a).toBeLessThan(r.noeuds.length);
      expect(b).toBeLessThan(r.noeuds.length);
      expect(b).toBeGreaterThanOrEqual(domaines);
    }
  });

  it("borne le dessin, garde les plus reliés et compte le reste", () => {
    const r = construireReseau(faits, liens, 5);
    // 3 centres + 2 faits : f1 (3 liens) puis f2 ou f3 (1 lien), départagés par le prédicat.
    expect(r.noeuds.filter((n) => !n.centre).map((n) => n.id)).toEqual(["f1", "f2"]);
    expect(r.omis).toBe(3);
  });

  it("est déterministe et rend une mémoire vide sans planter", () => {
    expect(construireReseau(faits, liens)).toEqual(construireReseau([...faits].reverse(), liens));
    expect(construireReseau([], [])).toEqual({ noeuds: [], aretes: [], domaines: [], omis: 0 });
    expect(domaineDe("sans_point")).toBe("sans_point");
  });
});

describe("voisinsDe", () => {
  const r = construireReseau(faits, liens);
  const rang = (id: string) => r.noeuds.findIndex((n) => n.id === id);

  it("liste les faits reliés, du lien le plus fort au plus faible, sans les fils vers les domaines (tâche MemoryAI 323)", () => {
    const v = voisinsDe(r, rang("f1"));
    expect(v.map((x) => [x.etiquette, x.domaine, x.poids])).toEqual([
      ["poste", "emploi", 1],
      ["ville", "logement", 0.5],
    ]);
    // Chaque voisin pointe son vrai rang dans le réseau : un clic sur la carte le choisit.
    for (const x of v) expect(r.noeuds[x.index]?.etiquette).toBe(x.etiquette);
    // Le lien se lit dans les deux sens.
    expect(voisinsDe(r, rang("f2")).map((x) => x.etiquette)).toEqual(["employeur"]);
  });

  it("un fait sans lien, un centre de domaine et un rang hors du réseau n'ont aucun voisin", () => {
    expect(voisinsDe(r, rang("f4"))).toEqual([]);
    expect(voisinsDe(r, 0)).toEqual([]);
    expect(voisinsDe(r, 999)).toEqual([]);
    expect(voisinsDe(r, -1)).toEqual([]);
  });
});

describe("la carte d'un fait", () => {
  it("ne renvoie plus à l'ancienne fiche /fait/[id], et ne montre aucune valeur (tâche MemoryAI 323)", () => {
    const s = readFileSync("app/memoire/MemoireClient.tsx", "utf8");
    expect(s).not.toMatch(/href=\{?[`"']\/fait\//);
    expect(s).not.toContain("Ouvrir la fiche");
    // La carte lit la structure du réseau, jamais une valeur.
    expect(s).toMatch(/voisinsDe\(/);
  });
});

describe("filtrerVisibles", () => {
  const r = construireReseau(faits, liens);
  const montre = (niveaux: number[], q: string) =>
    filtrerVisibles(r.noeuds, new Set(niveaux), q)
      .map((v, i) => (v ? r.noeuds[i]!.etiquette : null))
      .filter(Boolean)
      .sort();

  it("éteint un niveau décoché, garde toujours les centres", () => {
    expect(montre([0, 1, 2, 3], "")).toHaveLength(8);
    expect(montre([0, 1, 2], "")).not.toContain("allergie");
    expect(montre([], "")).toEqual(["emploi", "logement", "sante"]);
  });

  it("cherche dans l'étiquette, sans casse, et dans le domaine", () => {
    expect(montre([0, 1, 2, 3], "  VILLE ")).toEqual(["emploi", "logement", "sante", "ville"]);
    expect(montre([0, 1, 2, 3], "emploi")).toEqual(["emploi", "employeur", "logement", "poste", "sante"]);
  });
});
