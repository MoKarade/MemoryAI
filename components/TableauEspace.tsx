// components/TableauEspace.tsx — le corps d'un panneau de la maison, comme la maquette v5 (écart B) :
// la question à côté de LIA, puis le tableau de tuiles repliables. Il dessine ce que
// `lib/accueil/tableaux.ts` a composé, rien de plus : une tuile sans donnée le dit (`Vide`).

import Link from "next/link";
import type { Corps, Tableau } from "@/lib/accueil/tableaux";
import { IconeEspace } from "./IconeEspace";
import { Tuile, Vide } from "./Tuile";

/** Le rond de points de LIA, à côté de la question (`ring()` de la maquette). */
function RondLia() {
  return (
    <svg className="tab-lia" width="44" height="44" viewBox="0 0 52 52" aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return <circle key={i} cx={(26 + 19 * Math.cos(a)).toFixed(1)} cy={(26 + 19 * Math.sin(a)).toFixed(1)} r="2.2" />;
      })}
    </svg>
  );
}

function CorpsTuile({ c }: { c: Corps }) {
  switch (c.genre) {
    case "vide":
      return <Vide>{c.texte}</Vide>;
    case "texte":
      return (
        <p className="tab-texte">
          {c.texte}{" "}
          {c.lien ? (
            <Link href={c.lien.href} className="tab-lien">
              {c.lien.libelle}
            </Link>
          ) : null}
        </p>
      );
    case "chiffres":
      return (
        <ul className="tab-chiffres">
          {c.chiffres.map((x) => (
            <li key={x.libelle}>
              <IconeEspace nom={x.icone} taille={18} />
              <b>{x.valeur}</b>
              <small>{x.libelle}</small>
            </li>
          ))}
        </ul>
      );
    case "barres":
      return (
        <ul className="tab-barres" aria-label={c.resume}>
          {c.barres.map((b) => (
            <li key={b.libelle}>
              <span className="tab-barres-libelle">{b.libelle}</span>
              <span className="tab-barre" aria-hidden="true">
                <i style={{ width: `${Math.max(2, Math.round(b.part * 100))}%` }} />
              </span>
              <span className="tab-valeur">{b.valeur}</span>
            </li>
          ))}
        </ul>
      );
    case "pastilles":
      return (
        <ul className="maison-puces">
          {c.elements.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      );
  }
}

export function TableauEspace({ tableau }: { tableau: Tableau }) {
  return (
    <>
      <div className="tab-question">
        <RondLia />
        <p>{tableau.question}</p>
      </div>
      <div className="tableau">
        {tableau.tuiles.map((t) => (
          <Tuile key={t.cle} largeur={t.largeur} icone={t.icone} titre={t.titre} repliee={t.repliee}>
            {t.corps.map((c, i) => (
              <CorpsTuile key={i} c={c} />
            ))}
          </Tuile>
        ))}
      </div>
    </>
  );
}
