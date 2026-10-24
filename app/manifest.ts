// app/manifest.ts — MemoryAI installable, et cible de partage Android (ADR 0004, socle S6).
//
// ⚠️ `share_target` NE DÉCLARE AUCUN FICHIER, et c'est une décision. Partager un document
// ici reviendrait à faire ingérer un papier par MemoryAI — c'est le travail de DriveAI, qui
// le classe, et c'est par lui que passe la frontière de l'ADR-0061. Un second chemin d'entrée
// pour les documents créerait une seconde source de vérité que personne ne penserait à fermer
// le jour d'un retrait.
//
// ⚠️ `method: "POST"` + `enctype: multipart/form-data` : c'est ce qui rend le partage une
// NAVIGATION, donc interceptable par le service worker. En GET, Android mettrait le texte
// PERSONNEL dans l'URL — donc dans l'historique, dans les journaux d'un proxy, et dans le
// `Referer` de la page suivante.

import type { MetadataRoute } from "next";
import { SECTIONS } from "@/components/Nav";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // [PWA-ANDROID] `id` FIXE l'identité de l'installation. Sans lui, l'identité EST le
    // `start_url`, donc le jour où celui-ci bouge, Android ne met pas à jour l'app installée :
    // il en installe une DEUXIÈME.
    //
    // ⚠️⚠️ CETTE VALEUR NE SE DÉRIVE PAS DE `start_url`, ET C'EST TOUT L'INTÉRÊT. Juste en
    // dessous, `start_url` est DÉRIVÉ de `SECTIONS[0]` pour suivre l'accueil quand il déménage.
    // Un `id` qui ferait pareil bougerait avec lui — c'est exactement ce contre quoi `id`
    // existe. Elle est donc écrite en dur, et elle ne change JAMAIS, même le jour où l'accueil
    // change encore.
    //
    // ⚠️ Écrit `"/moi"` du 18/09 au 18/09, corrigé le jour même : j'avais mesuré `start_url`
    // sur une branche partie AVANT L26b, qui l'a fait passer de `/moi` à `/`. Le rebasage a
    // emporté le code sans emporter ma mesure, et le commentaire d'à côté affirmait alors le
    // contraire du fichier. La garde ne regardait que `id` NON VIDE : elle a certifié la
    // valeur fausse. Classe consignée en leçon n° 30.
    id: "/",
    // [PWA-ANDROID] Un lien venu du hub RÉUTILISE la fenêtre déjà ouverte au lieu d'en empiler
    // une seconde. `focus-existing` écarté : il ramène la fenêtre au premier plan SANS
    // naviguer, donc en ignorant l'URL demandée.
    launch_handler: { client_mode: "navigate-existing" },
    name: "MemoryAI — la mémoire de Marc",
    short_name: "MemoryAI",
    description: "Ce que la mémoire sait, ce qu'elle ignore, et d'où elle le tient.",
    // ⚠⚠ DÉRIVÉ de la barre, plus écrit en dur — et c'est un CORRECTIF, pas du style.
    // Cette valeur était `"/moi"`, ce qui avait un sens quand `/moi` était l'accueil
    // fonctionnel (compteurs + purge). Après L26a (l'accueil devient la conversation) et
    // surtout L26b (`/moi` ne porte PLUS QUE la purge), lancer l'app INSTALLÉE plaçait Marc
    // droit devant « Effacer toute la mémoire » — l'exact contraire de ce que `app/moi/page.tsx`
    // revendique en commentaire. Et `tests/partage.test.ts` ÉPINGLAIT `"/moi"` : la garde
    // CERTIFIAIT la valeur périmée au lieu de l'attraper.
    //
    // Le point d'entrée de l'app installée est, par définition, la première section de la
    // barre. En le DÉRIVANT, un lot qui déplace l'accueil emmène le manifeste avec lui — un
    // manifeste, personne ne le relit (leçon JobAI, déjà payée ici sur `background_color`).
    start_url: SECTIONS[0].href,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // ⚠️ Sombre seul (Marc, 22/10/2026) : le fond de l'app, `--bg-systeme` de `globals.css`,
    // converti en sRGB. Une autre valeur ferait un flash au lancement de l'app installée
    // (l'erreur que JobAI a payée) ; `tests/couleurs.test.ts` tient les trois sites ensemble.
    background_color: "#07090d",
    theme_color: "#07090d",
    lang: "fr-CA",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // [PWA-ANDROID] Était `/icone-192.png`, donc le MÊME fichier que l'icône normale, et
      // sous les 512 px attendus. Fichier distinct désormais. Le maskable est un fichier distinct : le dessin y est réduit (zone sûre) sur une tuile pleine.
      { src: "/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/partage",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
