// app/memoire/historique/page.tsx — l'onglet HISTORIQUE de la page Mémoire (MemoryAI#74, maquette
// v5), dans l'ordre de la maquette : son humeur, ce qu'elle a fait, ses relances, ses journées
// (lectures et dépense des 14 derniers jours), ce qu'elle a corrigé, ses conversations, ce qu'elle
// a écrit sur 26 semaines et ses actions par jour.
//
// ⚠️ Des comptes, des prédicats et des métadonnées seulement, rien de déchiffré
// (`lib/memoire/depotHistorique.ts`). Ce qui n'a pas de mesure (humeur, relances) est dessiné
// VIDE à sa place, et le dit.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import Link from "next/link";
import { Histogramme } from "@/components/Histogramme";
import { CoqueMemoire } from "@/components/CoqueMemoire";
import { Tuile, Vide } from "@/components/Tuile";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { FUSEAU } from "@/lib/fuseau";
import { CorpsTuile } from "@/components/TableauEspace";
import { depotAccesDrizzle } from "@/lib/memoire/depotAcces";
import { depotHistoriqueDrizzle } from "@/lib/memoire/depotHistorique";
import { corpsCeQuElleAFait, corpsCorrections, FILTRES_FAIT, grilleEcritures, journees, joursFenetre, LIBELLE_SOURCE, lireFiltreFait, serieJours } from "@/lib/memoire/historique";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const SEMAINES = 26;
const JOURS = 14;
const CASE = 13;
const DERNIERES = 8;

const jourCourt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: FUSEAU });
const usd = (v: number) => `${v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
/** Le début d'une fenêtre de `jours` jours finissant aujourd'hui (une marge d'un jour pour le fuseau). */
const debutFenetre = (maintenant: Date, jours: number) => new Date(maintenant.getTime() - (jours + 1) * 86_400_000);

export default async function HistoriquePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
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
  const filtre = lireFiltreFait((await searchParams)?.fait);
  const [faits, lectures, sources, depenses, corrections, dernieres] = await Promise.all([
    depot.faitsParJour(debutFenetre(maintenant, SEMAINES * 7)),
    depot.lecturesParJour(debutFenetre(maintenant, JOURS)),
    depot.conversationsParSource(),
    depotAdminDrizzle(acces.db).depenseParJour(JOURS),
    depot.corrections(DERNIERES),
    depotAccesDrizzle(acces.db).journal(DERNIERES, null),
  ]);
  const grille = grilleEcritures(faits, aujourdhui, SEMAINES);
  const jours = joursFenetre(aujourdhui, JOURS);
  const barresLectures = serieJours(lectures, aujourdhui, JOURS).map((x) => ({ cle: x.jour, etiquette: x.jour.slice(5), valeur: x.n }));
  const totalLectures = barresLectures.reduce((s, b) => s + b.valeur, 0);
  const depenseDe = new Map(depenses.map((d) => [d.jour, Object.values(d.parPoste).reduce((a, b) => a + b, 0)]));
  const sesJournees = journees(jours, lectures, depenseDe);
  const totalDepense = sesJournees.reduce((t, j) => t + j.depense, 0);

  return (
    <CoqueMemoire actif="historique">
      <div className="tableau">
        <Tuile largeur={12} icone="heart" titre="Son humeur, 14 jours">
          <Vide>Son humeur n&apos;est pas encore gardée jour après jour : ce bloc se remplira quand MemoryAI tiendra son état.</Vide>
        </Tuile>

        <Tuile largeur={7} icone="clock" titre="Ce qu’elle a fait">
          <nav className="puces-filtre" aria-label="Filtrer ce qu'elle a fait">
            {FILTRES_FAIT.map((f) => (
              <Link key={f.cle} href={f.cle === "tous" ? "/memoire/historique" : `/memoire/historique?fait=${f.cle}`} aria-current={filtre === f.cle ? "true" : undefined}>
                {f.libelle}
              </Link>
            ))}
          </nav>
          <CorpsTuile c={corpsCeQuElleAFait(dernieres, filtre)} />
        </Tuile>

        <Tuile largeur={5} icone="bell" titre="Ses relances">
          <Vide>Aucune relance : elle n&apos;en fait pas encore.</Vide>
        </Tuile>

        <Tuile largeur={12} icone="cal" titre="Ses journées">
          {sesJournees.every((j) => j.lectures === 0 && j.depense === 0) ? (
            <p className="doux">Aucune lecture ni dépense ces {JOURS} derniers jours.</p>
          ) : (
            <>
              <ol className="journees" tabIndex={0} aria-label={`Ses ${JOURS} derniers jours, le plus récent d'abord`}>
                {sesJournees.map((j) => (
                  <li key={j.jour}>
                    <b>{j.etiquette}</b>
                    <span>
                      {j.lectures.toLocaleString("fr-CA")} lecture{j.lectures > 1 ? "s" : ""}
                    </span>
                    <span className="doux">{usd(j.depense)}</span>
                  </li>
                ))}
              </ol>
              <p className="doux">{usd(totalDepense)} en tout sur {JOURS} jours</p>
            </>
          )}
          <Link href="/depenses" className="bouton bouton-second">
            Dépenses et plafonds
          </Link>
        </Tuile>

        <Tuile largeur={6} icone="croix" titre="Ce qu’elle a corrigé">
          <CorpsTuile c={corpsCorrections(corrections)} />
        </Tuile>

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

        <Tuile largeur={5} icone="chart" titre="Actions par jour" repliee>
          {totalLectures === 0 ? (
            <p className="doux">Aucune lecture ces {JOURS} derniers jours.</p>
          ) : (
            <Histogramme barres={barresLectures} unite="lecture" resume={`${totalLectures} lectures du ${jours[0]} au ${aujourdhui}, au plus ${Math.max(...barresLectures.map((b) => b.valeur))} en une journée.`} />
          )}
        </Tuile>

      </div>
    </CoqueMemoire>
  );
}
