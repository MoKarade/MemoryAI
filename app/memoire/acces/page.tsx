// app/memoire/acces/page.tsx — l'onglet ACCÈS de la page Mémoire (MemoryAI#74, maquette v5) :
// la part des faits par niveau, le journal des lectures, ce qui attend ta réponse, quand chaque
// lecteur lit, qui peut lire quel niveau, ce qui protège la mémoire et les oublis.
//
// ⚠️ Rien de la maquette n'est recopié tel quel : ses chiffres sont fictifs. Chaque bloc lit la
// base (`lib/memoire/depotAcces.ts`) et dit honnêtement quand il n'y a rien. Le journal ne
// porte que des métadonnées signées : jamais une question, jamais une valeur.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import Link from "next/link";
import { CoqueMemoire } from "@/components/CoqueMemoire";
import { CorpsTuile } from "@/components/TableauEspace";
import { Tuile, Vide } from "@/components/Tuile";
import { depotQuestionsDrizzle } from "@/lib/depotQuestions";
import { FUSEAU } from "@/lib/fuseau";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { corpsAConfirmer } from "@/lib/memoire/tuilesMemoire";
import { carteHoraire, GARDE_FOUS, libelleLecteur, matriceNiveaux, NIVEAUX, partsParNiveau, REGLE_NIVEAU, type FiltreJournal, type Permis } from "@/lib/memoire/acces";
import { depotAccesDrizzle } from "@/lib/memoire/depotAcces";
import { JETON_NIVEAU } from "@/lib/memoire/reseau";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { MAX_OUVERTES } from "@/lib/questions";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const JOURNAL = 40;
const FENETRE_JOURS = 30;
const LECTURES_MAX = 5000;
/** Largeur réservée aux noms des lecteurs, à gauche de la carte horaire. */
const G = 64;

const quand = new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: FUSEAU });
const jour = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: FUSEAU });
const teinte = (n: number) => ({ "--teinte": `var(${JETON_NIVEAU[n] ?? "--texte-doux"})` }) as React.CSSProperties;

/** Le début de la fenêtre de la carte horaire. */
const joursAvant = (maintenant: Date, jours: number) => new Date(maintenant.getTime() - jours * 86_400_000);

const premier = (brut: string | string[] | undefined) => (Array.isArray(brut) ? brut[0] : brut);

function lireFiltre(p: Record<string, string | string[] | undefined>): FiltreJournal {
  if (premier(p.qui) === "toi") return "toi";
  const n = Number(premier(p.niveau));
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : null;
}

const PERMIS: Record<Permis, string> = { oui: "toujours", "sur-demande": "sur demande", non: "jamais" };

