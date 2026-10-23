// app/regler/sauvetage/page.tsx — le sauvetage du 23/10/2026, vu et conduit par Marc (ADR 0019).
//
// Cette page ne déchiffre RIEN : elle compte. Ce qui est sauvé, ce qui reste, et pourquoi une
// ligne a échoué — des nombres et des raisons fermées, jamais une valeur.
//
// Ce qu'on peut y faire suit les étapes de l'ADR : lancer le sauvetage (étape 4, relançable) et
// le clore (étape 6, qui rouvre les écritures des apps). Les deux écrivent en base ; Marc les a
// dits oui sur une carte avant que la page n'existe en production.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { SauvetageEnDirect } from "@/components/SauvetageEnDirect";
import { FUSEAU } from "@/lib/fuseau";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { depotSauvetageDrizzle } from "@/lib/sauvetage/depot";
import { configOracle } from "@/lib/sauvetage/oracle";
import { MOT_CLORE } from "@/lib/sauvetage/porte";
import { requireSession } from "@/lib/session";
import { cloreSauvetageAction } from "./actions";

export const dynamic = "force-dynamic";
/** Une passe dure au plus 240 s : la page lui laisse 300 s. */
export const maxDuration = 300;

/** Ce que chaque raison d'échec veut dire, en français. Les codes viennent de `RAISONS_SAUVETAGE`. */
const LIBELLES_RAISON: Record<string, string> = {
  "page-absente": "l’ancien déploiement n’a pas rendu la page",
  "sommaire-n3": "papier N3 que l’ancien déploiement ne montre pas",
  "absent-de-la-page": "une valeur n’est pas sur la page",
  "taille-differente": "la valeur relue n’a pas la bonne taille",
  concurrence: "la ligne a changé pendant le sauvetage",
  "illisible-nouvelle-cle": "illisible sous la nouvelle clé",
  "erreur-ecriture": "la base a refusé l’écriture",
  "oracle-en-panne": "l’ancien déploiement n’a pas répondu",
};

const MESSAGES_CLORE: Record<string, string> = {
  ok: "Sauvetage clos : les écritures des apps sont rouvertes. Ce qui reste illisible est gardé, pas effacé.",
  deja: "Le sauvetage était déjà clos.",
  mot: `Rien n’a été clos : il faut taper ${MOT_CLORE} exactement.`,
  acces: "Rien n’a été clos : la base ou la clé manque.",
};

function quand(d: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "long", timeStyle: "short", timeZone: FUSEAU }).format(d);
}

export default async function SauvetagePage({ searchParams }: { searchParams: Promise<{ clore?: string }> }) {
  await requireSession();
  const { clore } = await searchParams;
  const acces = await accesDonnees();
  const config = configOracle();
  const bilan = acces.ok ? await depotSauvetageDrizzle(acces.db).bilan() : null;
  const ouvert = bilan !== null && bilan.ouvertLe !== null && bilan.closLe === null;
  const echecs = Object.entries(bilan?.echecs ?? {}).filter(([, n]) => (n ?? 0) > 0);

  return (
    <>
      <Nav active="regler" />
      <main className="page">
        <p className="surtitre">
          <Link href="/regler">← Régler</Link>
        </p>
        <h1>Sauvetage de la mémoire</h1>
        <p className="lead">
          La clé qui chiffrait la mémoire a été effacée le 23 octobre. L’ancienne version de l’app la garde encore : le
          sauvetage lui relit chaque fait et chaque papier, puis le rechiffre sous la nouvelle clé. L’ancien chiffré est
          archivé, jamais effacé.
        </p>
        {clore && MESSAGES_CLORE[clore] && <p className={clore === "ok" ? "hint" : "alerte bandeau"}>{MESSAGES_CLORE[clore]}</p>}
        {!acces.ok && <p className="alerte bandeau">{MESSAGES_MANQUE[acces.manque]}</p>}

        {bilan && bilan.ouvertLe === null && (
          <p className="hint">Rien à sauver : cette base n’avait ni fait ni papier quand la nouvelle clé est arrivée.</p>
        )}

        {bilan && bilan.ouvertLe !== null && (
          <section className="carte tuile" aria-labelledby="ou-on-en-est">
            <h2 id="ou-on-en-est">Où on en est</h2>
            <dl className="attributs">
              <div>
                <dt>Faits</dt>
                <dd>
                  {bilan.faits.sauves} sauvé(s) · {bilan.faits.aSauver} à sauver
                </dd>
              </div>
              <div>
                <dt>Papiers</dt>
                <dd>
                  {bilan.pieces.sauves} sauvé(s) · {bilan.pieces.aSauver} à sauver
                  {bilan.pieces.horsSauvetage > 0 ? ` · ${bilan.pieces.horsSauvetage} retiré(s) ou remplacé(s), gardés tels quels` : ""}
                </dd>
              </div>
              <div>
                <dt>Oublis</dt>
                <dd>
                  {bilan.oublisAveugles} gardé(s), que la nouvelle clé ne reconnaît plus : un papier oublié pourrait revenir
                </dd>
              </div>
              <div>
                <dt>Ouvert</dt>
                <dd>{quand(bilan.ouvertLe)}</dd>
              </div>
              {bilan.closLe && (
                <div>
                  <dt>Clos</dt>
                  <dd>{quand(bilan.closLe)}</dd>
                </div>
              )}
            </dl>
            {echecs.length > 0 && (
              <>
                <h3>Pourquoi des lignes n’ont pas été sauvées</h3>
                <ul className="liste-simple">
                  {echecs.map(([raison, n]) => (
                    <li key={raison}>
                      {n} · {LIBELLES_RAISON[raison] ?? raison}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {ouvert && (
          <section className="carte tuile" aria-labelledby="lancer">
            <h2 id="lancer">Lancer</h2>
            {config.ok ? (
              <>
                <p className="hint">
                  Relançable autant que tu veux : une ligne sauvée ne l’est qu’une fois, une ligne en échec est retentée.
                </p>
                <SauvetageEnDirect />
              </>
            ) : (
              <p className="alerte bandeau">Il manque des réglages pour joindre l’ancienne version : {config.manque.join(", ")}.</p>
            )}
          </section>
        )}

        {ouvert && (
          <section className="carte tuile zone-rouge" aria-labelledby="clore">
            <h2 id="clore">Clore le sauvetage</h2>
            <p className="hint">
              Ce qui n’est pas sauvé reste illisible, gardé dans la base et dans l’archive. Les apps peuvent de nouveau écrire
              dans la mémoire. L’ancienne version de l’app ne doit pas être supprimée : c’est elle qui relirait l’archive.
            </p>
            <form action={cloreSauvetageAction}>
              <label htmlFor="confirmation">Tape {MOT_CLORE} pour clore</label>
              <input id="confirmation" className="champ" name="confirmation" type="text" autoComplete="off" required />
              <button type="submit" className="bouton bouton-danger">
                Clore le sauvetage
              </button>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
