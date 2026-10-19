// app/chat/page.tsx — [L26] le chat a DÉMÉNAGÉ à la racine : cette route y renvoie.
//
// ⚠️ Pourquoi une redirection plutôt qu'une suppression : `/chat` est une adresse que Marc a
// pu marquer, et qui figure dans des comptes-rendus de session. Une 404 sur un chemin qui
// marchait hier se lit comme une panne, pas comme un déplacement.
//
// ⚠️ `requireSession()` AVANT la redirection, et ce n'est pas décoratif : sans lui cette page
// serait exemptée dans `tests/gardePages.test.ts`, et une exemption est une porte de sortie
// qu'il faut mériter. Une ligne coûte moins qu'une entrée dans une liste d'exceptions.

// ⚠️⚠️ `force-dynamic` N'EST PAS DU DÉCOR ICI : sans lui, Next PRÉREND cette page au BUILD,
// `requireSession()` y lève `NonAutorisé` faute de session, et `npm run build` ÉCHOUE — mesuré.
// Les treize autres pages du dossier la déclarent, `/login` comprise, qui n'appelle même pas
// `requireSession()` : j'ai recopié l'appel du voisin sans sa PRÉCONDITION. Garde ajoutée dans
// `tests/gardePages.test.ts`, qui rougit en une seconde là où le build coûte trois minutes.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatDeplace() {
  await requireSession();
  redirect("/");
}
