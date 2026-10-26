// app/memoire/apprentissage/page.tsx — l'onglet APPRENTISSAGE de la page Mémoire (MemoryAI#74,
// maquette v5), les sept tuiles de la maquette dans son ordre : la courbe du banc, la porte de
// qualité, ce qu'elle a appris de toi, ton rythme habituel, les exemples, les versions et le
// chemin réel d'un oubli. Puis, repliés, trois blocs réels que la maquette n'a pas : le banc par
// capacité, ce qu'elle te demande, et comment elle apprend.
//
// ⚠️ Des nombres seulement (`lib/memoire/depotApprentissage.ts`) : ni question du banc, ni fait.
// Les tuiles sans mesure (porte, exemples, versions : aucun réseau n'est entraîné) sont dessinées
// VIDES à leur place et le disent.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import Link from "next/link";
import { Jauge } from "@/components/Jauge";
import { CoqueMemoire } from "@/components/CoqueMemoire";
import { Tuile, Vide } from "@/components/Tuile";
import { BANC_COURANT } from "@/lib/banc/passe";
import { CAPACITES } from "@/lib/banc/banc";
import { FUSEAU } from "@/lib/fuseau";
import {
  comptesFaits,
  comptesQuestions,
  ETAPES,
  ETAPES_OUBLI,
  LIBELLE_CAPACITE,
  LIBELLE_STATUT_FAIT,
  LIBELLE_STATUT_QUESTION,
  pourcent,
  rythmeHoraire,
  serieBanc,
  type PointBanc,
} from "@/lib/memoire/apprentissage";
import { heureQuebec } from "@/lib/memoire/acces";
import { depotAccesDrizzle } from "@/lib/memoire/depotAcces";
import { depotApprentissageDrizzle } from "@/lib/memoire/depotApprentissage";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { valideesParLia } from "@/lib/relectureLia";
import { papiersVraisParLia } from "@/lib/pieces/depotRelecture";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const MESURES = 60;
const W = 400;
const H = 220;
const M = { g: 40, d: 8, h: 10, b: 24 };
const RYTHME_JOURS = 30;
const LECTURES_MAX = 5000;

const jour = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: FUSEAU });

/** La courbe du banc : rappel et abstention juste, de 0 à 100 %, une mesure par point. */
function CourbeBanc({ points }: { points: PointBanc[] }) {
  const x = (i: number) => M.g + (points.length > 1 ? (i / (points.length - 1)) * (W - M.g - M.d) : (W - M.g - M.d) / 2);
  const y = (v: number) => M.h + (1 - v) * (H - M.h - M.b);
  const trace = (cle: "rappel" | "abstention") =>
    points
      .flatMap((p, i) => {
        const v = p[cle];
        return v === null ? [] : [`${x(i).toFixed(1)},${y(v).toFixed(1)}`];
      })
      .join(" ");
  const series = [
    { cle: "rappel", teinte: "var(--repere)" },
    { cle: "abstention", teinte: "var(--info)" },
  ] as const;
  const premiere = points[0];
  const derniere = points.at(-1);
  return (
    <svg
      className="courbe-banc"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${points.length} mesure${points.length > 1 ? "s" : ""} du banc. Dernière : ${pourcent(derniere?.rappel ?? null)} des papiers attendus retrouvés, ${pourcent(derniere?.abstention ?? null)} de « je n'ai rien » justes.`}
    >
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={M.g} x2={W - M.d} y1={y(v)} y2={y(v)} stroke="var(--bordure)" />
          <text x={M.g - 6} y={y(v) + 3} textAnchor="end">
            {v * 100} %
          </text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.cle}>
          <polyline points={trace(s.cle)} fill="none" stroke={s.teinte} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => {
            const v = p[s.cle];
            return v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.teinte} />;
          })}
        </g>
      ))}
      {premiere ? (
        <text x={M.g} y={H - 4}>
          {jour.format(premiere.mesureLe)}
        </text>
      ) : null}
      {derniere && points.length > 1 ? (
        <text x={W - M.d} y={H - 4} textAnchor="end">
          {jour.format(derniere.mesureLe)}
        </text>
      ) : null}
    </svg>
  );
}

