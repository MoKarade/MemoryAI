// app/apps/page.tsx — les apps qui parlent à ta mémoire, et ce que chacune peut faire.
//
// ⚠️ AUCUNE VALEUR DE JETON N'APPARAÎT ICI, ni tronquée, ni hachée. La page dit QUI peut
// écrire (déduit des NOMS de variables `MEMORYAI_TOKEN_<APP>_<RÔLE>`), jamais avec quoi.
//
// Le périmètre ne peut que RESTREINDRE ce que le jeton permet : sans ligne, l'app garde ce
// que son jeton lui donne. C'est écrit à l'écran, parce qu'une case vide qui veut dire
// « tout » et une case vide qui veut dire « rien » ne se devinent pas.

import { Nav } from "@/components/Nav";
import { appsConnues } from "@/lib/jetons";
import { depotPerimetresDrizzle } from "@/lib/depotPerimetres";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { domaines as domainesDuVocabulaire } from "@/lib/vocabulaire";
import { reglerAction, retirerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="apps" />
        <main className="page">
          <h1>Apps</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const depot = depotPerimetresDrizzle(acces.db);
  const [perimetres, avecJeton] = await Promise.all([depot.tous(), Promise.resolve(appsConnues())]);
  const tousDomaines = domainesDuVocabulaire();

  // Une app peut avoir un jeton sans périmètre (le cas normal), ou un périmètre sans jeton
  // (une ligne restée après le retrait d'une variable — elle ne sert plus rien, et le dire
  // vaut mieux que la cacher).
  const ids = [...new Set([...avecJeton.map((a) => a.appId), ...perimetres.map((p) => p.appId)])].sort();

  return (
    <>
      <Nav active="apps" />
      <main className="page">
        <h1>Apps</h1>
        <p className="lead">
          {ids.length === 0
            ? "Aucune app ne parle encore à ta mémoire. Une app apparaît ici dès qu'une variable MEMORYAI_TOKEN_<APP>_<RÔLE> est posée."
            : `${ids.length} app(s). Le périmètre ne peut que RESTREINDRE ce que le jeton permet : sans réglage, l'app garde ce que son jeton lui donne.`}
        </p>
        <p className="hint">
          Aucune valeur de jeton n&apos;est affichée ici, même partiellement. Le niveau 3 (identité, immigration,
          fiscal) ne s&apos;accorde pas : il n&apos;a aucun contenu stocké.
        </p>

        <section className="liste-faits" aria-label="Apps">
          {ids.map((appId) => {
            const jeton = avecJeton.find((a) => a.appId === appId);
            const p = perimetres.find((x) => x.appId === appId);
            const accordes: string[] = p ? (JSON.parse(p.domaines) as string[]) : [];
            return (
              <article key={appId} className="carte tuile">
                <h2>{appId}</h2>
                <p className="hint">
                  {jeton ? `Jeton posé, rôle ${jeton.role}.` : "Aucun jeton posé : ce réglage ne sert plus à rien."}{" "}
                  {p
                    ? `Réglé : niveau ≤ ${p.niveauMax}, ${accordes.length === 0 ? "aucun domaine" : `${accordes.length} domaine(s)`}, ${p.role}${p.admetInvites ? "" : ", sans invités"}${p.domicile ? ", domicile inclus" : ""}.`
                    : "Aucun réglage : le jeton décide seul."}
                </p>

                <form action={reglerAction}>
                  <input type="hidden" name="appId" value={appId} />
                  <fieldset>
                    <legend>Domaines</legend>
                    {tousDomaines.map((d) => (
                      <label key={d} className="ligne">
                        <input type="checkbox" name="domaine" value={d} defaultChecked={accordes.includes(d)} /> {d}
                      </label>
                    ))}
                  </fieldset>
                  <label className="ligne">
                    Niveau maximal{" "}
                    <select className="champ" name="niveauMax" defaultValue={String(p?.niveauMax ?? 0)}>
                      <option value="0">0 — goûts, projets</option>
                      <option value="1">1 — employeur, véhicule, documents</option>
                      <option value="2">2 — domicile, santé, relations</option>
                    </select>
                  </label>
                  <label className="ligne">
                    Rôle{" "}
                    <select className="champ" name="role" defaultValue={p?.role ?? "lecture"}>
                      <option value="lecture">lecture</option>
                      <option value="ecriture">écriture</option>
                    </select>
                  </label>
                  <label className="ligne">
                    <input type="checkbox" name="admetInvites" defaultChecked={p?.admetInvites ?? true} /> Un invité de
                    cette app peut voir ce qu&apos;elle voit
                  </label>
                  <label className="ligne">
                    <input type="checkbox" name="domicile" defaultChecked={p?.domicile ?? false} /> Inclure le domicile
                    (exige le niveau 2)
                  </label>
                  <div className="actions-fait">
                    <button type="submit" className="bouton bouton-principal">
                      Enregistrer
                    </button>
                  </div>
                </form>

                {p && (
                  <div className="actions-fait">
                    <form action={retirerAction}>
                      <input type="hidden" name="appId" value={appId} />
                      <button type="submit" className="bouton-texte">
                        Retirer le réglage
                      </button>
                    </form>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
