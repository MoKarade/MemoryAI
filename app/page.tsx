// app/page.tsx — LA MAISON DE LIA : elle au centre, ses huit espaces en orbite (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026 ; « Memory ai est toujours pas en refonte », 23/10).
//
// La conversation complète a déménagé à `/chat` (section « Parler ») ; toucher LIA ouvre ici une
// discussion légère (`lia-ui`, `POST /api/lia/ask`). Cette page LIT seulement : la pile (« N à
// juger »), la dépense du jour et les plafonds, les trente derniers jours et les modèles, les appels du mois par outil. Ce que montre chaque espace est composé par
// `contenuEspaces` (pur, `tests/accueil.test.ts`) : sans source réelle, un espace le dit.
//
// ⚠️ `requireSession()` comme partout (`tests/gardePages.test.ts`), et `force-dynamic` : sans
// lui, Next prérend la page au build, où il n'y a pas de session, et le build échoue.

import { AccueilClient } from "./AccueilClient";
import { depotAccueilDrizzle } from "@/lib/accueil/depotAccueil";
import { contenuEspaces, type EntreesEspaces } from "@/lib/accueil/espaces";
import { debutDuMoisQuebec, jourMoins, LECTURES_DU_JOUR_MAX, minuitQuebec } from "@/lib/accueil/tableaux";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { OUTILS_LIA_HUB } from "@/lib/lia/ask";
import { TYPES_BLOCS } from "@/lib/lia/blocs";
import { accesDonnees } from "@/lib/pageDonnees";
import { bandeauAJuger, type BandeauAJuger } from "@/lib/pile/bandeau";
import { resteAJuger } from "@/lib/pile/charger";
import { requireSession } from "@/lib/session";
import { sourceMeteoEccc } from "@/lib/monde/meteo";
import { sourceActualite } from "@/lib/monde/actualite";

export const dynamic = "force-dynamic";

export default async function MaisonDeLia() {
  await requireSession();
  const acces = await accesDonnees();
  const jour = jourQuebec(new Date());
  // ⚠️ Un COMPTE, pas les cartes : la pastille dit qu'il y a quelque chose à juger, `/questions`
  // le montre. `avis` entre dans le compte : une carte déjà jugée n'est plus « à juger ».
  let aJuger: BandeauAJuger | null = null;
  let budget: EntreesEspaces["budget"] = null;
  let appels: EntreesEspaces["appels"] = null;
  let lectures: EntreesEspaces["lectures"] = null;
  let meteo: EntreesEspaces["meteo"] = null;
  let actualite: EntreesEspaces["actualite"] = null;
  if (acces.ok) {
    aJuger = bandeauAJuger(await resteAJuger(acces.db, jour));
    const admin = depotAdminDrizzle(acces.db);
    const accueil = depotAccueilDrizzle(acces.db);
    budget = {
      jour,
      depense: await admin.depenseDuJourParPoste(jour),
      plafonds: await admin.plafonds(),
      parJour: await admin.depenseParJour(31), // tout le mois en cours, au pire 31 jours
      parModele: await accueil.depenseParModeleDepuis(jourMoins(jour, 29)),
    };
    appels = await accueil.appelsParOutilDepuis(debutDuMoisQuebec(new Date()));
    lectures = await accueil.lecturesDepuis(minuitQuebec(jour), LECTURES_DU_JOUR_MAX);
    // Le monde (ADR 0024) : servi du cache en base, ECCC relu au plus toutes les 30 minutes.
    meteo = await sourceMeteoEccc(acces.db, process.env.MEMORYAI_METEO_VILLE).lire(new Date());
    actualite = await sourceActualite(acces.db).lire(new Date());
  }
  const contenus = contenuEspaces({ aJuger, budget, appels, lectures, meteo, actualite, outils: [...OUTILS_LIA_HUB], formes: TYPES_BLOCS });
  return <AccueilClient contenus={contenus} aJuger={aJuger ? { titre: aJuger.titre, detail: aJuger.detail } : null} />;
}
