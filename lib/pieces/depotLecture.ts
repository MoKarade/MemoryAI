// lib/pieces/depotLecture.ts — LIRE des pièces. Neon en production, PGlite en test, même SQL.
//
// Ce module ne déchiffre rien et ne décide rien : `lib/pieces/lecture.ts` applique les règles
// sur ce qu'il rend. Il ne fait que deux choses, et elles répondent à deux questions que le
// modèle pose dans cet ordre : « quelles valeurs existent ? » puis « lesquelles me concernent ? ».
//
// ⚠️ SANS LA LISTE DES VALEURS CONNUES, LE MODÈLE DEVINE. C'est écrit dans l'ADR 0004 §7 et
// c'est mesurable : demander « les papiers de Banque Aurore » quand la base dit « Banque Aurore
// Assurances générales » ne rend rien, et le modèle conclut qu'il n'y en a pas. Les facettes
// se comptent donc EN PREMIER, et c'est ce compte qui guide la recherche.
//
// ⚠️ LA RECHERCHE PLEIN TEXTE NE VOIT QUE LE RÉGIME EN CLAIR, et ce n'est pas un défaut :
// `recherche` est NULL quand la pièce est chiffrée (contrainte `pieces_chiffre_sans_recherche`).
// Une pièce chiffrée se retrouve par ses FACETTES — domaine, année, type, émetteur — jamais
// par son contenu. Le dire plutôt que de laisser croire que la recherche couvre tout.

