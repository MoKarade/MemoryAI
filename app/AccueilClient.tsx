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
import type { LiaHandle } from "@mokarade/lia-ui";
import { Lia } from "@mokarade/lia-ui/react";
import { ConversationMaison } from "@/components/ConversationMaison";
import { IconeEspace } from "@/components/IconeEspace";
import { LogoMemoire } from "@/components/LogoMemoire";
import { etatLiaMaison, OPTIONS_LIA_MAISON } from "@/components/LiaMaison";
import { echouer, enAttente, poser, questionPrete, repondre, type Tour } from "@/lib/accueil/conversation";
import { PanneauEspace } from "@/components/PanneauEspace";
import { ESPACES, type ContenuEspace, type IdEspace } from "@/lib/accueil/espaces";
import { peindreDecor } from "@/lib/accueil/decor";
import { orbite, placerEspaces, VITESSE_ORBITE, zoneDeVie } from "@/lib/accueil/orbite";
import { parleSeuleMaison, salutSelonHeure, type MotifParole } from "@/lib/accueil/paroles";
import { estRaccourciParler } from "@/lib/accueil/raccourcis";
import { demanderLia } from "@/lib/lia/client";
import { heureQuebec } from "@/lib/memoire/acces";

/** Ce qui peut être ouvert dans la maison : un espace, ou « Parler » (écart A7). */
type Ouvert = IdEspace | "parler";

export function AccueilClient({ contenus, aJuger }: { contenus: Record<IdEspace, ContenuEspace>; aJuger: { titre: string; detail: string } | null }) {
  const [monde, setMonde] = useState<HTMLDivElement | null>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const satellites = useRef<(HTMLButtonElement | null)[]>([]);
  const anneau = useRef<HTMLDivElement>(null);
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const retour = useRef<HTMLElement | null>(null);
  const fige = useRef(false);
  // La boucle et la zone de LIA lisent l'espace ouvert sans redémarrer à chaque ouverture.
  const ouvertRef = useRef<Ouvert | null>(null);
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

  // « Parler » s'ouvre dans la maison (maquette v5) : touche `/` (sauf dans un champ), ou toucher LIA
  // (`surToucher`, lia-ui ≥ v0.33.0 ; `true` : sa bulle ne s'ouvre pas, le panneau la remplace).
  const ouvrirParler = useCallback(() => {
    if (ouvertRef.current === null && document.activeElement instanceof HTMLElement) retour.current = document.activeElement;
    setOuvert("parler");
    return true;
  }, []);
  useEffect(() => {
    const parler = (e: KeyboardEvent) => {
      const cible = e.target instanceof Element ? e.target : null;
      if (!estRaccourciParler(e, cible)) return;
      e.preventDefault();
      ouvrirParler();
    };
    addEventListener("keydown", parler);
    return () => removeEventListener("keydown", parler);
  }, [ouvrirParler]);

  // « Parler » (écart A7) : la même route que la bulle de LIA (`POST /api/lia/ask`). Le fil vit ici
  // pour survivre à la fermeture du panneau ; une réponse arrivée après le départ de la page est jetée.
  const [fil, setFil] = useState<Tour[]>([]);
  const filRef = useRef<Tour[]>([]);
  useEffect(() => {
    filRef.current = fil;
  }, [fil]);
  const lia = useRef<LiaHandle | null>(null);
  const envois = useRef(new Set<AbortController>());
  useEffect(() => {
    const enCours = envois.current;
    return () => enCours.forEach((c) => c.abort());
  }, []);
  const demander = useCallback((brute: string) => {
    const question = questionPrete(brute);
    if (!question || enAttente(filRef.current)) return;
    const id = `q${Date.now().toString(36)}`;
    setFil((f) => poser(f, id, question));
    const controle = new AbortController();
    envois.current.add(controle);
    lia.current?.setEtat("reflexion");
    demanderLia(question, controle.signal, { page: "/" })
      .then((r) => setFil((f) => repondre(f, id, r)))
      .catch(() => {
        if (!controle.signal.aborted) setFil((f) => echouer(f, id));
      })
      .finally(() => {
        envois.current.delete(controle);
        lia.current?.setEtat(null);
      });
  }, []);

  // Ce qu'elle dit seule (écart A3) : le salut de l'heure de Québec, puis ce que les espaces disent
  // de vrai (à juger, dépense du jour), à tour de rôle. Rien d'autre : le reste, elle parle d'elle.
  const tour = useRef(0);
  const parleSeule = useCallback(
    (motif: MotifParole) => parleSeuleMaison(motif, contenus, heureQuebec(new Date()), tour.current++),
    [contenus],
  );

  const ouvrir = (id: Ouvert, depuis: HTMLElement) => {
    if (!ouvert) retour.current = depuis;
    setOuvert(id);
  };

  const espace = ouvert === "parler" ? undefined : ESPACES.find((e) => e.id === ouvert);
  const contenu = ouvert && ouvert !== "parler" ? contenus[ouvert] : null;

  return (
    <div className={`maison${ouvert ? " maison--ouverte" : ""}`} ref={setMonde}>
      <canvas className="maison-sol" ref={toile} aria-hidden="true" />
      <div className="maison-orbite" ref={anneau} aria-hidden="true" />

      <header className="maison-tete">
        <LogoMemoire />
        <h1 className="maison-nom">LIA</h1>
        {aJuger && (
          <Link href="/questions" className="pastille-juger" aria-label={`${aJuger.titre} : ${aJuger.detail}`}>
            <span className="pastille-point" aria-hidden="true" />
            {aJuger.titre}
          </Link>
        )}
      </header>
      {/* Un seul bouton à droite, comme la maquette : les autres sections passent par la Mémoire,
          les liens des espaces et la touche `/`. */}
      <nav className="maison-droite" aria-label="Raccourcis">
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
          // Elle va voir l'espace et dit ce qu'il contient de vrai (`lia-ui`, comme la maquette).
          data-lia-cible={e.id}
          data-lia-dit={contenus[e.id].dit}
          data-lia-activite={e.activite}
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

      <PanneauEspace
        espace={espace ?? null}
        contenu={contenu}
        choisir={setOuvert}
        fermer={fermer}
        parler={ouvert === "parler" ? <ConversationMaison fil={fil} demander={demander} /> : null}
      />

      {monde ? (
        <Lia
          {...OPTIONS_LIA_MAISON}
          etat={etatLiaMaison()}
          container={monde}
          cle="lia-accueil"
          salut={salutSelonHeure(heureQuebec(new Date()))}
          onSpontane={parleSeule}
          surToucher={ouvrirParler}
          onPret={(h) => {
            lia.current = h;
          }}
          rayon={rayon}
          bounds={() => {
            const r = monde.getBoundingClientRect();
            return zoneDeVie(orbite(r.width, r.height), ouvertRef.current !== null);
          }}
        />
      ) : null}
    </div>
  );
}
