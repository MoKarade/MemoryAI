"use client";
// components/Graphe3D.tsx — un graphe en 3D sur un canvas 2D, sans bibliothèque (page Mémoire et
// réseau de LIA, MemoryAI#74 ; moteur de la maquette v5 validée par Marc le 22/10/2026).
//
// Le calcul vit dans `lib/graphe3d/` (pur, testé : placement, caméra, scène, gestes) ; ce
// composant lit les jetons, appelle `composerScene` puis `peindreScene`, et branche les gestes.
// - Tourner : glisser. Zoomer : molette ou pincer. Choisir : toucher un nœud. Clavier : flèches,
//   + et -, Échap pour désélectionner.
// - ⚠️ AUCUNE COULEUR ÉCRITE ICI : chaque nœud nomme un JETON de `globals.css` (`--repere`…),
//   lu au montage. La transparence passe par `globalAlpha`, jamais par une couleur composée.
// - ⚠️ `prefers-reduced-motion` : ni rotation automatique, ni impulsions, ni bascule animée ;
//   l'image ne se redessine qu'après un geste. Hors de l'écran, la boucle s'arrête.

import { useEffect, useRef } from "react";
import { ordreDuPeintre, projeter, trouver, type Camera, type Projete } from "@/lib/graphe3d/camera";
import type { Arete, Point3 } from "@/lib/graphe3d/disposer";
import { peindreScene, type Palette } from "@/lib/graphe3d/peindre";
import { avancer, avancerImpulsions, composerScene, glisser, toucheClavier, viser, voisinage, zoomer, type Impulsion, type Mouvement } from "@/lib/graphe3d/scene";

interface Noeud3D {
  pos: Point3;
  /** Le jeton de couleur, par exemple `--repere`. */
  jeton: string;
  rayon?: number;
  etiquette?: string;
  /** Un centre (un domaine, une source) : cerclé, étiquette toujours visible. */
  centre?: boolean;
}

export interface Graphe3DProps {
  noeuds: readonly Noeud3D[];
  aretes: readonly Arete[];
  /** Un booléen par nœud ; absent = tout visible. */
  visibles?: readonly boolean[];
  /** Ce que lit un lecteur d'écran : le graphe dit en une phrase. */
  description: string;
  impulsions?: number;
  selection?: number;
  onSelection?: (i: number) => void;
  hauteur?: number;
}

