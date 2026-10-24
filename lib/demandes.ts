// lib/demandes.ts — les demandes « Que peut-on changer ici ? » du hub (ADR 0021, tâche MemoryAI 169).
//
// Le hub note ce que Marc a voulu changer sur une page, pour qu'il le retrouve. Une demande n'est
// PAS un fait sur Marc : elle n'entre ni dans `faits`, ni dans la recherche, ni dans un prompt.
//
// ⚠️ AUCUN TEXTE DE PAGE. Le texte d'une page est écrit par une app, et une app peut porter une
// fausse consigne : le contenu est donc BORNÉ (enums, un `nom` court sans balise ni retour à la
// ligne) et tout champ inconnu fait refuser la demande (422), jamais retirer en silence.
// ⚠️ LE `nom` EST UNE DONNÉE. Chiffré au niveau 1, il ne ressort que comme valeur d'un champ JSON :
// aucune route ni aucun outil ne l'interprète, il ne peut donc pas devenir une action.
// ⚠️ OUBLIABLE. L'empreinte keyée (type, app, genre, nom, jour) est à la fois la clé d'idempotence
// et celle d'oubli : `oublis` est consulté avant toute insertion, une demande oubliée ne revient pas.
//
// Fonctions pures d'un côté (`lireDemande`), I/O de l'autre (`depotDemandesDrizzle`, `repondre*`).

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { chiffrer, dechiffrer, empreinte, type Cle } from "./chiffrement";
import { jourQuebec } from "./coutChat";
import * as schema from "./db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Au-delà, 413 avant même de lire le JSON : une demande tient en quelques dizaines d'octets. */
const TAILLE_MAX_CORPS = 2 * 1024;
/** Le GET rend les plus récentes, pas l'historique entier. */
const MAX_LISTE = 100;
/** Le niveau du `nom` : celui d'un fait courant, ouvert au hub. */
const NIVEAU_NOM = 1;
/** Un clic du futur est une horloge fausse ou une demande fabriquée : refusée au-delà de 5 min. */
const AVANCE_MAX_MS = 5 * 60 * 1000;

const Demande = z
  .object({
    type: z.enum(["changer"]),
    // Le hub et les six apps du parc (Hubperso `lib/sources.ts`).
    app: z.enum(["hub", "financeai", "driveai", "batchchef", "carai", "jobai", "memoryai"]),
    genre: z.enum(["tuile", "bouton", "page", "graphique", "texte", "autre"]),
    // Ni balise, ni retour à la ligne, ni caractère de contrôle : un libellé, pas un texte.
    nom: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^<>\u0000-\u001f\u007f]+$/),
    demandeLe: z.iso.datetime({ offset: true }),
  })
  .strict();

type DemandeLue = z.infer<typeof Demande>;

/** Ce que le GET rend : les champs du schéma et l'id, rien d'autre. */
interface DemandeRendue extends DemandeLue {
  id: string;
}

type Lecture =
  | { ok: true; demande: DemandeLue }
  | { ok: false; status: 400 | 413 | 422; code: string; message: string; champs?: string[] };

