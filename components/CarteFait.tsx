// components/CarteFait.tsx — un fait tel que Marc le LIT, puis ce qu'on peut en faire.
//
// Marc, le 18/09 : « va falloir full retravailler comment ça affiche les faits ». Choix
// retenu (QCM du 18/09) : **une phrase, le reste replié**. Un seul habillage, pas deux.
//
// ── CE QUI A CHANGÉ, ET POURQUOI ─────────────────────────────────────────────────────────
//
// Avant, l'en-tête était `identite · personne.nom.legal` — du vocabulaire MACHINE — suivi de
// trois à cinq badges (`N1 · chiffré`, `valide`, `source : document officiel`) et d'un `<dl>`
// brut de tous les attributs. La valeur était là, encadrée de cinq étiquettes techniques.
//
// ⚠️ Le libellé HUMAIN existait déjà : le vocabulaire porte `d("logement.bail.fin", …, "Fin
// du bail")` et `rendreLisible` le pose dans `description`. Il s'affichait en `hint` SOUS la
// valeur. Ce lot est donc une INVERSION de ce qui est dominant, pas une table de phrases —
// une table par prédicat divergerait en silence de la description, qui est la source unique.
//
// ⚠️ Et le cas MAJORITAIRE de cette mémoire s'affichait comme un identifiant :
// **2 729 faits sur ~2 828** sont des `ref_document` dont la valeur est un fileId Drive
// opaque, avec leur libellé dans `attributs.type`. La carte affichait le fileId en titre.
//
// ⚠️ RESTENT VISIBLES, hors du repli, ce qui CHANGE la lecture : la fiabilité de la source
// (c'est le signal de tri quand Marc tranche une proposition), un statut qui n'est pas
// `valide`, et le canari. Tout ce qui décrit le RANGEMENT — prédicat, domaine, niveau,
// validité, attributs, provenance — passe sous « D'où ça vient ». Rien n'est retiré : un
// `<details>` natif, donc clavier et lecteur d'écran gratuits, et l'état porté par le
// navigateur plutôt que par un `useState` qui retomberait à chaque remontage.
//
// ⚠️ Compromis DIT plutôt que caché : la file `/a-valider` partage cet habillage, donc le
// prédicat exact y est à un clic au lieu d'être sous les yeux. C'est le choix de Marc
// (« une phrase, le reste replié »), pas un oubli ; la fiabilité, elle, reste visible parce
// que c'est d'elle que dépend le tri.

import Link from "next/link";
import { libelleDuFait, sourceDuFait, titreDuFait } from "@/lib/faitPhrase";
import type { FaitLisible } from "@/lib/lecture";

export const LIBELLES_NIVEAU = ["N0 · public", "N1 · chiffré", "N2 · sensible", "N3 · sans contenu"] as const;
export const LIBELLES_FIABILITE: Record<string, string> = {
  "document-officiel": "document officiel",
  "document-tiers": "document tiers",
  app: "une app",
  "mail-tiers": "un mail de tiers",
  marc: "Marc",
  seed: "seed de démarrage",
};

/** Ce que le statut VEUT DIRE, en français. `valide` ne s'affiche pas : c'est le cas normal. */
const LIBELLES_STATUT: Record<string, string> = {
  propose: "à confirmer",
  rejete: "rejeté",
  perime: "remplacé par un plus récent",
};