export function Graphe3D({ noeuds, aretes, visibles, description, impulsions = 0, selection = -1, onSelection, hauteur = 420 }: Graphe3DProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const etat = useRef({ selection, onSelection, relancer: () => {} });

  // La sélection vient du parent : la garder à jour sans refaire le graphe, et redessiner
  // (sans animation, l'image ne bouge qu'à la demande).
  useEffect(() => {
    etat.current.selection = selection;
    etat.current.onSelection = onSelection;
    etat.current.relancer();
  }, [selection, onSelection]);

  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(cv);
    const jeton = (nom: string) => style.getPropertyValue(nom).trim();
    const doux = jeton("--texte-doux");
    const palette: Palette = { texte: jeton("--texte"), doux, fond: jeton("--fond"), lien: jeton("--accent"), noeuds: noeuds.map((n) => jeton(n.jeton) || doux) };
    const points = noeuds.map((n) => n.pos);
    const rayons = noeuds.map((n) => n.rayon ?? 3);
    const centres = noeuds.map((n) => n.centre === true);
    const etiquettes = noeuds.map((n) => n.etiquette);
    const etiquetes = etiquettes.map(Boolean);
    const voisins = voisinage(noeuds.length, aretes);
    const vu = (i: number) => !visibles || visibles[i] !== false;

    const cam: Camera = { lacet: 0.6, tangage: 0.25, zoom: 1 };
    const mvt: Mouvement = { bascule: null, vLacet: 0, vTangage: 0 };
    let survol = -1;
    let L = 300;
    let H = hauteur;
    let proj: Projete[] = [];
    let actif = true;
    let dansLEcran = true;
    let sale = true;
    let dernier = performance.now();
    let glisse: { x: number; y: number } | null = null;
    const train: Impulsion[] = Array.from({ length: reduit ? 0 : impulsions }, () => ({ k: 0, u: Math.random(), v: 0.25 + Math.random() * 0.5 }));

    const mesurer = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      L = Math.max(200, r.width);
      H = Math.max(160, r.height);
      const w = Math.round(L * dpr);
      const h = Math.round(H * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const peindre = (maintenant: number) => {
      const dt = Math.min(0.06, (maintenant - dernier) / 1000);
      dernier = maintenant;
      const sel = etat.current.selection;
      if (avancer(cam, mvt, { maintenant, dt, tenu: glisse !== null, calme: sel < 0 && survol < 0, reduit })) sale = true;
      if (train.length) sale = true;
      if (!sale) return;
      sale = false;
      mesurer();
      g.clearRect(0, 0, L, H);
      proj = projeter(points, cam, L, H);
      const scene = composerScene({ proj, ordre: ordreDuPeintre(proj), aretes, rayons, centres, etiquetes, voisins, vu, selection: sel, survol });

      if (train.length && aretes.length) avancerImpulsions(train, dt, aretes.length, Math.random);
      peindreScene(g, { scene, proj, palette, centres, rayons, etiquettes, aretes, impulsions: aretes.length ? train : [], vu });
    };

    const boucle = (t: number) => {
      if (!actif) return;
      peindre(t);
      if (dansLEcran && !reduit) requestAnimationFrame(boucle);
    };
    const relancer = () => {
      sale = true;
      if (reduit || !dansLEcran) requestAnimationFrame((t) => actif && peindre(t));
    };
    etat.current.relancer = relancer;

    const pointeurs = new Map<number, [number, number]>();
    let pince = 0;
    let bouge = false;
    const local = (e: PointerEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const choisir = (i: number) => {
      etat.current.onSelection?.(i);
      const p = points[i];
      if (i >= 0 && p) {
        const cible = viser(p, cam.lacet);
        if (reduit) {
          cam.lacet = cible.lacet;
          cam.tangage = cible.tangage;
        } else mvt.bascule = { t0: performance.now(), de: cam.lacet, vers: cible.lacet, tDe: cam.tangage, tVers: cible.tangage };
      }
      relancer();
    };
    const bas = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, local(e));
      bouge = false;
      mvt.bascule = null;
      if (pointeurs.size === 1) {
        glisse = { x: e.clientX, y: e.clientY };
        mvt.vLacet = mvt.vTangage = 0;
      } else if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()] as [[number, number], [number, number]];
        pince = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    };
    const deplace = (e: PointerEvent) => {
      const [mx, my] = local(e);
      if (!pointeurs.has(e.pointerId)) {
        const h = trouver(proj, rayons, mx, my, vu);
        if (h !== survol) {
          survol = h;
          cv.style.cursor = h >= 0 ? "pointer" : "grab";
          relancer();
        }
        return;
      }
      pointeurs.set(e.pointerId, [mx, my]);
      if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()] as [[number, number], [number, number]];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pince) zoomer(cam, d / pince);
        pince = d;
        bouge = true;
        relancer();
        return;
      }
      if (!glisse) return;
      const dx = e.clientX - glisse.x;
      const dy = e.clientY - glisse.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) bouge = true;
      glisse = { x: e.clientX, y: e.clientY };
      glisser(cam, mvt, dx, dy, reduit);
      relancer();
    };
    const haut = (e: PointerEvent) => {
      const etait = pointeurs.delete(e.pointerId);
      if (pointeurs.size < 2) pince = 0;
      if (!etait) return;
      if (!bouge && pointeurs.size === 0) {
        const [mx, my] = local(e);
        choisir(trouver(proj, rayons, mx, my, vu));
      }
      if (pointeurs.size === 0) glisse = null;
    };
    const molette = (e: WheelEvent) => {
      e.preventDefault();
      zoomer(cam, e.deltaY < 0 ? 1.1 : 0.91);
      relancer();
    };
    const touche = (e: KeyboardEvent) => {
      const effet = toucheClavier(cam, e.key);
      if (effet === "rien") return;
      if (effet === "deselectionne") etat.current.onSelection?.(-1);
      e.preventDefault();
      relancer();
    };
    const quitte = () => {
      if (survol >= 0) {
        survol = -1;
        relancer();
      }
    };

    cv.addEventListener("pointerdown", bas);
    cv.addEventListener("pointermove", deplace);
    cv.addEventListener("pointerup", haut);
    cv.addEventListener("pointercancel", haut);
    cv.addEventListener("pointerleave", quitte);
    cv.addEventListener("wheel", molette, { passive: false });
    cv.addEventListener("keydown", touche);
    const taille = new ResizeObserver(relancer);
    taille.observe(cv);
    const vue = new IntersectionObserver(([entree]) => {
      const avant = dansLEcran;
      dansLEcran = entree?.isIntersecting ?? true;
      if (dansLEcran && !avant && !reduit) requestAnimationFrame(boucle);
    });
    vue.observe(cv);
    requestAnimationFrame(boucle);
    if (reduit) relancer();

    return () => {
      actif = false;
      taille.disconnect();
      vue.disconnect();
      cv.removeEventListener("pointerdown", bas);
      cv.removeEventListener("pointermove", deplace);
      cv.removeEventListener("pointerup", haut);
      cv.removeEventListener("pointercancel", haut);
      cv.removeEventListener("pointerleave", quitte);
      cv.removeEventListener("wheel", molette);
      cv.removeEventListener("keydown", touche);
    };
  }, [noeuds, aretes, visibles, impulsions, hauteur]);

  return <canvas ref={ref} className="graphe3d" style={{ height: hauteur }} tabIndex={0} role="img" aria-label={description} />;
}
