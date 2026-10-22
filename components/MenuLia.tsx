"use client";

// components/MenuLia.tsx — le menu de l'app : plein écran sur téléphone, tiroir sur PC.
//
// Un <dialog> MODAL fait le travail d'accessibilité à notre place : le focus reste dans le menu,
// Échap le ferme, le focus revient au bouton, le reste de la page est inerte. Un menu fait de
// `div` aurait à réécrire les quatre à la main — et à les rater.
//
// ⚠️ Le contenu replié est quand même ENVOYÉ avec la page (leçon n° 21) : il ne porte donc que
// des liens, jamais un chiffre ni un fait.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type EntreeMenu = { cle: string; href: string; libelle: string };

export function MenuLia({ entrees, allumee }: { entrees: readonly EntreeMenu[]; allumee: string | null }) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const chemin = usePathname();

  // Une navigation referme le menu. Un lien vers la page où l'on est ne change pas le chemin :
  // il referme aussi, par son propre `onClick`.
  useEffect(() => {
    dialogue.current?.close();
  }, [chemin]);

  const fermer = () => dialogue.current?.close();

  return (
    <>
      <button
        type="button"
        className="menu-bouton"
        aria-label="Ouvrir le menu"
        aria-haspopup="dialog"
        onClick={() => dialogue.current?.showModal()}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 8h16M4 16h10" />
        </svg>
      </button>
      {/* Un clic sur le voile (hors du tiroir) atteint le <dialog> lui-même : le corps le remplit,
          donc seul le voile a `cible === dialogue`. */}
      <dialog
        ref={dialogue}
        className="menu"
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === dialogue.current) fermer();
        }}
      >
        <div className="menu-corps">
          <div className="menu-tete">
            <span className="nav-marque">Lia</span>
            <button type="button" className="menu-fermer" aria-label="Fermer le menu" onClick={fermer}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <nav aria-label="Sections">
            <ul className="menu-liste">
              {entrees.map((e) => (
                <li key={e.cle}>
                  <Link
                    href={e.href}
                    className="menu-lien"
                    aria-current={allumee === e.cle ? "page" : undefined}
                    onClick={fermer}
                  >
                    {e.libelle}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </dialog>
    </>
  );
}