export default async function AccesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <CoqueMemoire actif="acces">
        <Vide>{MESSAGES_MANQUE[acces.manque]}</Vide>
      </CoqueMemoire>
    );
  }

  const filtre = lireFiltre(await searchParams);
  const depot = depotAccesDrizzle(acces.db);
  const depuis = joursAvant(new Date(), FENETRE_JOURS);
  const [comptes, journal, lectures, oublis, questions] = await Promise.all([
    depot.faitsParNiveau(),
    depot.journal(JOURNAL, filtre),
    depot.lecturesDepuis(depuis, LECTURES_MAX),
    depot.oublis(5),
    depotQuestionsDrizzle(acces.db).ouvertes(MAX_OUVERTES),
  ]);
  const parts = partsParNiveau(comptes);
  const carte = carteHoraire(lectures);
  // Seulement SI les bascules sont posées, jamais leur valeur.
  const matrice = matriceNiveaux({ n2: n2Autorise(), n3: n3Autorise() });

  return (
    <CoqueMemoire actif="acces">
      <div className="tableau">
        <Tuile largeur={12} icone="lock" titre="Niveaux">
          {parts.every((p) => p.part === null) ? (
            <p className="doux">Aucun fait validé pour l&apos;instant : rien à répartir.</p>
          ) : (
            <div className="empile" role="img" aria-label={`Part des faits validés par niveau : ${parts.map((p) => `N${p.niveau} ${p.part} %`).join(", ")}`}>
              {parts.map((p) => (p.total > 0 ? <i key={p.niveau} style={{ ...teinte(p.niveau), width: `${p.part}%` }} /> : null))}
            </div>
          )}
          <ul className="regles">
            {parts.map((p) => (
              <li key={p.niveau} style={teinte(p.niveau)}>
                <b>N{p.niveau}</b>
                <span>{p.total.toLocaleString("fr-CA")} fait{p.total > 1 ? "s" : ""}{p.part === null ? "" : ` · ${p.part} %`}</span>
                <small className="doux">{REGLE_NIVEAU[p.niveau]}</small>
              </li>
            ))}
          </ul>
        </Tuile>

        <Tuile largeur={7} icone="search" titre="Journal d’accès">
          <nav className="puces-filtre" aria-label="Filtrer par niveau servi ou par lecteur">
            <Link href="/memoire/acces" aria-current={filtre === null ? "true" : undefined}>Tout</Link>
            {NIVEAUX.map((n) => (
              <Link key={n} href={`/memoire/acces?niveau=${n}`} aria-current={filtre === n ? "true" : undefined} style={teinte(n)}>
                N{n}
              </Link>
            ))}
            <Link href="/memoire/acces?qui=toi" aria-current={filtre === "toi" ? "true" : undefined}>Toi</Link>
          </nav>
          {journal.length === 0 ? (
            <p className="doux">
              {filtre === null ? "Personne n'a encore lu la mémoire." : filtre === "toi" ? "Ta conversation n'a encore rien lu." : `Aucune lecture n'a servi jusqu'au niveau ${filtre}.`}
            </p>
          ) : (
            <ul className="journal-acces">
              {journal.map((l) => (
                <li key={l.id}>
                  <time dateTime={l.ts.toISOString()}>{quand.format(l.ts)}</time>
                  <span>
                    {libelleLecteur(l.lecteur)} <span className="doux">· {l.outil}</span>
                  </span>
                  <span className="doux">
                    {l.nFaits ?? "?"} fait{l.nFaits === 1 ? "" : "s"}
                    {l.nPieces ? `, ${l.nPieces} papier${l.nPieces > 1 ? "s" : ""}` : ""}
                  </span>
                  <span className="memoire-niveau-pastille" style={teinte(l.niveauMaxServi)}>
                    N{l.niveauMaxServi}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tuile>

        <Tuile largeur={5} icone="cardok" titre="À confirmer">
          {corpsAConfirmer(questions, new Date()).map((c, i) => (
            <CorpsTuile key={i} c={c} />
          ))}
        </Tuile>

        <Tuile largeur={6} icone="eye" titre="Quand elle lit quoi">
          {carte.lecteurs.length === 0 ? (
            <p className="doux">Aucune lecture ces {FENETRE_JOURS} derniers jours.</p>
          ) : (
            // Défile sur téléphone : focusable pour défiler au clavier (axe, scrollable-region-focusable).
            <div className="defile-heures" tabIndex={0} role="region" aria-label="Carte des lectures par heure, défilante">
              <svg
                className="carte-heures"
                viewBox={`0 0 ${G + 24 * 12} ${carte.lecteurs.length * 14 + 16}`}
                role="img"
                aria-label={`Lectures par heure sur ${FENETRE_JOURS} jours, par lecteur : ${carte.lecteurs.map((l, i) => `${libelleLecteur(l)} ${carte.cases[i]?.reduce((s, x) => s + x, 0)}`).join(", ")}`}
              >
                {carte.lecteurs.map((l, i) => (
                  <text key={l} x={0} y={i * 14 + 9}>
                    {libelleLecteur(l)}
                  </text>
                ))}
                {carte.cases.map((ligne, i) =>
                  ligne.map((v, h) => (
                    <rect key={`${i}-${h}`} x={G + h * 12} y={i * 14} width={10} height={12} rx={2.5} fill="var(--accent)" fillOpacity={(0.06 + (carte.max ? (v / carte.max) * 0.85 : 0)).toFixed(2)} />
                  )),
                )}
                <text x={G} y={carte.lecteurs.length * 14 + 12}>0 h</text>
                <text x={G + 12 * 12} y={carte.lecteurs.length * 14 + 12} textAnchor="middle">12 h</text>
                <text x={G + 24 * 12 - 2} y={carte.lecteurs.length * 14 + 12} textAnchor="end">24 h</text>
              </svg>
            </div>
          )}
        </Tuile>

        <Tuile largeur={6} icone="tool" titre="Outils et niveaux">
          <table className="matrice-niveaux">
            <caption className="sr-only">Qui peut lire quel niveau, tel que le code l&apos;applique aujourd&apos;hui</caption>
            <thead>
              <tr>
                <td />
                {NIVEAUX.map((n) => (
                  <th key={n} scope="col" style={teinte(n)}>
                    N{n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrice.map((l) => (
                <tr key={l.libelle}>
                  <th scope="row">{l.libelle}</th>
                  {NIVEAUX.map((n) => (
                    <td key={n} data-permis={l.cases[n]} style={teinte(n)}>
                      <i aria-hidden="true" />
                      <span className="sr-only">{PERMIS[l.cases[n]]}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="doux">Plein : toujours. Anneau : sur demande, un appel à la fois. Petit point : jamais.</p>
        </Tuile>

        <Tuile largeur={6} icone="shield" titre="Garde-fous">
          <ul className="garde-fous">
            {GARDE_FOUS.map((g) => (
              <li key={g.texte}>{g.texte}</li>
            ))}
          </ul>
        </Tuile>

        <Tuile largeur={6} icone="trash" titre="Oublis">
          <p className="chiffre">{oublis.total.toLocaleString("fr-CA")}</p>
          <p className="doux">{oublis.total > 1 ? "faits oubliés, qui ne reviendront pas" : "fait oublié, qui ne reviendra pas"}</p>
          {oublis.derniers.length > 0 ? (
            <ul className="liste-simple doux" aria-label="Les derniers oublis">
              {oublis.derniers.map((d) => (
                <li key={d.toISOString()}>{jour.format(d)}</li>
              ))}
            </ul>
          ) : null}
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}
