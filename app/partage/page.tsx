// app/partage/page.tsx — ce qu'Android vient de partager vers MemoryAI (socle S6).
//
// ⚠️ Cette page est un point d'ENTRÉE, donc elle est gardée comme les autres : le contenu
// partagé est du texte personnel, et rien ici ne doit s'afficher sans session. Le service
// worker, lui, tourne AVANT elle et dans le navigateur — il ne voit aucune session : c'est
// pour ça qu'il ne fait que déposer dans un cache local et rediriger, sans jamais rien
// envoyer au serveur.

import { Nav } from "@/components/Nav";
import { requireSession } from "@/lib/session";
import { PartageClient } from "./PartageClient";

export const dynamic = "force-dynamic";

export default async function PartagePage() {
  await requireSession();
  return (
    <>
      <Nav active="chat" />
      <PartageClient />
    </>
  );
}
