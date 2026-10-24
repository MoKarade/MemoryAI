// components/TableauEspace.tsx — le corps d'un panneau de la maison, comme la maquette v5 (écart B) :
// la question à côté de LIA, puis le tableau de tuiles repliables. Il dessine ce que
// `lib/accueil/tableaux.ts` a composé, rien de plus : une tuile sans donnée le dit (`Vide`).
// ⚠️ Aucune couleur ici : les parts prennent la teinte de `globals.css` (`.teinte-*`).

import Link from "next/link";
import type { Corps, Tableau } from "@/lib/accueil/tableaux";
import { Histogramme } from "./Histogramme";
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

const R = 46;
const TOUR = 2 * Math.PI * R;

/** L'anneau : chaque part, à sa teinte, rapportée au plafond ; le reste est la piste vide. */
function Anneau({ c }: { c: Extract<Corps, { genre: "anneau" }> }) {
  const longueurs = c.parts.map((p) => (c.plafond > 0 ? Math.min(1, p.valeur / c.plafond) * TOUR : 0));
  return (
    <div className="tab-anneau">
      <svg viewBox="0 0 120 120" role="img" aria-label={c.resume}>
        <circle className="tab-anneau-piste" cx="60" cy="60" r={R} />
        {c.parts.map((p, i) => {
          const longueur = longueurs[i] ?? 0;
          const debut = longueurs.slice(0, i).reduce((t, l) => t + l, 0);
          return <circle key={p.libelle} className={`tab-anneau-part teinte-${p.teinte}`} cx="60" cy="60" r={R} strokeDasharray={`${longueur.toFixed(1)} ${(TOUR - longueur).toFixed(1)}`} strokeDashoffset={(-debut).toFixed(1)} transform="rotate(-90 60 60)" />;
        })}
        <text className="tab-anneau-centre" x="60" y="62" textAnchor="middle">
          {c.centre}
        </text>
        <text className="tab-anneau-sous" x="60" y="80" textAnchor="middle">
          {c.sous}
        </text>
      </svg>
      <ul className="tab-legende">
        {c.parts.map((p) => (
          <li key={p.libelle} className={`teinte-${p.teinte}`}>
            <i aria-hidden="true" />
            {p.libelle} · {p.valeur.toFixed(2).replace(".", ",")} $
          </li>
        ))}
      </ul>
    </div>
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
    case "anneau":
      return <Anneau c={c} />;
    case "jauges":
      return (
        <ul className="tab-jauges">
          {c.lignes.map((l) => (
            <li key={l.libelle}>
              <div>
                <span>{l.libelle}</span>
                <span className="tab-valeur">{l.valeur}</span>
              </div>
              {l.part !== null ? (
                <div className={l.alerte ? "tab-barre tab-barre--alerte" : "tab-barre"} aria-hidden="true">
                  <i style={{ width: `${Math.round(l.part * 100)}%` }} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      );
    case "histogramme":
      return <Histogramme barres={c.barres} resume={c.resume} unite={c.unite} />;
    case "liste":
      return (
        <ul className="tab-liste">
          {c.elements.map((e) => (
            <li key={e.libelle}>
              <span>{e.libelle}</span>
              {e.detail ? <small>{e.detail}</small> : null}
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
