// app/memoire/reseau/page.tsx — l'onglet RÉSEAU de la page Mémoire (MemoryAI#74, maquette v5) : son
// réseau de neurones, ce qui l'anime, ses humeurs et ses six couches.
//
// ⚠️ DES CHIFFRES RÉELS, et rien d'autre (tâche MemoryAI 187). Les trois premières tuiles lisent le
// réseau ENREGISTRÉ (`etatReseau`) : des comptes, une force moyenne par règle, la date de la
// dernière passe. Aucune valeur de fait n'est lue ni déchiffrée — les libellés sont des prédicats
// et des noms de règles, qui ne sont pas chiffrés.
// ⚠️ « Les six couches » reste VIDE, dessinée à sa place (règle de Marc du 23/10/2026) : la mémoire
// n'a pas de couches à montrer, et en inventer six pour remplir la tuile serait le contraire de ce
// que cette page sert à prouver.
// ⚠️ `requireSession()` et `force-dynamic` comme toutes les pages (`tests/gardePages.test.ts`).

import { CoqueMemoire } from "@/components/CoqueMemoire";
import { CorpsTuile } from "@/components/TableauEspace";
import { Tuile, Vide } from "@/components/Tuile";
import { depotEtatLiaDrizzle } from "@/lib/lia/depotEtat";
import { depotMemoireDrizzle } from "@/lib/memoire/depotMemoire";
import { corpsAnime, corpsHumeurs, corpsParRegle, corpsReseau, type EtatLiaLu } from "@/lib/memoire/tuilesReseau";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReseauPage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <CoqueMemoire actif="reseau">
        <Vide>{MESSAGES_MANQUE[acces.manque]}</Vide>
      </CoqueMemoire>
    );
  }

  const [etat, partage] = await Promise.all([
    depotMemoireDrizzle(acces.db).etatReseau(),
    depotEtatLiaDrizzle(acces.db).lire(),
  ]);
  const maintenant = new Date();
  const lia: EtatLiaLu | null = partage
    ? { humeur: partage.humeur, maj: partage.maj, envies: partage.envies, souvenirs: partage.souvenirs ?? [] }
    : null;

  return (
    <CoqueMemoire actif="reseau">
      <div className="tableau">
        <Tuile largeur={12} icone="net" titre="Son réseau de neurones">
          <CorpsTuile c={corpsReseau(etat, maintenant)} />
          <CorpsTuile c={corpsParRegle(etat)} />
        </Tuile>
        <Tuile largeur={6} icone="spark" titre="Ce qui l’anime maintenant">
          <CorpsTuile c={corpsAnime(lia, maintenant)} />
          <p className="hint">Ses envies sont une simulation du paquet de LIA, pas un ressenti.</p>
        </Tuile>
        <Tuile largeur={6} icone="heart" titre="Ses humeurs">
          <CorpsTuile c={corpsHumeurs(lia, maintenant)} />
          <p className="hint">Sa mémoire affective ne garde qu&apos;un genre, un instant et un poids : aucun texte.</p>
        </Tuile>
        <Tuile largeur={12} icone="layers" titre="Les six couches" repliee>
          <Vide>
            La mémoire n&apos;est pas faite de couches : ses liens viennent de règles nommées, et la tuile
            « Ce qui l&apos;anime » les montre une par une. Rien n&apos;est dessiné ici tant qu&apos;il n&apos;y a
            pas de couche réelle à décrire.
          </Vide>
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}
