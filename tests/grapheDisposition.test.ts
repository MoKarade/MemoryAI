// tests/grapheDisposition.test.ts — où les nœuds se posent, et ce que le dessin REFUSE.
//
// Ce que ces cas défendent :
//   1. la disposition est DÉTERMINISTE — deux appels donnent la même image, sinon Marc ne
//      peut pas dire deux fois « le nœud en haut à gauche » ;
//   2. un nœud sans lien n'est pas dessiné, et il est COMPTÉ ;
//   3. au-delà de la borne, ce sont les faits les plus CONNECTÉS qui restent ;
//   4. un trait dont une extrémité est hors du dessin n'est pas tracé à moitié ;
//   5. le résumé accessible dit la même chose que l'image.

import { describe, it, expect } from "vitest";
import { degres, disposer, MAX_NOEUDS, resume, type LienEntree, type NoeudEntree } from "../lib/grapheDisposition";

const noeud = (id: string, domaine = "emploi"): NoeudEntree => ({ id, domaine, etiquette: `${domaine}.x` });
const lien = (a: string, b: string, type = "meme-document", poids = 1): LienEntree => ({ faitA: a, faitB: b, type, poids });

describe("disposer", () => {
  it("est DÉTERMINISTE : deux appels donnent exactement la même image", () => {
    const ns = [noeud("c"), noeud("a"), noeud("b")];
    const ls = [lien("a", "b"), lien("b", "c")];
    expect(disposer(ns, ls)).toEqual(disposer(ns, ls));
    // Et l'ordre d'ENTRÉE ne change rien : le tri est total (degré, puis identifiant).
    expect(disposer([...ns].reverse(), ls).noeuds.map((n) => n.id)).toEqual(disposer(ns, ls).noeuds.map((n) => n.id));
  });

  it("ne dessine PAS un fait sans aucun lien, et le compte", () => {
    const d = disposer([noeud("a"), noeud("b"), noeud("seul")], [lien("a", "b")]);
    expect(d.noeuds.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(d.noeudsOmis).toBe(1);
  });

  it("au-delà de la borne, garde les faits les PLUS connectés", () => {
    // `centre` touche tout le monde ; les feuilles n'ont qu'un lien chacune.
    const ns = [noeud("centre"), ...Array.from({ length: 60 }, (_, i) => noeud(`f${String(i).padStart(2, "0")}`))];
    const ls = ns.slice(1).map((n) => lien("centre", n.id));
    const d = disposer(ns, ls, { max: 10 });
    expect(d.noeuds).toHaveLength(10);
    expect(d.noeuds.map((n) => n.id)).toContain("centre");
    expect(d.noeudsOmis).toBe(51);
  });

  // ⚠️ CE CAS EST NÉ D'UNE MUTATION QUI N'A PAS DISCRIMINÉ. Retirer le départage par
  // identifiant à degré égal laissait les dix autres cas verts : dans l'étoile ci-dessus,
  // l'ordre d'ENTRÉE des feuilles est déjà celui de leurs identifiants, et le tri de V8 est
  // STABLE — les deux règles donnent le même résultat. Il fallait un cas où les deux ordres
  // DIVERGENT, et où la coupe tombe entre deux nœuds de MÊME degré : c'est là, et là
  // seulement, que le départage décide qui est dessiné.
  it("à degré égal, c'est l'identifiant qui départage — pas l'ordre d'arrivée", () => {
    const ns = [noeud("centre"), noeud("zz"), noeud("mm"), noeud("aa")];
    const ls = [lien("centre", "zz"), lien("centre", "mm"), lien("centre", "aa")];
    const gardes = disposer(ns, ls, { max: 3 }).noeuds.map((n) => n.id).sort();
    expect(gardes).toEqual(["aa", "centre", "mm"]);
    // Et l'ordre d'arrivée ne change rien : « zz » reste dehors même s'il entre en premier.
    const inverse = disposer([noeud("zz"), noeud("mm"), noeud("aa"), noeud("centre")], ls, { max: 3 })
      .noeuds.map((n) => n.id)
      .sort();
    expect(inverse).toEqual(gardes);
  });

  it("un trait dont une extrémité est hors du dessin n'est pas tracé à moitié", () => {
    // Une question n'est pas un fait : elle n'a pas de nœud, et son lien ne se dessine pas.
    const d = disposer([noeud("a"), noeud("b")], [lien("a", "b"), lien("a", "q1", "cause-declaree")]);
    expect(d.traits).toHaveLength(1);
    expect(d.traitsOmis).toBe(1);
  });

  it("groupe par domaine sur le cercle, dans un ordre stable", () => {
    const d = disposer(
      [noeud("a", "emploi"), noeud("b", "logement"), noeud("c", "emploi")],
      [lien("a", "b"), lien("b", "c")],
    );
    expect(d.domaines).toEqual(["emploi", "logement"]);
    // Les deux faits d'`emploi` sont VOISINS sur le cercle : c'est ce qui rend lisibles les
    // liens qui TRAVERSENT deux domaines, ceux que `meme-periode` existe pour trouver.
    const ids = d.noeuds.map((n) => n.domaine);
    expect(ids).toEqual(["emploi", "emploi", "logement"]);
  });

  it("tous les nœuds tombent sur le cercle, à la distance annoncée", () => {
    const d = disposer([noeud("a"), noeud("b")], [lien("a", "b")], { taille: 600 });
    for (const n of d.noeuds) {
      const dx = n.x - 300;
      const dy = n.y - 300;
      expect(Math.hypot(dx, dy)).toBeCloseTo(d.rayon, 6);
    }
  });

  it("le chemin d'un trait part d'un nœud et arrive à l'autre", () => {
    const d = disposer([noeud("a"), noeud("b")], [lien("a", "b")]);
    const t = d.traits[0];
    const a = d.noeuds.find((n) => n.id === t?.faitA);
    const b = d.noeuds.find((n) => n.id === t?.faitB);
    expect(t?.d).toMatch(/^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
    expect(t?.x1).toBeCloseTo(a?.x ?? -1, 1);
    expect(t?.y2).toBeCloseTo(b?.y ?? -1, 1);
  });

  it("aucun fait ⇒ un dessin vide, jamais une erreur", () => {
    const d = disposer([], []);
    expect(d.noeuds).toEqual([]);
    expect(d.traits).toEqual([]);
    expect(resume(d)).toContain("rien à dessiner");
  });

  it("la borne par défaut est celle qui est publiée", () => {
    const ns = Array.from({ length: MAX_NOEUDS + 5 }, (_, i) => noeud(`f${String(i).padStart(2, "0")}`));
    const ls = ns.slice(1).map((n) => lien(ns[0]?.id ?? "", n.id));
    expect(disposer(ns, ls).noeuds).toHaveLength(MAX_NOEUDS);
  });
});

describe("degres", () => {
  it("compte les liens qui touchent chaque nœud, et ignore ceux qui pointent ailleurs", () => {
    const d = degres([noeud("a"), noeud("b")], [lien("a", "b"), lien("a", "inconnu")]);
    expect(d.get("a")).toBe(2);
    expect(d.get("b")).toBe(1);
    expect(d.has("inconnu")).toBe(false);
  });
});

describe("resume — ce que lit une synthèse vocale", () => {
  it("dit le nombre de faits, de traits, les domaines, et ce qui manque", () => {
    const d = disposer([noeud("a", "emploi"), noeud("b", "logement"), noeud("seul")], [lien("a", "b")]);
    const r = resume(d);
    expect(r).toContain("2 faits");
    expect(r).toContain("1 traits");
    expect(r).toContain("emploi (1)");
    // ⚠️ Ce que le dessin NE montre PAS doit être dans la phrase : une image qui tait ce
    // qu'elle omet se présente comme complète.
    expect(r).toContain("1 fait(s) sans lien");
  });
});
