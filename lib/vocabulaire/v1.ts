// lib/vocabulaire/v1.ts — la version 1 du vocabulaire des prédicats (ADR 0001 §5.2).
//
// FERMÉ : un prédicat absent d'ici ⇒ 422 avec son nom, et un compteur dans
// `predicats_refuses` — c'est le signal qui dit quoi mettre dans la v2. VERSIONNÉ : la
// version est stockée sur le fait et sur le refus. Un prédicat ne se retire JAMAIS d'une
// version : il se marque `deprecie` avec son remplaçant.
//
// Chaque entrée porte son NIVEAU MINIMAL — le code prend le MAX de ce niveau, du niveau
// dérivé du domaine du document, et du niveau que le LLM propose. Jamais le minimum.
//
// `multi` dit si plusieurs faits du même prédicat peuvent coexister pour un sujet (des
// goûts, des documents) ou si un nouveau fait REMPLACE l'ancien (un employeur courant).
//
// Marc a demandé « encore plus, et de plus en plus » (Q9) : la v1 est large. Ce qui n'y est
// pas se compte, puis s'ajoute en v2 — jamais en insérant quand même.

export type Niveau = 0 | 1 | 2 | 3;
export type TypeValeur = "date" | "texte" | "ref_document";

export interface DefinitionPredicat {
  readonly predicat: string;
  /** Le domaine du vocabulaire (sert aux périmètres d'app) — pas le dossier DriveAI. */
  readonly domaine: string;
  readonly niveauMin: Niveau;
  readonly types: readonly TypeValeur[];
  readonly multi: boolean;
  readonly description: string;
  /** Prédicat qui le remplace, s'il est déprécié. Jamais retiré. */
  readonly deprecie?: string;
}

const d = (
  predicat: string,
  domaine: string,
  niveauMin: Niveau,
  types: readonly TypeValeur[],
  multi: boolean,
  description: string,
): DefinitionPredicat => ({ predicat, domaine, niveauMin, types, multi, description });

const T = ["texte"] as const;
const D = ["date"] as const;
const TD = ["texte", "date"] as const;
const R = ["ref_document"] as const;

