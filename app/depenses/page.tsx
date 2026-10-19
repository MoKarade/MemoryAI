// app/depenses/page.tsx — DÉPENSES : ce que ça coûte, et les plafonds.
//
// ⚠️ [ADR 0009, 23/09] « où en est la lecture » a DÉMÉNAGÉ dans l'onglet Avancement : un même
// compte affiché à deux endroits finit par dériver. Les paragraphes [L38] ci-dessous racontent
// l'histoire de cette page ; les graphes de lecture vivent désormais là-bas.
//
// [L34] Décision de Marc, 18/09 : « jveux pouvoir choisir dans lapp je veux aussi un onglet
// dédié aux depenses a limport etc ».
// [L38] Puis : « je veux des graphs voir ce qui reste ce qui a été traité depuis combien de
// temps etc combien de liens fais etc ».
//
// ── POURQUOI UN ONGLET, ALORS QUE L26a EN A RETIRÉ CINQ ──────────────────────────────────
//
// Ce n'est pas une rechute : L26a a retiré des onglets que Marc ne regardait pas, et il en
// demande un qu'il va regarder. La différence est mesurable — celui-ci porte les choses qu'on
// surveille pendant qu'un import de ~2 645 documents tourne. Un dépli de Régler ne
// conviendrait pas : on n'ouvre pas un dépli toutes les dix minutes.
//
// ⚠️ Et c'est un ATELIER, au sens de la règle dégagée par L26b2 : il porte un formulaire qui
// ÉCRIT (les plafonds). L'information reste visible dans Régler → État, qui est le hub. Le hub
// DIT, l'atelier RÈGLE.
//
// ── LES GRAPHES : RENDUS AU SERVEUR, SANS JAVASCRIPT ─────────────────────────────────────
//
// Même patron que `GrapheSvg` : du SVG statique, zéro ligne de JavaScript envoyée au
// navigateur, aucune couleur en dur (tout par les jetons de `globals.css`, donc le dessin suit
// `prefers-color-scheme`), et un résumé parlé pour les lecteurs d'écran. Les composants
// refusent de dessiner ce qu'ils ne savent pas : une série vide ne rend rien, et une part
// inconnue ne rend pas une jauge à zéro.
//
// ⚠️ La lecture se calcule dans `lib/importEtat.ts`, un module PUR (consommé par Avancement). Sur un tableau de
// bord, chaque chiffre est une affirmation — et les trois pièges (deux rythmes différents, un
// rythme nul qui donnerait `Infinity`, un pourcentage sur un total nul) sont documentés et
// gardés là-bas plutôt que dispersés dans du JSX intestable.
//
// ── CE QUE CETTE PAGE NE FAIT PAS ────────────────────────────────────────────────────────
//
// Elle ne LANCE pas l'import et ne dit pas dans quel ORDRE il lira (Marc a choisi « par valeur
// d'émetteur », export Facebook « en dernier » — c'est `[L35]`). Et la LECTURE vit dans
// DriveAI : ce dépôt-ci reçoit les papiers (`POST /api/pieces`), il ne les extrait pas.

import Link from "next/link";
import { Histogramme, type Barre } from "@/components/Histogramme";
import { Nav } from "@/components/Nav";
import {
  PLAFONDS_DEFAUT_USD_PAR_JOUR,
  PLAFOND_MAX_USD_PAR_JOUR,
  PLAFOND_MIN_USD_PAR_JOUR,
  POSTES,
  jourQuebec,
  type Poste,
} from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { LIBELLES_LIEN } from "@/lib/faitPhrase";
import { estGele } from "@/lib/gel";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { reglerPlafondAction } from "./actions";

export const dynamic = "force-dynamic";

const usd = (n: number) => `${n.toFixed(2)} $ US`;

/** Combien de jours les histogrammes montrent. Au-delà, les barres deviennent illisibles. */
const JOURS_MONTRES = 30;

/** `2026-09-18` → `09-18` : l'année ne discrimine rien sur trente jours et vole la place. */
const jourCourt = (j: string) => j.slice(5);

