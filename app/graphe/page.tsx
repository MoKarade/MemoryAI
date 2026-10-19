// app/graphe/page.tsx — les liens entre les faits (ADR 0002 §5.3).
//
// ⚠️ CE QUE CETTE PAGE MONTRE EN PREMIER, C'EST LE POURQUOI. Un graphe qui affiche des traits
// sans dire ce qui les justifie ne s'audite pas : on le croit ou on l'ignore. Chaque lien
// porte donc la phrase de la règle qui l'a posé, et les liens d'un modèle (phase suivante,
// `origine: "modele"`) resteront distingués de ceux d'une règle — jamais mélangés.
//
// ⚠️ ELLE DIT AUSSI L'ÉCART. La table est une PHOTO du dernier recalcul ; les faits, eux,
// bougent. La page compare donc ce qui est enregistré à ce que les règles diraient
// maintenant, et le dit quand les deux diffèrent. Sans ça, un graphe de la semaine dernière
// se présenterait comme à jour.
//
// ⚠️ AUCUNE VALEUR DE FAIT N'EST AFFICHÉE ICI — seulement des prédicats et des phrases de
// règle. C'est ce qui permet de montrer la structure de la mémoire sans en montrer le
// contenu, et ce qui rend cette page lisible à côté de quelqu'un.

import Link from "next/link";
import { GrapheSvg } from "@/components/GrapheSvg";
import { Nav } from "@/components/Nav";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { parType, TAILLE_MAX_GROUPE } from "@/lib/graphe";
import { disposer, resume } from "@/lib/grapheDisposition";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { recalculerAction } from "./actions";

export const dynamic = "force-dynamic";
const LIMITE_PAR_TYPE = 25;

const CE_QUE_DIT_LA_REGLE: Record<string, string> = {
  "meme-document": "Deux faits tirés du même document.",
  "meme-periode": "Deux faits de domaines différents dont les périodes se chevauchent.",
  remplacement: "Un fait et celui qu'il remplace — la même chose à deux moments.",
  "meme-domaine-meme-entite": "Deux faits du même domaine qui parlent de la même entité.",
  "cause-declaree": "Un fait et la question qui l'a produit.",
};

export default async function GraphePage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="graphe" />
        <main className="page">
          <h1>Graphe</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const depot = depotLiensDrizzle(acces.db);
  const [comptes, apercu, faitsBruts] = await Promise.all([
    depot.comptes(),
    depot.apercu(acces.cle),
    depotLectureDrizzle(acces.db).faits({ statuts: ["valide", "propose"], limite: 1000 }),
  ]);

  // Le prédicat suffit à situer une extrémité, et il n'est pas chiffré : c'est exactement ce
  // qu'il faut pour lire un lien sans lire un fait.
  const predicatDe = new Map(faitsBruts.map((r) => [r.fait.id, r.fait.predicat]));
  const groupes = parType(apercu.liens);
  const ecart = apercu.liens.length - comptes.total;

  // Le DESSIN. Il ne montre que les faits RELIÉS, et au plus quelques dizaines : c'est un
  // résumé, jamais la source — la liste en dessous reste complète, et c'est elle qui porte
  // le POURQUOI de chaque trait. Les nœuds se construisent depuis les faits déjà lus ; la
  // disposition est PURE et déterministe (`lib/grapheDisposition.ts`).
  const dispo = disposer(
    faitsBruts.map((r) => ({
      id: r.fait.id,
      domaine: r.fait.predicat.split(".")[0] ?? "",
      // Le dernier segment du prédicat, jamais une VALEUR : le dessin montre la structure
      // de la mémoire, pas son contenu.
      etiquette: r.fait.predicat.split(".").slice(1).join(".") || r.fait.predicat,
    })),
    apercu.liens,
  );

  return (
    <>
      <Nav active="graphe" />
      <main className="page">
        <h1>Graphe</h1>
        <p className="lead">
          {apercu.liens.length === 0
            ? "Aucun lien. Les règles n'ont rien trouvé à rapprocher — c'est une réponse, pas une panne."
            : `${apercu.liens.length} lien(s) entre ${apercu.faitsLus} faits, posés par cinq règles déterministes. Chaque lien dit pourquoi il existe.`}
        </p>

        <form action={recalculerAction}>
          <button type="submit" className="bouton bouton-principal">
            Enregistrer les liens
          </button>
        </form>

        {ecart !== 0 && (
          <p className="alerte bandeau">
            {comptes.total} lien(s) enregistré(s), {apercu.liens.length} que les règles donnent aujourd&apos;hui. La
            mémoire a bougé depuis le dernier enregistrement.
          </p>
        )}

        {apercu.illisibles > 0 && (
          <p className="alerte bandeau">
            {apercu.illisibles} fait(s) illisible(s) écarté(s) du calcul — comptés, jamais devinés.
          </p>
        )}

        {dispo.noeuds.length > 0 && (
          <section aria-label="Le graphe">
            <GrapheSvg d={dispo} />
            <p className="hint">{resume(dispo)}</p>
            <p className="hint">
              Un point par fait relié, groupé par domaine ; un trait par lien. L&apos;épaisseur dit ce que la règle
              vaut, le pointillé signale un simple chevauchement de dates — une coïncidence, pas un rapport établi.
              Le détail de chaque trait est plus bas.
            </p>
          </section>
        )}

        {apercu.abstentions.length > 0 && (
          <section aria-label="Ce que les règles ont refusé de faire">
            <h2>Ce qui n&apos;a pas été lié, et pourquoi</h2>
            <p className="hint">
              Au-delà de {TAILLE_MAX_GROUPE} faits, une règle de groupe relierait tout à tout et le graphe
              deviendrait un mur. Elle s&apos;abstient et le dit, plutôt que d&apos;afficher un résultat qu&apos;on
              ne pourrait pas lire.
            </p>
            <ul className="liste-simple">
              {apercu.abstentions.map((a, i) => (
                <li key={`${a.regle}-${i}`}>
                  <code>{a.regle}</code> — {a.motif} ({a.taille} faits).
                </li>
              ))}
            </ul>
          </section>
        )}

        {groupes.map((g) => (
          <section key={g.type} aria-label={g.type}>
            <h2>
              {g.type} <span className="hint">· {g.liens.length}</span>
            </h2>
            <p className="hint">{CE_QUE_DIT_LA_REGLE[g.type] ?? ""}</p>
            <ul className="liste-simple">
              {g.liens.slice(0, LIMITE_PAR_TYPE).map((l) => (
                <li key={`${l.faitA}-${l.faitB}-${l.type}`}>
                  <Link href={`/fait/${l.faitA}`}>
                    <code>{predicatDe.get(l.faitA) ?? l.faitA}</code>
                  </Link>{" "}
                  {l.cibleB === "question" ? (
                    <>— question</>
                  ) : (
                    <>
                      —{" "}
                      <Link href={`/fait/${l.faitB}`}>
                        <code>{predicatDe.get(l.faitB) ?? l.faitB}</code>
                      </Link>
                    </>
                  )}
                  <br />
                  <span className="hint">{l.pourquoi}</span>
                </li>
              ))}
            </ul>
            {g.liens.length > LIMITE_PAR_TYPE && (
              <p className="hint">
                {g.liens.length - LIMITE_PAR_TYPE} autre(s) lien(s) de ce type, non affiché(s) ici.
              </p>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
