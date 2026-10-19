// app/pieces/page.tsx — LA BIBLIOTHÈQUE DES PAPIERS : ce que c'est, et où ça en est.
//
// ⚠️ CE QUE CET ÉCRAN A REMPLACÉ, et pourquoi. Il a affiché jusqu'au 21/09/2026 six colonnes
// de métadonnées techniques — domaine, niveau, date, extracteur, « ouvrir ↗ », « Retirer » —
// parce qu'il avait été écrit pour UN usage : retirer un papier parti par erreur. Marc :
// « pour l'instant ça sert à rien je comprends rien alors refais full ». Il avait raison, et
// la cause n'était pas le style : rien sur cette page ne disait CE QUE le papier est. Le type
// et l'émetteur existaient en base depuis le premier jour — la couche de lecture les jetait.
//
// ⚠️ LA LISTE NE DÉCHIFFRE QUE LES FACETTES (`rendreFacettesPiece`), jamais le résumé ni les
// champs. Cent papiers affichés, c'est cent contenus en clair dans le HTML à chaque
// affichage : exactement ce que le régime de chiffrement protège. Le contenu s'ouvre papier
// par papier, sur `/pieces/<id>`.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { rendreFacettesPiece, type FacettesPiece } from "@/lib/pieces/lecture";
import { libelleExtracteur, titrePiece } from "@/lib/pieces/presentation";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const LIMITE = 100;

/** Les trois vues de la liste. Un défaut qui CACHE serait un mensonge par omission. */
const VUES = [
  { cle: "", libelle: "Tous" },
  { cle: "lus", libelle: "Lus" },
  { cle: "attente", libelle: "Pas encore lus" },
] as const;

function lien(base: Record<string, string | undefined>, modif: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...modif })) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `/pieces?${q}` : "/pieces";
}

