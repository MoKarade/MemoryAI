"use client";

// LIA chez elle : montée une fois pour toute l'app (une seule LIA par page), sur toute la fenêtre.
// Le corps, la vie et la discussion viennent de `@mokarade/lia-ui` ; ses réponses en blocs sont
// dessinées par `rendreBlocs` (catalogue de `lib/lia/blocs.ts`). Rien ne se décide ici.
// ⚠️ Pas dans `/widget` : cette page vit dans un cadre du hub, qui a déjà sa LIA.
// ⚠️ Pas sur l'accueil (`/`) : la maison de LIA la monte elle-même, au centre de son orbite
// (`app/AccueilClient.tsx`). Deux montages sur une page, et `mountLia` refuse le second.

import { usePathname } from "next/navigation";
import { Lia } from "@mokarade/lia-ui/react";
import { rendreBlocs } from "@mokarade/lia-ui/blocs";
import { demanderLia } from "@/lib/lia/client";

/** Ce que LIA sait faire chez elle, partagé par l'accueil et les autres pages. */
export const OPTIONS_LIA_MAISON = {
  ask: (question: string, signal: AbortSignal, contexte?: unknown) =>
    demanderLia(question, signal, { page: window.location.pathname, contexte }),
  renderBlocks: (blocs: readonly unknown[], dans: HTMLElement) => {
    rendreBlocs(blocs, dans);
  },
};

export function LiaMaison() {
  const chemin = usePathname();
  if (chemin === "/" || chemin.startsWith("/widget")) return null;
  return <Lia {...OPTIONS_LIA_MAISON} />;
}
