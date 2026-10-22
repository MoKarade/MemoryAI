// tests/graphe3dPeindre.test.ts — la peinture du graphe 3D sur un pinceau qui enregistre
// (MemoryAI#74) : pas de navigateur, on lit les gestes.
import { describe, expect, it } from "vitest";
import type { Projete } from "@/lib/graphe3d/camera";
import { peindreScene, type Palette, type Pinceau } from "@/lib/graphe3d/peindre";
import type { Scene } from "@/lib/graphe3d/scene";

/** Un pinceau qui note chaque tracé avec l'état (couleur, opacité) au moment du tracé. */
function enregistreur() {
  const gestes: string[] = [];
  const g = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "start",
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: (x: number, y: number, r: number) => gestes.push(`arc ${x},${y} r${+r.toFixed(2)}`),
    stroke: () => gestes.push(`trait ${g.strokeStyle} a${+g.globalAlpha.toFixed(3)} l${g.lineWidth}`),
    fill: () => gestes.push(`plein ${g.fillStyle} a${+g.globalAlpha.toFixed(3)}`),
    roundRect: () => gestes.push("pilule"),
    measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
    fillText: (t: string) => gestes.push(`texte « ${t} » ${g.fillStyle}`),
  };
  return { g: g as unknown as Pinceau & { globalAlpha: number }, gestes };
}

const p = (x: number, y: number): Projete => ({ x, y, z: 0, echelle: 1 });
const palette: Palette = { texte: "T", doux: "D", fond: "F", lien: "L", noeuds: ["C0", "C1"] };

describe("peindreScene", () => {
  it("peint traits, centre en anneau, point choisi cerclé, étiquettes en pilule, puis rend l'opacité", () => {
    const scene: Scene = {
      traits: [{ a: 0, b: 1, alpha: 0.85, touche: true }],
      points: [
        { i: 0, alpha: 0.8, rayon: 7, cercle: false },
        { i: 1, alpha: 0.95, rayon: 3, cercle: true },
      ],
      etiquettes: [[0, "centre"], [1, "voisin"]],
    };
    const { g, gestes } = enregistreur();
    peindreScene(g, { scene, proj: [p(0, 0), p(10, 0)], palette, centres: [true, false], rayons: [7, 3], etiquettes: ["emploi", "poste"], aretes: [[0, 1]], impulsions: [], vu: () => true });
    expect(gestes).toEqual([
      "trait L a0.85 l1.6",
      "arc 0,0 r7",
      "plein C0 a0.2",
      "trait C0 a0.8 l1.6",
      "arc 10,0 r3",
      "plein C1 a0.95",
      "arc 10,0 r7",
      "trait T a0.9 l1.6",
      "pilule",
      "plein F a0.82",
      "texte « emploi » T",
      "pilule",
      "plein F a0.82",
      "texte « poste » D",
    ]);
    expect(g.globalAlpha).toBe(1);
  });

  it("fait courir les impulsions sur les liens visibles, et saute ce qui manque", () => {
    const scene: Scene = { traits: [{ a: 0, b: 5, alpha: 0.5, touche: false }], points: [{ i: 7, alpha: 1, rayon: 2, cercle: false }], etiquettes: [[1, "vise"], [9, "vise"]] };
    const { g, gestes } = enregistreur();
    peindreScene(g, {
      scene,
      proj: [p(0, 0), p(10, 0), p(0, 10)],
      palette,
      centres: [],
      rayons: [],
      etiquettes: [undefined, undefined],
      aretes: [[0, 1], [0, 2]],
      impulsions: [{ k: 0, u: 0.5, v: 1 }, { k: 1, u: 0.5, v: 1 }, { k: 9, u: 0.5, v: 1 }],
      vu: (i) => i !== 2,
    });
    // 1re : à mi-chemin de 0-1. 2e : son bout 2 est masqué. 3e : arête inconnue, repli sur 0-0.
    // Le trait vers un nœud non projeté, le point 7 et les étiquettes sans texte ne peignent rien.
    expect(gestes).toEqual(["arc 5,0 r1.6", "plein T a0.85", "arc 0,0 r1.6", "plein T a0.85"]);
  });
});
