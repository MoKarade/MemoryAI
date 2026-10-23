// app/fait/[id]/page.tsx — [L33a] un fait, et TOUT ce qui se rattache à lui.
//
// Marc, le 18/09, en texte libre — aucune de mes options ne le proposait : « voir le document
// lié, ou tous les documents liés ». Mesuré avant de le construire : `provenances.source_ref`
// est `notNull` ET **indexé** (`provenances_source`, index posé exactement pour retrouver les
// faits d'une même source), et `rendreLisible` le JETAIT. La demande était donc à un champ de
// distance, pas à une requête neuve — c'est pourquoi aucune surface ne pouvait le montrer.
//
// Cette page porte désormais quatre rattachements, tous DÉRIVÉS de données déjà écrites :
//   1. le document d'où le fait vient (son lien Drive, quand la référence en porte un) ;
//   2. les autres faits tirés du MÊME document ;
//   3. les faits LIÉS par les cinq règles — avec la phrase qui dit pourquoi. C'était visible
//      seulement dans le dessin du graphe, que L26c veut retirer : la fiche est son remplaçant
//      pour ce qu'on peut LIRE, la frise de L30 le sera pour ce qu'on VOIT ;
//   4. « demander à Lia là-dessus », qui préremplit la conversation.
//
// ⚠️ Le lien vers Lia porte le LIBELLÉ du fait, jamais sa VALEUR. Une valeur peut être une
// adresse (N2) ou un document d'identité (N3), et un paramètre d'URL voyage dans l'historique
// du navigateur et dans les journaux du serveur. Le libellé (« Fin du bail ») suffit à Lia,
// qui sait chercher : elle a `memoryai_contexte` et `memoryai_chercher`.