import { and, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { FUSEAU } from "../fuseau";
import { EXTRACTEUR_MIGRATION } from "./migration";
import type { PieceAvecExemplaires } from "./lecture";
import type { FamilleFacette } from "./facettes";

/** Une valeur de facette et son compte. La VALEUR est encore chiffrée ici. */
export interface FacetteBrute {
  famille: FamilleFacette;
  /** La clé keyée — c'est elle qui regroupe, sans rien révéler. */
  cle: string;
  /** La valeur chiffrée d'un représentant du groupe, à déchiffrer par l'appelant. */
  valeurChiffree: string;
  /** L'`id` et le `niveau` de ce représentant : l'AAD dont le déchiffrement a besoin. */
  representantId: string;
  representantNiveau: number;
  nombre: number;
}

export interface FiltrePieces {
  texte?: string;
  domaines?: readonly string[];
  annees?: readonly number[];
  /** Des clés de facette KEYÉES (`cleFacette`), jamais des valeurs en clair. */
  typeCles?: readonly string[];
  emetteurCles?: readonly string[];
  /** ADR 0011 — le titulaire, par la même clé keyée (index `pieces_titulaire_cle`). */
  titulaireCles?: readonly string[];
  /** ADR 0011 — restreindre à certains niveaux (la recherche N3 en mémoire lit `[3]`). */
  niveaux?: readonly number[];
  /**
   * `true` = seulement les papiers OUVERTS par un modèle ; `false` = seulement ceux qui ne
   * sont encore qu'un nom de fichier. Absent = les deux.
   *
   * ⚠️ Le critere est l'EXTRACTEUR, comme `comptesParExtracteur` — jamais `domaine IS NULL`,
   * qui donnerait presque le meme resultat aujourd'hui et mentirait demain (un papier LU peut
   * n'avoir aucun domaine). Deux facons de repondre a la meme question divergeraient, et c'est
   * l'ecran qui porterait la divergence.
   */
  lus?: boolean;
  limite: number;
}

export interface DepotPiecesLecture {
  chercher(f: FiltrePieces): Promise<PieceAvecExemplaires[]>;
  /**
   * COMBIEN de pièces correspondent à ce filtre, sans borne de lecture ni de tranche.
   *
   * ⚠️ Pourquoi cette requête existe, avec sa date. Le 17/09, Marc a demandé à claude.ai
   * combien il avait de papiers, puis combien venaient de Banque Aurore. Réponses : « au moins
   * 214 », puis « au moins 68 » — alors qu'il y a 2 723 papiers et 75 Banque Aurore. Le modèle
   * n'avait pas menti : `chercher` tronque à la limite demandée et ne dit NULLE PART combien
   * de pièces correspondaient. Devant une liste pleine, un lecteur ne peut qu'inventer une
   * borne basse, et il la présente comme un fait.
   *
   * ⚠️ Un COUNT et non `lignes.length` : la troncature est à DEUX étages — la tranche servie
   * (60 par défaut) et la borne de lecture en base (500). Compter les lignes rendues ne
   * corrigerait que le premier, et mentirait toujours au-delà de 500.
   */
  compter(f: Omit<FiltrePieces, "limite">): Promise<number>;
  /**
   * ⚠️ `niveauMax` est REQUIS (ADR 0011). Une facette déchiffrée est un CONTENU : le titulaire
   * d'un passeport est un nom, et le sommaire d'une pièce N3 le cache justement. Sans ce
   * plafond, la liste des valeurs connues rendait au MCP ce que la recherche lui refuse.
   */
  facettes(famille: FamilleFacette, limite: number, niveauMax: number): Promise<FacetteBrute[]>;
  /** Combien de pièces ACTIVES, par domaine. En clair : c'est ce qui cadre une réponse. */
  comptes(): Promise<{ total: number; parDomaine: Record<string, number>; parNiveau: Record<string, number> }>;
  /**
   * Combien de papiers ont été LUS par un modèle, et combien ne sont encore qu'un nom de
   * fichier. [L34].
   *
   * ⚠️ Le critère est l'EXTRACTEUR, et c'est le seul qui dise la vérité : `moteur-inventaire-v1`
   * est la MIGRATION de l'inventaire — elle a créé la ligne à partir d'un nom de fichier, sans
   * qu'aucun modèle n'ouvre le document. Compter par `domaine IS NULL` donnerait presque le
   * même nombre aujourd'hui et mentirait demain : un papier LU peut très bien n'avoir aucun
   * domaine (le dossier DriveAI n'est pas toujours connu), et ce serait alors compté comme
   * non lu.
   */
  comptesParExtracteur(): Promise<{ lus: number; nonLus: number; parExtracteur: Record<string, number> }>;
  /**
   * Les papiers LUS par jour, du plus ancien au plus récent. [L38].
   *
   * ⚠️ Seuls les jours NON VIDES sortent : une série qui remplirait les trous avec des zéros
   * ne saurait plus distinguer « rien lu ce jour-là » de « l'import n'existait pas encore »,
   * et le rythme se diviserait par des jours où il n'y avait rien à faire. C'est l'appelant
   * (`lib/importEtat.ts`) qui décide ce que l'absence veut dire.
   *
   * ⚠️ Le jour est calculé à l'heure du QUÉBEC, comme les plafonds de dépense : `cree_le` est
   * un instant UTC, et grouper dessus mettrait tout ce qui est lu après 20 h le lendemain.
   */
  luesParJour(limite: number): Promise<{ jour: string; nombre: number }[]>;
  /**
   * UNE piece et ses exemplaires, ou `null`. C'est le seul chemin par lequel le CONTENU
   * (resume, champs) est lu : la liste, elle, ne dechiffre que les facettes.
   *
   * ⚠️ Les memes conditions de vie que partout (`supprimeLe IS NULL`, `statut = active`) :
   * une piece retiree ou remplacee ne doit pas se rouvrir par son adresse.
   */
  parId(id: string): Promise<PieceAvecExemplaires | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

const COLONNE_FACETTE = {
  type: { valeur: schema.pieces.type, cle: schema.pieces.typeCle },
  emetteur: { valeur: schema.pieces.emetteur, cle: schema.pieces.emetteurCle },
  titulaire: { valeur: schema.pieces.titulaire, cle: schema.pieces.titulaireCle },
} as const;

/**
 * L'extracteur de la MIGRATION de l'inventaire : une ligne qu'il a créée vient d'un nom de
 * fichier, pas d'une lecture.
 *
 * ⚠️ RÉEXPORTÉ, plus recopié : [L38] avait écrit la chaîne une seconde fois ici, alors
 * qu'elle a un foyer (`./migration.ts`). Deux graphies feraient compter TOUS les papiers
 * comme lus — donc annoncer à Marc un import terminé quand rien n'a été ouvert. Et
 * `tests/importEtat.test.ts` exige en plus que `lib/autoValidation.ts` s'accorde avec elle.
 */
export { EXTRACTEUR_MIGRATION as EXTRACTEUR_INVENTAIRE } from "./migration";

export function depotPiecesLectureDrizzle(db: Base): DepotPiecesLecture {
  const vivante = () => [isNull(schema.pieces.supprimeLe), eq(schema.pieces.statut, "active")];

  /**
   * [L3] Le DERNIER avis de Marc sur chacun de ces papiers (ADR 0012). Lu à côté, attaché à la
   * ligne rendue : sans lui, le chat servirait un papier contesté avec l'aplomb d'un papier sûr.
   */
  const avisDe = async (ids: readonly string[]) => {
    const m = new Map<string, "vrai" | "faux" | "passe">();
    if (ids.length === 0) return m;
    const rows = await db
      .select({ refId: schema.avisPile.refId, verdict: schema.avisPile.verdict })
      .from(schema.avisPile)
      .where(and(eq(schema.avisPile.genre, "piece"), inArray(schema.avisPile.refId, [...ids])))
      .orderBy(desc(schema.avisPile.avisLe), desc(schema.avisPile.id));
    for (const r of rows) if (!m.has(r.refId)) m.set(r.refId, r.verdict);
    return m;
  };

  /**
   * Les conditions d'un filtre, écrites UNE fois. ⚠️ Partagées entre `chercher` et `compter`
   * exprès : deux copies divergeraient au premier filtre ajouté, et le compte cesserait alors
   * de décrire la liste qu'il annonce — un total qui ne correspond pas à ce qui est montré est
   * pire qu'un total absent.
   */
  const conditionsDe = (f: Omit<FiltrePieces, "limite">) => {
    const conditions = [...vivante()];
    if (f.domaines?.length) conditions.push(inArray(schema.pieces.domaine, [...f.domaines]));
    if (f.annees?.length) conditions.push(inArray(schema.pieces.annee, [...f.annees]));
    if (f.typeCles?.length) conditions.push(inArray(schema.pieces.typeCle, [...f.typeCles]));
    if (f.emetteurCles?.length) conditions.push(inArray(schema.pieces.emetteurCle, [...f.emetteurCles]));
    if (f.titulaireCles?.length) conditions.push(inArray(schema.pieces.titulaireCle, [...f.titulaireCles]));
    if (f.niveaux?.length) conditions.push(inArray(schema.pieces.niveau, [...f.niveaux]));

    if (f.lus !== undefined) {
      conditions.push(
        f.lus
          ? ne(schema.pieces.extracteur, EXTRACTEUR_MIGRATION)
          : eq(schema.pieces.extracteur, EXTRACTEUR_MIGRATION),
      );
    }

    const texte = (f.texte ?? "").trim();
    if (texte) {
      // `plainto_tsquery` et non `to_tsquery` : il prend une phrase d'humain et ne lève
      // jamais sur une ponctuation. Un modèle qui écrit « bail & logement » ferait planter
      // le second, et la panne ressemblerait à « aucun résultat ».
      conditions.push(
        sql`to_tsvector('french', coalesce(${schema.pieces.recherche}, '')) @@ plainto_tsquery('french', ${texte})`,
      );
    }
    return conditions;
  };

  return {
    async compter(f) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.pieces)
        .where(and(...conditionsDe(f)));
      return Number(r?.n ?? 0);
    },

    async chercher(f) {
      const conditions = conditionsDe(f);

      const lignes = await db
        .select()
        .from(schema.pieces)
        .where(and(...conditions))
        .orderBy(desc(schema.pieces.dateDocument), desc(schema.pieces.creeLe))
        .limit(f.limite);
      if (lignes.length === 0) return [];

      const ids = lignes.map((p) => p.id);
      const ex = await db
        .select()
        .from(schema.pieceExemplaires)
        .where(inArray(schema.pieceExemplaires.pieceId, ids));
      const parPiece = new Map<string, (typeof ex)[number][]>();
      for (const x of ex) {
        const l = parPiece.get(x.pieceId) ?? [];
        l.push(x);
        parPiece.set(x.pieceId, l);
      }
      const avis = await avisDe(ids);
      return lignes.map((piece) => ({ piece, exemplaires: parPiece.get(piece.id) ?? [], avisMarc: avis.get(piece.id) ?? null }));
    },

    async parId(id) {
      const rows = await db
        .select()
        .from(schema.pieces)
        .where(and(eq(schema.pieces.id, id), ...vivante()))
        .limit(1);
      const piece = rows[0];
      if (!piece) return null;
      const exemplaires = await db
        .select()
        .from(schema.pieceExemplaires)
        .where(eq(schema.pieceExemplaires.pieceId, piece.id));
      const avis = await avisDe([piece.id]);
      return { piece, exemplaires, avisMarc: avis.get(piece.id) ?? null };
    },

    async facettes(famille, limite, niveauMax) {
      const col = COLONNE_FACETTE[famille];
      // ⚠️ On GROUPE par la clé KEYÉE et on ne remonte qu'UN représentant : c'est tout
      // l'intérêt du dessin. Grouper par la valeur CHIFFRÉE ne marcherait pas — deux pièces
      // portant « Banque Aurore » ont deux chiffrés différents (AAD `id|niveau`), donc deux
      // groupes. La clé keyée, elle, est la même pour les deux.
      const rows = await db
        .select({
          cle: col.cle,
          nombre: sql<number>`count(*)::int`,
          representantId: sql<string>`min(${schema.pieces.id})`,
        })
        .from(schema.pieces)
        .where(and(...vivante(), sql`${col.cle} IS NOT NULL`, lte(schema.pieces.niveau, niveauMax)))
        .groupBy(col.cle)
        .orderBy(sql`count(*) DESC`)
        .limit(limite);
      if (rows.length === 0) return [];

      const representants = await db
        .select({ id: schema.pieces.id, niveau: schema.pieces.niveau, valeur: col.valeur })
        .from(schema.pieces)
        .where(inArray(schema.pieces.id, rows.map((r) => r.representantId)));
      const parId = new Map(representants.map((r) => [r.id, r]));

      return rows.flatMap((r) => {
        const rep = parId.get(r.representantId);
        // Un représentant introuvable ou sans valeur se COMPTE en le SAUTANT, jamais en
        // rendant « ? » : une facette sans nom n'aide personne à chercher.
        if (!rep || rep.valeur === null || r.cle === null) return [];
        return [{
          famille,
          cle: r.cle,
          valeurChiffree: rep.valeur,
          representantId: rep.id,
          representantNiveau: rep.niveau,
          nombre: r.nombre,
        }];
      });
    },

    async luesParJour(limite) {
      const rows = await db
        .select({
          jour: sql<string>`to_char(${schema.pieces.creeLe} AT TIME ZONE ${FUSEAU}, 'YYYY-MM-DD')`,
          nombre: sql<number>`count(*)::int`,
        })
        .from(schema.pieces)
        .where(and(...vivante(), ne(schema.pieces.extracteur, EXTRACTEUR_MIGRATION)))
        .groupBy(sql`1`)
        .orderBy(sql`1 desc`)
        .limit(limite);
      // Rendu du plus ANCIEN au plus récent : un histogramme se lit de gauche à droite. Le SQL
      // trie à l'envers parce que c'est la LIMITE qui doit garder les jours récents.
      return rows.reverse();
    },
    async comptesParExtracteur() {
      const rows = await db
        .select({ extracteur: schema.pieces.extracteur, nombre: sql<number>`count(*)::int` })
        .from(schema.pieces)
        .where(and(...vivante()))
        .groupBy(schema.pieces.extracteur);
      const parExtracteur: Record<string, number> = {};
      let lus = 0;
      let nonLus = 0;
      for (const r of rows) {
        parExtracteur[r.extracteur] = r.nombre;
        if (r.extracteur === EXTRACTEUR_MIGRATION) nonLus += r.nombre;
        else lus += r.nombre;
      }
      return { lus, nonLus, parExtracteur };
    },
    async comptes() {
      const rows = await db
        .select({
          domaine: schema.pieces.domaine,
          niveau: schema.pieces.niveau,
          nombre: sql<number>`count(*)::int`,
        })
        .from(schema.pieces)
        .where(and(...vivante()))
        .groupBy(schema.pieces.domaine, schema.pieces.niveau);
      const parDomaine: Record<string, number> = {};
      const parNiveau: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        total += r.nombre;
        const d = r.domaine ?? "(sans domaine)";
        parDomaine[d] = (parDomaine[d] ?? 0) + r.nombre;
        parNiveau[String(r.niveau)] = (parNiveau[String(r.niveau)] ?? 0) + r.nombre;
      }
      return { total, parDomaine, parNiveau };
    },
  };
}
