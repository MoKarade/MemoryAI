// tests/accueil.test.ts — la maison de LIA (MemoryAI#74, maquette v5) : géométrie de l'orbite,
// contenu des espaces (sans donnée inventée) et décor.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { orbite, placerEspaces, zoneDeVie, LARGEUR_ETROITE, VITESSE_ORBITE } from "@/lib/accueil/orbite";
import { contenuEspaces, ESPACES, IDS_ESPACES, type EntreesEspaces } from "@/lib/accueil/espaces";
import { heureAllumee, peindreDecor, type Pinceau } from "@/lib/accueil/decor";

const ENTREES: EntreesEspaces = {
  aJuger: null,
  budget: null,
  outils: ["memoryai_chercher", "memoryai_etat"],
  formes: ["carte", "courbe", "liste"],
};

describe("l'orbite", () => {
  it("place le premier espace en haut, au centre, puis tourne dans le sens horaire", () => {
    const o = orbite(1400, 900);
    const [haut, droite] = placerEspaces(8, 0, o);
    expect(haut?.x).toBeCloseTo(o.cx);
    expect(haut?.y).toBeCloseTo(o.cy - o.ry);
    expect(droite?.x).toBeGreaterThan(o.cx);
    expect(droite?.y).toBeLessThan(o.cy);
  });

  it("chaque espace est sur l'ellipse, à intervalles égaux", () => {
    const o = orbite(1200, 800);
    const points = placerEspaces(8, 0.7, o);
    expect(points).toHaveLength(8);
    for (const p of points) expect(((p.x - o.cx) / o.rx) ** 2 + ((p.y - o.cy) / o.ry) ** 2).toBeCloseTo(1);
  });

  it("sur téléphone, l'ellipse tient dans l'écran avec la marge d'un espace (84 px)", () => {
    const o = orbite(390, 844);
    expect(390 < LARGEUR_ETROITE).toBe(true);
    expect(o.cx - o.rx).toBeGreaterThanOrEqual(42);
    expect(o.cx + o.rx).toBeLessThanOrEqual(390 - 42);
    expect(o.cy - o.ry).toBeGreaterThan(60);
  });

  it("LIA erre au cœur au repos, et laisse la place au panneau quand il s'ouvre", () => {
    const o = orbite(1400, 900);
    const repos = zoneDeVie(o);
    expect(repos.x).toBeGreaterThan(o.cx - o.rx);
    expect(repos.x + repos.w).toBeLessThan(o.cx + o.rx);
    const pc = zoneDeVie(o, true);
    expect(pc.x + pc.w).toBeLessThanOrEqual(1400 - 640);
    const tel = zoneDeVie(orbite(390, 844), true);
    expect(tel.y + tel.h).toBeLessThanOrEqual(844 * 0.32 + 0.01);
  });

  it("l'orbite tourne lentement : un tour prend plus de deux minutes (on lit, on ne la poursuit pas)", () => {
    expect(VITESSE_ORBITE).toBeGreaterThan(0);
    expect((2 * Math.PI) / VITESSE_ORBITE).toBeGreaterThan(120);
  });

  it("une taille nulle ne rend jamais NaN", () => {
    const o = orbite(0, 0);
    for (const v of Object.values(o)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("les espaces", () => {
  it("huit espaces, dans l'ordre de la maquette, un par identifiant", () => {
    expect(ESPACES.map((e) => e.id)).toEqual([...IDS_ESPACES]);
    expect(ESPACES[0]?.id).toBe("souvenirs");
  });

  it("sans source réelle, un espace le DIT : santé, journée, monde sont vides", () => {
    const c = contenuEspaces(ENTREES);
    for (const id of ["sante", "journee", "monde"] as const) {
      expect(c[id].vide, id).toBe(true);
      expect(c[id].lignes, id).toBeUndefined();
      expect(c[id].pastille, id).toBeUndefined();
      // Aucun chiffre écrit en dur : la maquette en montre de fictifs, la vraie page n'en a pas.
      expect(c[id].phrase, id).not.toMatch(/\d/);
    }
  });

  it("sans base, le budget ne devine pas un zéro", () => {
    const c = contenuEspaces(ENTREES);
    expect(c.budget.vide).toBe(true);
    expect(c.budget.lignes).toBeUndefined();
  });

  it("avec la base, le budget montre la dépense du jour et le plafond de chaque poste", () => {
    const c = contenuEspaces({ ...ENTREES, budget: { depense: { chat: 0.113, apprentissage: 0 }, plafonds: { chat: 1, apprentissage: 2 } } });
    expect(c.budget.vide).toBe(false);
    expect(c.budget.lignes).toEqual([
      { libelle: "Parler", valeur: "0,11 $ sur 1,00 $" },
      { libelle: "Apprendre", valeur: "0,00 $ sur 2,00 $" },
    ]);
  });

  it("la pastille d'Idées est le compte réel de la pile, et n'existe pas sans rien à juger", () => {
    expect(contenuEspaces(ENTREES).idees.pastille).toBeUndefined();
    const c = contenuEspaces({ ...ENTREES, aJuger: { total: 3, titre: "3 à juger" } });
    expect(c.idees.pastille).toBe(3);
    expect(c.idees.liens).toEqual([{ href: "/questions", libelle: "3 à juger" }]);
  });

  it("outils et formes viennent des listes réelles (comptées, nommées)", () => {
    const c = contenuEspaces(ENTREES);
    expect(c.outils.phrase).toMatch(/^2 outils/);
    expect(c.outils.puces).toEqual(["Chercher un fait", "L'état de sa mémoire"]);
    expect(c.formes.phrase).toContain("parmi 3");
    expect(c.formes.puces).toEqual(["carte", "courbe", "liste"]);
  });

  it("chaque lien mène à une page qui existe", () => {
    const c = contenuEspaces({ ...ENTREES, aJuger: { total: 1, titre: "1 à juger" }, budget: { depense: { chat: 0, apprentissage: 0 }, plafonds: { chat: 1, apprentissage: 2 } } });
    const liens = Object.values(c).flatMap((x) => x.liens ?? []);
    expect(liens.length).toBeGreaterThanOrEqual(4);
    for (const l of liens) expect(() => readFileSync(`app${l.href}/page.tsx`), l.href).not.toThrow();
  });
});

describe("le décor", () => {
  /** Un faux contexte qui compte les traits et retient chaque opacité employée. */
  function pinceau() {
    const alphas: number[] = [];
    const traits = { n: 0, arcs: 0, epais: [] as number[] };
    const degrade = { addColorStop: () => undefined };
    const c: Pinceau = {
      clearRect: () => undefined,
      createRadialGradient: () => degrade as unknown as CanvasGradient,
      fillRect: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => {
        traits.n++;
        traits.epais.push(c.lineWidth);
      },
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      scale: () => undefined,
      arc: () => {
        traits.arcs++;
      },
      fill: () => undefined,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      set globalAlpha(v: number) {
        alphas.push(v);
      },
      get globalAlpha() {
        return alphas.at(-1) ?? 1;
      },
    };
    return { c, alphas, traits };
  }

  it("peint le sol, les vingt-quatre heures et la poussière, sans jamais une opacité hors de [0, 1]", () => {
    const { c, alphas, traits } = pinceau();
    peindreDecor(c, 1400, 900, orbite(1400, 900), 3, "a", "t", new Date(2026, 9, 23, 14, 10));
    // 14 lignes d'horizon + 29 fuyantes + l'anneau du tapis + 24 graduations.
    expect(traits.n).toBe(14 + 29 + 1 + 24);
    // Une seule graduation épaisse : l'heure courante.
    expect(traits.epais.filter((e) => e === 3)).toHaveLength(1);
    expect(traits.arcs).toBeGreaterThanOrEqual(60);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(alphas.at(-1)).toBe(1);
  });

  it("l'heure allumée est la bonne, y compris à minuit et en fin de journée", () => {
    expect(heureAllumee(14, 14.2)).toBe(true);
    expect(heureAllumee(15, 14.2)).toBe(false);
    expect(heureAllumee(0, 23.8)).toBe(true);
    expect(heureAllumee(23, 0.1)).toBe(false);
    expect(heureAllumee(23, 23.4)).toBe(true);
  });
});
