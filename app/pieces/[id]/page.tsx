// app/pieces/[id]/page.tsx — UN papier : ce que c'est, comment c'est arrivé là, ce qui a été
// retenu. Les trois questions de Marc, le 21/09/2026, dans cet ordre.
//
// ⚠️ C'EST LE SEUL ÉCRAN QUI AFFICHE LE CONTENU, et c'est délibéré. La liste n'ouvre que les
// facettes (type, émetteur, titulaire) : cent papiers affichés, c'est cent résumés en clair
// dans le HTML à chaque chargement. Ici, un seul papier, parce que Marc l'a demandé.
// (L'onglet Avancement ouvre aussi les champs structurés, pour n'en COMPTER que les entrées,
// sous la même politique `sortDeLaPiece` — aucune valeur n'en sort.)
//
// ⚠️ Ce que la politique retient, l'écran le DIT. Un papier de niveau 3 dont les réglages
// n'autorisent pas le contenu rend un SOMMAIRE — et « je ne sais pas » et « je sais et je ne
// montre pas » sont deux phrases différentes : les confondre ferait chercher une panne là où
// il y a un réglage.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { FUSEAU } from "@/lib/fuseau";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { rendreLisiblePiece } from "@/lib/pieces/lecture";
import { libelleExtracteur, titrePiece } from "@/lib/pieces/presentation";
import { requireSession } from "@/lib/session";
import { depotPileDrizzle } from "@/lib/pile/depot";
import { relecturePapier } from "@/lib/pieces/depotRelecture";
import { phraseDoutePapier } from "@/lib/pieces/secondeLecture";
import { DechiffrementError } from "@/lib/chiffrement";
import { oublierPieceAction } from "../actions";

export const dynamic = "force-dynamic";

function quand(d: Date): string {
  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: FUSEAU,
  }).format(d);
}

/** Une valeur de champ extrait peut être un objet ou une liste : on la rend LISIBLE, jamais
 *  `[object Object]` — le piège déjà payé par l'audit des pièces de DriveAI le 17/09. */
function valeurLisible(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valeurLisible).join(" · ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k} : ${valeurLisible(x)}`)
      .join(" · ");
  }
  return String(v);
}