export const VOCABULAIRE_V1: readonly DefinitionPredicat[] = [
  // ── emploi (N1) ────────────────────────────────────────────────────────────────────
  d("emploi.employeur", "emploi", 1, T, false, "Employeur courant"),
  d("emploi.poste", "emploi", 1, T, false, "Intitulé du poste courant"),
  d("emploi.debut", "emploi", 1, D, false, "Début de l'emploi courant"),
  d("emploi.fin", "emploi", 1, D, false, "Fin de l'emploi courant (si connue)"),
  d("emploi.statut", "emploi", 1, T, false, "En poste, en recherche, en préavis…"),
  d("emploi.ancien", "emploi", 1, T, true, "Un ancien employeur (une entrée par employeur)"),
  d("emploi.domaine", "emploi", 1, T, true, "Domaine professionnel"),
  d("emploi.competence", "emploi", 0, T, true, "Une compétence revendiquée"),
  // ── études (N1) ────────────────────────────────────────────────────────────────────
  d("etudes.etablissement", "etudes", 1, T, true, "Établissement fréquenté"),
  d("etudes.programme", "etudes", 1, T, true, "Programme suivi"),
  d("etudes.diplome", "etudes", 1, T, true, "Diplôme obtenu"),
  d("etudes.annee", "etudes", 1, TD, true, "Année d'obtention ou de fréquentation"),
  d("etudes.en_cours", "etudes", 1, T, false, "Études en cours"),
  // ── formation (N1) ─────────────────────────────────────────────────────────────────
  d("formation.cours", "formation", 1, T, true, "Un cours suivi"),
  d("formation.certification", "formation", 1, T, true, "Une certification obtenue"),
  d("formation.echeance", "formation", 1, D, true, "Échéance d'une certification"),
  // ── logement ───────────────────────────────────────────────────────────────────────
  d("logement.type", "logement", 1, T, false, "Appartement, condo, maison…"),
  d("logement.ville", "logement", 1, T, false, "Ville de résidence"),
  d("logement.bail.debut", "logement", 1, D, false, "Début du bail"),
  d("logement.bail.fin", "logement", 1, D, false, "Fin du bail"),
  d("logement.proprietaire", "logement", 1, T, false, "Propriétaire ou gestionnaire"),
  d("logement.adresse", "logement", 2, T, false, "Adresse du domicile — N2, servie à périmètre seulement (Q3)"),
  d("logement.ancien", "logement", 1, T, true, "Une ancienne ville ou un ancien logement"),
  // ── véhicule (N1) ──────────────────────────────────────────────────────────────────
  d("vehicule.modele", "vehicule", 1, T, false, "Marque et modèle"),
  d("vehicule.annee", "vehicule", 1, T, false, "Année-modèle"),
  d("vehicule.bail.debut", "vehicule", 1, D, false, "Début du bail ou de la possession"),
  d("vehicule.bail.fin", "vehicule", 1, D, false, "Fin du bail"),
  d("vehicule.bail.km", "vehicule", 1, T, false, "Kilométrage alloué au bail"),
  d("vehicule.assureur", "vehicule", 1, T, false, "Assureur auto"),
  d("vehicule.entretien", "vehicule", 1, TD, true, "Un entretien fait ou prévu"),
  d("vehicule.immatriculation.echeance", "vehicule", 1, D, false, "Échéance d'immatriculation"),
  // ── santé (N2) ─────────────────────────────────────────────────────────────────────
  d("sante.allergie", "sante", 2, T, true, "Une allergie"),
  d("sante.praticien", "sante", 2, T, true, "Un praticien suivi"),
  d("sante.couverture", "sante", 2, T, false, "Régime d'assurance santé"),
  d("sante.rendez_vous", "sante", 2, TD, true, "Un rendez-vous"),
  d("sante.condition", "sante", 2, T, true, "Une condition connue"),
  d("sante.pharmacie", "sante", 2, T, false, "Pharmacie habituelle"),
  // ── relations (N2, le nom chiffré dans `sujets`) ───────────────────────────────────
  d("relation.proche", "relation", 2, T, true, "Un proche (slug de sujet)"),
  d("relation.lien", "relation", 2, T, true, "La nature du lien"),
  d("relation.statut", "relation", 2, T, false, "Situation conjugale"),
  // ── famille (N2) ───────────────────────────────────────────────────────────────────
  d("famille.evenement", "famille", 2, TD, true, "Un événement familial daté"),
  d("famille.anniversaire", "famille", 2, TD, true, "Un anniversaire à retenir"),
  d("famille.enfant", "famille", 2, T, true, "Un enfant (slug de sujet)"),
  // ── identité / immigration / fiscal (N3 : existence, type, date, échéance, pointeur) ─
  d("identite.document", "identite", 3, R, true, "Un document d'identité existe"),
  d("identite.echeance", "identite", 3, D, true, "Échéance d'un document d'identité"),
  d("immigration.statut", "immigration", 3, R, false, "Le document de statut existe"),
  d("immigration.echeance", "immigration", 3, D, false, "Échéance du statut"),
  d("immigration.demande", "immigration", 3, R, true, "Une demande en cours existe"),
  d("fiscal.declaration", "fiscal", 3, R, true, "Une déclaration existe"),
  d("fiscal.avis", "fiscal", 3, R, true, "Un avis de cotisation existe"),
  d("fiscal.echeance", "fiscal", 3, D, true, "Une échéance fiscale"),
  // ── goûts (N0) ─────────────────────────────────────────────────────────────────────
  d("gout.cuisine", "gout", 0, T, true, "Une cuisine ou un plat aimé"),
  d("gout.activite", "gout", 0, T, true, "Une activité aimée"),
  d("gout.musique", "gout", 0, T, true, "Un genre ou un artiste"),
  d("gout.marque", "gout", 0, T, true, "Une marque préférée"),
  d("gout.lecture", "gout", 0, T, true, "Un auteur, un genre, un titre"),
  d("gout.film_serie", "gout", 0, T, true, "Un film, une série, un genre"),
  d("gout.boisson", "gout", 0, T, true, "Une boisson aimée"),
  d("gout.evite", "gout", 0, T, true, "Ce que Marc évite"),
  d("gout.style", "gout", 0, T, true, "Un style (vestimentaire, déco…)"),
  // ── loisirs (N0) ───────────────────────────────────────────────────────────────────
  d("loisir.sport", "loisir", 0, T, true, "Un sport pratiqué"),
  d("loisir.activite", "loisir", 0, T, true, "Un loisir régulier"),
  d("loisir.equipement", "loisir", 0, T, true, "Un équipement possédé"),
  d("loisir.club", "loisir", 1, T, true, "Un club, une ligue, un abonnement sportif"),
  // ── projets (N0) ───────────────────────────────────────────────────────────────────
  d("projet.en_cours", "projet", 0, T, true, "Un projet en cours"),
  d("projet.souhait", "projet", 0, T, true, "Un souhait, une envie"),
  d("projet.echeance", "projet", 0, TD, true, "Une échéance de projet"),
  d("projet.termine", "projet", 0, T, true, "Un projet terminé"),
  // ── documents (niveau dérivé du chemin) ────────────────────────────────────────────
  d("document.existe", "document", 1, R, true, "Un document existe, et où (fileId)"),
  // ── abonnements / contrats / garanties (N1) ────────────────────────────────────────
  d("abonnement.service", "abonnement", 1, T, true, "Un service souscrit"),
  d("abonnement.echeance", "abonnement", 1, D, true, "Échéance ou renouvellement"),
  d("contrat.fournisseur", "contrat", 1, T, true, "Un fournisseur sous contrat (internet, téléphone, assurance…)"),
  d("contrat.type", "contrat", 1, T, true, "Type de contrat"),
  d("contrat.echeance", "contrat", 1, D, true, "Échéance d'un contrat"),
  d("garantie.achat", "garantie", 1, T, true, "Un achat sous garantie"),
  d("garantie.echeance", "garantie", 1, D, true, "Fin de garantie"),
  // ── finances — EXISTENCE seulement, jamais un montant (N2) ─────────────────────────
  d("finance.compte.existe", "finance", 2, T, true, "Un compte existe (institution, type)"),
  d("finance.produit.existe", "finance", 2, T, true, "Un produit financier existe"),
  d("finance.institution", "finance", 2, T, true, "Une institution financière fréquentée"),
  d("finance.echeance", "finance", 2, D, true, "Une échéance financière (sans montant)"),
  // ── voyages (N1) ───────────────────────────────────────────────────────────────────
  d("voyage.destination", "voyage", 1, T, true, "Une destination visitée ou prévue"),
  d("voyage.date", "voyage", 1, D, true, "Une date de voyage"),
  d("voyage.hebergement", "voyage", 1, T, true, "Un hébergement"),
  d("voyage.compagnie", "voyage", 1, T, true, "Une compagnie utilisée"),
  d("voyage.souhait", "voyage", 0, T, true, "Une destination souhaitée"),
  // ── animaux (N0) ───────────────────────────────────────────────────────────────────
  d("animal.espece", "animal", 0, T, true, "Un animal de compagnie"),
  d("animal.nom", "animal", 0, T, true, "Son nom"),
  d("animal.veterinaire", "animal", 1, T, false, "Vétérinaire"),
  // ── contacts (N1 : EXISTENCE, jamais des coordonnées) ──────────────────────────────
  d("contact.professionnel", "contact", 1, T, true, "Un contact professionnel existe (rôle, organisation)"),
  d("contact.organisation", "contact", 1, T, true, "Une organisation en relation"),
  // ── préférences de fonctionnement (N0) ─────────────────────────────────────────────
  d("preference.langue", "preference", 0, T, false, "Langue préférée"),
  d("preference.fuseau", "preference", 0, T, false, "Fuseau horaire"),
  d("preference.horaire", "preference", 0, T, true, "Une habitude d'horaire"),
  d("preference.communication", "preference", 0, T, true, "Comment Marc préfère être adressé"),
  d("preference.outil", "preference", 0, T, true, "Un outil ou une app préférée"),
];

export const VERSION_VOCABULAIRE_V1 = 1 as const;
