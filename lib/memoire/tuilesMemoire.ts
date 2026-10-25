// lib/memoire/tuilesMemoire.ts — les tuiles de l'onglet Mémoire autour du réseau (maquette v5,
// écart C) : Thèmes, Sources, Croissance, Les plus reliés, Tranché par LIA et Papiers ; et À confirmer (Accès). PUR : la page lit la base, ce module compose, `CorpsTuile` dessine.
//
// ⚠️ Des COMPTES et des dates, jamais une valeur de fait : comme le réseau, ces tuiles montrent la
// forme de la mémoire, pas son contenu.

import type { Corps } from "@/lib/accueil/tableaux";
import type { SOURCES } from "@/lib/db/schema";
import { jourQuebec } from "@/lib/coutChat";
import { domaineDe } from "./reseau";

type Source = (typeof SOURCES)[number];

/** Les thèmes : un domaine (le préfixe du prédicat) et son nombre de faits validés, le plus gros d'abord. */
export function corpsThemes(faits: readonly { predicat: string }[]): Corps {
  const comptes = new Map<string, number>();
  for (const f of faits) comptes.set(domaineDe(f.predicat), (comptes.get(domaineDe(f.predicat)) ?? 0) + 1);
  const bulles = [...comptes].map(([libelle, valeur]) => ({ libelle, valeur })).sort((a, b) => b.valeur - a.valeur || a.libelle.localeCompare(b.libelle));
  if (bulles.length === 0) return { genre: "vide", texte: "Aucun fait validé : aucun thème pour l'instant." };
  return { genre: "bulles", bulles, resume: `Thèmes de la mémoire : ${bulles.map((b) => `${b.libelle} ${b.valeur}`).join(", ")}.` };
}

const LIBELLE_SOURCE: Record<Source, string> = { document: "Papiers", mail: "Courriels", app: "Apps", seed: "Amorce", marc: "Toi" };

