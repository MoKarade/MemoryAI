// lib/evenements/messenger.ts — lire un export Messenger (HTML Facebook) en messages datés (MemoryAI#70).
//
// ⚠️ LE FORMAT A ÉTÉ RELEVÉ SUR DE VRAIS EXPORTS, PAS DEVINÉ (24/10/2026, deux `message_N.html`
// du Drive de Marc, générés le 18/03/2026) : un message est une `<section>` qui porte l'auteur
// dans un `<h2>`, le texte dans le DEUXIÈME `<div>` du corps, la date dans le `<footer>`. Les
// classes (`_a6-g`, `_a72d`…) sont générées par Facebook et changent d'un export à l'autre : on
// s'appuie sur la STRUCTURE (section, h2, footer), jamais sur une classe. Les tests tournent sur
// des exports FICTIFS de même forme.
//
// ⚠️ UNE DATE ILLISIBLE N'EST PAS DEVINÉE. Le message est écarté et compté (`datesIllisibles`) :
// un message daté au hasard répondrait faux à « qu'ai-je dit tel jour », et on le croirait.
//
// Ce module est PUR : ni base, ni clé, ni horloge.

import { FUSEAU } from "../fuseau";

interface MessageLu {
  /** Rang dans le fil, 0 = le plus ancien. Stable : l'export liste du plus récent au plus ancien. */
  position: number;
  auteur: string;
  /** `null` = un message sans texte (une photo, un audio seuls). */
  texte: string | null;
  /** Instant ISO (UTC). */
  survenuLe: string;
  piecesJointes: number;
}

export interface ExportLu {
  /** Le nom du fil (`<h1>`). */
  fil: string | null;
  /** Le titulaire du compte qui a généré l'export : c'est Marc, sans que son nom soit écrit ici. */
  titulaire: string | null;
  participants: string[];
  messages: MessageLu[];
  datesIllisibles: number;
}

const ENTITES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decoder(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITES[e.toLowerCase()] ?? m;
  });
}

/** Le texte d'un fragment : `<br>` devient un saut de ligne, toute autre balise disparaît. */
function texteDe(html: string): string {
  return decoder(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Les `<div>` enfants DIRECTS d'un fragment, comptés par profondeur (un texte peut en contenir). */
function enfantsDiv(html: string): string[] {
  const enfants: string[] = [];
  const re = /<div\b[^>]*>|<\/div>/gi;
  let profondeur = 0;
  let debut = -1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0][1] !== "/") {
      if (profondeur === 0) debut = m.index + m[0].length;
      profondeur++;
    } else if (profondeur > 0) {
      profondeur--;
      if (profondeur === 0) enfants.push(html.slice(debut, m.index));
    }
  }
  return enfants;
}

// Les mois tels que l'export les écrit (« fév 11, 2021 »), comparés sans accent ni point.
const MOIS: ReadonlyArray<readonly string[]> = [
  ["janv", "jan"], ["fevr", "fev", "feb"], ["mars", "mar"], ["avr", "apr"], ["mai", "may"], ["juin", "jun"],
  ["juil", "jul"], ["aout", "aou", "aug"], ["sept", "sep"], ["oct"], ["nov"], ["dec"],
];

function moisDe(mot: string): number | null {
  const m = mot.normalize("NFD").replace(/[̀-ͯ.]/g, "").toLowerCase();
  const i = MOIS.findIndex((noms) => noms.includes(m));
  return i === -1 ? null : i;
}

/** Le décalage (minutes) du fuseau de Marc à un instant donné. */
function decalage(instant: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FUSEAU,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return (local - instant) / 60000;
}

/**
 * « fév 11, 2021 7:00:52 am » (heure du fuseau de Marc) → instant ISO. `null` si un morceau ne
 * se lit pas, jamais une date approchée. [À vérifier] l'export écrit l'heure dans le fuseau du
 * compte au moment de l'export ; c'est celui de Marc depuis qu'il l'a généré.
 */
export function lireDate(s: string): string | null {
  const m = /^([^\s\d]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(s.trim());
  if (!m) return null;
  const mois = moisDe(m[1]!);
  const jour = Number(m[2]);
  let heure = Number(m[4]);
  if (mois === null || jour < 1 || jour > 31 || heure > 23) return null;
  const ampm = m[7]?.toLowerCase().replace(/\./g, "");
  if (ampm) {
    if (heure < 1 || heure > 12) return null;
    heure = (heure % 12) + (ampm === "pm" ? 12 : 0);
  }
  const mur = Date.UTC(Number(m[3]), mois, jour, heure, Number(m[5]), Number(m[6] ?? 0));
  if (new Date(mur).getUTCDate() !== jour) return null; // 31 février
  // Deux passes : le décalage dépend de l'instant cherché (heure avancée).
  let t = mur - decalage(mur) * 60000;
  t = mur - decalage(t) * 60000;
  return new Date(t).toISOString();
}

function lireParticipants(entete: string): string[] {
  const liste = entete.replace(/^Participants\s*:\s*/i, "");
  return liste
    .split(/,\s*|\s+(?:et|and)\s+/)
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Lit un export. Un fichier qui n'a pas la forme rend zéro message, jamais une erreur avalée. */
export function lireExportMessenger(html: string): ExportLu {
  const fil = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const titulaire = /<aside\b[^>]*>\s*G[ée]n[ée]r[ée]e? par ([\s\S]*?) le\s*<time/i.exec(html) ??
    /<aside\b[^>]*>\s*Generated by ([\s\S]*?) on\s*<time/i.exec(html);
  const participants: string[] = [];
  const brut: Omit<MessageLu, "position">[] = [];
  let datesIllisibles = 0;

  for (const s of html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)) {
    const corps = s[1]!;
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(corps);
    if (!h2) continue;
    const titre = texteDe(h2[1]!);
    const pied = /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(corps);
    if (!pied) {
      // Une section sans date est un en-tête du fil (participants, lien d'invitation).
      if (/^Participants\s*:/i.test(titre)) participants.push(...lireParticipants(titre));
      continue;
    }
    const survenuLe = lireDate(texteDe(pied[1]!));
    if (!survenuLe || !titre) {
      datesIllisibles++;
      continue;
    }
    const contenu = corps.slice(h2.index + h2[0].length, pied.index);
    // corps du message > enveloppe > [vide, TEXTE, vide, vide, pièce jointe…, réactions]
    const enveloppe = enfantsDiv(enfantsDiv(contenu)[0] ?? "")[0] ?? "";
    const enfants = enfantsDiv(enveloppe);
    const texte = texteDe(enfants[1] ?? "");
    const joints = enfants
      .slice(2)
      .filter((e) => !/<ul\b/i.test(e))
      .join("")
      .match(/<(?:img|audio|video)\b|<a\b[^>]*href="[^"]*\/files\//gi);
    brut.push({ auteur: titre, texte: texte || null, survenuLe, piecesJointes: joints?.length ?? 0 });
  }

  const messages = brut.reverse().map((m, position) => ({ position, ...m }));
  return {
    fil: fil ? texteDe(fil[1]!) || null : null,
    titulaire: titulaire ? texteDe(titulaire[1]!) || null : null,
    participants: [...new Set(participants)],
    messages,
    datesIllisibles,
  };
}
