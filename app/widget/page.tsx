// app/widget/page.tsx — la mémoire, embarquée dans une app du hub (ADR 0002 §5.4).
//
// ⚠️ LECTURE SEULE, ET ÇA SE VOIT DANS LE CODE : aucun formulaire, aucune Server Action
// importée, aucun `postMessage` qui écrit. Une écriture depuis une iframe hôte serait une
// porte dont personne ne connaîtrait la clé — l'app hôte contrôle ce qui l'entoure, pas nous.
//
// ⚠️ UN INVITÉ DE L'APP HÔTE VOIT UN 403 LISIBLE, jamais une redirection. MemoryAI est une app
// SANS INVITÉS : `requireSession` refuse toute adresse autre que celle du propriétaire. Dans
// une page ordinaire, ce refus renvoie au hub ; dans une IFRAME, une redirection produit soit
// une page de login imbriquée, soit un cadre blanc — on attrape donc le refus ici et on
// explique, en une phrase, dans le cadre.
//
// Le périmètre vient de `/apps` (lot 11) : SANS réglage, ce widget ne montre RIEN. C'est
// l'inverse du contrat d'écriture, et c'est voulu — voir `lib/widget.ts`.

import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotPerimetresDrizzle } from "@/lib/depotPerimetres";
import { n2Autorise, n3Autorise, rendreServables, STATUTS_SERVIS } from "@/lib/lecture";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { NonAutorise, requireSession } from "@/lib/session";
import { APP_ID_VALIDE, filtrerPourWidget, politiqueDepuisPerimetre, raisonDuVide } from "@/lib/widget";

export const dynamic = "force-dynamic";
const LIMITE = 300;

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <main className="page" style={{ padding: "0.75rem" }}>
      {children}
    </main>
  );
}

export default async function WidgetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) {
      return (
        <Cadre>
          <p className="lead">Cette mémoire est privée.</p>
          <p className="hint">
            Elle n&apos;appartient qu&apos;à son propriétaire et n&apos;a pas d&apos;invités. Rien n&apos;est affiché
            ici, et ce n&apos;est pas une panne.
          </p>
        </Cadre>
      );
    }
    throw err;
  }

  const params = await searchParams;
  const brut = params.app;
  const appId = typeof brut === "string" && APP_ID_VALIDE.test(brut) ? brut : null;
  if (!appId) {
    return (
      <Cadre>
        <p className="lead">Widget mal appelé.</p>
        <p className="hint">Il attend `?app=&lt;identifiant&gt;` — l&apos;app qui l&apos;embarque.</p>
      </Cadre>
    );
  }

  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <Cadre>
        <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
      </Cadre>
    );
  }

  const perimetre = await depotPerimetresDrizzle(acces.db).parApp(appId);
  const politique = politiqueDepuisPerimetre(perimetre);

  // On ne lit RIEN quand le périmètre est vide : inutile de déchiffrer des faits pour les
  // jeter ensuite, et un widget non réglé ne doit toucher à la base qu'au minimum.
  const rows = politique.domaines.length === 0
    ? []
    : await depotLectureDrizzle(acces.db).faits({ statuts: STATUTS_SERVIS, limite: LIMITE });
  // La quarantaine mord aussi ici : le widget est embarqué DANS les apps, donc un prédicat
  // neuf y serait lu par n'importe quel Claude qui regarde la page. L'écran où Marc VOIT
  // ce qui attend est `/a-valider`, pas celui-ci.
  const retenus = await depotLectureDrizzle(acces.db).predicatsRetenus();
  const { faits } = rendreServables(rows, { inclureN2: politique.niveauMax >= 2, n2Autorise: n2Autorise(), inclureN3: politique.niveauMax >= 3, n3Autorise: n3Autorise(), inclureProposes: true }, acces.cle, retenus);
  const visibles = filtrerPourWidget(faits, politique);
  const vide = raisonDuVide(politique, visibles.length);

  return (
    <Cadre>
      <h1 style={{ fontSize: "1.1rem" }}>Ce que la mémoire sait, pour {appId}</h1>
      {vide ? (
        <p className="hint">{vide}</p>
      ) : (
        <>
          <p className="hint">
            {visibles.length} fait(s), niveau ≤ {politique.niveauMax}, domaines : {politique.domaines.join(", ")}.
            Lecture seule.
          </p>
          <ul className="liste-simple">
            {visibles.slice(0, 40).map((f) => (
              <li key={f.id}>
                <code>{f.predicat}</code> — {f.valeur}
                {f.statut === "propose" ? " (proposé, pas encore validé)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </Cadre>
  );
}
