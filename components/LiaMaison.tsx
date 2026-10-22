"use client";

// LIA chez elle : montée une fois pour toute l'app (une seule LIA par page), sur toute la fenêtre.
// Le corps, la vie et la discussion viennent de `@mokarade/lia-ui` ; ses réponses en blocs sont
// dessinées par `rendreBlocs` (catalogue de `lib/lia/blocs.ts`). Rien ne se décide ici.
// ⚠️ Pas dans `/widget` : cette page vit dans un cadre du hub, qui a déjà sa LIA.

import { usePathname } from "next/navigation";
import { Lia } from "@mokarade/lia-ui/react";
import { rendreBlocs } from "@mokarade/lia-ui/blocs";
import { demanderLia } from "@/lib/lia/client";

export function LiaMaison() {
  const chemin = usePathname();
  if (chemin.startsWith("/widget")) return null;
  return (
    <Lia
      ask={(question, signal) => demanderLia(question, signal, { page: window.location.pathname })}
      renderBlocks={(blocs, dans) => {
        rendreBlocs(blocs, dans);
      }}
    />
  );
}
