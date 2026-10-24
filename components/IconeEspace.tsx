// components/IconeEspace.tsx — les icônes de la maison de LIA (maquette v5), en traits : elles
// prennent la couleur du texte qui les porte (`currentColor`), donc la teinte de leur espace.
//
// Les tracés sont ceux de la maquette (`ICO`), mot pour mot. Ses cercles et ses rectangles
// arrondis sont réécrits en chemins (`rond`, `cadre`), pour que chaque icône reste une liste de `d`.

import type { Icone } from "@/lib/accueil/espaces";

/** Un cercle en chemin : deux demi-arcs. */
const rond = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** Un rectangle aux coins arrondis, en chemin. */
const cadre = (x: number, y: number, l: number, h: number, r: number) =>
  `M${x + r} ${y}h${l - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(l - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

const TRACES = {
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
  envoyer: ["M4 12l16-8-6 16-3-7z"],
  // La page Mémoire : onglets, retour, chevron des tuiles et icônes de leurs titres.
  chev: ["M6 9l6 6 6-6"],
  back: ["M15 5l-7 7 7 7"],
  net: [rond(5, 6, 2), rond(5, 18, 2), rond(12, 12, 2), rond(19, 7, 2), rond(19, 17, 2), "M7 6l3.5 5M7 18l3.5-5M14 11l3.5-3M14 13l3.5 3"],
  target: [rond(12, 12, 8.5), rond(12, 12, 4), rond(12, 12, 0.8)],
  hist: ["M4 12a8 8 0 1 0 2.5-5.8", "M4 4v4h4M12 8v4l3 2"],
  lock: [cadre(5, 11, 14, 9, 2), "M8 11V8a4 4 0 0 1 8 0v3"],
  chart: ["M4 19V5M4 19h16", "M7 15l4-5 3 3 5-7"],
  mail: ["M4 6h16v12H4z", "M4 7l8 6 8-6"],
  link: ["M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1", "M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"],
  alert: ["M12 4l9 16H3z", "M12 10v4M12 17v.1"],
  folder: ["M4 6h6l2 2h8v10H4z"],
  spark: ["M12 3q1 7 8 9-7 2-8 9-1-7-8-9 7-2 8-9z"],
  layers: ["M12 4l8 4-8 4-8-4z", "M4 12l8 4 8-4M4 16l8 4 8-4"],
  shield: ["M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"],
  star: ["M12 4l2.4 5 5.6.8-4 4 1 5.5L12 16.5 7 19.3l1-5.5-4-4L9.6 9z"],
  pie: ["M12 4a8 8 0 1 0 8 8h-8z", "M14 3a8 8 0 0 1 7 7h-7z"],
  trash: ["M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"],
  bell: ["M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z", "M10 20.5h4"],
  cal: ["M4 6h16v14H4z", "M4 10h16M8 3v4M16 3v4"],
  eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", rond(12, 12, 2.5)],
  cardok: [cadre(4, 5, 16, 14, 2), "M8 12.5l2.5 2.5L16 9.5"],
  moon: ["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"],
  thermo: ["M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"],
  pulse: ["M3 12h4l2-6 3 12 2-6h7"],
  phone: ["M6 3h4l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2L21 14v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"],
  path: [rond(5, 6, 2), rond(19, 18, 2), "M7 6h6a4 4 0 0 1 0 8h-2a4 4 0 0 0 0 4h6"],
} satisfies Record<Icone, string[]> & Record<string, string[]>;

export type NomIcone = keyof typeof TRACES;

export function IconeEspace({ nom, taille = 22 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRACES[nom].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