/** Ton rythme : une barre par heure autour d'un cadran, minuit en haut ; l'heure courante en accent. */
function RoseHeures({ heures, maintenant }: { heures: number[]; maintenant: number }) {
  const c = 100;
  const r0 = 34;
  const max = Math.max(1, ...heures);
  const total = heures.reduce((a, b) => a + b, 0);
  const pic = heures.indexOf(Math.max(...heures));
  const point = (h: number, r: number) => {
    const a = -Math.PI / 2 + (h * Math.PI) / 12;
    return [(c + r * Math.cos(a)).toFixed(1), (c + r * Math.sin(a)).toFixed(1)] as const;
  };
  return (
    <svg className="rose-heures" viewBox="0 0 200 200" role="img" aria-label={`${total} lecture${total > 1 ? "s" : ""} sur ${RYTHME_JOURS} jours, heure par heure (Québec) ; le plus souvent vers ${pic} h.`}>
      {heures.map((n, h) => {
        const [x1, y1] = point(h, r0);
        const [x2, y2] = point(h, r0 + Math.max(4, (n / max) * 54));
        return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke={h === maintenant ? "var(--accent)" : "var(--repere)"} strokeOpacity={h === maintenant ? 1 : 0.65} strokeWidth={6} strokeLinecap="round" />;
      })}
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = point(h, r0 - 12);
        return (
          <text key={h} x={x} y={Number(y) + 4} textAnchor="middle">
            {h}
          </text>
        );
      })}
    </svg>
  );
}

