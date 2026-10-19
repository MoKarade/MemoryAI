// lib/depotLiens.ts — l'accès à la base pour le graphe (ADR 0002 §5.3). Le calcul, lui, est
// PUR et vit dans `lib/graphe.ts` : ce module lit, déchiffre, appelle, écrit.
//
// ⚠️ LE RECALCUL REMPLACE, IL N'AJOUTE PAS. Les liens `origine: "regle"` sont supprimés puis
// réécrits : c'est ce qui fait qu'un fait oublié, une date corrigée ou une règle affinée ne
// laissent AUCUN lien périmé derrière eux. Un graphe qui accumulerait dirait, six mois plus
// tard, des rapports qui n'existent plus — et rien ne le signalerait.
//
// ⚠️ LES LIENS D'UN MODÈLE NE SONT JAMAIS TOUCHÉS par ce recalcul (`origine: "modele"`,
// phase suivante) : une règle ne supprime pas ce qu'un modèle a proposé, et l'inverse non
// plus. Les deux vivent dans la même table et se distinguent par une colonne, parce qu'un
// graphe qui mélange ce qui est établi et ce qui est deviné n'apprend rien à personne.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { dechiffrer, type Cle } from "./chiffrement";
import * as schema from "./db/schema";
import type { Lien } from "./db/schema";
import { calculerLiens, type Abstention, type FaitPourGraphe, type LienCalcule, type QuestionPourGraphe } from "./graphe";
import type { Attributs } from "./validerFait";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Ce que le recalcul a fait, en clair — jamais un simple « ok ». */
export interface Recalcul {
  faitsLus: number;
  /** Comptés et ÉCARTÉS, jamais rendus vides : même règle que `rendreServables`. */
  illisibles: number;
  liensEcrits: number;
  abstentions: Abstention[];
}

export interface DepotLiens {
  /**
   * Ce que les règles diraient MAINTENANT, sans rien écrire. C'est ce qui permet à l'écran de
   * montrer l'ÉCART entre ce qui est enregistré et ce que la mémoire porte aujourd'hui — un
   * graphe qui n'affiche que sa table se présente comme à jour alors qu'il peut dater.
   */
  apercu(cle: Cle): Promise<{ liens: LienCalcule[]; abstentions: Abstention[]; faitsLus: number; illisibles: number }>;
  /** Recalcule TOUS les liens de règle. Rend ce qu'il a fait. */
  recalculer(cle: Cle, maintenant: Date): Promise<Recalcul>;
  /** Les liens en base, bornés. Les deux origines, distinguées par leur colonne. */
  tous(limite: number): Promise<Lien[]>;
  /**
   * Les liens qui TOUCHENT ce fait, dans les deux sens. [L33a].
   *
   * ⚠️ Les DEUX sens, et ce n'est pas un détail : la table stocke une paire ordonnée
   * (`fait_a`, `fait_b`) et seul `fait_a` est indexé, mais un lien « même document » est
   * SYMÉTRIQUE — ne lire que `fait_a` montrerait les liens à une extrémité et les cacherait
   * à l'autre, donc une fiche sur deux mentirait par omission, sans rien de rouge.
   *
   * ⚠️ `cible_b` filtre sur `fait` : un lien vers une QUESTION n'est pas un fait voisin, et
   * son `fait_b` n'est même pas une clé de `faits` (pas de FK sur cette colonne).
   */
  voisinsDe(faitId: string, limite: number): Promise<Lien[]>;
  /** Combien de liens, par type — pour dire l'état sans tout charger. */
  comptes(): Promise<{ parType: Record<string, number>; total: number }>;
}

/**
 * Déchiffre un fait pour le graphe. ⚠️ Un fait ILLISIBLE (clé tournée, ligne altérée) est
 * ÉCARTÉ et COMPTÉ, jamais rendu avec une valeur vide : une chaîne vide se grouperait avec
 * les autres chaînes vides et fabriquerait des liens entre des faits sans rapport.
 */