/** Lit le corps BRUT. PURE : `maintenant` est un paramètre. Les CHEMINS des champs fautifs, jamais leur valeur. */
export function lireDemande(brut: string, maintenant: Date): Lecture {
  if (Buffer.byteLength(brut, "utf8") > TAILLE_MAX_CORPS) {
    return { ok: false, status: 413, code: "corps_trop_gros", message: `Corps au-delà de ${TAILLE_MAX_CORPS} octets.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "JSON attendu." };
  }
  const r = Demande.safeParse(json);
  if (!r.success) {
    const champs = [
      ...new Set(r.error.issues.flatMap((i) => (i.code === "unrecognized_keys" ? i.keys : [i.path.join(".") || "(racine)"]))),
    ];
    return { ok: false, status: 422, code: "champs_invalides", message: `Champs invalides : ${champs.join(", ")}.`, champs };
  }
  if (Date.parse(r.data.demandeLe) - maintenant.getTime() > AVANCE_MAX_MS) {
    return { ok: false, status: 422, code: "champs_invalides", message: "Champs invalides : demandeLe.", champs: ["demandeLe"] };
  }
  return { ok: true, demande: r.data };
}

interface DepotDemandes {
  /** `nouvelle: false` si la même demande existe déjà ce jour-là ; `oubliee` si Marc l'a oubliée. */
  ecrire(d: DemandeLue): Promise<{ oubliee: true } | { oubliee: false; id: string; demandeLe: string; nouvelle: boolean }>;
  /** Les plus récentes d'abord, `MAX_LISTE` au plus, `nom` déchiffré. */
  lister(): Promise<DemandeRendue[]>;
}

export function depotDemandesDrizzle(db: Base, cle: Cle): DepotDemandes {
  return {
    async ecrire(d) {
      // Le JOUR de Québec, pas l'instant : la même demande refaite l'après-midi n'en crée pas une deuxième.
      const cleDemande = empreinte(cle, "demande", d.type, d.app, d.genre, d.nom, jourQuebec(new Date(d.demandeLe)));
      const oubli = await db.select({ e: schema.oublis.empreinte }).from(schema.oublis).where(eq(schema.oublis.empreinte, cleDemande)).limit(1);
      if (oubli.length > 0) return { oubliee: true };
      const id = randomUUID();
      const demandeLe = new Date(d.demandeLe);
      const ecrites = await db
        .insert(schema.demandes)
        .values({ id, empreinte: cleDemande, type: d.type, app: d.app, genre: d.genre, nom: chiffrer(cle, d.nom, `demande|${id}`, NIVEAU_NOM), demandeLe })
        .onConflictDoNothing({ target: schema.demandes.empreinte })
        .returning({ id: schema.demandes.id });
      if (ecrites.length > 0) return { oubliee: false, id, demandeLe: demandeLe.toISOString(), nouvelle: true };
      const [deja] = await db
        .select({ id: schema.demandes.id, demandeLe: schema.demandes.demandeLe })
        .from(schema.demandes)
        .where(eq(schema.demandes.empreinte, cleDemande))
        .limit(1);
      if (!deja) throw new Error("Demande en conflit introuvable après l'insertion.");
      return { oubliee: false, id: deja.id, demandeLe: deja.demandeLe.toISOString(), nouvelle: false };
    },
    async lister() {
      const lignes = await db.select().from(schema.demandes).orderBy(desc(schema.demandes.demandeLe)).limit(MAX_LISTE);
      return lignes.map((l) => ({
        id: l.id,
        type: l.type as DemandeLue["type"],
        app: l.app as DemandeLue["app"],
        genre: l.genre as DemandeLue["genre"],
        nom: dechiffrer(cle, l.nom, `demande|${l.id}`, NIVEAU_NOM),
        demandeLe: l.demandeLe.toISOString(),
      }));
    },
  };
}

const ENTETES = { "Cache-Control": "no-store" } as const;

/** POST : 201 nouvelle, 200 déjà là ce jour, 410 oubliée ; 400 / 413 / 422 corps. */
export async function repondreEcriture(depot: DepotDemandes, brut: string, maintenant: Date): Promise<Response> {
  const lu = lireDemande(brut, maintenant);
  if (!lu.ok) {
    return Response.json({ error: lu.code, message: lu.message, ...(lu.champs && { champs: lu.champs }) }, { status: lu.status, headers: ENTETES });
  }
  const r = await depot.ecrire(lu.demande);
  if (r.oubliee) return Response.json({ error: "oubliee", message: "Marc a oublié cette demande." }, { status: 410, headers: ENTETES });
  return Response.json({ id: r.id, demandeLe: r.demandeLe, nouvelle: r.nouvelle }, { status: r.nouvelle ? 201 : 200, headers: ENTETES });
}

/** GET : 200 `{ demandes }`, vide compris. */
export async function repondreLecture(depot: DepotDemandes): Promise<Response> {
  return Response.json({ demandes: await depot.lister() }, { headers: ENTETES });
}
