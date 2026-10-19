"use client";
// app/partage/PartageClient.tsx — lit le partage déposé par le service worker, et rien d'autre.
//
// ⚠️ LE TEXTE NE PASSE JAMAIS PAR L'URL. Il vient du Cache Storage (déposé par `sw.js`), et
// repart par `sessionStorage`, qui meurt avec l'onglet. Un paramètre d'URL le laisserait dans
// l'historique du navigateur, dans les journaux d'un proxy, et dans le `Referer` de la page
// suivante — pour du texte que Marc vient justement de juger assez personnel pour le confier
// à sa mémoire.
//
// ⚠️ ET IL NE PART PAS AU SERVEUR ICI. Cette page ne fait que MONTRER puis TRANSMETTRE au
// chat : c'est Marc qui décide d'en faire quelque chose. Une page de partage qui écrirait
// toute seule serait « elle agit toute seule », la ligne rouge de l'ADR 0004 §3.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  brouillonDepuisPartage,
  CACHE_PARTAGE,
  CLE_BROUILLON_CHAT,
  CLE_META,
  normaliserPartage,
  type PartageNormalise,
} from "@/lib/partage";

type Etat =
  | { nom: "lecture" }
  | { nom: "vide"; raison: string }
  | { nom: "recu"; partage: PartageNormalise };

export function PartageClient() {
  const router = useRouter();
  const [etat, setEtat] = useState<Etat>({ nom: "lecture" });

  useEffect(() => {
    let vivant = true;
    (async () => {
      if (typeof caches === "undefined") {
        // Sur un navigateur sans Cache Storage, le partage ne peut pas marcher — et on le
        // DIT plutôt que d'afficher un écran vide qui ressemble à « rien reçu ».
        if (vivant) setEtat({ nom: "vide", raison: "ce navigateur ne sait pas recevoir un partage." });
        return;
      }
      try {
        const cache = await caches.open(CACHE_PARTAGE);
        const rep = await cache.match(CLE_META);
        if (!rep) {
          if (vivant) setEtat({ nom: "vide", raison: "rien n'a été partagé vers MemoryAI." });
          return;
        }
        const brut = (await rep.json()) as { titre?: string; texte?: string; url?: string };
        // Consommé une fois : un partage ne doit pas ressurgir à la visite suivante.
        await cache.delete(CLE_META);
        const partage = normaliserPartage(brut);
        if (!partage.description && !partage.lien) {
          if (vivant) setEtat({ nom: "vide", raison: "le partage reçu était vide." });
          return;
        }
        if (vivant) setEtat({ nom: "recu", partage });
      } catch {
        if (vivant) setEtat({ nom: "vide", raison: "le partage n'a pas pu être relu." });
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  function ouvrirDansLeChat(partage: PartageNormalise) {
    try {
      sessionStorage.setItem(CLE_BROUILLON_CHAT, brouillonDepuisPartage(partage));
    } catch {
      // `sessionStorage` peut être refusé (navigation privée stricte). On continue : le chat
      // s'ouvrira vide, ce qui est visible, plutôt que de bloquer sur une erreur muette.
    }
    router.push("/chat");
  }

  return (
    <main className="page">
      <h1>Partagé vers MemoryAI</h1>
      {etat.nom === "lecture" && <p className="lead">Lecture du partage…</p>}
      {etat.nom === "vide" && (
        <>
          <p className="lead">Rien à reprendre : {etat.raison}</p>
          <p className="hint">
            Pour partager : dans une app Android, « Partager » puis MemoryAI. Il faut que
            l’application soit installée depuis le navigateur (« Ajouter à l’écran d’accueil »).
          </p>
        </>
      )}
      {etat.nom === "recu" && (
        <>
          <p className="lead">Voici ce qui est arrivé. Rien n’a été enregistré — c’est à toi de décider.</p>
          <section className="carte tuile" aria-label="Contenu partagé">
            {etat.partage.description && <p style={{ whiteSpace: "pre-wrap" }}>{etat.partage.description}</p>}
            {etat.partage.lien && (
              <p>
                <a href={etat.partage.lien} rel="noreferrer noopener" target="_blank">
                  {etat.partage.lien}
                </a>
              </p>
            )}
          </section>
          <button type="button" className="bouton bouton-second" onClick={() => ouvrirDansLeChat(etat.partage)}>
            Ouvrir dans le chat
          </button>
        </>
      )}
    </main>
  );
}