function pourGraphe(f: schema.Fait, cle: Cle): FaitPourGraphe | null {
  try {
    const valeur = f.valeur === null ? "" : f.niveau >= 1 ? dechiffrer(cle, f.valeur, f.id, f.niveau) : f.valeur;
    let attributs: Attributs | null = null;
    if (f.attributs) {
      const brut = f.niveau >= 1 ? dechiffrer(cle, f.attributs, f.id + "#attributs", f.niveau) : f.attributs;
      attributs = JSON.parse(brut) as Attributs;
    }
    return {
      id: f.id,
      domaine: f.predicat.split(".")[0] ?? "",
      predicat: f.predicat,
      valeurType: f.valeurType,
      valeur,
      attributs,
      valideDe: f.valideDe,
      valideA: f.valideA,
      remplaceId: f.remplaceId,
    };
  } catch {
    return null;
  }
}

/**
 * Lit, déchiffre, calcule. UNE seule implémentation pour l'aperçu et le recalcul : deux
 * chemins finiraient par diverger, et l'écran montrerait un écart qui n'existe pas.
 */
async function lireEtCalculer(db: Base, cle: Cle) {
  const rows = await db
    .select()
    .from(schema.faits)
    .where(and(isNull(schema.faits.supprimeLe), inArray(schema.faits.statut, ["valide", "propose"])));

  const faits: FaitPourGraphe[] = [];
  let illisibles = 0;
  for (const f of rows) {
    const p = pourGraphe(f, cle);
    if (p === null) illisibles++;
    else faits.push(p);
  }

  // Seules les questions RÉPONDUES portent un lien de cause : une question ouverte n'a encore
  // rien produit, et une écartée n'a rien produit du tout.
  const qs = await db
    .select({ id: schema.questions.id, question: schema.questions.question, faitId: schema.questions.faitId })
    .from(schema.questions)
    .where(eq(schema.questions.statut, "repondue"));
  const questions: QuestionPourGraphe[] = qs.map((q) => ({ id: q.id, question: q.question, faitId: q.faitId }));

  const { liens, abstentions } = calculerLiens(faits, questions);
  return { liens, abstentions, faitsLus: faits.length, illisibles };
}

export function depotLiensDrizzle(db: Base): DepotLiens {
  return {
    async apercu(cle) {
      return lireEtCalculer(db, cle);
    },

    async recalculer(cle, maintenant) {
      const { liens, abstentions, faitsLus, illisibles } = await lireEtCalculer(db, cle);

      // ⚠️ L'ORDRE COMPTE : on supprime AVANT d'insérer, sinon l'index unique refuse une
      // paire que le calcul vient de reproduire à l'identique — le cas le plus fréquent.
      await db.delete(schema.liens).where(eq(schema.liens.origine, "regle"));
      const aEcrire = liens.map((l: LienCalcule) => ({
        id: randomUUID(),
        faitA: l.faitA,
        faitB: l.faitB,
        cibleB: l.cibleB,
        type: l.type,
        poids: l.poids,
        origine: "regle" as const,
        regle: l.regle,
        pourquoi: l.pourquoi,
        creeLe: maintenant,
      }));
      // Par paquets : une seule instruction de 5 000 valeurs dépasse ce qu'un pilote HTTP
      // accepte, et l'échec serait total plutôt que partiel.
      for (let i = 0; i < aEcrire.length; i += 200) {
        await db.insert(schema.liens).values(aEcrire.slice(i, i + 200));
      }

      return { faitsLus, illisibles, liensEcrits: aEcrire.length, abstentions };
    },

    async tous(limite) {
      return db.select().from(schema.liens).limit(limite);
    },

    async voisinsDe(faitId, limite) {
      return db
        .select()
        .from(schema.liens)
        .where(
          or(
            eq(schema.liens.faitA, faitId),
            and(eq(schema.liens.faitB, faitId), eq(schema.liens.cibleB, "fait")),
          ),
        )
        .limit(limite);
    },

    async comptes() {
      const rows = await db.select({ type: schema.liens.type }).from(schema.liens);
      const parType: Record<string, number> = {};
      for (const r of rows) parType[r.type] = (parType[r.type] ?? 0) + 1;
      return { parType, total: rows.length };
    },
  };
}
