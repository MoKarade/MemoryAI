// tests/graphe3dScene.test.ts — ce que le graphe 3D dessine et comment la caméra bouge
// (MemoryAI#74). Pur : aucune toile, aucun navigateur.
import { describe, expect, it } from "vitest";
import { TANGAGE_MAX, ZOOM_MAX, ZOOM_MIN, type Camera, type Projete } from "@/lib/graphe3d/camera";
import {
  adoucir,
  avancer,
  avancerImpulsions,
  composerScene,
  DUREE_BASCULE,
  glisser,
  MAX_ETIQUETTES_VOISINS,
  toucheClavier,
  viser,
  voisinage,
  zoomer,
  type EntreeScene,
  type Mouvement,
} from "@/lib/graphe3d/scene";

const p = (x: number, y: number, z = 0, echelle = 1): Projete => ({ x, y, z, echelle });

/** Trois nœuds : un centre (0) relié à deux faits (1, 2). */
function entree(o: Partial<EntreeScene> = {}): EntreeScene {
  const aretes = [[0, 1, 1], [0, 2, 0.4]] as const;
  return {
    proj: [p(100, 100, 0.5), p(150, 100, 0), p(50, 100, -0.5)],
    ordre: [2, 1, 0],
    aretes,
    rayons: [7, 3, 3],
    centres: [true, false, false],
    etiquetes: [true, true, true],
    voisins: voisinage(3, aretes),
    vu: () => true,
    selection: -1,
    survol: -1,
    ...o,
  };
}

describe("composerScene", () => {
  it("sans choix : tous les traits et points, étiquette du centre seulement, dans l'ordre du peintre", () => {
    const s = composerScene(entree());
    expect(s.traits.map((t) => [t.a, t.b])).toEqual([[0, 1], [0, 2]]);
    expect(s.traits.every((t) => !t.touche && t.alpha > 0 && t.alpha < 0.25)).toBe(true);
    // Un lien plus fort est plus visible.
    expect(s.traits[0]!.alpha).toBeGreaterThan(s.traits[1]!.alpha);
    expect(s.points.map((x) => x.i)).toEqual([2, 1, 0]);
    expect(s.points.find((x) => x.i === 0)!.rayon).toBe(7);
    expect(s.points.some((x) => x.cercle)).toBe(false);
    expect(s.etiquettes).toEqual([[0, "centre"]]);
  });

  it("un point choisi allume ses voisins, éteint le reste et cercle le choisi", () => {
    const aretes = [[0, 1], [0, 2], [3, 2]] as const;
    const s = composerScene(
      entree({
        proj: [p(0, 0), p(1, 0), p(2, 0), p(3, 0)],
        ordre: [0, 1, 2, 3],
        aretes,
        rayons: [7, 3, 3, 3],
        centres: [true, false, false, false],
        etiquetes: [true, true, true, true],
        voisins: voisinage(4, aretes),
        selection: 1,
      }),
    );
    const alpha = (i: number) => s.points.find((x) => x.i === i)!.alpha;
    expect(alpha(1)).toBeGreaterThanOrEqual(0.95);
    expect(alpha(0)).toBeGreaterThanOrEqual(0.95);
    expect(alpha(3)).toBeLessThan(0.2);
    expect(s.points.find((x) => x.i === 1)!.cercle).toBe(true);
    expect(s.traits.find((t) => t.a === 0 && t.b === 1)).toMatchObject({ touche: true, alpha: 0.85 });
    // Le trait 0-2 ne touche pas le choisi : atténué, et le trait 3-2, trop pâle, n'est pas tracé.
    expect(s.traits.find((t) => t.a === 0 && t.b === 2)!.alpha).toBeLessThan(0.05);
    // Le centre voisin garde son style de centre, une seule étiquette par nœud, le choisi en dernier.
    expect(s.etiquettes).toEqual([[0, "centre"], [1, "vise"]]);
  });

  it("masque ce que les filtres cachent, et étiquette le point survolé", () => {
    const s = composerScene(entree({ vu: (i) => i !== 2, survol: 1 }));
    expect(s.traits.map((t) => [t.a, t.b])).toEqual([[0, 1]]);
    expect(s.points.map((x) => x.i)).toEqual([1, 0]);
    expect(s.points.find((x) => x.i === 1)!.cercle).toBe(true);
    expect(s.etiquettes).toEqual([[0, "centre"], [1, "vise"]]);
  });

  it("borne les étiquettes de voisins et ignore un centre sans étiquette ou une projection absente", () => {
    const n = MAX_ETIQUETTES_VOISINS + 10;
    const aretes = Array.from({ length: n - 1 }, (_, k) => [0, k + 1] as const);
    const s = composerScene(
      entree({
        proj: Array.from({ length: n }, (_, k) => p(k, 0)),
        ordre: Array.from({ length: n }, (_, k) => k),
        aretes,
        rayons: [],
        centres: Array.from({ length: n }, (_, k) => k === 0),
        etiquetes: Array.from({ length: n }, (_, k) => k !== 0),
        voisins: voisinage(n, aretes),
        selection: 0,
      }),
    );
    expect(s.etiquettes.filter(([, sorte]) => sorte === "voisin").length).toBeLessThanOrEqual(MAX_ETIQUETTES_VOISINS);
    expect(s.etiquettes.some(([, sorte]) => sorte === "centre")).toBe(false);
    expect(s.points[0]!.rayon).toBe(3);
    expect(composerScene(entree({ proj: [p(0, 0)] })).traits).toEqual([]);
  });
});

