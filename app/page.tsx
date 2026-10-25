// app/page.tsx — LA MAISON DE LIA : elle au centre, ses huit espaces en orbite (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026 ; « Memory ai est toujours pas en refonte », 23/10).
//
// La conversation complète a déménagé à `/chat` (section « Parler ») ; toucher LIA ouvre ici une
// discussion légère (`lia-ui`, `POST /api/lia/ask`). Cette page LIT seulement : la dépense du jour et les plafonds, les trente derniers jours et les modèles, les appels du mois par outil, ce qu'elle a fait aujourd'hui, ses dernières vérifications et les échéances de tes papiers. Ce que montre chaque espace est composé par
// `contenuEspaces` (pur, `tests/accueil.test.ts`) : sans source réelle, un espace le dit.
//
// ⚠️ `requireSession()` comme partout (`tests/gardePages.test.ts`), et `force-dynamic` : sans
// lui, Next prérend la page au build, où il n'y a pas de session, et le build échoue.

import { AccueilClient } from "./AccueilClient";
import { depotAccueilDrizzle } from "@/lib/accueil/depotAccueil";
import { contenuEspaces, type EntreesEspaces } from "@/lib/accueil/espaces";
import { debutDuMoisQuebec, jourMoins, LECTURES_DU_JOUR_MAX, LIGNES_RELANCES, minuitQuebec, RELANCES_JOURS_A_VENIR, RELANCES_JOURS_PASSES } from "@/lib/accueil/tableaux";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { OUTILS_LIA_HUB } from "@/lib/lia/ask";
import { TYPES_BLOCS } from "@/lib/lia/blocs";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { sourceMeteoEccc } from "@/lib/monde/meteo";
import { sourceActualite } from "@/lib/monde/actualite";
import { sourceBornes } from "@/lib/monde/bornes";

export const dynamic = "force-dynamic";

export default async function MaisonDeLia() {
  await requireSession();
  const acces = await accesDonnees();
  const jour = jourQuebec(new Date());
  // Plus de « N à juger » : Marc ne juge plus rien, LIA tranche seule (tâche MemoryAI 231).
  let budget: EntreesEspaces["budget"] = null;
  let appels: EntreesEspaces["appels"] = null;
  let lectures: EntreesEspaces["lectures"] = null;
  let activite: EntreesEspaces["activite"] = null;
  let relances: EntreesEspaces["relances"] = null;
  let meteo: EntreesEspaces["meteo"] = null;
  let actualite: EntreesEspaces["actualite"] = null;
  let bornes: EntreesEspaces["bornes"] = null;
  if (acces.ok) {
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
    activite = await accueil.activiteDuJour(jour);
    relances = await accueil.echeancesEntre(jour, jourMoins(jour, RELANCES_JOURS_PASSES), jourMoins(jour, -RELANCES_JOURS_A_VENIR), LIGNES_RELANCES);
    // Le monde (ADR 0024) : servi du cache en base, ECCC relu au plus toutes les 30 minutes.
    meteo = await sourceMeteoEccc(acces.db, process.env.MEMORYAI_METEO_VILLE).lire(new Date());
    actualite = await sourceActualite(acces.db).lire(new Date());
    // Les bornes proches (ADR 0028) : depuis le point de la ville de la météo, jamais une adresse.
    bornes = await sourceBornes(acces.db).lire(new Date(), meteo.ok ? (meteo.meteo.position ?? null) : null);
  }
  const contenus = contenuEspaces({ budget, appels, lectures, activite, relances, meteo, actualite, bornes, outils: [...OUTILS_LIA_HUB], formes: TYPES_BLOCS });
  return <AccueilClient contenus={contenus} />;
}
