// app/questions/page.tsx — la PILE « vrai / faux » (ADR 0012) : une carte à la fois.
//
// Trois familles de cartes : ce que la mémoire a LU dans un papier, ce qu'elle a DÉDUIT (un fait
// proposé), ce qui lui MANQUE (une question). L'ordre vient de `composerPile` (PUR, testé).
//
// ⚠️ UNE SEULE CARTE DÉCHIFFRÉE PAR CHARGEMENT. Le garde-fou de `/pieces` vaut ici : cent
// résumés en clair dans le HTML à chaque visite, c'est cent papiers exposés pour en juger un.
// La carte papier suit la politique de la fiche `/pieces/[id]`, rien de plus.
//
// ⚠️ Les trois gestes sont des FORMULAIRES (Server Actions) : la pile marche sans JavaScript et
// au clavier. Le glisser (`CarteGlissable`) ne fait que soumettre le bon formulaire.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { CarteGlissable } from "@/components/CarteGlissable";
import { LIBELLES_FIABILITE } from "@/components/CarteFait";
import { jourQuebec } from "@/lib/coutChat";
import { DechiffrementError } from "@/lib/chiffrement";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { n2Autorise, n3Autorise, rendreLisible } from "@/lib/lecture";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { champsCles, phraseTitulaire } from "@/lib/pile/carte";
import { composerPile, restantParGenre, type CarteRef } from "@/lib/pile/composer";
import { chargerEntreesPile } from "@/lib/pile/charger";
import { LONGUEUR_MAX_REMARQUE } from "@/lib/pile/depot";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { rendreLisiblePiece } from "@/lib/pieces/lecture";
import { libelleExtracteur, titrePiece } from "@/lib/pieces/presentation";
import { lireOptions } from "@/lib/questions";
import type { Question } from "@/lib/db/schema";
import type { Cle } from "@/lib/chiffrement";
import { relectureDuFait } from "@/lib/relectureLia";
import { requireSession } from "@/lib/session";
import { phraseRelecture } from "@/lib/validationLia";
import { definition } from "@/lib/vocabulaire";
import { choisirOptionAction, ecarterAction, jugerCarteAction, repondreAction } from "./actions";

export const dynamic = "force-dynamic";

const ORIGINES: Record<string, string> = {
  chat: "le chat",
  "claude-ai": "claude.ai",
  extraction: "une extraction",
  regle: "une règle",
};

type Db = Extract<Awaited<ReturnType<typeof accesDonnees>>, { ok: true }>["db"];

/** Les trois gestes. `formVrai` / `formFaux` sont les ids que le glisser soumet. */
function Gestes({ genre, id, vraiFaux }: { genre: CarteRef["genre"]; id: string; vraiFaux: boolean }) {
  return (
    <div className="pile-gestes">
      {vraiFaux ? (
        <>
          <form id={`faux-${id}`} action={jugerCarteAction} className="pile-faux">
            <input type="hidden" name="genre" value={genre} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="verdict" value="faux" />
            {genre === "piece" ? (
              <>
                <label className="sr-only" htmlFor={`rq-${id}`}>
                  Ce qui est faux (facultatif)
                </label>
                <input id={`rq-${id}`} className="champ" name="remarque" type="text" maxLength={LONGUEUR_MAX_REMARQUE} autoComplete="off" placeholder="Ce qui est faux (facultatif)" />
              </>
            ) : null}
            <button type="submit" className="bouton bouton-danger">
              Faux
            </button>
          </form>
          <form id={`vrai-${id}`} action={jugerCarteAction}>
            <input type="hidden" name="genre" value={genre} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="verdict" value="vrai" />
            <button type="submit" className="bouton bouton-principal">
              Vrai
            </button>
          </form>
        </>
      ) : null}
      <form action={jugerCarteAction}>
        <input type="hidden" name="genre" value={genre} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="verdict" value="passe" />
        <button type="submit" className="bouton-texte">
          Passer
        </button>
      </form>
    </div>
  );
}

