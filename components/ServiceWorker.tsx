"use client";
// components/ServiceWorker.tsx — enregistre `public/sw.js`, et rien d'autre.
//
// ⚠️ Le worker n'a qu'UN rôle : recevoir un partage Android. Il ne met RIEN en cache — pas une
// page, pas une réponse d'API. MemoryAI sert les données les plus personnelles de
// l'écosystème derrière une session : un cache hors-ligne les laisserait sur l'appareil et
// servirait des écrans périmés à quelqu'un qui n'a plus de session.

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Échec SILENCIEUX assumé, et borné : un worker non enregistré ne casse rien de l'app —
    // seul le partage Android cesse de marcher, et `/partage` le DIT alors explicitement.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
