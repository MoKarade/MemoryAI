// app/memoire/historique/page.tsx — l'onglet HISTORIQUE de la page Mémoire (MemoryAI#74, maquette
// v5) : ce que LIA a écrit en mémoire sur 26 semaines, ses lectures et sa dépense des 14 derniers
// jours, et ses conversations par source.
//
// ⚠️ Des comptes seulement, rien de déchiffré (`lib/memoire/depotHistorique.ts`). Les blocs de la
// maquette qui n'ont pas de mesure (humeur, relances, corrections) ne sont pas dessinés.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import Link from "next/link";
import { Histogramme } from "@/components/Histogramme";
import { CoqueMemoire } from "@/components/CoqueMemoire";
import { Tuile, Vide } from "@/components/Tuile";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { FUSEAU } from "@/lib/fuseau";
import { depotHistoriqueDrizzle } from "@/lib/memoire/depotHistorique";
import { grilleEcritures, joursFenetre, LIBELLE_SOURCE, serieJours } from "@/lib/memoire/historique";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const SEMAINES = 26;
const JOURS = 14;
const CASE = 13;

const jourCourt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: FUSEAU });
const usd = (v: number) => `${v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
/** Le début d'une fenêtre de `jours` jours finissant aujourd'hui (une marge d'un jour pour le fuseau). */
const debutFenetre = (maintenant: Date, jours: number) => new Date(maintenant.getTime() - (jours + 1) * 86_400_000);

export default async function HistoriquePage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <CoqueMemoire actif="historique">
        <Vide>{MESSAGES_MANQUE[acces.manque]}</Vide>
      </CoqueMemoire>
    );
  }

  const maintenant = new Date();
  const aujourdhui = jourQuebec(maintenant);
  const depot = depotHistoriqueDrizzle(acces.db);
  const [faits, lectures, sources, depenses] = await Promise.all([
    depot.faitsParJour(debutFenetre(maintenant, SEMAINES * 7)),
    depot.lecturesParJour(debutFenetre(maintenant, JOURS)),
    depot.conversationsParSource(),
    depotAdminDrizzle(acces.db).depenseParJour(JOURS),
  ]);
  const grille = grilleEcritures(faits, aujourdhui, SEMAINES);
  const jours = joursFenetre(aujourdhui, JOURS);
  const barresLectures = serieJours(lectures, aujourdhui, JOURS).map((x) => ({ cle: x.jour, etiquette: x.jour.slice(5), valeur: x.n }));
  const totalLectures = barresLectures.reduce((s, b) => s + b.valeur, 0);
  const depenseDe = new Map(depenses.map((d) => [d.jour, Object.values(d.parPoste).reduce((a, b) => a + b, 0)]));
  const barresDepense = jours.map((jour) => {
    const v = depenseDe.get(jour) ?? 0;
    return { cle: jour, etiquette: jour.slice(5), valeur: v, texte: usd(v) };
  });
  const totalDepense = barresDepense.reduce((s, b) => s + b.valeur, 0);

  return (
    <CoqueMemoire actif="historique">
      <div className="tableau">
        <Tuile largeur={6} icone="chat" titre="Ses conversations">
          {sources.length === 0 ? (
            <p className="doux">Aucune conversation enregistrée.</p>
          ) : (
            <ul className="liste-simple">
              {sources.map((s) => (
                <li key={s.source}>
                  <span>
                    {LIBELLE_SOURCE[s.source] ?? s.source}
                    {s.derniere ? <small className="doux"> · {jourCourt.format(s.derniere)}</small> : null}
                  </span>
                  <span>
                    {s.conversations.toLocaleString("fr-CA")} <small className="doux">({s.messages.toLocaleString("fr-CA")} messages)</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/conversations" className="bouton bouton-second">
            Toutes les conversations
          </Link>
        </Tuile>

        <Tuile largeur={6} icone="eye" titre={`Ses lectures, ${JOURS} jours`}>
          {totalLectures === 0 ? (
            <p className="doux">Aucune lecture ces {JOURS} derniers jours.</p>
          ) : (
            <Histogramme barres={barresLectures} unite="lecture" resume={`${totalLectures} lectures du ${jours[0]} au ${aujourdhui}, au plus ${Math.max(...barresLectures.map((b) => b.valeur))} en une journée.`} />
          )}
        </Tuile>

        <Tuile largeur={7} icone="db" titre="Ce qu’elle a écrit" repliee>
          <p className="doux">
            {grille.total.toLocaleString("fr-CA")} fait{grille.total > 1 ? "s" : ""} écrit{grille.total > 1 ? "s" : ""} en mémoire sur {SEMAINES} semaines
          </p>
          <div className="defile-heures">
            <svg
              className="grille-ecritures"
              viewBox={`0 0 ${SEMAINES * CASE} ${7 * CASE}`}
              role="img"
              aria-label={`Faits écrits par jour sur ${SEMAINES} semaines : ${grille.total} en tout, au plus ${grille.max} en une journée.`}
            >
              {grille.semaines.map((semaine, s) =>
                semaine.map((n, j) =>
                  n === null ? null : (
                    <rect key={`${s}-${j}`} x={s * CASE} y={j * CASE} width={CASE - 3} height={CASE - 3} rx={2.5} fill="var(--repere)" fillOpacity={(0.08 + (grille.max ? (n / grille.max) * 0.85 : 0)).toFixed(2)} />
                  ),
                ),
              )}
            </svg>
          </div>
        </Tuile>

        <Tuile largeur={5} icone="coin" titre={`Sa dépense, ${JOURS} jours`}>
          {totalDepense === 0 ? (
            <p className="doux">Aucune dépense ces {JOURS} derniers jours.</p>
          ) : (
            <>
              <p className="doux">{usd(totalDepense)} en tout</p>
              <Histogramme barres={barresDepense} unite="$ US" resume={`Dépense du ${jours[0]} au ${aujourdhui} : ${usd(totalDepense)} en tout.`} />
            </>
          )}
          <Link href="/depenses" className="bouton bouton-second">
            Dépenses et plafonds
          </Link>
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}
