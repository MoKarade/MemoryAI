// components/IconeEspace.tsx — les icônes de la maison de LIA (maquette v5), en traits : elles
// prennent la couleur du texte qui les porte (`currentColor`), donc la teinte de leur espace.

import type { Icone } from "@/lib/accueil/espaces";

const TRACES: Record<Icone | "db" | "chat" | "croix", string[]> = {
  search: ["M16 16l4.5 4.5", "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"],
  heart: ["M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"],
  clock: ["M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z", "M12 7v5l3 2"],
  bulb: ["M9 18h6M10 21h4", "M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z"],
  globe: ["M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z", "M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"],
  coin: ["M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z", "M14.6 9.6c-.5-1-1.5-1.6-2.6-1.6-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2.1-.6-2.6-1.6M12 6.5V8M12 16v1.5"],
  tool: ["M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z"],
  grid: ["M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
  db: ["M5 7c0-1.5 3-3 7-3s7 1.5 7 3-3 3-7 3-7-1.5-7-3z", "M5 7v10c0 1.5 3 3 7 3s7-1.5 7-3V7", "M5 12c0 1.5 3 3 7 3s7-1.5 7-3"],
  chat: ["M4 5h16v11H10l-4 4v-4H4z", "M8 9.5h8M8 12.5h5"],
  croix: ["M6 6l12 12M18 6L6 18"],
};

export function IconeEspace({ nom, taille = 22 }: { nom: keyof typeof TRACES; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRACES[nom].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
