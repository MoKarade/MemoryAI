// app/questions/page.tsx — ce qui MANQUE à la mémoire : une question à la fois (ADR 0012).
//
// ⚠️ Marc ne juge plus rien (25/10/2026, tâche MemoryAI 231, amendement de l'ADR 0026) : la pile
// ne lui montre plus ni papier lu ni déduction. LIA les tranche seule (seconde lecture de DriveAI,
// relecture des faits) ; ce qui ne concorde pas reste « non confirmé », jamais posé à Marc. Ne
// restent ici que ses QUESTIONS, ce qu'elle ne sait pas : y répondre n'est pas juger.
//
// ⚠️ Les gestes sont des FORMULAIRES (Server Actions) : la page marche sans JavaScript et au clavier.

import { Nav } from "@/components/Nav";
import { jourQuebec } from "@/lib/coutChat";
import { NE_JUGE_PLUS } from "@/lib/memoire/tuilesMemoire";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { composerPile } from "@/lib/pile/composer";
import { chargerEntreesPile } from "@/lib/pile/charger";
import { lireOptions } from "@/lib/questions";
import type { Question } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { definition } from "@/lib/vocabulaire";
import { choisirOptionAction, ecarterAction, jugerCarteAction, repondreAction } from "./actions";

export const dynamic = "force-dynamic";

const ORIGINES: Record<string, string> = {
  chat: "le chat",
  "claude-ai": "claude.ai",
  extraction: "une extraction",
  regle: "une règle",
};

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

  // Seules les questions entrent dans la pile : ni papier, ni déduction (tâche MemoryAI 231).
  const { questions, avis } = await chargerEntreesPile(acces.db);
  const ordre = composerPile({
    faitsEnTete: [],
    piecesEnTete: [],
    pieces: [],
    faits: [],
    questions: questions.map((q) => ({ id: q.id, creeLe: q.creeLe })),
    avis,
    aujourdhui: jourQuebec(new Date()),
  });
  const carte = ordre[0] ?? null;
  const question = carte ? (questions.find((q) => q.id === carte.id) ?? null) : null;

  return (
    <>
      <Nav active="questions" />
      <main className="page pile">
        <h1>Questions</h1>
        <p className="lead">{NE_JUGE_PLUS}</p>
        <p className="hint">Ce qu&rsquo;elle a tranché seule se compte dans l&rsquo;onglet Mémoire.</p>
        {question ? <CarteQuestion key={question.id} q={question} /> : <p className="doux">Elle n&rsquo;a aucune question ouverte.</p>}
      </main>
    </>
  );
}
