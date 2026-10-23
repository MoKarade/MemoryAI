// app/memoire/reseau/page.tsx — l'onglet RÉSEAU de la page Mémoire (MemoryAI#74, maquette v5) : son
// réseau de neurones, ce qui l'anime, ses humeurs et ses six couches.
//
// ⚠️ NO FAKE DATA : ce réseau n'existe pas encore. Les quatre tuiles de la maquette sont dessinées
// à leur place et à leur taille (règle de Marc du 23/10/2026), chacune avec un état vide qui dit ce
// qui la remplira. Aucune lecture de la base : il n'y a rien à lire.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import { CoqueMemoire } from "@/components/CoqueMemoire";
import { Tuile, Vide } from "@/components/Tuile";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReseauPage() {
  await requireSession();
  return (
    <CoqueMemoire actif="reseau">
      <div className="tableau">
        <Tuile largeur={12} icone="net" titre="Son réseau de neurones">
          <Vide haute>
            Son réseau n&apos;est pas encore construit. Ici s&apos;afficheront ses neurones, leurs liens et ce qui
            s&apos;allume quand elle pense.
          </Vide>
        </Tuile>
        <Tuile largeur={6} icone="spark" titre="Ce qui l’anime maintenant">
          <Vide>Rien à montrer tant que le réseau n&apos;existe pas.</Vide>
        </Tuile>
        <Tuile largeur={6} icone="heart" titre="Ses humeurs">
          <Vide>Son humeur n&apos;est pas encore enregistrée jour après jour : rien à tracer.</Vide>
        </Tuile>
        <Tuile largeur={12} icone="layers" titre="Les six couches" repliee>
          <Vide>Les couches du réseau seront décrites ici quand il sera construit.</Vide>
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}
