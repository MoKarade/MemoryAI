// lib/pile/depot.ts — lire ce qui NOURRIT la pile et consigner les avis de Marc (ADR 0012).
//
// ⚠️ Ce dépôt ne déchiffre RIEN pour composer la pile : il ne remonte que ce qui décide de
// l'ordre (domaine, certitude sur le titulaire, échéance, date d'arrivée). Le contenu d'UNE
// carte se lit ensuite par `depotPiecesLectureDrizzle(...).parId`, sous la politique de la
// fiche — une carte par chargement, jamais cent (le garde-fou de `/pieces`).
//
// ⚠️ UN AVIS NE MODIFIE RIEN D'AUTRE QUE SA TABLE. Pas une pièce, pas un fait : un verdict se
// lit À CÔTÉ, ce qui rend « changer d'avis » gratuit et « je ne veux rien perdre » vrai.

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { chiffrer, dechiffrer, type Cle } from "../chiffrement";
import { EXTRACTEUR_MIGRATION } from "../pieces/migration";
import type { AvisEnVigueur, CandidatPiece, GenreCarte, Verdict } from "./composer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** La remarque d'un « faux » : courte, parce que c'est un pense-bête et pas un formulaire. */
export const LONGUEUR_MAX_REMARQUE = 200;
/** Niveau de l'AAD de la remarque : elle peut citer un numéro de passeport, donc N3. */
const NIVEAU_REMARQUE = 3;
const aadRemarque = (refId: string) => `avis|${refId}`;

export interface DepotPile {
  /** Les papiers LUS et vivants, avec ce qui décide de leur place — rien de chiffré. */
  candidatsPieces(): Promise<CandidatPiece[]>;
  /** Tous les avis, pour le verdict en vigueur. */
  avis(): Promise<AvisEnVigueur[]>;
  consigner(avis: { genre: GenreCarte; refId: string; verdict: Verdict; remarque?: string | null }, cle: Cle, maintenant: Date): Promise<void>;
  /** La remarque déchiffrée du dernier « faux » sur une carte, ou `null`. */
  remarque(genre: GenreCarte, refId: string, cle: Cle): Promise<string | null>;
}

export function depotPileDrizzle(db: Base): DepotPile {
  return {
    async candidatsPieces() {
      const rows = await db
        .select({
          id: schema.pieces.id,
          domaine: schema.pieces.domaine,
          titulaireConfiance: schema.pieces.titulaireConfiance,
          titulaire: schema.pieces.titulaire,
          dateEcheance: schema.pieces.dateEcheance,
          creeLe: schema.pieces.creeLe,
        })
        .from(schema.pieces)
        .where(
          and(
            isNull(schema.pieces.supprimeLe),
            eq(schema.pieces.statut, "active"),
            // Un papier de l'INVENTAIRE n'a pas été lu : il n'y a rien à juger.
            ne(schema.pieces.extracteur, EXTRACTEUR_MIGRATION),
          ),
        );
      return rows.map((r) => ({
        id: r.id,
        domaine: r.domaine,
        // La certitude ne compte que si un titulaire a été LU : sans nom, rien à confirmer.
        titulaireConfiance: r.titulaire ? r.titulaireConfiance : null,
        dateEcheance: r.dateEcheance,
        creeLe: r.creeLe,
      }));
    },

    async avis() {
      const rows = await db
        .select({ genre: schema.avisPile.genre, refId: schema.avisPile.refId, verdict: schema.avisPile.verdict, avisLe: schema.avisPile.avisLe })
        .from(schema.avisPile)
        // L'ordre d'insertion départage deux avis de la même milliseconde, comme `avisDe` (id
        // décroissant) : sans lui, la pile et le chat pourraient lire deux verdicts différents.
        .orderBy(schema.avisPile.avisLe, schema.avisPile.id);
      return rows;
    },

    async consigner({ genre, refId, verdict, remarque }, cle, maintenant) {
      const texte = (remarque ?? "").trim().slice(0, LONGUEUR_MAX_REMARQUE);
      // Une remarque n'accompagne qu'un « faux » : la base le refuse aussi, mais un « vrai »
      // avec remarque serait un appelant qui se trompe de geste — on la laisse tomber ici.
      const scellee = verdict === "faux" && texte ? chiffrer(cle, texte, aadRemarque(refId), NIVEAU_REMARQUE) : null;
      await db.insert(schema.avisPile).values({ genre, refId, verdict, remarque: scellee, avisLe: maintenant });
    },

    async remarque(genre, refId, cle) {
      const rows = await db
        .select({ verdict: schema.avisPile.verdict, remarque: schema.avisPile.remarque })
        .from(schema.avisPile)
        .where(and(eq(schema.avisPile.genre, genre), eq(schema.avisPile.refId, refId)))
        .orderBy(desc(schema.avisPile.avisLe), desc(schema.avisPile.id))
        .limit(1);
      const r = rows[0];
      if (!r || r.verdict !== "faux" || !r.remarque) return null;
      return dechiffrer(cle, r.remarque, aadRemarque(refId), NIVEAU_REMARQUE);
    },
  };
}