function Champs({ titre, champs }: { titre: string; champs: Record<string, unknown> | null }) {
  const entrees = Object.entries(champs ?? {});
  if (entrees.length === 0) return null;
  return (
    <>
      <h3>{titre}</h3>
      <dl className="attributs">
        {entrees.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{valeurLisible(v)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export default async function PiecePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="pieces" />
        <main className="page">
          <h1>Papier</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const brute = await depotPiecesLectureDrizzle(acces.db).parId(id);
  const p = brute
    ? rendreLisiblePiece(
        brute,
        {
          inclureN2: true,
          n2Autorise: n2Autorise(),
          inclureN3: true,
          n3Autorise: n3Autorise(),
          inclureProposes: true,
        },
        acces.cle,
      )
    : null;

  if (!p) {
    return (
      <>
        <Nav active="pieces" />
        <main className="page">
          <h1>Papier</h1>
          {/* ⚠️ DEUX causes, deux phrases : un papier retiré n'est pas un papier protégé. */}
          <p className="lead">
            {brute
              ? "Ce papier existe, mais son niveau dépasse ce que les réglages laissent lire."
              : "Ce papier n’existe plus : il a été retiré, ou remplacé par une lecture plus récente."}
          </p>
          <p>
            <Link href="/pieces">← Retour aux papiers</Link>
          </p>
        </main>
      </>
    );
  }

  // [L3] Ce que Marc a dit de cette lecture, et sa remarque — lue ici, par lui seul : elle ne
  // part vers aucun modèle (ADR 0012).
  // ⚠️ Revue #73 : une remarque illisible (clé tournée, ligne altérée) ne doit pas rendre la
  // fiche entière inaccessible — elle se DIT illisible, le reste s'affiche.
  let remarque: string | null = null;
  if (p.avisMarc === "conteste") {
    try {
      remarque = await depotPileDrizzle(acces.db).remarque("piece", p.id, acces.cle);
    } catch (err) {
      if (!(err instanceof DechiffrementError)) throw err;
      remarque = "(remarque illisible)";
    }
  }
  const relu = await relecturePapier(acces.db, p.id);
  const ex = libelleExtracteur(p.extracteur);
  const titre = titrePiece(p);
  const principal = p.exemplaires.find((x) => x.principal) ?? p.exemplaires[0] ?? null;
  // `brute` est forcement present ici : `p` en derive. On le NOMME plutot que de poser un
  // `!`, qui ferait taire le compilateur sur un invariant que le lecteur doit voir.
  const arriveLe = brute ? brute.piece.creeLe : null;

  return (
    <>
      <Nav active="pieces" />
      <main className="page">
        <p className="surtitre">
          <Link href="/pieces">← Papiers</Link>
        </p>
        <h1>{titre ?? (p.forme === "sommaire" ? "Contenu protégé (niveau 3)" : "Papier sans type ni émetteur")}</h1>
        <p className="pastilles">
          <span className={ex.lu ? "pastille succes" : "pastille"}>{ex.court}</span>
          {p.domaine ? <span className="pastille">{p.domaine}</span> : null}
          <span className={p.niveau >= 3 ? "pastille erreur" : "pastille"}>Niveau {p.niveau}</span>
        </p>
        <p className="lead">{ex.phrase}</p>
        {p.avisMarc ? (
          <p className={p.avisMarc === "conteste" ? "pile-alerte" : "hint"}>
            {p.avisMarc === "conteste"
              ? `Tu as dit que cette lecture est fausse${remarque ? ` : « ${remarque} »` : ""}. Le chat ne la présente plus comme sûre.`
              : "Tu as confirmé cette lecture."}
          </p>
        ) : relu ? (
          // ADR 0026 : ce que la seconde lecture de DriveAI a dit, tant que Marc n'a rien dit.
          <p className="hint">
            {relu.decision === "vrai" ? "Jugé vrai par LIA : une seconde lecture de DriveAI concorde." : phraseDoutePapier(relu.champs)}
          </p>
        ) : null}

        <section className="carte tuile" aria-labelledby="quoi">
          <h2 id="quoi">Ce que c’est</h2>
          <dl className="attributs">
            <div>
              <dt>Type</dt>
              <dd>{p.type ?? "—"}</dd>
            </div>
            <div>
              <dt>Émetteur</dt>
              <dd>{p.emetteur ?? "—"}</dd>
            </div>
            <div>
              <dt>Au nom de</dt>
              <dd>
                {p.titulaire ?? "—"}
                {p.titulaire && p.titulaireConfiance !== null
                  ? ` (certitude ${Math.round(p.titulaireConfiance * 100)} %)`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Date du document</dt>
              <dd>{p.dateDocument ?? (p.annee ? String(p.annee) : "—")}</dd>
            </div>
            <div>
              <dt>Échéance</dt>
              <dd>{p.dateEcheance ?? "—"}</dd>
            </div>
            <div>
              <dt>Langue</dt>
              <dd>{p.langue ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="carte tuile" aria-labelledby="arrive">
          <h2 id="arrive">Comment c’est arrivé là</h2>
          <dl className="attributs">
            <div>
              <dt>Document</dt>
              <dd>
                {principal ? (
                  <a href={principal.lien} target="_blank" rel="noreferrer noopener">
                    ouvrir dans le Drive ↗
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Rangé dans</dt>
              <dd>{principal?.chemin ?? p.domaine ?? "—"}</dd>
            </div>
            <div>
              <dt>Lu par</dt>
              <dd>{p.extracteur}</dd>
            </div>
            <div>
              <dt>Certitude de la lecture</dt>
              <dd>{Math.round(p.confiance * 100)} %</dd>
            </div>
            <div>
              <dt>Exemplaires du même papier</dt>
              <dd>{p.exemplaires.length}</dd>
            </div>
          </dl>
          {p.exemplaires.length > 1 ? (
            <ul className="liste-simple">
              {p.exemplaires.map((x) => (
                <li key={x.fileId}>
                  <a href={x.lien} target="_blank" rel="noreferrer noopener">
                    {x.chemin ?? x.fileId}
                  </a>
                  {x.principal ? " · exemplaire de référence" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="carte tuile" aria-labelledby="retenu">
          <h2 id="retenu">Ce qui a été retenu</h2>
          {!ex.lu ? (
            <p className="hint">
              Rien : le document n’a pas été ouvert. Son type et son émetteur, ci-dessus,
              viennent de son <strong>nom de fichier</strong> — pas d’une lecture.
            </p>
          ) : (
            <>
              {p.resume ? <p>{p.resume}</p> : <p className="hint">Aucun résumé n’a été produit pour ce papier.</p>}
              <Champs titre="Champs relevés" champs={p.champsStructures} />
              <Champs titre="Autres informations du document" champs={p.champsLibres} />
              {!p.resume && !p.champsStructures && !p.champsLibres ? (
                <p className="hint">
                  La lecture a eu lieu mais n’a rien rendu d’exploitable — c’est souvent une
                  photo illisible : le document est à re-scanner, pas à relire.
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="carte tuile zone-rouge" aria-labelledby="retirer">
          <h2 id="retirer">Retirer ce papier</h2>
          <p className="hint">
            Le retrait est <strong>définitif</strong> : ce papier ne reviendra ni par le
            rattrapage, ni par le flux. Le document reste intact dans ton Drive — c’est ce que
            la Mémoire en sait qui disparaît. {arriveLe ? ` Arrivé le ${quand(new Date(arriveLe))}.` : ""}
          </p>
          <form action={oublierPieceAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className="bouton bouton-danger">
              Retirer de la Mémoire
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
