// lib/hubSummary.ts — ce que MemoryAI publie au hub (contrat v1.3), depuis les comptes réels.
//
// `building` tant qu'aucun fait n'est VALIDÉ (ADR 0001 §8 ; un `propose` n'est pas une
// donnée que Marc a confirmée). Ensuite `ok`, et `degraded` quand la file « à valider »
// dépasse le seuil d'alerte forte (CLAUDE.md §9 n° 5 : une mémoire que personne ne valide
// est le vrai risque). `dataAsOf` = le dernier fait validé, jamais « maintenant ».
// Pas d'`expectedMaxAgeSec` : comme BatchChef, il n'y a pas de moteur qui passe — la
// donnée change quand Marc valide. Le coût du chat n'est publié que s'il y a eu ≥ 1 appel.
// PURE : les comptes sont un paramètre.

import { buildingSummary, type HubSummary } from "@mokarade/hub-contract";
import { totalInformations } from "./totalInformations";

export const APP: HubSummary["app"] = {
  id: "memoryai",
  name: "MemoryAI",
  url: "https://memoryai.hubperso.com",
  color: "#7c3aed",
};

export const SEUIL_A_VALIDER_ALERTE = 100;
export const SEUIL_A_VALIDER_FORT = 500;

export interface ComptesMemoire {
  valides: number;
  aValider: number;
  canaris: number;
  dernierValideLe: string | null;
  parDomaine: Record<string, number>;
  chat: { totalUsd: number; appels: number };
  gele: boolean;
  /**
   * Les PAPIERS (table `pieces`). ⚠️ Champ REQUIS, et pas par goût de la rigueur : le jour où
   * les faits `document.existe` sont sortis de `valides` (ils sont devenus des pièces),
   * « Faits validés » est passé de 2 828 à ~180 sur la carte. Sans une seconde métrique qui
   * dit où les 2 646 autres sont partis, la carte annonce une chute de 94 % et ressemble à une
   * perte de données. Optionnel, un appelant l'oublierait et la carte mentirait en silence.
   */
  papiers: number;
}

/**
 * Le contrat borne une section de `details` à {@link MAX_ITEMS_SECTION} lignes, et il le
 * fait en REFUSANT le summary entier : une liste trop longue ne tronque pas l'affichage,
 * elle met la carte en erreur.
 *
 * ⚠️ Ce plafond a coûté une panne le 15/09/2026. La version précédente coupait à 12 — un
 * chiffre écrit à la main, jamais confronté au schéma. Tant que la mémoire était vide le
 * code n'avait jamais plus de quelques domaines, donc la branche fautive était
 * INATTEIGNABLE ; la validation des 98 premiers faits l'a rendue atteignable, et
 * `/hub/summary` est passé en `500` alors que la mémoire allait parfaitement bien.
 *
 * Au-delà du plafond, on ne JETTE pas la queue : les domaines restants sont agrégés dans
 * une dernière ligne qui dit combien ils sont et combien de faits ils portent. Une liste
 * tronquée en silence laisserait croire que la mémoire ne contient que ces domaines-là, et
 * le total afficherait moins que la métrique « Faits validés » juste à côté.
 */
export const MAX_ITEMS_SECTION = 8;

export function itemsParDomaine(
  domaines: readonly (readonly [string, number])[],
): { label: string; value: number; format: "number" }[] {
  const item = (label: string, value: number) => ({ label, value, format: "number" as const });
  if (domaines.length <= MAX_ITEMS_SECTION) return domaines.map(([d, n]) => item(d, n));
  const tete = domaines.slice(0, MAX_ITEMS_SECTION - 1);
  const reste = domaines.slice(MAX_ITEMS_SECTION - 1);
  const faitsDuReste = reste.reduce((t, [, n]) => t + n, 0);
  return [...tete.map(([d, n]) => item(d, n)), item(`${reste.length} autres domaines`, faitsDuReste)];
}

