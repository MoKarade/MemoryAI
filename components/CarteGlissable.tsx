"use client";
// components/CarteGlissable.tsx — glisser une carte de la pile (ADR 0012 §2.3).
//
// ⚠️ LE GLISSER N'EST QU'UN RACCOURCI VERS LES BOUTONS. Il ne décide rien : au-delà du seuil, il
// soumet le formulaire du bouton correspondant (`requestSubmit`), donc la même Server Action,
// la même garde de session, le même chemin. Sans JavaScript, ou au clavier, les trois boutons
// font tout — c'est pour ça qu'ils restent visibles (arbitrage de Marc : « boutons + glisser »).
//
// ⚠️ `touch-action: pan-y` : la page doit encore défiler verticalement sous le pouce. Seul un
// geste HORIZONTAL déplace la carte.

import { useRef, useState } from "react";

/** Au-delà de ce déplacement (px), relâcher la carte vaut le bouton. En deçà, elle revient. */
const SEUIL_GLISSER_PX = 110;

export function CarteGlissable({
  formVrai,
  formFaux,
  children,
}: {
  /** Les `id` des formulaires Vrai et Faux de la carte. */
  formVrai: string;
  formFaux: string;
  children: React.ReactNode;
}) {
  const depart = useRef<number | null>(null);
  const [dx, setDx] = useState(0);

  function relacher() {
    const cible = dx >= SEUIL_GLISSER_PX ? formVrai : dx <= -SEUIL_GLISSER_PX ? formFaux : null;
    depart.current = null;
    setDx(0);
    if (cible) (document.getElementById(cible) as HTMLFormElement | null)?.requestSubmit();
  }

  const sens = dx >= SEUIL_GLISSER_PX ? "vrai" : dx <= -SEUIL_GLISSER_PX ? "faux" : null;
  return (
    <div
      className="carte-glissable"
      data-sens={sens ?? undefined}
      style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 30}deg)` : undefined }}
      onPointerDown={(e) => {
        depart.current = null;
        setDx(0);
        // ⚠️ Revue #73 : au DOIGT seulement. À la souris, sélectionner un numéro pour le copier
        // est un glisser de plus de 110 px — il soumettait « Vrai » ou « Faux » sans le vouloir.
        if (e.pointerType === "mouse" || !e.isPrimary) return;
        // Un geste qui commence sur un bouton, un lien ou un champ reste à eux.
        if ((e.target as HTMLElement).closest("a, button, input, textarea, select, label")) return;
        depart.current = e.clientX;
        // Sans capture, un doigt qui sort de la carte ne rend jamais `pointerup` ici : le geste
        // restait « accroché » et le relâcher suivant jugeait la carte.
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (depart.current !== null && e.buttons !== 0) setDx(e.clientX - depart.current);
      }}
      onPointerUp={relacher}
      onPointerCancel={() => {
        depart.current = null;
        setDx(0);
      }}
    >
      {children}
    </div>
  );
}