async function CartePiece({ id, db, cle }: { id: string; db: Db; cle: Cle }) {
  const brute = await depotPiecesLectureDrizzle(db).parId(id);
  let p = null;
  let illisible = false;
  try {
    p = brute
      ? rendreLisiblePiece(brute, { inclureN2: true, n2Autorise: n2Autorise(), inclureN3: true, n3Autorise: n3Autorise(), inclureProposes: true }, cle)
      : null;
  } catch (err) {
    if (!(err instanceof DechiffrementError)) throw err;
    illisible = true;
  }
  if (!p || p.forme === "sommaire") {
    // ⚠️ Deux causes, deux phrases : un papier illisible n'est pas un papier protégé. Dans les
    // deux cas, il n'y a rien à juger — seul « Passer » a un sens.
    return (
      <article className="carte tuile pile-carte">
        <p className="surtitre">Ce que j&rsquo;ai lu</p>
        <h2>Papier non affichable</h2>
        <p className="lead">
          {illisible
            ? "Ce papier ne se déchiffre pas (clé tournée ou ligne altérée)."
            : "Le contenu de ce papier dépasse ce que les réglages laissent lire (MEMORYAI_N3_CHAT)."}
        </p>
        <Gestes genre="piece" id={id} vraiFaux={false} />
      </article>
    );
  }
  const titre = titrePiece(p) ?? "Papier sans type ni émetteur";
  const titulaire = phraseTitulaire(p.titulaire, p.titulaireConfiance);
  const champs = champsCles(p);
  const lien = p.exemplaires.find((x) => x.principal)?.lien ?? null;
  return (
    <CarteGlissable formVrai={`vrai-${id}`} formFaux={`faux-${id}`}>
      <article className="carte tuile pile-carte">
        <p className="surtitre">Ce que j&rsquo;ai lu — est-ce juste ?</p>
        <h2>{titre}</h2>
        <p className="pastilles">
          {p.domaine ? <span className="pastille">{p.domaine}</span> : null}
          <span className={p.niveau >= 3 ? "pastille erreur" : "pastille"}>Niveau {p.niveau}</span>
          <span className="pastille">{libelleExtracteur(p.extracteur).court}</span>
        </p>
        {titulaire ? <p className={p.titulaireConfiance !== null && p.titulaireConfiance < 0.8 ? "pile-alerte" : ""}>{titulaire}</p> : null}
        {p.resume ? <p>{p.resume}</p> : null}
        <dl className="attributs">
          {p.dateDocument ? (
            <div>
              <dt>Date du document</dt>
              <dd>{p.dateDocument}</dd>
            </div>
          ) : null}
          {p.dateEcheance ? (
            <div>
              <dt>Échéance</dt>
              <dd>{p.dateEcheance}</dd>
            </div>
          ) : null}
          {champs.map((c, i) => (
            <div key={i}>
              <dt>{c.libelle}</dt>
              <dd>{c.valeur}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          <Link href={`/pieces/${id}`}>Tout ce qui a été lu</Link>
          {lien ? (
            <>
              {" · "}
              <a href={lien} target="_blank" rel="noopener noreferrer">
                Ouvrir le document
              </a>
            </>
          ) : null}
        </p>
        <Gestes genre="piece" id={id} vraiFaux />
      </article>
    </CarteGlissable>
  );
}

async function CarteFaitPropose({ id, db, cle }: { id: string; db: Db; cle: Cle }) {
  const r = await depotAdminDrizzle(db).parId(id);
  let f = null;
  try {
    f = r ? rendreLisible(r, cle) : null;
  } catch (err) {
    if (!(err instanceof DechiffrementError)) throw err;
  }
  if (!f) {
    return (
      <article className="carte tuile pile-carte">
        <p className="surtitre">Ce que j&rsquo;ai déduit</p>
        <h2>Fait non affichable</h2>
        <Gestes genre="fait" id={id} vraiFaux={false} />
      </article>
    );
  }
  const relu = await relectureDuFait(db, cle, f);
  return (
    <CarteGlissable formVrai={`vrai-${id}`} formFaux={`faux-${id}`}>
      <article className="carte tuile pile-carte">
        <p className="surtitre">Ce que j&rsquo;ai déduit — est-ce juste ?</p>
        <h2>{f.description}</h2>
        <p className="pile-valeur">{f.valeur}</p>
        {relu ? <p className="hint">{phraseRelecture(relu)}</p> : null}
        <p className="hint">
          Source : {LIBELLES_FIABILITE[f.fiabiliteSource] ?? f.fiabiliteSource}
          {f.provenance?.dateSource ? `, ${f.provenance.dateSource}` : ""} · <Link href={`/fait/${id}`}>la fiche</Link>
        </p>
        <Gestes genre="fait" id={id} vraiFaux />
      </article>
    </CarteGlissable>
  );
}

function CarteQuestion({ q }: { q: Question }) {
  const def = definition(q.predicatVise);
  const options = lireOptions(q.options);
  return (
    <article className="carte tuile pile-carte">
      <p className="surtitre">Ce qui me manque</p>
      <h2>{q.question}</h2>
      <p className="hint">
        {q.motif} — posée par {ORIGINES[q.origine] ?? q.origine}.
      </p>
      <p className="hint">
        {options ? "Il s'agit de " : "Ta réponse deviendra "}
        <code>{q.predicatVise}</code>
        {def ? ` — ${def.description}` : ""}
        {def && def.types.includes("date") ? " (une date se saisit AAAA-MM-JJ)" : ""}
      </p>
      {options ? (
        <div className="liste-faits">
          {options.map((o) => (
            <form key={o.faitId} action={choisirOptionAction} className="option-qcm">
              <input type="hidden" name="id" value={q.id} />
              <input type="hidden" name="faitId" value={o.faitId} />
              <button type="submit" className="bouton bouton-principal">
                {o.libelle}
              </button>
              <span className="hint">{o.libelle === o.valeur ? o.provenance : o.valeur}</span>
            </form>
          ))}
        </div>
      ) : (
        <form action={repondreAction} className="chat-saisie">
          <input type="hidden" name="id" value={q.id} />
          <label className="sr-only" htmlFor={`r-${q.id}`}>
            Réponse à : {q.question}
          </label>
          <input id={`r-${q.id}`} className="champ" name="reponse" type="text" maxLength={200} required autoComplete="off" placeholder="Ta réponse, 200 caractères au plus" />
          <button type="submit" className="bouton bouton-principal">
            Répondre
          </button>
        </form>
      )}
      <div className="pile-gestes">
        <form action={ecarterAction}>
          <input type="hidden" name="id" value={q.id} />
          <button type="submit" className="bouton-texte">
            Écarter
          </button>
        </form>
        <form action={jugerCarteAction}>
          <input type="hidden" name="genre" value="question" />
          <input type="hidden" name="id" value={q.id} />
          <input type="hidden" name="verdict" value="passe" />
          <button type="submit" className="bouton-texte">
            Passer
          </button>
        </form>
      </div>
    </article>
  );
}

export default async function QuestionsPage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="questions" />
        <main className="page">
          <h1>Questions</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const { candidats, deductions, questions, avis, faitsEnTete } = await chargerEntreesPile(acces.db);
  const ordre = composerPile({
    faitsEnTete,
    pieces: candidats,
    faits: deductions.map((d) => ({ id: d.fait.id, creeLe: d.fait.creeLe })),
    questions: questions.map((q) => ({ id: q.id, creeLe: q.creeLe })),
    avis,
    aujourdhui: jourQuebec(new Date()),
  });
  const reste = restantParGenre(ordre, avis);
  const carte = ordre[0] ?? null;
  const question = carte?.genre === "question" ? (questions.find((q) => q.id === carte.id) ?? null) : null;

  return (
    <>
      <Nav active="questions" />
      <main className="page pile">
        <h1>Questions</h1>
        <p className="lead">
          {carte
            ? `Il reste ${reste.piece} papier(s) lu(s), ${reste.fait} déduction(s) et ${reste.question} question(s) à juger${ordre.length > reste.piece + reste.fait + reste.question ? `, plus ${ordre.length - reste.piece - reste.fait - reste.question} passée(s)` : ""}.`
            : "Tout est jugé. Les prochains papiers lus et les prochaines déductions arriveront ici."}
        </p>
        {carte?.genre === "piece" ? <CartePiece key={carte.id} id={carte.id} db={acces.db} cle={acces.cle} /> : null}
        {carte?.genre === "fait" ? <CarteFaitPropose key={carte.id} id={carte.id} db={acces.db} cle={acces.cle} /> : null}
        {question ? <CarteQuestion key={question.id} q={question} /> : null}
        {carte ? (
          <p className="hint">
            Vrai : la lecture est juste. Faux : le papier reste, marqué « contesté », et le chat ne présentera plus sa lecture comme sûre. Rien n&rsquo;est effacé. Sur téléphone, glisse la carte à droite (vrai) ou à gauche (faux).
          </p>
        ) : null}
      </main>
    </>
  );
}
