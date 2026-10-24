// lib/monde/actualite.ts — l'actualité que LIA lit (ADR 0024, tâche MemoryAI 189) : des fils RSS
// publics, LISTE FERMÉE ci-dessous, sans clé. Radio-Canada permet ses fils pour un usage personnel
// (ici.radio-canada.ca/rss), ce qu'est MemoryAI : l'app d'une seule personne.
//
// ⚠️ UN TITRE D'ACTUALITÉ EST UN TEXTE ÉCRIT PAR UN TIERS, donc un canal d'injection. Il est coupé à
// 200 caractères, débarrassé de toute balise, et RETIRÉ quand `estCanari` le marque (compté, jamais
// avalé). Le lien n'est jamais ouvert par le serveur ; il n'est pas rendu au modèle.
// ⚠️ RIEN DE MARC NE PART : la requête est l'adresse fixe du fil.
//
// Fonctions pures d'un côté (`lireFilRss`, `baliserActualite`), I/O de l'autre (`sourceActualite`).

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { estCanari } from "../canari";
import * as schema from "../db/schema";
import { ENTETE_MONDE, FRAICHEUR_MS } from "./meteo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Les fils lus. FERMÉE : un fil ajouté ici est une décision (ses conditions vérifiées d'abord). */
export const FILS = [
  { id: "rc-une", nom: "Radio-Canada, À la une", url: "https://ici.radio-canada.ca/info/rss/info/a-la-une" },
  { id: "rc-international", nom: "Radio-Canada, International", url: "https://ici.radio-canada.ca/info/rss/international/en-continu" },
] as const;
export const SOURCE_ACTUALITE = "Source : Radio-Canada (fils RSS, usage personnel)";

const DELAI_MS = 5_000;
const LONGUEUR_MAX = 200;
/** Au plus tant de titres par fil, les plus récents d'abord. */
const TITRES_PAR_FIL = 8;
/** Un fil plus gros est refusé : un RSS de titres ne pèse pas un mégaoctet. */
const TAILLE_MAX = 1_000_000;

export interface Titre {
  fil: string;
  titre: string;
  /** ISO ; `null` : le fil ne date pas l'article. */
  le: string | null;
}

export interface Actualite {
  titres: Titre[];
  /** Les titres retirés parce qu'ils ressemblaient à une consigne. */
  retires: number;
  /** Les fils qui n'ont pas répondu. */
  enPanne: string[];
}

const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Le texte d'un élément RSS : CDATA déroulé, entités lues, balises retirées, une ligne, coupé. */
function texte(brut: string): string {
  const t = brut
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (e, c: string) =>
      c[0] === "#" ? String.fromCodePoint(Number.parseInt(c.slice(c[1] === "x" ? 2 : 1), c[1] === "x" ? 16 : 10) || 32) : (ENTITES[c.toLowerCase()] ?? e),
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, LONGUEUR_MAX);
}

const element = (item: string, nom: string) => item.match(new RegExp(`<${nom}\\b[^>]*>([\\s\\S]*?)</${nom}>`))?.[1];

/** Lit un fil RSS 2.0. PURE. Les titres marqués par `estCanari` sont retirés et comptés. */
export function lireFilRss(xml: string, fil: string): { titres: Titre[]; retires: number } {
  const titres: Titre[] = [];
  let retires = 0;
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const titre = texte(element(item!, "title") ?? "");
    if (!titre) continue;
    if (estCanari(titre)) {
      retires++;
      continue;
    }
    const date = Date.parse(texte(element(item!, "pubDate") ?? ""));
    titres.push({ fil, titre, le: Number.isNaN(date) ? null : new Date(date).toISOString() });
  }
  titres.sort((a, b) => (b.le ?? "").localeCompare(a.le ?? ""));
  return { titres: titres.slice(0, TITRES_PAR_FIL), retires };
}

/** Le texte rendu au modèle. PURE. Les titres seulement, jamais les liens. */
export function baliserActualite(a: Actualite): string {
  if (a.titres.length === 0) return a.enPanne.length ? "Actualité indisponible : les fils ne répondent pas." : "Aucun titre d'actualité pour l'instant.";
  const nom = new Map<string, string>(FILS.map((f) => [f.id, f.nom]));
  const lignes = a.titres.map((t) => `<titre fil="${nom.get(t.fil) ?? t.fil}"${t.le ? ` le="${t.le}"` : ""}>${t.titre}</titre>`);
  const pannes = a.enPanne.length ? [`Fils sans réponse : ${a.enPanne.map((f) => nom.get(f) ?? f).join(", ")}.`] : [];
  return [ENTETE_MONDE, '<monde source="actualite">', ...lignes, "</monde>", ...pannes, SOURCE_ACTUALITE].join("\n");
}

export interface SourceActualite {
  lire(maintenant: Date): Promise<Actualite>;
}

/** Les fils derrière le cache en base (`monde_cache`), relus au plus toutes les 30 minutes chacun. */
export function sourceActualite(db: Base, lireUrl: (url: string, signal: AbortSignal) => Promise<string> = lireTexte): SourceActualite {
  return {
    async lire(maintenant) {
      const resultat: Actualite = { titres: [], retires: 0, enPanne: [] };
      for (const f of FILS) {
        const cle = `actualite|${f.id}`;
        const [cache] = await db.select().from(schema.mondeCache).where(eq(schema.mondeCache.cle, cle));
        let lu: { titres: Titre[]; retires: number };
        if (cache && maintenant.getTime() - cache.luLe.getTime() < FRAICHEUR_MS) {
          // Le cache garde les titres DÉJÀ lus et filtrés par ce module, pas le fil brut.
          lu = JSON.parse(cache.corps) as { titres: Titre[]; retires: number };
        } else {
          try {
            lu = lireFilRss(await lireUrl(f.url, AbortSignal.timeout(DELAI_MS)), f.id);
          } catch (err) {
            console.warn(`[monde_actualite] ${f.id} injoignable : ${err instanceof Error ? err.name : "erreur"}`);
            resultat.enPanne.push(f.id);
            continue;
          }
          if (lu.retires) console.warn(`[monde_actualite] ${f.id} : ${lu.retires} titre(s) retiré(s), ils ressemblaient à une consigne`);
          const corps = JSON.stringify(lu);
          await db
            .insert(schema.mondeCache)
            .values({ cle, corps, luLe: maintenant })
            .onConflictDoUpdate({ target: schema.mondeCache.cle, set: { corps, luLe: maintenant } });
        }
        resultat.titres.push(...lu.titres);
        resultat.retires += lu.retires;
      }
      resultat.titres.sort((a, b) => (b.le ?? "").localeCompare(a.le ?? ""));
      return resultat;
    },
  };
}

async function lireTexte(url: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal, headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  if (t.length > TAILLE_MAX) throw new Error("fil trop gros");
  return t;
}