export default async function ApprentissagePage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <CoqueMemoire actif="apprentissage">
        <Vide>{MESSAGES_MANQUE[acces.manque]}</Vide>
      </CoqueMemoire>
    );
  }

  const depot = depotApprentissageDrizzle(acces.db);
  const maintenant = new Date();
  const accesDepot = depotAccesDrizzle(acces.db);
  const [lignes, faits, questions, lectures, oublis, parLia, papiersParLia] = await Promise.all([
    depot.mesures(BANC_COURANT, MESURES),
    depot.faitsAppris(),
    depot.questionsParStatut(),
    accesDepot.lecturesDepuis(new Date(maintenant.getTime() - RYTHME_JOURS * 86_400_000), LECTURES_MAX),
    accesDepot.oublis(0),
    valideesParLia(acces.db),
    papiersVraisParLia(acces.db),
  ]);
  const rythme = rythmeHoraire(lectures);
  const banc = serieBanc(lignes);
  const appris = comptesFaits(faits);
  const demandes = comptesQuestions(questions);
  const totalAppris = appris.reduce((s, c) => s + c.n, 0);
  const totalDemandes = demandes.reduce((s, c) => s + c.n, 0);
  const derniereLe = lignes[0]?.mesureLe ?? null;

  return (
    <CoqueMemoire actif="apprentissage">
      <div className="tableau">
        <Tuile largeur={7} icone="chart" titre="Erreur, semaine après semaine">
          {banc.points.length === 0 ? (
            <p className="doux">Aucune mesure du banc pour l&apos;instant. La première se prend au prochain réveil de l&apos;apprentissage.</p>
          ) : (
            <>
              <p className="doux">Les mêmes {banc.derniere?.questions ?? 0} questions à chaque fois, sur ses papiers.</p>
              <CourbeBanc points={banc.points} />
              <ul className="legende-courbe">
                <li style={{ "--teinte": "var(--repere)" } as React.CSSProperties}>Papiers attendus retrouvés</li>
                <li style={{ "--teinte": "var(--info)" } as React.CSSProperties}>« Je n&apos;ai rien » justes</li>
              </ul>
            </>
          )}
          {banc.illisibles > 0 ? <p className="doux">{banc.illisibles} mesure{banc.illisibles > 1 ? "s" : ""} illisible{banc.illisibles > 1 ? "s" : ""}, écartée{banc.illisibles > 1 ? "s" : ""} de la courbe.</p> : null}
        </Tuile>
        <Tuile largeur={5} icone="shield" titre="Porte de qualité">
          <Vide>Aucun réseau n&apos;est entraîné : il n&apos;y a pas encore de porte à franchir.</Vide>
        </Tuile>
        <Tuile largeur={6} icone="star" titre="Ce qu’elle a appris de toi">
          {totalAppris === 0 ? (
            <p className="doux">Aucun fait tiré d&apos;une conversation pour l&apos;instant.</p>
          ) : (
            <ul className="liste-simple">
              {appris.map((c) => (
                <li key={c.statut}>
                  <span>{LIBELLE_STATUT_FAIT[c.statut]}</span>
                  <span>{c.n.toLocaleString("fr-CA")}</span>
                </li>
              ))}
              {parLia > 0 && (
                <li>
                  <span>dont validés par LIA</span>
                  <span>{parLia.toLocaleString("fr-CA")}</span>
                </li>
              )}
            </ul>
          )}
          {papiersParLia > 0 ? (
            <p className="doux">
              {papiersParLia.toLocaleString("fr-CA")} papier{papiersParLia > 1 ? "s" : ""} jugé{papiersParLia > 1 ? "s" : ""} vrai{papiersParLia > 1 ? "s" : ""} par LIA (seconde lecture concordante).
            </p>
          ) : null}
        </Tuile>
        <Tuile largeur={6} icone="clock" titre="Ton rythme habituel">
          {lectures.length === 0 ? (
            <p className="doux">Aucune lecture ces {RYTHME_JOURS} derniers jours.</p>
          ) : (
            <>
              <RoseHeures heures={rythme} maintenant={heureQuebec(maintenant)} />
              <p className="doux">
                Lectures de la mémoire sur {RYTHME_JOURS} jours, heure par heure ; l&apos;heure qu&apos;il est en couleur.
              </p>
            </>
          )}
        </Tuile>
        <Tuile largeur={6} icone="pie" titre="Les exemples">
          <Vide>Aucun exemple d&apos;entraînement : ils viendront avec le premier réseau.</Vide>
        </Tuile>
        <Tuile largeur={6} icone="hist" titre="Versions">
          <Vide>Aucune version entraînée pour l&apos;instant.</Vide>
        </Tuile>
        <Tuile largeur={12} icone="trash" titre="Oubli réel" repliee>
          <ol className="etapes-apprentissage">
            {ETAPES_OUBLI.map((e) => (
              <li key={e.ou}>{e.texte}</li>
            ))}
          </ol>
          <p className="doux">
            {oublis.total.toLocaleString("fr-CA")} fait{oublis.total > 1 ? "s" : ""} oublié{oublis.total > 1 ? "s" : ""} à ce jour.
          </p>
        </Tuile>
        <Tuile largeur={5} icone="target" titre="Par capacité" repliee>
          {banc.derniere === null ? (
            <p className="doux">Rien à montrer tant que le banc n&apos;a pas été mesuré.</p>
          ) : (
            <>
              {derniereLe ? <p className="doux">Mesure du {jour.format(derniereLe)}, dans les {banc.derniere.k} premiers résultats.</p> : null}
              <ul className="capacites">
                {CAPACITES.map((c) => {
                  const s = banc.derniere!.parCapacite[c];
                  return (
                    <li key={c}>
                      <span>
                        {LIBELLE_CAPACITE[c]}
                        <small className="doux">{s.questions} questions</small>
                      </span>
                      <b>{pourcent(s.rappel)}</b>
                      <Jauge part={s.rappel === null ? null : s.rappel * 100} resume={`${LIBELLE_CAPACITE[c]} : ${pourcent(s.rappel)}`} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Tuile>
        <Tuile largeur={6} icone="cardok" titre="Ce qu’elle te demande" repliee>
          {totalDemandes === 0 ? (
            <p className="doux">Aucune question posée pour l&apos;instant.</p>
          ) : (
            <ul className="liste-simple">
              {demandes.map((c) => (
                <li key={c.statut}>
                  <span>{LIBELLE_STATUT_QUESTION[c.statut]}</span>
                  <span>{c.n.toLocaleString("fr-CA")}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/questions" className="bouton bouton-second">
            Ses questions
          </Link>
        </Tuile>

        <Tuile largeur={12} icone="layers" titre="Comment elle apprend" repliee>
          <ol className="etapes-apprentissage">
            {ETAPES.map((e) => (
              <li key={e.ou}>{e.texte}</li>
            ))}
          </ol>
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}
