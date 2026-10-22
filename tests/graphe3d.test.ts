// tests/graphe3d.test.ts — le moteur 3D de la page Mémoire (MemoryAI#74) : placement et caméra.
import { describe, expect, it } from "vitest";
import { ancresSphere, disposer, generateur, MAX_NOEUDS_3D, type NoeudADisposer } from "@/lib/graphe3d/disposer";
import { lacetVers, ordreDuPeintre, projeter, trouver, type Camera } from "@/lib/graphe3d/camera";

const noeuds = (n: number, groupes = 3): NoeudADisposer[] => Array.from({ length: n }, (_, i) => ({ groupe: i % groupes }));

describe("le placement", () => {
  it("est le même à chaque appel : même graine, même nuage", () => {
    const aretes = [[0, 1], [1, 2], [3, 4]] as const;
    const a = disposer(noeuds(12), aretes, { ancres: ancresSphere(3) });
    const b = disposer(noeuds(12), aretes, { ancres: ancresSphere(3) });
    expect(a).toEqual(b);
    expect(disposer(noeuds(12), aretes, { graine: 8 })).not.toEqual(disposer(noeuds(12), aretes, { graine: 7 }));
  });

  it("garde un nœud fixe à sa place, et ne rend aucune coordonnée infinie", () => {
    const n: NoeudADisposer[] = [{ groupe: 0, fixe: { x: 0, y: 0, z: 0 } }, ...noeuds(20)];
    const p = disposer(n, [[0, 1], [0, 2]]);
    expect(p[0]).toEqual({ x: 0, y: 0, z: 0 });
    for (const q of p) for (const v of [q.x, q.y, q.z]) expect(Number.isFinite(v)).toBe(true);
  });

  it("rapproche les nœuds d'un même groupe de leur ancre", () => {
    const ancres = ancresSphere(2, 0.8);
    const p = disposer(noeuds(30, 2), [], { ancres });
    const distance = (i: number, k: number) => Math.hypot(p[i]!.x - ancres[k]!.x, p[i]!.y - ancres[k]!.y, p[i]!.z - ancres[k]!.z);
    const proches = p.filter((_, i) => distance(i, i % 2) < distance(i, (i + 1) % 2)).length;
    expect(proches).toBeGreaterThan(24);
  });

  it("le générateur est reproductible et reste dans [0, 1)", () => {
    const a = generateur(42);
    const b = generateur(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("borne le dessin à quelques centaines de nœuds : au-delà, le canevas rame sur un téléphone", () => {
    expect(MAX_NOEUDS_3D).toBeGreaterThanOrEqual(100);
    expect(MAX_NOEUDS_3D).toBeLessThanOrEqual(600);
  });

  it("les ancres sont sur la sphère, une seule ancre est au centre", () => {
    for (const a of ancresSphere(9, 0.6)) expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(0.6, 5);
    expect(ancresSphere(1)).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(ancresSphere(0)).toEqual([]);
  });
});

describe("la caméra", () => {
  const cam: Camera = { lacet: 0, tangage: 0, zoom: 1 };

  it("met l'origine au centre du cadre, et ce qui est devant plus grand", () => {
    const [o, devant, derriere] = projeter([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.5 }, { x: 0, y: 0, z: -0.5 }], cam, 400, 300);
    expect(o).toMatchObject({ x: 200, y: 150, echelle: 1 });
    expect(devant!.echelle).toBeGreaterThan(1);
    expect(derriere!.echelle).toBeLessThan(1);
  });

  it("peint du fond vers l'avant", () => {
    const p = projeter([{ x: 0, y: 0, z: 0.5 }, { x: 0, y: 0, z: -0.5 }, { x: 0, y: 0, z: 0 }], cam, 400, 300);
    expect(ordreDuPeintre(p)).toEqual([1, 2, 0]);
  });

  it("trouve le nœud sous le doigt, avec une zone d'au moins 9 px, et ignore les masqués", () => {
    const p = projeter([{ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }], cam, 400, 300);
    expect(trouver(p, [1, 1], 205, 150)).toBe(0);
    expect(trouver(p, [1, 1], 260, 40)).toBe(-1);
    expect(trouver(p, [1, 1], 205, 150, (i) => i !== 0)).toBe(-1);
  });

  it("tourne vers un point par le plus court chemin", () => {
    const vers = lacetVers({ x: 1, y: 0, z: 0 }, 0);
    expect(Math.abs(vers)).toBeLessThanOrEqual(Math.PI);
    const tourne = projeter([{ x: 1, y: 0, z: 0 }], { ...cam, lacet: vers }, 400, 300)[0]!;
    expect(tourne.x).toBeCloseTo(200, 5);
    expect(lacetVers({ x: 1, y: 0, z: 0 }, 10 * Math.PI) - 10 * Math.PI).toBeLessThanOrEqual(Math.PI);
  });
});
