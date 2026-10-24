// lib/evenements/depot.ts — ÉCRIRE un export lu en événements et personnes (ADR 0020, MemoryAI#70).
//
// ⚠️ IDEMPOTENT PAR LA BASE, pas par la mémoire du processus : `(source_ref, position)` est
// unique, l'insertion ignore ce qui existe déjà. Relancer l'import du même export ne crée rien ;
// un import coupé au milieu se termine au suivant.
//
// ⚠️ UN PAPIER OUBLIÉ NE REVIENT PAS EN MESSAGES. L'empreinte d'oubli du papier (posée par
// `lib/pieces/depotOubli.ts`) est lue AVANT toute écriture : sans elle, oublier un export dans la
// Mémoire laisserait ses messages rentrer par cette porte-ci.
//
// ⚠️ AUCUN TEXTE NE SORT D'ICI : le résultat est fait de nombres. Le texte passe par le scan de
// secrets des conversations, puis il est chiffré au niveau 2 avant d'atteindre la base.

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { chiffrer, empreinte, type Cle } from "../chiffrement";
import { masquerSecrets } from "../conversations/secrets";
import { empreinteOubliPiece } from "../pieces/ecrire";
import type { ExportLu } from "./messenger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le niveau d'un message (décision du plan, 22/10/2026) : jamais déduit du texte, qu'il faudrait lire. */
export const NIVEAU_MESSAGE = 2;
const PAQUET = 500;

export interface ResultatImport {
  lus: number;
  ecrits: number;
  dejaPresents: number;
  datesIllisibles: number;
  personnesNouvelles: number;
  secretsRetires: number;
  /** Vrai si le papier d'origine a été oublié : rien n'est écrit. */
  oublie: boolean;
}

const normaliser = (nom: string): string => nom.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

function cleAliasMessenger(cle: Cle, nom: string): string {
  return empreinte(cle, "alias", "messenger", normaliser(nom));
}

function paquets<T>(xs: T[]): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += PAQUET) r.push(xs.slice(i, i + PAQUET));
  return r;
}

/** Rend l'id de chaque nom, en créant les personnes inconnues. Deux imports simultanés n'en font qu'une. */
async function personnesDe(db: Base, cle: Cle, noms: string[], titulaire: string | null): Promise<{ ids: Map<string, string>; nouvelles: number }> {
  const parCle = new Map(noms.map((n) => [cleAliasMessenger(cle, n), n]));
  const lire = async (cles: string[]) =>
    cles.length === 0
      ? []
      : db
          .select({ cle: schema.personneAlias.cle, id: schema.personneAlias.personneId })
          .from(schema.personneAlias)
          .where(inArray(schema.personneAlias.cle, cles));
  const connues = new Map((await lire([...parCle.keys()])).map((r) => [r.cle, r.id]));
  let nouvelles = 0;
  for (const [c, nom] of parCle) {
    if (connues.has(c)) continue;
    const id = randomUUID();
    await db.insert(schema.personnes).values({
      id,
      nom: chiffrer(cle, nom, `personne|${id}`, NIVEAU_MESSAGE),
      estMarc: titulaire !== null && normaliser(nom) === normaliser(titulaire),
    });
    const pose = await db
      .insert(schema.personneAlias)
      .values({ cle: c, personneId: id, genre: "messenger", valeur: chiffrer(cle, nom, `alias|${c}`, NIVEAU_MESSAGE) })
      .onConflictDoNothing()
      .returning({ cle: schema.personneAlias.cle });
    if (pose.length === 1) {
      connues.set(c, id);
      nouvelles++;
    } else {
      // Un autre import a posé l'alias entre-temps : on garde SA personne, on retire la nôtre.
      await db.delete(schema.personnes).where(eq(schema.personnes.id, id));
      const r = await lire([c]);
      if (!r[0]) throw new Error("alias disparu entre deux lectures");
      connues.set(c, r[0].id);
    }
  }
  return { ids: new Map([...parCle].map(([c, nom]) => [nom, connues.get(c)!])), nouvelles };
}

export async function importerExport(db: Base, cle: Cle, lu: ExportLu, fileId: string, ecrivainApp: string): Promise<ResultatImport> {
  const base = { lus: lu.messages.length, datesIllisibles: lu.datesIllisibles };
  const vide = { ...base, ecrits: 0, dejaPresents: 0, personnesNouvelles: 0, secretsRetires: 0 };

  const oubli = await db
    .select({ e: schema.oublis.empreinte })
    .from(schema.oublis)
    .where(eq(schema.oublis.empreinte, empreinteOubliPiece(cle, "marc", fileId)))
    .limit(1);
  if (oubli.length > 0) return { ...vide, oublie: true };
  if (lu.messages.length === 0) return { ...vide, oublie: false };

  const presentes = new Set(
    (
      await db
        .select({ p: schema.evenements.position })
        .from(schema.evenements)
        .where(eq(schema.evenements.sourceRef, fileId))
    ).map((r) => r.p),
  );
  const aEcrire = lu.messages.filter((m) => !presentes.has(m.position));
  if (aEcrire.length === 0) return { ...vide, dejaPresents: lu.messages.length, oublie: false };

  const auteurs = [...new Set(lu.messages.map((m) => m.auteur))];
  // Sans ligne « Participants » (un fil à deux), le fil se reconstitue de ceux qui y ont écrit.
  const membres = [...new Set([...(lu.participants.length ? lu.participants : auteurs), ...(lu.titulaire ? [lu.titulaire] : [])])];
  const { ids, nouvelles } = await personnesDe(db, cle, [...new Set([...membres, ...auteurs])], lu.titulaire);

  let secretsRetires = 0;
  let ecrits = 0;
  for (const lot of paquets(aEcrire)) {
    const lignes = lot.map((m) => {
      const id = randomUUID();
      const masque = m.texte === null ? null : masquerSecrets(m.texte);
      return {
        id,
        genre: "message" as const,
        source: "messenger" as const,
        sourceRef: fileId,
        position: m.position,
        survenuLe: new Date(m.survenuLe),
        auteurId: ids.get(m.auteur)!,
        fil: lu.fil === null ? null : chiffrer(cle, lu.fil, `evenement-fil|${id}`, NIVEAU_MESSAGE),
        texte: masque === null ? null : chiffrer(cle, masque.texte, `evenement|${id}`, NIVEAU_MESSAGE),
        piecesJointes: m.piecesJointes,
        secretsRetires: masque?.retires ?? 0,
        niveau: NIVEAU_MESSAGE,
        ecrivainApp,
      };
    });
    const posees = new Set(
      (await db.insert(schema.evenements).values(lignes).onConflictDoNothing().returning({ id: schema.evenements.id })).map((r) => r.id),
    );
    ecrits += posees.size;
    secretsRetires += lignes.reduce((n, l) => n + (posees.has(l.id) ? l.secretsRetires : 0), 0);
    const liens = lignes
      .filter((l) => posees.has(l.id))
      .flatMap((l) => [
        { evenementId: l.id, personneId: l.auteurId, role: "auteur" as const },
        ...membres
          .map((n) => ids.get(n)!)
          .filter((p) => p !== l.auteurId)
          .map((personneId) => ({ evenementId: l.id, personneId, role: "destinataire" as const })),
      ]);
    for (const l of paquets(liens)) await db.insert(schema.evenementPersonnes).values(l).onConflictDoNothing();
  }

  return { ...base, ecrits, dejaPresents: lu.messages.length - ecrits, personnesNouvelles: nouvelles, secretsRetires, oublie: false };
}
