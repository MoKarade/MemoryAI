// components/Tuile.tsx — la tuile de la page Mémoire (maquette v5, `tile()`) : une icône, un petit
// titre, un chevron qui la replie, un filet violet en haut. Native (`<details>`) : elle se plie sans
// une ligne de JavaScript, au clavier comme au doigt.
//
// ⚠️ Une tuile de la maquette SANS donnée réelle se dessine quand même, avec `Vide` (règle de Marc
// du 23/10/2026) : même place, même titre, et une ligne qui dit ce qui la remplira. Jamais retirée,
// jamais remplie de chiffres inventés.

import { IconeEspace, type NomIcone } from "./IconeEspace";

type Largeur = 4 | 5 | 6 | 7 | 8 | 12;

const CLASSE_LARGEUR: Record<Largeur, string> = {
  4: "tuile-m--4",
  5: "tuile-m--5",
  6: "tuile-m--6",
  7: "tuile-m--7",
  8: "tuile-m--8",
  12: "tuile-m--12",
};

export function Tuile({
  largeur,
  icone,
  titre,
  repliee = false,
  children,
}: {
  largeur: Largeur;
  icone: NomIcone;
  titre: string;
  /** Repliée au départ, comme les tuiles `ferme` de la maquette. */
  repliee?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={`tuile-m ${CLASSE_LARGEUR[largeur]}`} open={!repliee}>
      <summary>
        <IconeEspace nom={icone} taille={16} />
        <h2>{titre}</h2>
        <span className="tuile-m-chevron">
          <IconeEspace nom="chev" taille={16} />
        </span>
      </summary>
      <div className="tuile-m-corps">{children}</div>
    </details>
  );
}

/** L'état vide honnête d'une tuile : ce qui manque, et ce qui la remplira. */
export function Vide({ children, haute = false }: { children: React.ReactNode; haute?: boolean }) {
  return <p className={haute ? "tuile-vide tuile-vide--haute" : "tuile-vide"}>{children}</p>;
}