export function composerSummary(c: ComptesMemoire, maintenant: Date = new Date()): HubSummary {
  // ⚠️ « En construction » exige que la mémoire soit vide des DEUX côtés. Sur le seul compte
  // des faits, une mémoire qui aurait migré tout son inventaire en papiers se déclarerait en
  // construction avec 2 723 papiers en base — le `status: "building"` du contrat dit « aucune
  // donnée confirmée », ce qui serait faux. Le test exerce ce cas exact.
  if (c.valides === 0 && c.papiers === 0) {
    return buildingSummary(APP, {
      alertLabel:
        c.aValider > 0
          ? `${c.aValider} fait(s) attendent ta validation — rien n'est validé encore.`
          : "MemoryAI en construction — aucun fait validé.",
    });
  }
  // ⚠️ Aucun lien ne mène à l'ancienne page `/a-valider` (tâche MemoryAI 277) : Marc ne juge plus
  // rien, et ce qui reste à regarder se lit dans l'onglet Mémoire.
  const alerts: HubSummary["alerts"] = [];
  if (c.aValider >= SEUIL_A_VALIDER_FORT) alerts.push({ label: `${c.aValider} faits à valider — la file déborde`, severity: "alert", href: `${APP.url}/memoire` });
  else if (c.aValider >= SEUIL_A_VALIDER_ALERTE) alerts.push({ label: `${c.aValider} faits à valider`, severity: "warn", href: `${APP.url}/memoire` });
  if (c.canaris > 0) alerts.push({ label: `${c.canaris} valeur(s) ressemblant à une consigne, jamais servies`, severity: "info", href: `${APP.url}/memoire` });
  if (c.gele) alerts.push({ label: "Mémoire gelée (MEMORYAI_GEL=1) : rien n'est servi", severity: "warn" });

  // Le total « ce que la mémoire sait de toi », source UNIQUE partagée avec l'écran Régler.
  const total = totalInformations({ faits: c.valides, papiers: c.papiers });
  const domaines = Object.entries(c.parDomaine).sort((a, b) => b[1] - a[1]);
  const summary: HubSummary = {
    contractVersion: 1,
    status: c.gele ? "degraded" : c.aValider >= SEUIL_A_VALIDER_FORT ? "degraded" : "ok",
    app: APP,
    generatedAt: maintenant.toISOString(),
    ...(c.dernierValideLe ? { dataAsOf: c.dernierValideLe } : {}),
    metrics: [
      // ⚠️ « Informations » porte le `primary` et PAS « Faits validés ». Marc regardait ce
      // dernier en croyant y lire l'avancement : il ne bouge pas quand la campagne de lecture
      // tourne (elle écrit des PAPIERS), donc la carte affichait un chiffre figé sous le nez de
      // quelqu'un qui cherchait un progrès. Les deux postes restent PUBLIÉS juste en dessous —
      // un total sans sa décomposition redeviendrait le compteur trompeur qu'on retire.
      ...(total === null ? [] : [{ label: "Informations", value: total, format: "number" as const, primary: true }]),
      { label: "Faits validés", value: c.valides, format: "number" },
      { label: "Papiers", value: c.papiers, format: "number" },
      { label: "À valider", value: c.aValider, format: "number", severity: c.aValider >= SEUIL_A_VALIDER_ALERTE ? "warn" : "ok" },
      { label: "Domaines", value: domaines.length, format: "number" },
    ],
    alerts,
    actions: [
      { label: "Mémoire", href: `${APP.url}/memoire`, kind: "link" },
      { label: "Chat", href: `${APP.url}/chat`, kind: "link" },
    ],
    ...(c.aValider > 0 ? { recommendation: { label: `Valider ${c.aValider} fait(s)`, why: "Un fait proposé n'est servi comme sûr qu'une fois validé.", href: `${APP.url}/memoire` } } : {}),
    ...(domaines.length
      ? { details: [{ title: "Faits validés par domaine", items: itemsParDomaine(domaines) }] }
      : {}),
    ...(c.chat.appels > 0 ? { usage: { cost: { currency: "USD", amount: Math.round(c.chat.totalUsd * 10000) / 10000, period: "total" } } } : {}),
  };
  return summary;
}