/** Ce que chaque poste paie, en français — un nom de colonne n'explique rien. */
const LIBELLES_POSTE: Record<Poste, string> = {
  chat: "Parler avec Lia",
  apprentissage: "Lire tes documents et en tirer des faits",
};

export default async function DepensesPage() {
  await requireSession();
  const acces = await accesDonnees();
  const gele = estGele();

  if (!acces.ok) {
    return (
      <>
        <Nav active="depenses" />
        <main className="page">
          <h1>Dépenses</h1>
          <p className="alerte bandeau">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const admin = depotAdminDrizzle(acces.db);
  const jour = jourQuebec(new Date());
  const [plafonds, parPoste, total, depenseParJour, liens] = await Promise.all([
    admin.plafonds(),
    admin.depenseDuJourParPoste(jour),
    admin.depenseTotaleUsd(),
    admin.depenseParJour(JOURS_MONTRES),
    depotLiensDrizzle(acces.db).comptes(),
  ]);

  // Les barres sont construites ICI, pas dans le composant : lui ne sait pas ce que la série
  // MESURE, donc il ne peut pas en composer le résumé parlé.
  const barresDepense: Barre[] = depenseParJour.map((j) => {
    // Le TOTAL du jour, tous postes : c'est à ça que se compare le budget de la journée.
    const valeur = POSTES.reduce((n, p) => n + j.parPoste[p], 0);
    // ⚠️ `texte` FORMATÉ, parce que la somme de colonnes `real` donne des flottants comme
    // `3.1400000000000006` : un chiffre juste, écrit d'une façon qui a l'air d'un bug. Le
    // composant ne sait pas si la série compte des documents ou des dollars, donc c'est ici.
    return { cle: j.jour, etiquette: jourCourt(j.jour), valeur, texte: valeur.toFixed(2) };
  });
  const depenseSurLaFenetre = barresDepense.reduce((n, b) => n + b.valeur, 0);

  return (
    <>
      <Nav active="depenses" />
      <main className="page">
        <h1>Dépenses</h1>
        <p className="lead">
          Ce que la mémoire coûte. Les plafonds sont à toi : un plafond existe
          toujours et ne se désactive pas, mais c’est toi qui en fixes la hauteur.
        </p>
        {gele && (
          <p className="alerte bandeau">
            Mémoire gelée (<code>MEMORYAI_GEL=1</code>) : rien n’est servi ni écrit par les machines, donc rien ne se
            dépense. Cette page reste lisible.
          </p>
        )}

        {/* [ADR 0009] Le suivi de la LECTURE a déménagé dans l'onglet Avancement, le 23/09. Un
            même compte affiché à deux endroits finit par dériver ; cette page redevient ce que
            dit son nom. */}
        <p className="hint">
          Où en est la lecture de tes papiers : <Link href="/avancement">onglet Avancement</Link>.
        </p>

        <section className="carte tuile" aria-labelledby="cout">
          <h2 id="cout">Ce que ça coûte</h2>
          <dl className="attributs">
            {POSTES.map((p) => {
              const depense = parPoste[p];
              const plafond = plafonds[p];
              const reste = Math.max(0, plafond - depense);
              return (
                <div key={p}>
                  <dt>{LIBELLES_POSTE[p]}</dt>
                  <dd>
                    {usd(depense)} sur {usd(plafond)}
                    {/* ⚠️ « Fermé » et « il reste 0,00 $ » disent la même chose, et la première
                        le dit mieux : la comparaison du code est STRICTE (`depense < plafond`),
                        donc atteindre le plafond ferme le poste. Afficher « il reste 0 $ »
                        laisserait croire qu’un dernier appel passe encore. */}
                    {depense >= plafond ? " — fermé pour aujourd’hui" : ` — il reste ${usd(reste)}`}
                    {plafond === 0 ? " (en pause : tu as mis le plafond à zéro)" : ""}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>depuis le début</dt>
              <dd>
                {usd(total.total)} en {total.appels} appel{total.appels > 1 ? "s" : ""}
                {/* Le coût MOYEN par appel est ce qui permet d’estimer ce que coûtera la suite —
                    c’est la seule grandeur de cette page qui serve à décider. Sur zéro appel,
                    elle n’existe pas : on ne l’invente pas. */}
                {total.appels > 0 ? ` · ${usd(total.total / total.appels)} par appel en moyenne` : ""}
              </dd>
            </div>
          </dl>

          <h3>Dépense par jour, tous postes</h3>
          {barresDepense.length === 0 ? (
            <p className="hint">Aucune dépense enregistrée.</p>
          ) : (
            <Histogramme
              barres={barresDepense}
              unite="$ US"
              // ⚠️ La PLAGE DE DATES, comme l'autre histogramme : l'un donnait à l'œil ce que
              // l'autre taisait à l'oreille. Et les dates COMPLÈTES, pas le `MM-JJ` de l'axe —
              // « du 08-28 au 09-18 » lu à voix haute ne dit pas l'année.
              resume={`Dépense sur ${barresDepense.length} jour(s), du ${depenseParJour[0]?.jour} au ${
                depenseParJour[depenseParJour.length - 1]?.jour
              } : ${usd(depenseSurLaFenetre)} en tout, au plus ${usd(
                Math.max(...barresDepense.map((b) => b.valeur)),
              )} en une journée.`}
            />
          )}
        </section>

        <section className="carte tuile" aria-labelledby="plafonds">
          <h2 id="plafonds">Tes plafonds</h2>
          <p className="hint">
            Par jour, à l’heure du Québec. Entre <strong>{PLAFOND_MIN_USD_PAR_JOUR} $</strong> et{" "}
            <strong>{PLAFOND_MAX_USD_PAR_JOUR} $</strong> — cette borne haute est dans le code, pas dans ce formulaire,
            pour qu’une valeur entrée par erreur ne puisse pas ouvrir une facture sans fond. Mettre{" "}
            <strong>0 $</strong> met le poste en pause sans rien casser.
          </p>
          {POSTES.map((p) => (
            <form action={reglerPlafondAction} className="ligne" key={p}>
              <input type="hidden" name="poste" value={p} />
              <label htmlFor={`plafond-${p}`}>{LIBELLES_POSTE[p]}</label>
              <input
                id={`plafond-${p}`}
                className="champ"
                name="usdParJour"
                type="number"
                inputMode="decimal"
                step="0.25"
                min={PLAFOND_MIN_USD_PAR_JOUR}
                max={PLAFOND_MAX_USD_PAR_JOUR}
                defaultValue={plafonds[p]}
                required
              />
              <button type="submit" className="bouton bouton-principal">
                Enregistrer
              </button>
              {plafonds[p] !== PLAFONDS_DEFAUT_USD_PAR_JOUR[p] && (
                <span className="hint">défaut : {usd(PLAFONDS_DEFAUT_USD_PAR_JOUR[p])}</span>
              )}
            </form>
          ))}
        </section>

        <section className="carte tuile" aria-labelledby="liens">
          <h2 id="liens">Liens entre faits</h2>
          {liens.total === 0 ? (
            <p className="hint">
              Aucun lien pour l’instant. Les cinq règles de liaison sont RECALCULÉES, jamais accumulées : lance le
              recalcul depuis <Link href="/regler">Régler → Liens</Link>.
            </p>
          ) : (
            <>
              <p className="lead">
                <strong>{liens.total}</strong> lien(s) entre faits
              </p>
              <dl className="attributs">
                {Object.entries(liens.parType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => (
                    <div key={type}>
                      <dt>{LIBELLES_LIEN[type as keyof typeof LIBELLES_LIEN] ?? type}</dt>
                      <dd>{n} lien(s)</dd>
                    </div>
                  ))}
              </dl>
              {/* ⚠️ Les liens sont RECALCULÉS à chaque passe, jamais accumulés : ce total suit
                  donc les faits, et il BAISSE quand un fait est oublié ou corrigé. Le dire,
                  sinon une baisse se lirait comme une perte de données. */}
              <p className="hint">
                Ce total suit les faits : il monte quand la mémoire grandit, et il baisse quand un fait est oublié ou
                corrigé — les liens sont recalculés, jamais accumulés.
              </p>
            </>
          )}
        </section>

      </main>
    </>
  );
}