/** Depuis quand, en mots courts : « 12 min », « 3 h », « 4 j ». */
export function depuis(quand: Date, maintenant: Date): string {
  const minutes = Math.max(0, Math.round((maintenant.getTime() - quand.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} j`;
}

/** Les sources : combien de faits validés chacune a apportés, et depuis quand la dernière. */
export function corpsSources(parSource: readonly { source: Source; n: number; dernier: Date | null }[], maintenant: Date): Corps {
  const lignes = parSource.filter((s) => s.n > 0).sort((a, b) => b.n - a.n);
  if (lignes.length === 0) return { genre: "vide", texte: "Aucune source n'a encore apporté de fait validé." };
  const max = lignes[0]?.n ?? 1;
  const libelle = (s: (typeof lignes)[number]) => LIBELLE_SOURCE[s.source] ?? s.source;
  return {
    genre: "barres",
    barres: lignes.map((s) => ({ libelle: libelle(s), valeur: s.dernier ? `${s.n.toLocaleString("fr-CA")} · ${depuis(s.dernier, maintenant)}` : s.n.toLocaleString("fr-CA"), part: s.n / max })),
    resume: `Faits validés par source : ${lignes.map((s) => `${libelle(s)} ${s.n}`).join(", ")}.`,
  };
}


const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/**
 * La croissance : combien de faits validés la mémoire tenait à la fin de chacun des douze derniers
 * mois (Québec), d'après la date de validation (à défaut, de création). Un compte cumulé, pas un flux.
 */
export function corpsCroissance(faits: readonly { valideLe: Date | null; creeLe: Date }[], maintenant: Date): Corps {
  if (faits.length === 0) return { genre: "vide", texte: "Aucun fait validé : la mémoire n'a pas encore grandi." };
  const [a, m] = jourQuebec(maintenant).split("-").map(Number) as [number, number];
  const mois = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 12 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const moisDe = faits.map((f) => jourQuebec(f.valideLe ?? f.creeLe).slice(0, 7));
  const barres = mois.map((cle) => {
    const n = moisDe.filter((x) => x <= cle).length;
    return { cle, etiquette: MOIS[Number(cle.slice(5)) - 1] ?? cle, valeur: n, texte: n.toLocaleString("fr-CA") };
  });
  return { genre: "histogramme", barres, resume: `Faits validés tenus par la mémoire à la fin de chaque mois : ${barres[0]?.valeur} il y a douze mois, ${barres[11]?.valeur} aujourd'hui.`, unite: "faits" };
}

/** Les plus reliés : les faits qui ont le plus de liens, nommés par leur prédicat (jamais leur valeur). */
export function corpsPlusRelies(faits: readonly { id: string; predicat: string }[], liens: readonly { faitA: string; faitB: string }[], combien = 8): Corps {
  const degre = new Map<string, number>();
  for (const l of liens) for (const id of [l.faitA, l.faitB]) degre.set(id, (degre.get(id) ?? 0) + 1);
  const top = faits
    .map((f) => ({ f, n: degre.get(f.id) ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n || x.f.predicat.localeCompare(y.f.predicat))
    .slice(0, combien);
  if (top.length === 0) return { genre: "vide", texte: "Aucun lien entre les faits validés pour l'instant." };
  const max = top[0]?.n ?? 1;
  return {
    genre: "barres",
    barres: top.map((x) => ({ libelle: x.f.predicat, valeur: String(x.n), part: x.n / max })),
    resume: `Les faits les plus reliés : ${top.map((x) => `${x.f.predicat} ${x.n}`).join(", ")}.`,
  };
}

/** La règle de Marc (25/10/2026, tâche MemoryAI 231) : il ne juge plus rien, LIA tranche seule. */
export const NE_JUGE_PLUS = "Tu ne juges plus rien : LIA tranche seule, quand une seconde lecture de DriveAI concorde.";

/** Tranché par LIA : la règle, puis le compte réel des papiers qu'elle a jugés vrais. Jamais de lien vers une pile. */
export function corpsTranche(vrais: number): Corps[] {
  return [
    { genre: "texte", texte: NE_JUGE_PLUS },
    vrais > 0
      ? { genre: "texte", texte: `${vrais} ${vrais > 1 ? "papiers jugés vrais" : "papier jugé vrai"} par LIA.` }
      : { genre: "vide", texte: "Aucun papier encore confirmé par une seconde lecture." },
  ];
}

/** Les papiers : combien de papiers gardés par dossier DriveAI, le plus gros d'abord. */
export function corpsPapiers(parDomaine: readonly { domaine: string | null; n: number }[]): Corps {
  const lignes = parDomaine.filter((d) => d.n > 0).map((d) => ({ libelle: d.domaine ?? "Sans dossier", n: d.n }));
  lignes.sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle));
  if (lignes.length === 0) return { genre: "vide", texte: "Aucun papier gardé pour l'instant." };
  const max = lignes[0]?.n ?? 1;
  return {
    genre: "barres",
    barres: lignes.map((l) => ({ libelle: l.libelle, valeur: l.n.toLocaleString("fr-CA"), part: l.n / max })),
    resume: `Papiers gardés par dossier : ${lignes.map((l) => `${l.libelle} ${l.n}`).join(", ")}.`,
  };
}

/** À confirmer : les questions ouvertes de LIA, la plus récente d'abord, et le lien pour répondre. */
export function corpsAConfirmer(questions: readonly { question: string; motif: string; creeLe: Date }[], maintenant: Date): Corps[] {
  if (questions.length === 0) return [{ genre: "vide", texte: "Rien à confirmer : LIA n'a aucune question ouverte." }];
  return [
    { genre: "liste", elements: questions.map((q) => ({ libelle: q.question, detail: `${q.motif} · il y a ${depuis(q.creeLe, maintenant)}` })) },
    { genre: "texte", texte: `${questions.length} question${questions.length > 1 ? "s" : ""} en attente de ta réponse.`, lien: { href: "/questions", libelle: "Répondre" } },
  ];
}
