// app/page.tsx — LA MAISON DE LIA : elle au centre, ses huit espaces en orbite (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026 ; « Memory ai est toujours pas en refonte », 23/10).
//
// La conversation complète a déménagé à `/chat` (section « Parler ») ; toucher LIA ouvre ici une
// discussion légère (`lia-ui`, `POST /api/lia/ask`). Cette page LIT seulement : la dépense du jour et les plafonds, les trente derniers jours et les modèles, les appels du mois par outil, ce qu'elle a fait aujourd'hui, ce qu'elle a fait seule (son journal et son frein, ADR 0032), ses dernières vérifications, les échéances de tes papiers, l'agenda du jour envoyé par DriveAI et ses idées pour tes apps. Ce que montre chaque espace est composé par
// `contenuEspaces` (pur, `tests/accueil.test.ts`) : sans source réelle, un espace le dit.
//
// ⚠️ `requireSession()` comme partout (`tests/gardePages.test.ts`), et `force-dynamic` : sans
// lui, Next prérend la page au build, où il n'y a pas de session, et le build échoue.

import { AccueilClient } from "./AccueilClient";
import { lireAgendaDuJour } from "@/lib/agenda/depot";
import { depotAccueilDrizzle } from "@/lib/accueil/depotAccueil";
import { contenuEspaces, type EntreesEspaces } from "@/lib/accueil/espaces";
import { debutDuMoisQuebec, jourMoins, LECTURES_DU_JOUR_MAX, LIGNES_RELANCES, minuitQuebec, RELANCES_JOURS_A_VENIR, RELANCES_JOURS_PASSES } from "@/lib/accueil/tableaux";
import { avecBornes } from "@/lib/accueil/tuileBornes";
import { avecJournalLia, type JournalLia } from "@/lib/accueil/tuileSeule";
import { jourQuebec } from "@/lib/coutChat";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { lireIdees } from "@/lib/idees/depot";
import { OUTILS_LIA_HUB } from "@/lib/lia/ask";
import { TYPES_BLOCS } from "@/lib/lia/blocs";
import { lireEtatFrein, lireJournalDuJour } from "@/lib/lia/journal";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { sourceBornes, type LectureBornes } from "@/lib/monde/bornes";
import { sourceMeteoEccc } from "@/lib/monde/meteo";
import { sourceActualite } from "@/lib/monde/actualite";

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
  let agenda: EntreesEspaces["agenda"] = null;
  let idees: EntreesEspaces["idees"] = null;
  let meteo: EntreesEspaces["meteo"] = null;
  let actualite: EntreesEspaces["actualite"] = null;
  let bornes: LectureBornes | null | undefined;
  // Sans base, `journal` reste `undefined` : la journée garde ses tuiles d'origine.
  let journal: JournalLia | null | undefined;
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
    // L'agenda du jour que DriveAI envoie (ADR 0029) : rien reçu aujourd'hui, la tuile le dit.
    agenda = (await lireAgendaDuJour(acces.db, acces.cle, jour)) ?? "non-recu";
    // Ses idées pour tes apps (ADR 0027) : la page les LIT, c'est la passe d'apprentissage qui les écrit.
    idees = await lireIdees(acces.db, acces.cle);
    // Le monde (ADR 0024) : servi du cache en base, ECCC relu au plus toutes les 30 minutes.
    meteo = await sourceMeteoEccc(acces.db, process.env.MEMORYAI_METEO_VILLE).lire(new Date());
    actualite = await sourceActualite(acces.db).lire(new Date());
    // Les bornes proches (ADR 0028) : depuis le point de la ville de la météo, jamais une adresse.
    bornes = await sourceBornes(acces.db).lire(new Date(), meteo.ok ? (meteo.meteo.position ?? null) : null);
    // Ce qu'elle a fait seule et son frein (ADR 0032). Une panne de ce journal ne casse pas la maison : la tuile le dit.
    try {
      journal = { jour, frein: await lireEtatFrein(acces.db), lignes: await lireJournalDuJour(acces.db, jour) };
    } catch (e) {
      console.error("[accueil] journal de l'autonomie illisible :", e instanceof Error ? e.name : "erreur");
      journal = null;
    }
  }
  const contenus = contenuEspaces({ budget, appels, lectures, activite, relances, agenda, idees, meteo, actualite, outils: [...OUTILS_LIA_HUB], formes: TYPES_BLOCS });
  // Sans base, `bornes` reste `undefined` : la tuile garde son texte d'origine.
  const monde = contenus.monde.tableau;
  const journee = contenus.journee.tableau;
  const complets = {
    ...contenus,
    monde: monde ? { ...contenus.monde, tableau: avecBornes(monde, bornes) } : contenus.monde,
    journee: journee ? { ...contenus.journee, tableau: avecJournalLia(journee, journal) } : contenus.journee,
  };
  return <AccueilClient contenus={complets} />;
}
