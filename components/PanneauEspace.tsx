// components/PanneauEspace.tsx — un espace de la maison de LIA, ouvert : à droite sur PC, en
// feuille sur téléphone (`.maison-panneau`, `globals.css`). Il montre ce que `contenuEspaces` a
// composé côté serveur, rien de plus : sans source réelle, la phrase le dit (`.maison-vide`).
//
// ⚠️ Toujours dans la page, même fermé (`aria-hidden`, rien dedans) : il glisse au lieu d'apparaître.

import Link from "next/link";
import { ESPACES, type ContenuEspace, type Espace, type IdEspace } from "@/lib/accueil/espaces";
import { IconeEspace } from "./IconeEspace";

export function PanneauEspace({ espace, contenu, choisir, fermer }: { espace: Espace | null; contenu: ContenuEspace | null; choisir: (id: IdEspace) => void; fermer: () => void }) {
  return (
    <aside className="maison-panneau" data-ouvert={espace ? "" : undefined} role="dialog" aria-label={espace?.titre ?? "Espace"} aria-hidden={!espace}>
      {espace && contenu ? (
        <>
          <div className="maison-panneau-tete">
            <h2>{espace.titre}</h2>
            <div className="maison-mini" role="group" aria-label="Espaces">
              {ESPACES.map((e) => (
                <button key={e.id} type="button" aria-label={e.libelle} aria-current={e.id === espace.id} onClick={() => choisir(e.id)}>
                  <IconeEspace nom={e.icone} taille={18} />
                </button>
              ))}
            </div>
            <button type="button" className="maison-fermer" aria-label="Fermer" onClick={fermer} autoFocus>
              <IconeEspace nom="croix" taille={18} />
            </button>
          </div>
          <div className={`maison-panneau-corps teinte-${espace.teinte}`}>
            <p className={contenu.vide ? "maison-vide" : "maison-phrase"}>{contenu.phrase}</p>
            {contenu.lignes ? (
              <dl className="maison-lignes">
                {contenu.lignes.map((l) => (
                  <div key={l.libelle}>
                    <dt>{l.libelle}</dt>
                    <dd>{l.valeur}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {contenu.puces ? (
              <ul className="maison-puces">
                {contenu.puces.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {contenu.liens ? (
              <div className="maison-liens">
                {contenu.liens.map((l) => (
                  <Link key={l.href} href={l.href} className="bouton bouton-second">
                    {l.libelle}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}