describe("la caméra en mouvement", () => {
  const cam = (): Camera => ({ lacet: 0, tangage: 0, zoom: 1 });
  const mvt = (o: Partial<Mouvement> = {}): Mouvement => ({ bascule: null, vLacet: 0, vTangage: 0, ...o });
  const base = { maintenant: 0, dt: 0.016, tenu: false, calme: true, reduit: false };

  it("adoucir part de 0, passe par 0,5 au milieu et arrive à 1", () => {
    expect(adoucir(0)).toBe(0);
    expect(adoucir(0.5)).toBeCloseTo(0.5, 10);
    expect(adoucir(1)).toBe(1);
    expect(adoucir(0.25)).toBeLessThan(0.25);
  });

  it("une bascule amène la caméra au but puis s'efface", () => {
    const c = cam();
    const m = mvt({ bascule: { t0: 0, de: 0, vers: 1, tDe: 0, tVers: 0.5 } });
    expect(avancer(c, m, { ...base, maintenant: DUREE_BASCULE / 2 })).toBe(true);
    expect(c.lacet).toBeCloseTo(0.5, 5);
    expect(m.bascule).not.toBeNull();
    avancer(c, m, { ...base, maintenant: DUREE_BASCULE * 2 });
    expect(c).toMatchObject({ lacet: 1, tangage: 0.5 });
    expect(m.bascule).toBeNull();
  });

  it("l'élan d'un glissé décroît, la rotation lente ne tourne qu'au calme et sans mouvement réduit", () => {
    const c = cam();
    const m = mvt({ vLacet: 0.1, vTangage: 0.1 });
    expect(avancer(c, m, base)).toBe(true);
    expect(c.lacet).toBeCloseTo(0.1, 10);
    expect(m.vLacet).toBeCloseTo(0.093, 10);
    // Tenu : ni élan ni rotation.
    const c2 = cam();
    expect(avancer(c2, mvt(), { ...base, tenu: true })).toBe(false);
    expect(avancer(c2, mvt(), { ...base, calme: false })).toBe(false);
    expect(avancer(c2, mvt(), { ...base, reduit: true })).toBe(false);
    expect(avancer(c2, mvt(), base)).toBe(true);
    expect(c2.lacet).toBeGreaterThan(0);
  });

  it("glisser tourne, borne l'inclinaison, et ne garde aucun élan en mouvement réduit", () => {
    const c = cam();
    const m = mvt();
    glisser(c, m, 100, 10_000, false);
    expect(c.lacet).toBeCloseTo(0.8, 10);
    expect(c.tangage).toBe(TANGAGE_MAX);
    expect(m.vLacet).toBeGreaterThan(0);
    glisser(c, m, 100, 0, true);
    expect(m).toMatchObject({ vLacet: 0, vTangage: 0 });
  });

  it("zoomer reste dans ses bornes", () => {
    const c = cam();
    zoomer(c, 100);
    expect(c.zoom).toBe(ZOOM_MAX);
    zoomer(c, 0.0001);
    expect(c.zoom).toBe(ZOOM_MIN);
  });

  it("le clavier tourne, zoome, désélectionne, et laisse passer les autres touches", () => {
    const c = cam();
    expect(toucheClavier(c, "ArrowRight")).toBe("tourne");
    expect(c.lacet).toBeCloseTo(0.12, 10);
    toucheClavier(c, "ArrowLeft");
    expect(c.lacet).toBeCloseTo(0, 10);
    toucheClavier(c, "ArrowDown");
    expect(c.tangage).toBeCloseTo(0.1, 10);
    toucheClavier(c, "ArrowUp");
    expect(c.tangage).toBeCloseTo(0, 10);
    toucheClavier(c, "+");
    expect(c.zoom).toBeCloseTo(1.12, 10);
    toucheClavier(c, "-");
    expect(c.zoom).toBeCloseTo(1, 10);
    toucheClavier(c, "=");
    expect(c.zoom).toBeCloseTo(1.12, 10);
    expect(toucheClavier(c, "Escape")).toBe("deselectionne");
    expect(toucheClavier(c, "a")).toBe("rien");
  });

  it("viser met le point face à la caméra, inclinaison bornée", () => {
    const v = viser({ x: 1, y: 0, z: 0 }, 0);
    expect(Math.abs(v.lacet)).toBeLessThanOrEqual(Math.PI);
    expect(v.tangage).toBeCloseTo(0, 10);
    expect(viser({ x: 0, y: 5, z: 0.01 }, 0).tangage).toBeLessThanOrEqual(1.2);
  });

  it("les impulsions avancent et repartent d'une arête tirée au hasard", () => {
    const train = [{ k: 0, u: 0.5, v: 1 }, { k: 1, u: 0.95, v: 1 }];
    avancerImpulsions(train, 0.1, 10, () => 0.42);
    expect(train[0]).toMatchObject({ k: 0, u: 0.6 });
    expect(train[1]).toMatchObject({ k: 4, u: 0 });
  });
});