export default async function PiecesPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; domaine?: string; q?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const vue = VUES.some((v) => v.cle === params.vue) ? (params.vue ?? "") : "";
  const domaine = params.domaine ?? "";
  const q = (params.q ?? "").trim();
  const base = { vue: vue || undefined, domaine: domaine || undefined, q: q || undefined };

  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="pieces" />
        <main className="page">
          <h1>Papiers</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const depot = depotPiecesLectureDrizzle(acces.db);
  const politique = {
    inclureN2: true,
    n2Autorise: n2Autorise(),
    inclureN3: true,
    n3Autorise: n3Autorise(),
    inclureProposes: true,
  };

  const filtre = {
    lus: vue === "lus" ? true : vue === "attente" ? false : undefined,
    domaines: domaine ? [domaine] : undefined,
    texte: q || undefined,
  };
  const [brutes, total, etat, comptes] = await Promise.all([
    depot.chercher({ ...filtre, limite: LIMITE }),
    depot.compter(filtre),
    depot.comptesParExtracteur(),
    depot.comptes(),
  ]);

  // ⚠️ `rendreFacettesPiece` rend `null` pour ce que la politique retient : on COMPTE l'écart
  // au lieu de le taire. « Aucun papier » et « des papiers, mais protégés » appellent deux
  // gestes opposés, et un seul des deux est une panne.
  const lignes: FacettesPiece[] = [];
  let retenus = 0;
  for (const b of brutes) {
    const f = rendreFacettesPiece(b, politique, acces.cle);
    if (f) lignes.push(f);
    else retenus++;
  }

  const domaines = Object.entries(comptes.parDomaine).sort((a, b) => a[0].localeCompare(b[0]));
  const pct = etat.lus + etat.nonLus > 0 ? Math.round((etat.lus / (etat.lus + etat.nonLus)) * 100) : 0;

  return (
    <>
      <Nav active="pieces" />
      <main className="page">
        <h1>Papiers</h1>
        <p className="lead">
          Tes documents, tels que la Mémoire les connaît. Clique sur un papier pour voir ce
          qu’il est, comment il est arrivé là, et ce qui en a été retenu.
        </p>

        {/* L'ÉTAT D'ABORD : c'est lui qui explique pourquoi la plupart des lignes sont vides. */}
        <section className="carte tuile" aria-labelledby="etat-lecture">
          <h2 id="etat-lecture">Où en est la lecture</h2>
          <p>
            <strong>{etat.lus}</strong> papier(s) ont été <strong>ouverts et lus</strong> ·{" "}
            <strong>{etat.nonLus}</strong> ne sont encore qu’un <strong>nom de fichier</strong>{" "}
            signalé par DriveAI ({pct} % de lus).
          </p>
          <p className="hint">
            Un papier « pas encore lu » n’a ni résumé ni champs : personne n’a ouvert le
            document. Ce n’est pas une panne — c’est la campagne de lecture qui n’y est pas
            encore passée.
          </p>
        </section>

        <section className="carte tuile" aria-labelledby="filtres">
          <h2 id="filtres">Filtrer</h2>
          <form action="/pieces" method="get" className="ligne">
            {vue ? <input type="hidden" name="vue" value={vue} /> : null}
            {domaine ? <input type="hidden" name="domaine" value={domaine} /> : null}
            <label htmlFor="q" className="sr-only">
              Chercher un papier
            </label>
            <input id="q" name="q" className="champ" defaultValue={q} placeholder="type, émetteur, mot du résumé…" />
            <button type="submit" className="bouton bouton-principal">
              Chercher
            </button>
            {q ? (
              <Link className="bouton-texte" href={lien(base, { q: undefined })}>
                Effacer
              </Link>
            ) : null}
          </form>

          <p className="pastilles">
            {VUES.map((v) => (
              <Link
                key={v.cle || "tous"}
                className={v.cle === vue ? "pastille succes" : "pastille"}
                href={lien(base, { vue: v.cle || undefined })}
              >
                {v.libelle}
              </Link>
            ))}
          </p>
          <p className="pastilles">
            <Link className={domaine ? "pastille" : "pastille succes"} href={lien(base, { domaine: undefined })}>
              Tous les dossiers
            </Link>
            {domaines.map(([d, n]) => (
              <Link
                key={d}
                className={d === domaine ? "pastille succes" : "pastille"}
                href={lien(base, { domaine: d })}
              >
                {d} ({n})
              </Link>
            ))}
          </p>
        </section>

        <section className="carte tuile" aria-labelledby="papiers">
          <h2 id="papiers">
            {total} papier(s){total > lignes.length ? ` · ${lignes.length} montré(s) ici` : ""}
          </h2>

          {retenus > 0 ? (
            <p className="hint">
              {retenus} papier(s) de cette page ne sont pas montrés : leur niveau dépasse ce que
              les réglages laissent lire.
            </p>
          ) : null}

          {lignes.length === 0 ? (
            <p className="hint">
              {total === 0
                ? "Aucun papier ne correspond à ce filtre."
                : "Aucun papier lisible ici, alors que le compte n’est pas nul : ce sont les réglages de niveau qui les retiennent."}
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Papier</th>
                  <th>Dossier</th>
                  <th>Date</th>
                  <th>Lecture</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const ex = libelleExtracteur(l.extracteur);
                  const titre = titrePiece(l);
                  return (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/pieces/${l.id}`}>
                          {titre ??
                            (l.forme === "sommaire"
                              ? "Contenu protégé (niveau 3)"
                              : "Papier sans type ni émetteur")}
                        </Link>
                        {l.titulaire ? <div className="fait-source">au nom de {l.titulaire}</div> : null}
                      </td>
                      <td>{l.domaine ?? "—"}</td>
                      <td>{l.dateDocument ?? (l.annee ? String(l.annee) : "—")}</td>
                      <td>
                        <span className={ex.lu ? "pastille succes" : "pastille"}>{ex.court}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