import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { CarteFait } from "@/components/CarteFait";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { autreExtremite, LIBELLES_LIEN, libelleDuFait, sourceDuFait, titreDuFait } from "@/lib/faitPhrase";
import { rendreLisible } from "@/lib/lecture";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { oublierAction, rejeterAction, validerAction } from "../../a-valider/actions";
import { corrigerAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Ce que la correction a donné, en français. [L33b].
 *
 * ⚠️ Chaque entrée dit ce qui est ARRIVÉ À LA MÉMOIRE, pas juste « ça n'a pas marché » : un
 * refus laisse l'ancienne valeur INTACTE, et Marc doit le savoir pour ne pas repartir en
 * croyant sa mémoire à jour. Les codes viennent de `CODES_REFUS` (contrat d'écriture) et des
 * trois issues propres à cette page.
 */
const MESSAGES_CORRECTION: Record<string, string> = {
  ok: "Corrigé. L’ancienne valeur est GARDÉE, marquée « remplacée par un plus récent » — rien n’est effacé.",
  vide: "Rien n’a été écrit : le champ était vide.",
  introuvable: "Ce fait n’existe plus.",
  "type-non-corrigeable":
    "Ce fait désigne un document : sa valeur est une référence Drive, pas un texte à retaper. Rien n’a été touché.",
  "deja-present":
    "Cette correction avait déjà été faite : rien n’a été réécrit, et la valeur en mémoire est celle que tu voulais.",
  doublon_valide: "La mémoire porte DÉJÀ cette valeur pour ce prédicat : il n’y avait rien à corriger.",
  oublie: "Tu avais demandé d’oublier cette valeur : elle ne revient pas. L’ancienne est intacte.",
  type_valeur_incompatible:
    "Le vocabulaire n’accepte pas ce type de valeur pour ce prédicat (une date là où il attend du texte, ou l’inverse). Rien n’a été écrit.",
  n3_texte: "Ce prédicat est de niveau 3 : son contenu ne se saisit pas ici. Rien n’a été écrit.",
};

/** Bornes de lecture : une fiche montre ce qui tient à l'écran, pas une base de données. */
const MAX_MEME_SOURCE = 20;
const MAX_VOISINS = 30;

export default async function FaitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const codeBrut = (await searchParams).correction;
  const code = Array.isArray(codeBrut) ? codeBrut[0] : codeBrut;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="fait" />
        <main className="page">
          <h1>Fait</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }
  const admin = depotAdminDrizzle(acces.db);
  const r = await admin.parId(id);
  if (!r) notFound();
  const f = rendreLisible(r, acces.cle);
  const source = sourceDuFait(f.provenance?.sourceRef);
  const { libelle } = libelleDuFait(f);

  // ⚠️ Les faits voisins sont DÉCHIFFRÉS un par un, et un illisible est COMPTÉ puis écarté,
  // jamais rendu vide : un titre « » à la place d'une valeur serait une donnée inventée
  // (même règle que `rendreServables`). Le compte se dit à l'écran.
  const brutsMemeSource = source ? await admin.autresDeLaMemeSource(f.provenance?.sourceRef ?? "", f.id, MAX_MEME_SOURCE) : [];
  const memeSource: { id: string; titre: string; libelle: string }[] = [];
  let illisibles = 0;
  for (const b of brutsMemeSource) {
    try {
      const v = rendreLisible(b, acces.cle);
      memeSource.push({ id: v.id, titre: titreDuFait(v).titre, libelle: libelleDuFait(v).libelle });
    } catch {
      illisibles += 1;
    }
  }

  // Les liens ne portent AUCUNE valeur de fait (`pourquoi` est en clair par conception), donc
  // rien à déchiffrer ici — et c'est cette phrase qui rend un lien explicable à l'écran.
  const voisins = await depotLiensDrizzle(acces.db).voisinsDe(f.id, MAX_VOISINS);

  const questionPourLia = `Parle-moi de ce que tu sais sur « ${libelle} » (${f.domaine}).`;

  return (
    <>
      <Nav active="fait" />
      <main className="page">
        <h1>Un fait</h1>
        {code && (
          // ⚠️ Un code INCONNU se dit tel quel plutôt que d’être tu : ce paramètre est
          // écrivable dans la barre d’adresse, et un lot futur peut ajouter un code de refus
          // sans passer ici. « Refusé (code) » est honnête ; le silence ne l’est pas.
          <p className={code === "ok" ? "hint" : "alerte bandeau"}>
            {MESSAGES_CORRECTION[code] ?? `La correction a été refusée (${code}). Rien n’a été écrit.`}
          </p>
        )}
        <CarteFait f={f} canari={r.fait.canari} detail actions={{ valider: validerAction, rejeter: rejeterAction, oublier: oublierAction }} />

        <div className="actions-fait">
          <Link href={`/chat?a-propos=${encodeURIComponent(questionPourLia)}`} className="bouton bouton-second">
            Demander à Lia là-dessus
          </Link>
          {source?.lien && (
            <a href={source.lien} target="_blank" rel="noreferrer noopener" className="bouton bouton-second">
              Ouvrir le document d’où ça vient
            </a>
          )}
        </div>

        {/* CORRIGER. ⚠️ Le formulaire n’existe QUE pour les valeurs qui se retapent : pour un
            `ref_document`, la valeur est un fileId Drive, donc le « corriger » au clavier
            voudrait dire désigner un AUTRE document — ce qui n’est pas corriger un fait mais en
            créer un. On le DIT, plutôt que d’offrir un champ qui abîmerait la référence. */}
        <details className="repli">
          <summary>Corriger ce fait</summary>
          {f.valeurType === "ref_document" ? (
            <p className="hint">
              La valeur de ce fait est la référence Drive d’un document, pas un texte : elle ne se retape pas. Ce qui se
              corrige ici, c’est ce que l’extracteur a compris du document — son type, son émetteur, son année.
            </p>
          ) : (
            <form action={corrigerAction}>
              <input type="hidden" name="id" value={f.id} />
              <label htmlFor="correction-valeur">{libelle}</label>
              <input
                id="correction-valeur"
                className="champ"
                name="valeur"
                type="text"
                defaultValue={f.valeur}
                required
                maxLength={500}
                autoComplete="off"
              />
              <p className="hint">
                L’ancienne valeur est GARDÉE et marquée « remplacée par un plus récent » : rien n’est effacé. Une
                correction que tu tapes porte la fiabilité « Marc » — pas celle du document d’origine, même si c’est lui
                qu’elle corrige.
              </p>
              <button type="submit" className="bouton bouton-principal">
                Corriger
              </button>
            </form>
          )}
        </details>

        <details className="repli">
          <summary>
            Tiré du même document — <strong>{memeSource.length}</strong> autre(s) fait(s)
          </summary>
          {memeSource.length === 0 ? (
            <p className="hint">
              {source
                ? "Ce fait est le seul que la mémoire tire de cette source."
                : "Ce fait n’a pas de provenance enregistrée : rien à rattacher."}
            </p>
          ) : (
            <ul className="liste-faits">
              {memeSource.map((m) => (
                <li key={m.id}>
                  <Link href={`/fait/${m.id}`}>{m.titre}</Link> <span className="hint">— {m.libelle}</span>
                </li>
              ))}
            </ul>
          )}
          {illisibles > 0 && (
            <p className="alerte bandeau">
              {illisibles} fait(s) de cette source sont illisibles (clé tournée ou ligne altérée) : ils sont comptés, pas
              affichés vides.
            </p>
          )}
          {memeSource.length === MAX_MEME_SOURCE && (
            <p className="hint">Les {MAX_MEME_SOURCE} plus récents seulement — cette source en porte peut-être d’autres.</p>
          )}
        </details>

        <details className="repli">
          <summary>
            Faits liés — <strong>{voisins.length}</strong>
          </summary>
          {voisins.length === 0 ? (
            <p className="hint">
              Aucune des cinq règles de liaison ne rattache ce fait à un autre. ⚠️ Les liens sont RECALCULÉS, jamais
              accumulés : si tu viens de corriger une date, relance le recalcul depuis Régler → Liens.
            </p>
          ) : (
            <ul className="liste-faits">
              {voisins.map((l) => {
                const { autre, estUnFait } = autreExtremite(l, f.id);
                const libelleLien = LIBELLES_LIEN[l.type];
                return (
                  <li key={l.id}>
                    {estUnFait ? <Link href={`/fait/${autre}`}>{libelleLien}</Link> : <span>{libelleLien} (une question)</span>}{" "}
                    <span className="hint">— {l.pourquoi}</span>
                    {l.origine === "modele" && <span className="pastille"> deviné par un modèle</span>}
                  </li>
                );              })}
            </ul>
          )}
        </details>

        <p className="hint">
          Identifiant <code>{f.id}</code> · vocabulaire v{r.fait.versionVocabulaire} · confiance {Math.round(f.confiance * 100)} %
          {r.fait.remplaceId ? ` · remplace ${r.fait.remplaceId}` : ""}
        </p>
      </main>
    </>
  );
}
