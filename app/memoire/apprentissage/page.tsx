// app/memoire/apprentissage/page.tsx — l'onglet APPRENTISSAGE de la page Mémoire (MemoryAI#74,
// maquette v5) : ce qu'elle retrouve au banc, mesure après mesure et par capacité, ce qu'elle a
// tiré des conversations, ce qu'elle te demande, et comment elle apprend.
//
// ⚠️ Des nombres seulement (`lib/memoire/depotApprentissage.ts`) : ni question du banc, ni fait.
// Les blocs de la maquette sans mesure (entraînement, versions, habitudes) ne sont pas dessinés.
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
  LIBELLE_CAPACITE,
  LIBELLE_STATUT_FAIT,
  LIBELLE_STATUT_QUESTION,
  pourcent,
  serieBanc,
  type PointBanc,
} from "@/lib/memoire/apprentissage";
import { depotApprentissageDrizzle } from "@/lib/memoire/depotApprentissage";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const MESURES = 60;
const W = 400;
const H = 220;
const M = { g: 40, d: 8, h: 10, b: 24 };

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
  const [lignes, faits, questions] = await Promise.all([depot.mesures(BANC_COURANT, MESURES), depot.faitsAppris(), depot.questionsParStatut()]);
  const banc = serieBanc(lignes);
  const appris = comptesFaits(faits);
  const demandes = comptesQuestions(questions);
  const totalAppris = appris.reduce((s, c) => s + c.n, 0);
  const totalDemandes = demandes.reduce((s, c) => s + c.n, 0);
  const derniereLe = lignes[0]?.mesureLe ?? null;

  return (
    <CoqueMemoire actif="apprentissage">
      <div className="tableau">
        <Tuile largeur={7} icone="chart" titre="Ce qu’elle retrouve, mesure après mesure">
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
        <Tuile largeur={5} icone="target" titre="Par capacité">
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
        <Tuile largeur={6} icone="star" titre="Ce qu’elle a tiré de vos conversations">
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
            </ul>
          )}
          <Link href="/a-valider" className="bouton bouton-second">
            À valider
          </Link>
        </Tuile>
        <Tuile largeur={6} icone="cardok" titre="Ce qu’elle te demande">
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

        <Tuile largeur={12} icone="layers" titre="Comment elle apprend">
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
