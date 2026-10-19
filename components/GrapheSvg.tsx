// components/GrapheSvg.tsx — le dessin du graphe. Rendu côté SERVEUR, sans une ligne de
// JavaScript envoyée au navigateur : un SVG statique, comme une image, mais dont le texte se
// sélectionne et se lit à voix haute.
//
// ⚠️ AUCUNE COULEUR EN DUR. Tout passe par les jetons de `globals.css`, donc le dessin suit
// `prefers-color-scheme` sans que personne y pense. Une couleur écrite ici serait invisible à
// la relecture — parfaitement lisible dans le thème pour lequel on l'a écrite, fausse dans
// l'autre (leçon BatchChef, 21 sites en une passe).
//
// ⚠️ LE TYPE D'UN LIEN SE LIT AU TRAIT, PAS À LA COULEUR. Cinq couleurs demanderaient une
// légende et tomberaient sur le premier daltonisme ; l'épaisseur dit le POIDS (ce que la règle
// vaut) et le pointillé dit « coïncidence de dates » plutôt que « rapport établi ».

import type { Disposition } from "@/lib/grapheDisposition";
import { resume } from "@/lib/grapheDisposition";

/** Le seul type dessiné autrement : un chevauchement de dates n'est pas un rapport établi. */
const POINTILLE = "meme-periode";

export function GrapheSvg({ d }: { d: Disposition }) {
  if (d.noeuds.length === 0) return null;
  const { taille } = d;
  return (
    <svg
      viewBox={`0 0 ${taille} ${taille}`}
      role="img"
      aria-label={resume(d)}
      style={{ width: "100%", maxWidth: `${taille}px`, height: "auto", display: "block", margin: "0 auto" }}
    >
      {/* Les traits d'abord : ils passent SOUS les points, sinon ils les barrent. */}
      <g fill="none" stroke="var(--texte-doux)">
        {d.traits.map((t) => (
          <path
            key={`${t.faitA}-${t.faitB}-${t.type}`}
            d={t.d}
            // Le poids se voit : un pointeur partagé (1) est plus épais qu'un chevauchement
            // de dates (0,5). L'opacité suit, pour que le faible recule au lieu de crier.
            strokeWidth={0.6 + t.poids * 1.6}
            strokeOpacity={0.25 + t.poids * 0.35}
            strokeDasharray={t.type === POINTILLE ? "4 4" : undefined}
          />
        ))}
      </g>

      <g>
        {d.noeuds.map((n) => {
          // L'étiquette part vers l'EXTÉRIEUR du cercle, et bascule à gauche sur la moitié
          // gauche — sinon la moitié du texte se lit à l'envers du sens de lecture.
          const cos = Math.cos(n.angle);
          const droite = cos >= 0;
          const lx = n.x + cos * 10;
          const ly = n.y + Math.sin(n.angle) * 10;
          return (
            <g key={n.id}>
              {/* L'infobulle native du navigateur : le prédicat entier et le nombre de
                  liens, sans une ligne de JavaScript. L'étiquette à côté du point est
                  COURTE pour que le cercle reste lisible ; le détail vit ici. */}
              <title>{`${n.domaine}.${n.etiquette} — ${n.degre} lien(s)`}</title>
              <circle
                cx={n.x}
                cy={n.y}
                // Le rayon dit le DEGRÉ : un fait qui relie beaucoup se voit. Borné, sinon un
                // seul nœud très connecté avalerait le cercle.
                r={3 + Math.min(n.degre, 6) * 0.8}
                fill="var(--accent)"
                fillOpacity={0.85}
              />
              <text
                x={lx}
                y={ly}
                fontSize={11}
                fill="var(--texte-doux)"
                textAnchor={droite ? "start" : "end"}
                dominantBaseline="middle"
              >
                {n.etiquette}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
