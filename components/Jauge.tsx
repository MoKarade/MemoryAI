// components/Jauge.tsx — [L38] une part d'un tout, dessinée au SERVEUR.
//
// « Ce qui reste, ce qui a été traité » (Marc, 18/09). Même patron que `GrapheSvg` et
// `Histogramme` : SVG statique, zéro JavaScript, aucune couleur en dur.
//
// ⚠️⚠️ CE COMPOSANT REFUSE D'INVENTER UNE PART. Quand il n'y a rien à mesurer (`part` à
// `null`), il rend `null` — pas une jauge à zéro. Une barre vide et une barre « on ne sait
// pas » se ressemblent à l'écran et disent le contraire : la première affirme qu'on a mesuré
// zéro. C'est le `no-fake-data` du dépôt appliqué à un dessin.
//
// ⚠️ Le CHIFFRE est écrit à côté de la barre, pas seulement dans l'`aria-label` : une
// proportion lue à l'œil sur 40 px se trompe de 10 points, et « à peu près la moitié » n'est
// pas une mesure. Le dessin situe, le chiffre dit.

const HAUTEUR = 22;
const LARGEUR = 300;

export function Jauge({
  part,
  resume,
}: {
  /** Entre 0 et 100. `null` = rien à mesurer, et alors rien n'est dessiné. */
  part: number | null;
  resume: string;
}) {
  if (part === null) return null;
  // ⚠️ Borné : une part calculée hors [0, 100] (un total qui bouge entre deux lectures, un
  // compte négatif) dessinerait une barre plus longue que son cadre, donc une progression de
  // 130 % qui a l'air normale. On borne le DESSIN ; le chiffre affiché à côté reste celui que
  // l'appelant a mesuré, parce que c'est lui qui doit surprendre s'il est absurde.
  const largeurRemplie = (Math.min(100, Math.max(0, part)) / 100) * LARGEUR;

  return (
    <svg
      viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
      role="img"
      aria-label={resume}
      style={{ width: "100%", maxWidth: `${LARGEUR}px`, height: "auto", display: "block" }}
    >
      <rect x={0} y={0} width={LARGEUR} height={HAUTEUR} fill="var(--surface-douce)" rx={4} />
      {largeurRemplie > 0 && (
        <rect x={0} y={0} width={largeurRemplie} height={HAUTEUR} fill="var(--succes-texte)" rx={4} />
      )}
      <rect x={0} y={0} width={LARGEUR} height={HAUTEUR} fill="none" stroke="var(--bordure)" rx={4} />
    </svg>
  );
}
