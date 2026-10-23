"use client";
// app/AccueilClient.tsx — la maison de LIA, comme la maquette v5 : un sol en perspective, un tapis
// rond qui marque l'heure, LIA au centre et ses huit espaces en orbite. Un espace s'ouvre en
// panneau (à droite sur PC, en feuille sur téléphone). Tout ce qui est montré arrive calculé du
// serveur (`contenuEspaces`) ; ici on ne fait que placer et dessiner.
//
// ⚠️ Elle ne bouge jamais l'écran de Marc : l'orbite tourne seule, mais s'arrête au survol d'un
// espace, quand un panneau est ouvert, et tout à fait si le mouvement est réduit.
// ⚠️ Couleurs : toutes empruntées aux jetons de `globals.css` (le dessin du sol les lit au montage).

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lia } from "@mokarade/lia-ui/react";
import { LIBELLE_HUMEUR, type HumeurLia } from "@mokarade/lia-ui";
import { IconeEspace } from "@/components/IconeEspace";
import { LogoMemoire } from "@/components/LogoMemoire";
import { MenuLia } from "@/components/MenuLia";
import { OPTIONS_LIA_MAISON } from "@/components/LiaMaison";
import { SECTIONS } from "@/components/Nav";
import { PanneauEspace } from "@/components/PanneauEspace";
import { ESPACES, type ContenuEspace, type IdEspace } from "@/lib/accueil/espaces";
import { peindreDecor } from "@/lib/accueil/decor";
import { orbite, placerEspaces, VITESSE_ORBITE, zoneDeVie } from "@/lib/accueil/orbite";

export function AccueilClient({ contenus, aJuger }: { contenus: Record<IdEspace, ContenuEspace>; aJuger: { titre: string; detail: string } | null }) {
  const [monde, setMonde] = useState<HTMLDivElement | null>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const satellites = useRef<(HTMLButtonElement | null)[]>([]);
  const anneau = useRef<HTMLDivElement>(null);
  const [ouvert, setOuvert] = useState<IdEspace | null>(null);
  const [humeur, setHumeur] = useState<HumeurLia>("curieux");
  const retour = useRef<HTMLElement | null>(null);
  const fige = useRef(false);
  // La boucle et la zone de LIA lisent l'espace ouvert sans redémarrer à chaque ouverture.
  const ouvertRef = useRef<IdEspace | null>(null);
  useEffect(() => {
    ouvertRef.current = ouvert;
  }, [ouvert]);
  const [rayon] = useState(() => (typeof window === "undefined" ? 56 : orbite(window.innerWidth, window.innerHeight).rayon));

  // Une seule boucle : mesurer, tourner l'orbite, placer les espaces, peindre le sol.
  useEffect(() => {
    const cv = toile.current;
    const c = cv?.getContext("2d");
    if (!monde || !cv || !c) return;
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(monde);
    const accent = style.getPropertyValue("--accent").trim();
    const texte = style.getPropertyValue("--texte").trim();
    let rotation = 0;
    let t = 0;
    let dernier = performance.now();
    let raf = 0;
    const image = (maintenant: number) => {
      const dt = Math.min(0.05, (maintenant - dernier) / 1000);
      dernier = maintenant;
      t += dt;
      const r = monde.getBoundingClientRect();
      const o = orbite(r.width, r.height);
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!reduit && !fige.current && ouvertRef.current === null) rotation += dt * VITESSE_ORBITE;
      placerEspaces(ESPACES.length, rotation, o).forEach((p, i) => {
        const s = satellites.current[i];
        if (s) s.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      });
      const a = anneau.current;
      if (a) Object.assign(a.style, { left: `${o.cx}px`, top: `${o.cy}px`, width: `${o.rx * 2}px`, height: `${o.ry * 2}px` });
      peindreDecor(c, r.width, r.height, o, reduit ? 0 : t, accent, texte);
      if (!reduit) raf = requestAnimationFrame(image);
    };
    raf = requestAnimationFrame(image);
    const redessiner = () => {
      if (reduit) requestAnimationFrame(image);
    };
    addEventListener("resize", redessiner);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", redessiner);
    };
  }, [monde]);

  const fermer = useCallback(() => {
    setOuvert(null);
    retour.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!ouvert) return;
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
    };
    addEventListener("keydown", echap);
    return () => removeEventListener("keydown", echap);
  }, [ouvert, fermer]);

  const ouvrir = (id: IdEspace, depuis: HTMLElement) => {
    if (!ouvert) retour.current = depuis;
    setOuvert(id);
  };

  const espace = ESPACES.find((e) => e.id === ouvert);
  const contenu = ouvert ? contenus[ouvert] : null;

  return (
    <div className={`maison${ouvert ? " maison--ouverte" : ""}`} ref={setMonde}>
      <canvas className="maison-sol" ref={toile} aria-hidden="true" />
      <div className="maison-orbite" ref={anneau} aria-hidden="true" />

      <header className="maison-tete">
        <MenuLia entrees={SECTIONS} allumee="parler" />
        <LogoMemoire />
        <h1 className="maison-nom">LIA</h1>
        <span className="maison-pastille" aria-label={`Humeur : ${LIBELLE_HUMEUR[humeur]}`}>
          <i aria-hidden="true" />
          {LIBELLE_HUMEUR[humeur]}
        </span>
        {aJuger && (
          <Link href="/questions" className="pastille-juger" aria-label={`${aJuger.titre} : ${aJuger.detail}`}>
            <span className="pastille-point" aria-hidden="true" />
            {aJuger.titre}
          </Link>
        )}
      </header>
      <nav className="maison-droite" aria-label="Raccourcis">
        <Link href="/chat" className="maison-bouton" aria-label="Parler à LIA (conversation complète)">
          <IconeEspace nom="chat" taille={18} />
          <span className="maison-bouton-texte">Parler</span>
        </Link>
        <Link href="/memoire" className="maison-bouton" aria-label="Ouvrir toute la mémoire">
          <IconeEspace nom="db" taille={18} />
          <span className="maison-bouton-texte">Mémoire</span>
        </Link>
      </nav>

      {ESPACES.map((e, i) => (
        <button
          key={e.id}
          ref={(b) => {
            satellites.current[i] = b;
          }}
          type="button"
          className={`maison-espace teinte-${e.teinte}`}
          aria-label={contenus[e.id].pastille ? `${e.libelle}, ${contenus[e.id].pastille} en attente` : e.libelle}
          aria-expanded={ouvert === e.id}
          onClick={(ev) => ouvrir(e.id, ev.currentTarget)}
          onPointerEnter={() => (fige.current = true)}
          onPointerLeave={() => (fige.current = false)}
          onFocus={() => (fige.current = true)}
          onBlur={() => (fige.current = false)}
        >
          <span className="maison-rond">
            <IconeEspace nom={e.icone} taille={24} />
            {contenus[e.id].pastille ? <i className="maison-compte">{contenus[e.id].pastille}</i> : null}
          </span>
          <span className="maison-etiquette">{e.libelle}</span>
        </button>
      ))}

      <p className="maison-aide">Touche LIA pour lui parler. Clic droit : ses actions.</p>

      <PanneauEspace espace={espace ?? null} contenu={contenu} choisir={setOuvert} fermer={fermer} />

      {monde ? (
        <Lia
          {...OPTIONS_LIA_MAISON}
          container={monde}
          cle="lia-accueil"
          rayon={rayon}
          bounds={() => {
            const r = monde.getBoundingClientRect();
            return zoneDeVie(orbite(r.width, r.height), ouvertRef.current !== null);
          }}
          onHumeur={setHumeur}
        />
      ) : null}
    </div>
  );
}
