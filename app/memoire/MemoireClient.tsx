"use client";
// app/memoire/MemoireClient.tsx — le réseau 3D de la mémoire, ses filtres et la carte du point
// choisi (MemoryAI#74). Les données arrivent toutes calculées du serveur (`construireReseau`) :
// ce composant ne fait que filtrer et montrer.
//
// Depuis le 26/10/2026 (Marc, tâche MemoryAI 323), la carte d'un fait ne renvoie plus à
// l'ancienne page `/fait/[id]` : elle liste les faits auxquels il est relié, et un clic sur l'un
// d'eux le choisit dans le réseau. Aucune valeur de fait n'est affichée ici.

import { useMemo, useState } from "react";
import { Graphe3D } from "@/components/Graphe3D";
import { filtrerVisibles, JETON_NIVEAU, voisinsDe, type Reseau } from "@/lib/memoire/reseau";

const NIVEAUX = [0, 1, 2, 3] as const;
const SENS_NIVEAU = ["public", "courant", "privé", "intime"] as const;
/** Combien de voisins la carte montre ; le reste est compté, pas dessiné. */
const VOISINS_MAX = 12;

export function MemoireClient({ reseau, totalLiens, papiers, tronque }: { reseau: Reseau; totalLiens: number; papiers: number | null; tronque: boolean }) {
  const [niveaux, setNiveaux] = useState<ReadonlySet<number>>(new Set(NIVEAUX));
  const [recherche, setRecherche] = useState("");
  const [choisi, setChoisi] = useState(-1);

  const visibles = useMemo(() => filtrerVisibles(reseau.noeuds, niveaux, recherche), [reseau, niveaux, recherche]);
  const nombreVisibles = visibles.filter((v, i) => v && !reseau.noeuds[i]?.centre).length;
  const noeud = choisi >= 0 ? reseau.noeuds[choisi] : undefined;
  const voisins = useMemo(() => (choisi >= 0 ? voisinsDe(reseau, choisi) : []), [reseau, choisi]);

  const basculer = (n: number) =>
    setNiveaux((avant) => {
      const apres = new Set(avant);
      if (apres.has(n)) apres.delete(n);
      else apres.add(n);
      return apres;
    });

  return (
    <>
      <ul className="memoire-chiffres" aria-label="La mémoire en chiffres">
        <li><b>{nombreVisibles.toLocaleString("fr-CA")}</b> faits affichés</li>
        <li><b>{totalLiens.toLocaleString("fr-CA")}</b> liens</li>
        {/* Les épisodes (messages, journées) arrivent avec la lecture des messages : un tiret, pas un zéro. */}
        <li><b>—</b> épisodes</li>
        <li><b>{papiers === null ? "—" : papiers.toLocaleString("fr-CA")}</b> papiers</li>
      </ul>

      <div className="memoire-filtres">
        <div role="group" aria-label="Niveaux affichés" className="memoire-niveaux">
          {NIVEAUX.map((n) => (
            <button
              key={n}
              type="button"
              className="memoire-niveau"
              aria-pressed={niveaux.has(n)}
              style={{ "--teinte": `var(${JETON_NIVEAU[n]})` } as React.CSSProperties}
              onClick={() => basculer(n)}
            >
              <i aria-hidden="true" />N{n} <span className="doux">{SENS_NIVEAU[n]}</span>
            </button>
          ))}
        </div>
        <label className="memoire-recherche">
          <span className="sr-only">Chercher un prédicat</span>
          <input className="champ" type="search" placeholder="Chercher (adresse, employeur…)" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
      </div>

      <div className="memoire-scene">
        <Graphe3D
          noeuds={reseau.noeuds}
          aretes={reseau.aretes}
          visibles={visibles}
          impulsions={24}
          selection={choisi}
          onSelection={setChoisi}
          hauteur={520}
          description={`Réseau de la mémoire : ${nombreVisibles} faits affichés, groupés en ${reseau.domaines.length} domaines. Glisser pour tourner, toucher un point pour le choisir.`}
        />
        <aside className="carte memoire-fiche" aria-live="polite">
          {!noeud ? (
            <p className="doux">Touche un point pour voir ce qu&apos;il est. Glisse pour tourner, pince ou molette pour zoomer.</p>
          ) : noeud.centre ? (
            <>
              <p className="surtitre">Domaine</p>
              <h2>{noeud.domaine}</h2>
              <p className="doux">{noeud.degre} fait(s) affiché(s) dans ce domaine.</p>
            </>
          ) : (
            <>
              <p className="surtitre">{noeud.domaine}</p>
              <h2>{noeud.etiquette}</h2>
              <p>
                <span className="memoire-niveau-pastille" style={{ "--teinte": `var(${noeud.jeton})` } as React.CSSProperties}>
                  N{noeud.niveau} {noeud.niveau !== null ? SENS_NIVEAU[noeud.niveau as 0 | 1 | 2 | 3] : ""}
                </span>{" "}
                <span className="doux">{noeud.degre} lien(s)</span>
              </p>
              {voisins.length === 0 ? (
                <p className="doux">Aucun lien avec un autre fait affiché.</p>
              ) : (
                <>
                  <p className="surtitre">Relié à</p>
                  <ul>
                    {voisins.slice(0, VOISINS_MAX).map((v) => (
                      <li key={v.index}>
                        <button type="button" className="bouton bouton-second" onClick={() => setChoisi(v.index)}>
                          {v.domaine} · {v.etiquette}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {voisins.length > VOISINS_MAX && <p className="doux">Et {voisins.length - VOISINS_MAX} autre(s) fait(s) relié(s).</p>}
                </>
              )}
            </>
          )}
        </aside>
      </div>

      {(reseau.omis > 0 || tronque) && (
        <p className="hint">
          {reseau.omis > 0 && `${reseau.omis} fait(s) peu relié(s) laissé(s) hors du dessin pour qu'il reste lisible. `}
          {tronque && "La lecture s'arrête aux 2 000 faits les plus récents."}
        </p>
      )}
    </>
  );
}