export function CarteFait({
  f,
  actions,
  canari,
  detail,
}: {
  f: FaitLisible;
  actions?: { valider: (fd: FormData) => Promise<void>; rejeter: (fd: FormData) => Promise<void>; oublier: (fd: FormData) => Promise<void> };
  canari?: boolean;
  detail?: boolean;
}) {
  const attributs = Object.entries(f.attributs ?? {});
  const { titre, sousTitre, estDate } = titreDuFait(f);
  const { libelle, estDuVocabulaire } = libelleDuFait(f);
  const source = sourceDuFait(f.provenance?.sourceRef);
  const fiabilite = LIBELLES_FIABILITE[f.fiabiliteSource] ?? f.fiabiliteSource;
  const statut = LIBELLES_STATUT[f.statut];

  return (
    <article className={`carte tuile fait niveau-${f.niveau}${canari ? " canari" : ""}`} aria-labelledby={`f-${f.id}`}>
      <h2 id={`f-${f.id}`} className="fait-valeur">
        {estDate ? <time dateTime={titre}>{titre}</time> : titre}
      </h2>
      {/* La phrase : ce que le fait DIT, et d'où il le tient. Le prédicat brut ne s'affiche
          ici que si le vocabulaire n'a pas de description (un prédicat en quarantaine) — et
          il est alors marqué comme tel, plutôt que de passer pour une phrase. */}
      <p className="fait-libelle">
        {libelle}
        {!estDuVocabulaire && <span className="pastille"> prédicat hors vocabulaire</span>}
        <span className="fait-source"> · d’après {fiabilite}</span>
      </p>
      {sousTitre && <p className="hint">{sousTitre}</p>}
      {(statut || canari) && (
        <ul className="pastilles" aria-label="À savoir">
          {statut && <li className={f.statut === "propose" ? "pastille alerte" : "pastille"}>{statut}</li>}
          {canari && <li className="pastille erreur">ressemble à une consigne — jamais servi</li>}
        </ul>
      )}

      <details className="repli">
        <summary>D’où ça vient</summary>
        <dl className="attributs">
          <div>
            <dt>ce qu’on en sait</dt>
            <dd>
              <code>{f.predicat}</code> · {f.domaine}
            </dd>
          </div>
          <div>
            <dt>protection</dt>
            <dd>{LIBELLES_NIVEAU[f.niveau] ?? `N${f.niveau}`}</dd>
          </div>
          {(f.valideDe || f.valideA) && (
            <div>
              <dt>valable</dt>
              <dd>
                {f.valideDe ?? "…"} → {f.valideA ?? "…"}
              </dd>
            </div>
          )}
          {attributs.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          {f.provenance && (
            <div>
              <dt>extrait par</dt>
              <dd>
                {f.provenance.extracteur} · {f.provenance.sourceType}
                {f.provenance.dateSource ? ` · ${f.provenance.dateSource}` : ""} · proposé le {f.creeLe.slice(0, 10)}
              </dd>
            </div>
          )}
          {/* ⚠️ La référence de source s'affiche TELLE QUELLE quand elle ne dit pas d'elle-même
              qu'elle porte un lien (préfixe `drive|`) : fabriquer une URL Drive à partir d'une
              référence nue rendrait un lien crédible qui tombe en 404, et un lien faux est pire
              qu'un identifiant honnête. Le lien fiable d'un papier est le sien (plus haut). */}
          {source && (
            <div>
              <dt>référence de la source</dt>
              <dd>
                <code>{source.ref}</code>
                {source.genre === "inconnu" && " — pas une référence à laquelle on sait faire un lien"}
              </dd>
            </div>
          )}
        </dl>
      </details>

      <div className="actions-fait">
        {f.lien && (
          <a href={f.lien} target="_blank" rel="noreferrer noopener" className="bouton bouton-principal">
            Ouvrir le document
          </a>
        )}
        {!detail && (
          <Link href={`/fait/${f.id}`} className="bouton bouton-second">
            Détail
          </Link>
        )}
        {actions && (
          <>
            {f.statut !== "valide" && (
              <form action={actions.valider}>
                <input type="hidden" name="id" value={f.id} />
                <button type="submit" className="bouton bouton-principal">
                  Valider
                </button>
              </form>
            )}
            {f.statut !== "rejete" && (
              <form action={actions.rejeter}>
                <input type="hidden" name="id" value={f.id} />
                <button type="submit" className="bouton bouton-second">
                  Rejeter
                </button>
              </form>
            )}
            <form action={actions.oublier}>
              <input type="hidden" name="id" value={f.id} />
              <button type="submit" className="bouton bouton-danger" title="Supprime le fait et l’empêche de revenir">
                Oublier
              </button>
            </form>
          </>
        )}
      </div>
    </article>
  );
}
