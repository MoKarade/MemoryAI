// app/page.tsx — LA MAISON DE LIA : elle au centre, ses huit espaces en orbite (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026 ; « Memory ai est toujours pas en refonte », 23/10).
//
// La conversation complète a déménagé à `/chat` (section « Parler ») ; toucher LIA ouvre ici une
// discussion légère (`lia-ui`, `POST /api/lia/ask`). Cette page LIT seulement : la pile (« N à
// juger »), la dépense du jour et les plafonds. Ce que montre chaque espace est composé par
// `contenuEspaces` (pur, `tests/accueil.test.ts`) : sans source réelle, un espace le dit.
//
// ⚠️ `requireSession()` comme partout (`tests/gardePages.test.ts`), et `force-dynamic` : sans
// lui, Next prérend la page au build, où il n'y a pas de session, et le build échoue.

import { AccueilClient } from "./AccueilClient";
import { contenuEspaces, type EntreesEspaces } from "@/lib/accueil/espaces";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { OUTILS_LIA_HUB } from "@/lib/lia/ask";
import { TYPES_BLOCS } from "@/lib/lia/blocs";
import { accesDonnees } from "@/lib/pageDonnees";
import { bandeauAJuger, type BandeauAJuger } from "@/lib/pile/bandeau";
import { chargerEntreesPile } from "@/lib/pile/charger";
import { composerPile, restantParGenre } from "@/lib/pile/composer";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MaisonDeLia() {
  await requireSession();
  const acces = await accesDonnees();
  const jour = jourQuebec(new Date());
  // ⚠️ Un COMPTE, pas les cartes : la pastille dit qu'il y a quelque chose à juger, `/questions`
  // le montre. `avis` entre dans le compte : une carte déjà jugée n'est plus « à juger ».
  let aJuger: BandeauAJuger | null = null;
  let budget: EntreesEspaces["budget"] = null;
  if (acces.ok) {
    const { candidats, deductions, questions, avis } = await chargerEntreesPile(acces.db);
    const ordre = composerPile({
      pieces: candidats,
      faits: deductions.map((d) => ({ id: d.fait.id, creeLe: d.fait.creeLe })),
      questions: questions.map((q) => ({ id: q.id, creeLe: q.creeLe })),
      avis,
      aujourdhui: jour,
    });
    aJuger = bandeauAJuger(restantParGenre(ordre, avis));
    const admin = depotAdminDrizzle(acces.db);
    budget = { depense: await admin.depenseDuJourParPoste(jour), plafonds: await admin.plafonds() };
  }
  const contenus = contenuEspaces({ aJuger, budget, outils: [...OUTILS_LIA_HUB], formes: TYPES_BLOCS });
  return <AccueilClient contenus={contenus} aJuger={aJuger ? { titre: aJuger.titre, detail: aJuger.detail } : null} />;
}
