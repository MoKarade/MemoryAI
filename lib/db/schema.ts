// lib/db/schema.ts — les tables de la Mémoire (ADR 0001 §5.4, ADR 0004 §6).
//
// ⚠️ Cette ligne a dit « les sept tables » jusqu'au 16/09, alors qu'il y en avait déjà plus :
// un chiffre au présent rote sans prévenir. La liste qui fait foi est celle des `pgTable`
// ci-dessous, pas une phrase d'en-tête.
//
// PRINCIPE : ce qui décide de ce qu'on peut LIRE (niveau, statut, fiabilité) est en CLAIR
// pour servir de clé de recherche ; ce qui DIT quelque chose sur Marc (`valeur`, le nom
// d'un proche) est CHIFFRÉ dès le niveau 1 (`lib/chiffrement.ts`). La recherche filtre en
// SQL sur le clair, puis ne déchiffre que le sous-ensemble — jamais la table.
//
// ⚠️ UNICITÉ — ÉCART ASSUMÉ AVEC LE BRIEF (§5 : « unicité (sujet, predicat, valide_de) »).
// Cette clé-là interdirait deux `gout.cuisine` ou deux `document.existe` le même jour, donc
// la quasi-totalité de l'inventaire. La vraie règle d'idempotence est celle du contrat
// d'écriture (brief §6, règle 6) : `(source_ref, predicat, sujet, version_extracteur)`, à
// laquelle on ajoute la valeur — sinon un mail qui livre deux goûts ne pourrait en garder
// qu'un. Elle est portée par `empreinte`, un HMAC keyé (`lib/chiffrement.ts#empreinte`),
// jamais un SHA nu : le hash d'une valeur courte se brute-force, un HMAC sans la clé non.
//
// Un `CREATE TABLE` est additif et indolore ; une colonne difficile à ajouter plus tard
// (`version_vocabulaire`, `canari`, `remplace_id`) est là dès maintenant.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Les quatre statuts d'un fait. `perime` = remplacé ou dépassé, gardé pour l'historique. */
export const STATUTS = ["propose", "valide", "rejete", "perime"] as const;
/** Ce qu'une valeur peut être. `montant` n'y est PAS, par construction : 422 avant d'arriver ici. */
export const TYPES_VALEUR = ["date", "texte", "ref_document"] as const;
/** Déduite du JETON de l'écrivain, jamais lue dans le corps d'une requête. */
export const FIABILITES = ["document-officiel", "document-tiers", "app", "mail-tiers", "marc", "seed"] as const;
export const SOURCES = ["document", "mail", "app", "seed", "marc"] as const;
export const ROLES = ["lecture", "ecriture"] as const;
export const USAGES = ["conversation", "action"] as const;
/**
 * Les postes de dépense LLM. Recopiés de `lib/coutChat.ts` — le schéma ne peut pas l'importer
 * (il est chargé par `drizzle-kit`, hors du bundle) ; `tests/coutChat.test.ts` exige que les
 * deux listes soient identiques, sinon un poste ajouté d'un seul côté passerait le typage et
 * serait refusé par la base.
 */
export const POSTES_DEPENSE = ["chat", "apprentissage"] as const;
export const TYPES_SUJET = ["marc", "foyer", "entite"] as const;
/** D'où vient une question posée à Marc (ADR 0002 §5.1). */
export const ORIGINES_QUESTION = ["chat", "claude-ai", "extraction", "regle"] as const;
export const STATUTS_QUESTION = ["ouverte", "repondue", "ecartee"] as const;
/** D'où vient une conversation gardée (ADR 0002 §4, décision de Marc du 15/09). */
export const SOURCES_CONVERSATION = ["memoryai", "claude-ai", "claude-code"] as const;
export const ROLES_MESSAGE = ["user", "assistant"] as const;

export const faits = pgTable(
  "faits",
  {
    id: text("id").primaryKey(),
    /** `marc`, `foyer:<slug>`, `entite:<slug>`. Phase 0 : `marc` seul (ADR 0001 Q10). */
    sujet: text("sujet").notNull(),
    /** Vocabulaire FERMÉ et versionné (`lib/vocabulaire/`). Inconnu ⇒ 422 avant l'insertion. */
    predicat: text("predicat").notNull(),
    /**
     * Chiffrée dès N1 (AAD = `id|niveau`). Pour un fait N3, JAMAIS un texte : seulement une
     * date (échéance) ou un pointeur (`ref_document`) — la contrainte `faits_n3_sans_texte`
     * le fait tenir par la base elle-même, pas seulement par `validerFait`.
     */
    valeur: text("valeur"),
    valeurType: text("valeur_type", { enum: TYPES_VALEUR }).notNull(),
    /**
     * Métadonnées d'un document (type, émetteur, année, échéance) — JSON, clés en liste
     * FERMÉE (`lib/validerFait.ts`), chiffré dès N1 comme la valeur. C'est ce qui permet
     * « où est mon avis de cotisation 2024 » sans qu'un chiffre du document n'entre ici.
     */
    attributs: text("attributs"),
    /** Dates ISO `AAAA-MM-JJ`, en texte : ce sont des dates du monde, pas des instants. */
    valideDe: text("valide_de"),
    valideA: text("valide_a"),
    /** Le domaine DriveAI (`02 · Finances`…) quand la source en a un ; sert au niveau dérivé. */
    domaine: text("domaine"),
    /** 0-3. MAX(ce que le code dérive, ce que le LLM propose) — jamais le minimum. */
    niveau: integer("niveau").notNull(),
    statut: text("statut", { enum: STATUTS }).notNull().default("propose"),
    confiance: real("confiance").notNull().default(1),
    fiabiliteSource: text("fiabilite_source", { enum: FIABILITES }).notNull(),
    /** Le fait que celui-ci remplace (une nouvelle adresse, un nouvel employeur). */
    remplaceId: text("remplace_id"),
    /** Posé à l'écriture quand la valeur RESSEMBLE à une consigne : jamais servi, visible dans « à valider ». */
    canari: boolean("canari").notNull().default(false),
    /** La version du vocabulaire sous laquelle le fait a été accepté (CLAUDE.md §9 n° 7). */
    versionVocabulaire: integer("version_vocabulaire").notNull(),
    /** HMAC(sujet|predicat|source_ref|extracteur|valeur) — la clé d'idempotence, voir l'en-tête. */
    empreinte: text("empreinte").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    valideLe: timestamp("valide_le", { withTimezone: true }),
    /** Suppression LOGIQUE ; la suppression physique passe par la purge totale. */
    supprimeLe: timestamp("supprime_le", { withTimezone: true }),
    /**
     * Ce fait est devenu une PIÈCE (ADR 0004 §6.2, décision n° 7) : il cesse d'être servi, il
     * n'est pas effacé. ⚠️ C'est ce qui rend la migration réversible — `UPDATE … SET
     * migre_en_piece = NULL` plus la suppression des pièces qui portent `origine_fait_id`.
     * Un fait MIGRÉ n'est pas un fait OUBLIÉ : le second est une décision de Marc et ne
     * revient jamais, le premier est un déménagement qu'on peut défaire.
     */
    migreEnPiece: timestamp("migre_en_piece", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("faits_empreinte").on(t.empreinte),
    index("faits_sujet_predicat").on(t.sujet, t.predicat),
    index("faits_statut_niveau").on(t.statut, t.niveau),
    check("faits_niveau_0_3", sql`${t.niveau} BETWEEN 0 AND 3`),
    // Un fait N3 ne porte JAMAIS de texte, même chiffré : existence, date, pointeur, rien
    // d'autre (ADR 0001 §5.3). La base elle-même le refuse.
    check(
      "faits_n3_sans_texte",
      sql`${t.niveau} < 3 OR ${t.valeur} IS NULL OR ${t.valeurType} IN ('date', 'ref_document')`,
    ),
    check("faits_confiance_0_1", sql`${t.confiance} BETWEEN 0 AND 1`),
  ],
);

export const provenances = pgTable(
  "provenances",
  {
    id: serial("id").primaryKey(),
    faitId: text("fait_id")
      .notNull()
      .references(() => faits.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: SOURCES }).notNull(),
    /** Un `fileId` Drive ; pour un mail, le SHA-256 du `messageId`, jamais le messageId en clair. */
    sourceRef: text("source_ref").notNull(),
    /** Modèle + version de prompt, ou `moteur-inventaire-v1`, ou `seed-session-2026-09-15`. */
    extracteur: text("extracteur").notNull(),
    dateSource: text("date_source"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provenances_fait").on(t.faitId), index("provenances_source").on(t.sourceRef)],
);

/**
 * Ce qu'une app a le droit de lire ou d'écrire. Édité par Marc dans l'UI, JAMAIS par l'app.
 * Jeton inconnu ⇒ aucune ligne ⇒ périmètre vide — pas une erreur bavarde (ADR 0001 §3).
 */
export const perimetres = pgTable("perimetres", {
  appId: text("app_id").primaryKey(),
  /** Liste JSON de domaines du vocabulaire (`emploi`, `vehicule`…). Vide = rien. */
  domaines: text("domaines").notNull().default("[]"),
  niveauMax: integer("niveau_max").notNull().default(0),
  role: text("role", { enum: ROLES }).notNull().default("lecture"),
  admetInvites: boolean("admet_invites").notNull().default(true),
  /** Q3 : l'adresse du domicile n'est servie que si `domicile` ET `niveau_max >= 2` ET pas d'invités. Défaut OFF. */
  domicile: boolean("domicile").notNull().default(false),
  modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Un fait oublié ne revient ni par le rejeu, ni par le rattrapage, ni par le flux.
 * Consultée AVANT toute insertion, sur tous les chemins. Clé = HMAC(source_ref|predicat|sujet).
 */
export const oublis = pgTable("oublis", {
  empreinte: text("empreinte").primaryKey(),
  raison: text("raison"),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only, HMAC chaîné : chaque ligne signe la précédente. Aucun outil ne le sert au
 * modèle. Rétention 1 an. La chaîne se vérifie par `lib/journal.ts#verifierChaine`.
 *
 * ⚠️ ADR 0014 : `version` (1 = corpus historique gelé, 2 = + `ids_pieces`) et `ids_pieces`
 * sont additifs — AUCUNE ligne existante ne change de sens. `version` vaut 1 par défaut
 * (l'historique, jamais retouché) ; les écritures futures passent `version = 2`
 * explicitement CÔTÉ CODE (`lib/journal.ts#VERSION_JOURNAL_ACTUELLE`), jamais depuis ce
 * défaut de colonne — voir `lib/journalAcces.ts`.
 */
export const accesJournal = pgTable(
  "acces_journal",
  {
    id: serial("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    /** ADR 0014. Défaut 1 = l'historique (gelé) ; toute écriture NEUVE passe 2 explicitement. */
    version: integer("version").notNull().default(1),
    /** `claude-ai`, `chat`, `widget:<app>`, `api:<app>`. */
    lecteur: text("lecteur").notNull(),
    outil: text("outil").notNull(),
    usage: text("usage", { enum: USAGES }).notNull(),
    niveauMaxServi: integer("niveau_max_servi").notNull(),
    /** Liste JSON d'ids de faits servis. */
    idsFaits: text("ids_faits").notNull().default("[]"),
    /**
     * ADR 0014 (revue #72) : liste JSON d'ids de PAPIERS servis. "[]" pour tout l'historique
     * (v1 ne les consignait pas) — ce n'est signé que pour les lignes `version = 2`.
     */
    idsPieces: text("ids_pieces").notNull().default("[]"),
    /** Empreinte de la question, jamais la question. */
    questionEmpreinte: text("question_empreinte"),
    coutUsd: real("cout_usd"),
    hmacPrecedent: text("hmac_precedent"),
    hmac: text("hmac").notNull(),
  },
  (t) => [
    index("acces_journal_ts").on(t.ts),
    // Deux écritures concurrentes qui signeraient la MÊME entrée précédente forkeraient la
    // chaîne : la base refuse la seconde, l'écrivain relit la tête et re-signe.
    uniqueIndex("acces_journal_hmac_precedent").on(t.hmacPrecedent),
  ],
);

/** Les sujets autres que Marc. Le nom est CHIFFRÉ (N2) : les proches ne sont pas des métadonnées. */
export const sujets = pgTable("sujets", {
  slug: text("slug").primaryKey(),
  type: text("type", { enum: TYPES_SUJET }).notNull(),
  nomChiffre: text("nom_chiffre"),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Un prédicat refusé est COMPTÉ, jamais stocké avec sa valeur (ADR 0001 §5.1, Q9) : c'est
 * le signal qui dit quoi ajouter à la version suivante du vocabulaire.
 */
export const predicatsRefuses = pgTable(
  "predicats_refuses",
  {
    predicat: text("predicat").notNull(),
    appelant: text("appelant").notNull(),
    versionVocabulaire: integer("version_vocabulaire").notNull(),
    nombre: integer("nombre").notNull().default(1),
    derniereVue: timestamp("derniere_vue", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.predicat, t.appelant] })],
);

/**
 * LA QUARANTAINE DU VOCABULAIRE (ADR 0004 §2.3). Un prédicat neuf naît ici, `en_quarantaine` :
 * stocké, cherchable, affiché — et JAMAIS servi à un modèle tant qu'il n'en sort pas.
 *
 * ⚠️ L'état vit sur le PRÉDICAT, pas sur le fait. Le dénormaliser sur `faits` obligerait à
 * réécrire toutes ses lignes le jour où Marc l'accepte — et une sortie de quarantaine doit
 * être UN geste, pas une migration. Un fait est donc servable ou non selon la ligne d'ICI,
 * lue à chaque lecture.
 *
 * ⚠️ `extracteurs` est un compteur de SOURCES DISTINCTES, pas un journal : trois extracteurs
 * différents sortent le prédicat de quarantaine (`SEUIL_SOURCES_INDEPENDANTES`). La liste est
 * bornée — elle répond à « combien », jamais à « qui a écrit quoi quand ».
 */
export const predicatsProposes = pgTable("predicats_proposes", {
  predicat: text("predicat").primaryKey(),
  /** `en_quarantaine` | `accepte` | `refuse`. `refuse` est ABSORBANT : le volume ne l'annule pas. */
  statut: text("statut").notNull().default("en_quarantaine"),
  /** Les extracteurs DISTINCTS qui l'ont proposé, bornés. JSON, comme les attributs. */
  extracteurs: text("extracteurs").notNull().default("[]"),
  /**
   * Les APPS distinctes (celles du jeton, ADR 0015 §2.2) qui l'ont proposé : c'est CE compte
   * qui décide de la sortie par le nombre. `extracteurs` reste, pour l'écran, et ne décide plus.
   */
  apps: text("apps").notNull().default("[]"),
  /** Combien de faits l'ont employé — le signal qui dit si ça vaut la peine de regarder. */
  nombre: integer("nombre").notNull().default(1),
  premiereVue: timestamp("premiere_vue", { withTimezone: true }).notNull().defaultNow(),
  derniereVue: timestamp("derniere_vue", { withTimezone: true }).notNull().defaultNow(),
  /** Quand il est sorti de quarantaine, et par quel chemin (`marc` ou `sources`). */
  sortieLe: timestamp("sortie_le", { withTimezone: true }),
  sortiePar: text("sortie_par"),
});

/**
 * Ce que le chat dépense, appel par appel (ADR 0001 §5.5). Compté au site d'appel AVANT
 * toute validation de la réponse ; le plafond quotidien (1 $/jour, non désactivable) se lit
 * en sommant `cout_usd` sur `jour`. Publié au hub en `period: "total"`. Aucun contenu ici.
 */
/**
 * Les plafonds de dépense, RÉGLABLES depuis l'app (décision de Marc, 18/09). Migration 0015.
 *
 * ⚠⚠ Ce qui reste verrouillé de l'ADR 0001 §5.5 (« plafond dur, non désactivable ») : un
 * plafond EXISTE toujours (l'absence de ligne vaut le DÉFAUT, jamais « illimité »), il est
 * toujours CONSULTÉ (`budgetOuvert` le prend en argument, donc `tsc` énumère les sites), et
 * il ne peut pas dépasser un maximum écrit dans le code ET dans la base.
 *
 * ⚠️ Le plancher est zéro : « 0 $ » veut dire « ne dépense rien aujourd'hui », donc le
 * plafond est au MAXIMUM de son effet. C'est une pause, pas un interrupteur.
 */
export const plafonds = pgTable(
  "plafonds",
  {
    poste: text("poste", { enum: POSTES_DEPENSE }).primaryKey(),
    usdParJour: real("usd_par_jour").notNull(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // La même borne que dans le code (`PLAFOND_MAX_USD_PAR_JOUR`), parce que l'app n'est pas
    // le seul chemin d'écriture possible — même raison que `pieces_niveau_0_3`.
    check("plafonds_borne", sql`${t.usdParJour} >= 0 AND ${t.usdParJour} <= 50`),
  ],
);

/**
 * La VOIX de Lia : comment Marc veut qu'on lui parle (ADR 0005 A4, [L27]). Migration 0022.
 *
 * Une seule ligne (`id = 1`, imposé par la base). Texte de niveau 0 en clair : une préférence de
 * style, pas un fait sur Marc. Pas de ligne = pas de voix = le ton par défaut des règles de Lia.
 * Ce que Marc écrit entre dans le prompt BALISÉ comme donnée (`lib/chat/voix.ts`), jamais comme
 * une règle.
 */
export const voixLia = pgTable(
  "voix_lia",
  {
    id: integer("id").primaryKey().notNull().default(1),
    texte: text("texte").notNull(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("voix_lia_une_seule", sql`${t.id} = 1`),
    check("voix_lia_borne", sql`char_length(${t.texte}) BETWEEN 1 AND 600`),
  ],
);

export const depensesChat = pgTable(
  "depenses_chat",
  {
    id: serial("id").primaryKey(),
    /** `AAAA-MM-JJ` à l'heure du Québec — c'est le jour de Marc que le plafond protège. */
    jour: text("jour").notNull(),
    /**
     * Qui a dépensé (16/09). ⚠️ Les lignes ANTÉRIEURES valent toutes `chat` par défaut, et
     * c'est une approximation ASSUMÉE : avant cette date, les extractions lancées au bouton
     * passaient par le même compteur, sans rien qui permette de les distinguer après coup.
     * L'apprentissage est donc sous-compté sur le passé — borné, et dit plutôt que masqué.
     */
    poste: text("poste", { enum: POSTES_DEPENSE }).notNull().default("chat"),
    modele: text("modele").notNull(),
    entree: integer("entree").notNull().default(0),
    sortie: integer("sortie").notNull().default(0),
    ecritureCache: integer("ecriture_cache").notNull().default(0),
    lectureCache: integer("lecture_cache").notNull().default(0),
    coutUsd: real("cout_usd").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("depenses_chat_jour").on(t.jour), index("depenses_chat_jour_poste").on(t.jour, t.poste)],
);

/**
 * Ce que la mémoire NE SAIT PAS et demande à Marc (ADR 0002 §5.1). Une question est du texte
 * écrit par un modèle : elle passe donc les MÊMES contrôles qu'une valeur de fait (≤ 200
 * caractères, ni URL, ni balise, ni retour à la ligne — `lib/questions.ts`).
 *
 * ⚠️ AU PLUS `MAX_OUVERTES` questions ouvertes à la fois. Le vrai risque du projet est une
 * liste qui enfle sans être répondue (CLAUDE.md §9 n° 5) : passé le plafond, la plus ancienne
 * est ÉCARTÉE, pas supprimée — on garde la trace qu'elle a été posée, sinon on la reposerait.
 *
 * Aucune valeur chiffrée ici : une question ne dit rien sur Marc, elle dit ce qu'on ignore.
 * La RÉPONSE, elle, ne vit pas dans cette table — elle devient un fait, par `validerFait`.
 */
export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    /** Le prédicat que la réponse alimenterait. Vérifié contre le vocabulaire à la pose. */
    predicatVise: text("predicat_vise").notNull(),
    /** Pourquoi on la pose — affiché à Marc, parce qu'une question sans motif ne se répond pas. */
    motif: text("motif").notNull(),
    origine: text("origine", { enum: ORIGINES_QUESTION }).notNull(),
    statut: text("statut", { enum: STATUTS_QUESTION }).notNull().default("ouverte"),
    /** Le fait né de la réponse, quand il y en a un. */
    faitId: text("fait_id"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    closeLe: timestamp("close_le", { withTimezone: true }),
    /**
     * Les options d'un QCM, en JSON (`[{ faitId, valeur, provenance }]`), ou `null` pour une
     * question à texte libre (décision de Marc, 17/09).
     *
     * ⚠️ Les valeurs y sont EN CLAIR, contrairement à celles des faits (chiffrées sous l'AAD
     * `id|niveau`). C'est assumé et borné : une option ne naît que d'une contradiction entre
     * deux faits DÉJÀ en base, elle vit le temps de la question, et elle ne sort par aucun
     * outil MCP ni aucun périmètre d'app — `questions` n'est servie qu'à Marc. Le jour où une
     * question porterait un niveau 3, il faudra les chiffrer : c'est écrit ici pour qu'on ne
     * le découvre pas ce jour-là.
     */
    options: text("options"),
  },
  (t) => [
    // Une question ÉCARTÉE ne se repose pas : le prédicat et le texte forment la clé. Sans
    // elle, un modèle qui redemande la même chose chaque jour remplirait la page à lui seul.
    uniqueIndex("questions_texte").on(t.predicatVise, t.question),
    index("questions_statut").on(t.statut),
  ],
);

/**
 * Une conversation de Marc avec un assistant, gardée EN ENTIER (ADR 0002 §2).
 *
 * C'est l'amendement de la frontière de l'ADR 0001, et il est borné : la frontière sur les
 * DOCUMENTS et les MAILS reste entière, une conversation ne devient jamais un fait
 * directement, et elle n'entre dans AUCUN périmètre d'app.
 *
 * ⚠️ NIVEAU 2 PAR DÉFAUT, et le niveau ne se dérive PAS du contenu : il faudrait le lire pour
 * le classer, et c'est exactement la porte qu'on vient de fermer.
 *
 * `octets` est mesuré à l'écriture : c'est ce qui permet de dire à Marc combien la mémoire
 * pèse avant de décider d'une rétention (ADR 0002 §4, question B — tranchée « aucune purge »,
 * mais sur une mesure qui n'existait pas encore).
 */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: SOURCES_CONVERSATION }).notNull(),
    /** Chiffré comme un message : un titre est du texte de Marc. */
    titre: text("titre"),
    debutLe: timestamp("debut_le", { withTimezone: true }).notNull().defaultNow(),
    finLe: timestamp("fin_le", { withTimezone: true }).notNull().defaultNow(),
    nbMessages: integer("nb_messages").notNull().default(0),
    /** Taille du texte EN CLAIR, avant chiffrement — ce qui grossit la base, c'est lui. */
    octets: integer("octets").notNull().default(0),
    /** Combien de fragments le scan de secrets a retirés, tous messages confondus. */
    secretsRetires: integer("secrets_retires").notNull().default(0),
    /**
     * Jusqu'où l'extraction est allée (lot 9). C'est un RANG, pas un drapeau : une
     * conversation qui continue mérite une nouvelle passe, et un booléen la figerait à sa
     * première extraction. `null` = jamais extraite.
     */
    extraiteJusqua: integer("extraite_jusqua"),
    /** Suppression LOGIQUE, comme un fait oublié. */
    supprimeLe: timestamp("supprime_le", { withTimezone: true }),
  },
  (t) => [index("conversations_source").on(t.source), index("conversations_fin").on(t.finLe)],
);

/**
 * Un message, chiffré. **AAD = `conversation_id|source|index|2`** : déplacer un message d'une
 * conversation à l'autre, ou changer son rang, fait ÉCHOUER le déchiffrement — le même
 * principe que l'AAD `id|niveau` des faits, appliqué à la position.
 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Le rang dans la conversation, à partir de 0. Il entre dans l'AAD : il n'est pas décoratif. */
    index: integer("index").notNull(),
    role: text("role", { enum: ROLES_MESSAGE }).notNull(),
    contenu: text("contenu").notNull(),
    secretsRetires: integer("secrets_retires").notNull().default(0),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("messages_position").on(t.conversationId, t.index)],
);

/**
 * Les règles de liens (ADR 0002 §5.3) : les cinq de la v1, et quatre de plus le 26/10 pour un
 * réseau plus relié (tâche MemoryAI 186). FERMÉE comme le vocabulaire : un type inconnu n'entre
 * pas en base. La colonne est un `text` sans CHECK : en ajouter ne demande aucune migration.
 */
export const TYPES_LIEN = [
  "meme-document",
  "meme-periode",
  "remplacement",
  "meme-domaine-meme-entite",
  "cause-declaree",
  "meme-source",
  "meme-valeur",
  "meme-emetteur",
  "dates-proches",
] as const;
/** Une règle POSE, un modèle DEVINE. Les deux ne se confondent jamais à l'écran (ADR §5.3). */
export const ORIGINES_LIEN = ["regle", "modele"] as const;
/** Ce que l'extrémité B désigne : un autre fait, ou la question qui a produit celui-ci. */
export const CIBLES_LIEN = ["fait", "question"] as const;

/**
 * Un lien entre deux faits, ou entre un fait et la question qui l'a produit.
 *
 * ⚠️ `fait_a` porte une clé étrangère, `fait_b` N'EN PORTE PAS — et ce n'est pas un oubli :
 * `cause-declaree` pointe une QUESTION, pas un fait, donc une seule contrainte ne peut pas
 * couvrir les deux extrémités. Ce qui tient l'intégrité à la place : les liens `regle` sont
 * RECALCULÉS EN ENTIER (`recalculer` supprime puis réécrit), et la lecture écarte une
 * extrémité qui n'existe plus. Un lien orphelin ne survit donc pas à un recalcul, et il n'est
 * jamais affiché entre-temps.
 *
 * ⚠️ L'ORDRE DE LA PAIRE PORTE UN SENS pour les règles ORIENTÉES (`remplacement` :
 * le nouveau vers l'ancien ; `cause-declaree` : le fait vers sa question). Pour les règles
 * symétriques il est NORMALISÉ (`fait_a < fait_b`), sinon la même paire entrerait deux fois
 * selon l'ordre de parcours. `lib/graphe.ts` porte cette distinction, et un test l'exige :
 * normaliser une paire orientée l'inverserait, ce qui ferait dire au graphe le contraire.
 */
export const liens = pgTable(
  "liens",
  {
    id: text("id").primaryKey(),
    faitA: text("fait_a")
      .notNull()
      .references(() => faits.id, { onDelete: "cascade" }),
    faitB: text("fait_b").notNull(),
    cibleB: text("cible_b", { enum: CIBLES_LIEN }).notNull().default("fait"),
    type: text("type", { enum: TYPES_LIEN }).notNull(),
    /** 0-1. Ce que la RÈGLE affirme de sa propre force, jamais une probabilité mesurée. */
    poids: real("poids").notNull().default(1),
    origine: text("origine", { enum: ORIGINES_LIEN }).notNull().default("regle"),
    /** Le nom de la règle qui l'a posé — c'est lui qui rend le lien EXPLICABLE à l'écran. */
    regle: text("regle").notNull(),
    /** La phrase qui dit POURQUOI, en clair. Jamais une valeur de fait : elle n'est pas chiffrée. */
    pourquoi: text("pourquoi").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("liens_paire").on(t.faitA, t.faitB, t.type),
    index("liens_fait_a").on(t.faitA),
    index("liens_origine").on(t.origine),
    check("liens_poids_0_1", sql`${t.poids} BETWEEN 0 AND 1`),
    // Une extrémité qui pointe une question ne peut venir que de la règle qui le fait.
    check("liens_question_seulement_cause", sql`${t.cibleB} = 'fait' OR ${t.type} = 'cause-declaree'`),
    // Un fait ne se lie pas à lui-même : ça passerait tous les filtres et n'apprendrait rien.
    check("liens_pas_de_boucle", sql`${t.faitA} <> ${t.faitB}`),
  ],
);

/** L'état d'une pièce. `remplacee` = un papier plus récent dit la même chose (ADR 0004 §6.2). */
export const STATUTS_PIECE = ["active", "remplacee"] as const;
export const GENRES_AVIS = ["piece", "fait", "question"] as const;
export const VERDICTS_AVIS = ["vrai", "faux", "passe"] as const;

/**
 * Une PIÈCE : ce qu'un PAPIER contient (ADR 0004 §6.2). Table neuve, et la distinction avec
 * `faits` porte tout le reste : une pièce **n'affirme rien sur Marc**, elle rapporte ce qu'un
 * document dit. C'est ce qui permet de lui donner des champs LIBRES sans rouvrir la porte
 * d'injection des faits — le vocabulaire fermé protège les faits, pas les pièces.
 *
 * ── DEUX RÉGIMES DE CHIFFREMENT (décision de Marc, 16/09, `lib/pieces/regime.ts`) ─────────
 * L'ADR promet à la fois « les numéros vivront chiffrés » et « plein texte français natif de
 * Postgres » — or `to_tsvector` exige du clair. Le partage retenu :
 *   - une pièce de niveau < 3 dans un dossier RECONNU porte son `resume` et son `recherche`
 *     EN CLAIR, donc devient cherchable en plein texte ;
 *   - une pièce N3 (identité, immigration, fiscal) ou d'origine inconnue chiffre les deux,
 *     et ne se retrouve que par ses facettes.
 * `resume_en_clair` dit lequel des deux s'applique à CETTE ligne — sans lui, un lecteur ne
 * saurait pas s'il doit déchiffrer, et devinerait.
 *
 * ── LES FACETTES SONT CHIFFRÉES, MAIS REGROUPABLES ───────────────────────────────────────
 * `type` et `emetteur` DISENT quelque chose (« Immigration Canada » révèle un statut), donc
 * ils sont chiffrés comme les `attributs` d'un fait. Pour compter et filtrer sans déchiffrer
 * la table, chacun porte une CLÉ keyée en clair (`*_cle` = HMAC de la valeur normalisée, le
 * patron `empreinte` déjà en place). Elle permet l'égalité et le `GROUP BY` ; elle fuit la
 * FRÉQUENCE (on voit que 40 pièces partagent un émetteur, jamais lequel) et c'est le prix
 * assumé de facettes avec compteurs.
 *
 * ⚠️ `domaine` et `annee` restent EN CLAIR, et pour deux raisons différentes : le domaine est
 * ce qui DÉRIVE le niveau, donc il doit rester auditable sans clé — si on ne peut pas le lire,
 * on ne peut pas vérifier qu'une pièce est au bon régime ; un millésime seul n'identifie
 * personne. C'est déjà le choix fait pour `faits.domaine`.
 *
 * ⚠️ `champs_structures` et `champs_libres` sont chiffrés DANS LES DEUX RÉGIMES, sans
 * exception : c'est là que vivent les numéros de référence, les montants et les numéros
 * d'identité. Le régime ne décide que du sort du RÉSUMÉ.
 */
export const pieces = pgTable(
  "pieces",
  {
    id: text("id").primaryKey(),
    /** `marc`, `foyer:<slug>`, `entite:<slug>` — même convention que `faits`. */
    sujet: text("sujet").notNull().default("marc"),

    /** Facettes chiffrées + leur clé de regroupement keyée (voir l'en-tête). */
    type: text("type"),
    typeCle: text("type_cle"),
    emetteur: text("emetteur"),
    emetteurCle: text("emetteur_cle"),

    /**
     * À QUI le papier appartient (ADR-0061 de DriveAI, arbitrage de Marc du 16/09). Chiffré
     * comme un nom de proche l'est déjà dans `sujets.nom_chiffre` : un titulaire nomme une
     * personne. La clé keyée permet de filtrer « les papiers qui ne sont pas les miens »
     * sans déchiffrer la table.
     *
     * ⚠️ `null` veut dire INCONNU, et jamais « Marc ». Un document au nom de deux personnes,
     * un formulaire vierge, un papier où aucun nom n'apparaît : le défaut le plus prudent est
     * celui qui n'attribue rien à personne.
     */
    titulaire: text("titulaire"),
    titulaireCle: text("titulaire_cle"),
    /**
     * Ce que l'extracteur dit de SA propre certitude, entre 0 et 1. EN CLAIR : un degré de
     * confiance ne nomme personne. ⚠️ Un titulaire SANS confiance est refusé au contrat —
     * une lecture de modèle qu'on ne peut pas pondérer serait crue sur parole.
     */
    titulaireConfiance: real("titulaire_confiance"),

    /** En clair, assumé : un millésime seul n'identifie personne. */
    annee: integer("annee"),
    /** Le dossier DriveAI. EN CLAIR parce que c'est lui qui dérive le niveau — donc auditable. */
    domaine: text("domaine"),
    /** La langue du document (`fr`, `en`…) : le résumé est dans la langue du papier (ADR §6.2). */
    langue: text("langue"),

    /** Dates du MONDE (`AAAA-MM-JJ`), pas des instants — comme `faits.valide_de`. */
    dateDocument: text("date_document"),
    dateEcheance: text("date_echeance"),

    /** Dérivé par le CODE (`lib/niveau.ts`) ; un extracteur ne peut que le MONTER. */
    niveau: integer("niveau").notNull(),
    /** Le régime de CETTE ligne. Décidé par `regimePiece`, jamais par un modèle. */
    resumeEnClair: boolean("resume_en_clair").notNull(),
    /** Deux ou trois phrases, dans la langue du document. Clair ou chiffré selon le régime. */
    resume: text("resume"),
    /**
     * Le texte que `to_tsvector('french', …)` indexe : clés de recherche EN FRANÇAIS, quelle
     * que soit la langue du papier (ADR §6.2). `NULL` quand le régime est chiffré — et ce
     * `NULL` n'est pas un trou de données, c'est le régime qui parle.
     */
    recherche: text("recherche"),

    /** JSON chiffré TOUJOURS : numéros de référence, montants, personnes, lieux. */
    champsStructures: text("champs_structures"),
    /** JSON chiffré TOUJOURS : c'est ici, et seulement ici, que « je veux tout » vit sans vocabulaire. */
    champsLibres: text("champs_libres"),

    /** La pièce que celle-ci remplace (un bail renouvelé, un permis renouvelé). */
    remplaceId: text("remplace_id"),
    statut: text("statut", { enum: STATUTS_PIECE }).notNull().default("active"),
    confiance: real("confiance").notNull().default(1),
    /** Modèle + version de prompt, ou `moteur-inventaire-v1` pour les pièces migrées. */
    extracteur: text("extracteur").notNull(),
    /**
     * L'app que le JETON a prouvée à l'écriture (ADR 0015 §2.2), jamais un nom lu dans le corps.
     * `null` : papier antérieur à la migration 0020, tant que la 0021 ne l'a pas attribué.
     */
    ecrivainApp: text("ecrivain_app"),
    /** HMAC(sujet|exemplaire principal) — l'idempotence : deux passes ne créent pas deux pièces. */
    empreinte: text("empreinte").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression LOGIQUE, comme un fait oublié. */
    supprimeLe: timestamp("supprime_le", { withTimezone: true }),
    /**
     * Le fait `document.existe` dont cette pièce est issue (ADR 0004 §6.2, décision n° 7).
     * ⚠️ C'est LUI qui rend l'annulation exacte — on ne supprime que ce que la migration a
     * créé — et la reprise idempotente : un fait déjà migré a déjà sa pièce.
     */
    origineFaitId: text("origine_fait_id"),
  },
  (t) => [
    uniqueIndex("pieces_empreinte").on(t.empreinte),
    index("pieces_facettes").on(t.domaine, t.annee),
    index("pieces_emetteur_cle").on(t.emetteurCle),
    index("pieces_type_cle").on(t.typeCle),
    index("pieces_titulaire_cle").on(t.titulaireCle),
    check("pieces_niveau_0_3", sql`${t.niveau} BETWEEN 0 AND 3`),
    check("pieces_confiance_0_1", sql`${t.confiance} BETWEEN 0 AND 1`),
    // Le verrou qui tient le régime par la BASE et pas seulement par le code : une pièce au
    // régime chiffré ne peut pas porter de texte de recherche en clair. Sans lui, un chemin
    // d'écriture qui oublierait `regimePiece` écrirait du N3 en clair sans que rien ne lève.
    check("pieces_chiffre_sans_recherche", sql`${t.resumeEnClair} OR ${t.recherche} IS NULL`),
    // Un titulaire sans sa confiance serait une lecture de modèle crue sur parole. La base
    // le refuse aussi, parce que le contrat n'est pas le seul chemin d'écriture possible.
    check("pieces_titulaire_avec_confiance", sql`${t.titulaire} IS NULL OR ${t.titulaireConfiance} IS NOT NULL`),
    check(
      "pieces_titulaire_confiance_0_1",
      sql`${t.titulaireConfiance} IS NULL OR ${t.titulaireConfiance} BETWEEN 0 AND 1`,
    ),
  ],
);

/**
 * Les EXEMPLAIRES d'une pièce : le même papier peut exister en plusieurs fichiers Drive
 * (un scan, une copie, une version signée). Une table à part plutôt qu'un JSON, parce que
 * `fileId` est ce par quoi DriveAI et la Mémoire se retrouvent — il faut pouvoir l'indexer.
 *
 * ⚠️ `chemin` est CHIFFRÉ : un chemin Drive porte le nom des dossiers, donc le domaine, donc
 * parfois le statut migratoire. Le `fileId`, lui, est un identifiant opaque.
 */
export const pieceExemplaires = pgTable(
  "piece_exemplaires",
  {
    id: serial("id").primaryKey(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    /** L'identifiant Drive — opaque, donc en clair : c'est la clé de jointure avec DriveAI. */
    fileId: text("file_id").notNull(),
    /** Le chemin au moment de la lecture. Chiffré (voir l'en-tête). */
    chemin: text("chemin"),
    /** `true` pour celui qui porte l'empreinte de la pièce. Exactement un par pièce. */
    principal: boolean("principal").notNull().default(false),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un même fichier ne peut pas être deux fois le même exemplaire d'une pièce.
    uniqueIndex("piece_exemplaires_unicite").on(t.pieceId, t.fileId),
    index("piece_exemplaires_file").on(t.fileId),
  ],
);

/**
 * Les LECTURES TENTÉES sans résultat (ADR 0007, [L35]) : un verdict par (fichier, extracteur).
 *
 * ⚠️ Cette table n'existe que pour UN cas : le document qui ne donne rien (photo sans texte,
 * fichier disparu, extraction vide). Un papier LU n'y passe jamais — il sort de la file en
 * remplaçant sa pièce d'inventaire ([L39]). Sans elle, un document illisible resterait en
 * tête de file et la boucle paierait son OCR à chaque passe, pour toujours.
 *
 * ⚠️ L'EXTRACTEUR EST DANS LA CLÉ : un lecteur neuf ré-ouvre ce que l'ancien n'a pas su lire,
 * sans rien effacer. Et rien ici n'est un contenu : un `fileId` opaque, un motif d'une liste
 * fermée, une date.
 */
export const lecturesTentees = pgTable(
  "lectures_tentees",
  {
    fileId: text("file_id").notNull(),
    extracteur: text("extracteur").notNull(),
    motif: text("motif").notNull(),
    tenteLe: timestamp("tente_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.extracteur] })],
);

/**
 * L'AVANCEMENT qu'une app publie (ADR 0009) : une ligne PAR APP, écrasée à chaque envoi.
 *
 * ⚠️ DES COMPTES, JAMAIS DES FAITS : cette table n'est lue par aucun outil MCP, aucun outil du
 * chat, aucun prompt — un test l'impose. Et rien n'y est chiffré, délibérément : ce sont des
 * compteurs de niveau 0 (le corps est re-validé par `validerAvancement` à la LECTURE aussi).
 *
 * ⚠️ DEUX HORODATAGES, deux pannes : `mesure_le` ancien avec `recu_le` récent = l'app envoie un
 * compte figé ; `recu_le` ancien = l'app n'envoie plus rien.
 */
export const avancementSources = pgTable("avancement_sources", {
  appId: text("app_id").primaryKey(),
  mesureLe: timestamp("mesure_le", { withTimezone: true }).notNull(),
  recuLe: timestamp("recu_le", { withTimezone: true }).notNull().defaultNow(),
  corps: text("corps").notNull(),
});

/**
 * Les AVIS de Marc sur la pile « vrai / faux » (ADR 0012). EN AJOUT SEUL : le verdict en vigueur
 * est le plus récent, et changer d'avis ajoute une ligne. Un avis ne modifie ni une pièce ni un
 * fait — il est lu À CÔTÉ.
 *
 * ⚠️ `remarque` est CHIFFRÉE sous l'AAD `avis|<ref_id>` au niveau 3 : elle peut citer un numéro.
 */
export const avisPile = pgTable(
  "avis_pile",
  {
    id: serial("id").primaryKey(),
    genre: text("genre", { enum: GENRES_AVIS }).notNull(),
    refId: text("ref_id").notNull(),
    verdict: text("verdict", { enum: VERDICTS_AVIS }).notNull(),
    remarque: text("remarque"),
    avisLe: timestamp("avis_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("avis_pile_ref").on(t.genre, t.refId, t.avisLe),
    check("avis_pile_genre", sql`${t.genre} IN ('piece', 'fait', 'question')`),
    check("avis_pile_verdict", sql`${t.verdict} IN ('vrai', 'faux', 'passe')`),
    check("avis_pile_remarque_seulement_faux", sql`${t.remarque} IS NULL OR ${t.verdict} = 'faux'`),
  ],
);

/**
 * Le BANC de questions de la refonte LIA (MemoryAI#69, migration 0023). Tiré UNE fois par banc
 * (`banc` = son nom : `papiers-v1` d'abord, illisible depuis l'incident du 23/10, puis
 * `papiers-v2`), jamais réécrit : un banc qu'on retouche ne mesure plus rien.
 *
 * ⚠️ `contenu` est CHIFFRÉ (AAD `banc|<id>`, niveau 2) : la question nomme un émetteur ou un
 * type de papier de Marc. `capacite` reste en clair : elle ne dit rien sur lui, et c'est elle
 * que les comptes de `memoryai_etat` regroupent.
 */
export const bancQuestions = pgTable(
  "banc_questions",
  {
    id: text("id").primaryKey(),
    banc: text("banc").notNull(),
    rang: integer("rang").notNull(),
    capacite: text("capacite").notNull(),
    contenu: text("contenu").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("banc_questions_rang").on(t.banc, t.rang)],
);

/**
 * Une MESURE du banc : des NOMBRES seulement (`lib/banc/banc.ts#Mesure` en JSON), jamais une
 * question ni un identifiant de papier. En ajout seul : la suite des mesures EST l'historique.
 */
export const bancMesures = pgTable(
  "banc_mesures",
  {
    id: serial("id").primaryKey(),
    banc: text("banc").notNull(),
    /** Ce qui a cherché : `recherche-plein-texte` au lot 0, LIA ensuite. */
    chercheur: text("chercheur").notNull(),
    resultat: text("resultat").notNull(),
    mesureLe: timestamp("mesure_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("banc_mesures_banc").on(t.banc, t.mesureLe)],
);

/**
 * Le sauvetage du 23/10/2026 (ADR 0019, migration 0024). `ancien` est le JSON de ce que la ligne
 * portait avant d'être sauvée (scellés `v1`, empreintes) : écrit dans la même instruction que la
 * ligne, jamais modifié ensuite.
 */
export const chiffreV1Archive = pgTable(
  "chiffre_v1_archive",
  {
    tableNom: text("table_nom").notNull(),
    ligneId: text("ligne_id").notNull(),
    ancien: text("ancien").notNull(),
    sauveLe: timestamp("sauve_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "chiffre_v1_archive_pk", columns: [t.tableNom, t.ligneId] })],
);

/** Les lignes que le sauvetage n'a pas pu sauver. `raisons` : des codes fermés, jamais une valeur. */
export const sauvetageEchecs = pgTable(
  "sauvetage_echecs",
  {
    tableNom: text("table_nom").notNull(),
    ligneId: text("ligne_id").notNull(),
    raisons: text("raisons").notNull(),
    essais: integer("essais").notNull().default(1),
    majLe: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "sauvetage_echecs_pk", columns: [t.tableNom, t.ligneId] })],
);

/** Une seule ligne, posée par la migration si la base avait déjà des données. `closLe` vide ⇒ écritures des apps fermées. */
export const sauvetageEtat = pgTable(
  "sauvetage_etat",
  {
    id: integer("id").primaryKey(),
    ouvertLe: timestamp("ouvert_le", { withTimezone: true }).notNull().defaultNow(),
    closLe: timestamp("clos_le", { withTimezone: true }),
  },
  (t) => [check("sauvetage_etat_une_ligne", sql`${t.id} = 1`)],
);

/**
 * L'état PARTAGÉ de LIA (migration 0025, contrat `CONTRAT-etat-lia.md`) : une seule ligne, celle
 * du propriétaire. Aucun contenu de Marc : des nombres, des verbes de LIA, un nom d'humeur
 * (`lib/lia/etatPartage.ts`). `version` sert au contrôle optimiste (une écriture qui ne la
 * dépasse pas est refusée en 409).
 */
export const liaEtat = pgTable(
  "lia_etat",
  {
    id: integer("id").primaryKey(),
    version: integer("version").notNull(),
    maj: bigint("maj", { mode: "number" }).notNull(),
    etat: jsonb("etat").notNull(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("lia_etat_une_ligne", sql`${t.id} = 1`)],
);

/**
 * Une PERSONNE (ADR 0020) : « Julie », son adresse et son compte Messenger sont la même. Le nom
 * est CHIFFRÉ (AAD `personne|<id>|2`) : un nom de tiers est une donnée sur quelqu'un d'autre que
 * Marc. `est_marc` dit le titulaire du compte qui a généré l'export, sans que son nom soit écrit.
 */
export const personnes = pgTable("personnes", {
  id: text("id").primaryKey(),
  nom: text("nom").notNull(),
  estMarc: boolean("est_marc").notNull().default(false),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

/** Les façons de désigner une personne. FERMÉE : un genre inconnu n'entre pas en base. */
export const GENRES_ALIAS = ["messenger", "courriel", "nom"] as const;

/**
 * Un alias. `cle` = HMAC(genre|valeur normalisée) : c'est elle qui reconnaît la même personne
 * d'un import à l'autre sans déchiffrer la table. La valeur est chiffrée (AAD `alias|<cle>|2`).
 */
export const personneAlias = pgTable(
  "personne_alias",
  {
    cle: text("cle").primaryKey(),
    personneId: text("personne_id")
      .notNull()
      .references(() => personnes.id, { onDelete: "cascade" }),
    genre: text("genre", { enum: GENRES_ALIAS }).notNull(),
    valeur: text("valeur").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("personne_alias_personne").on(t.personneId)],
);

export const GENRES_EVENEMENT = ["message"] as const;
export const SOURCES_EVENEMENT = ["messenger"] as const;
export const ROLES_EVENEMENT = ["auteur", "destinataire"] as const;

/**
 * Un ÉVÉNEMENT daté (ADR 0020) : un message, plus tard un courriel. Il n'affirme rien sur Marc,
 * il rapporte ce qui a été dit, par qui, quand — comme une pièce rapporte un papier.
 *
 * ⚠️ `source_ref` + `position` FONT L'IDEMPOTENCE : le même export relu ne crée aucune ligne.
 * `texte` et `fil` sont CHIFFRÉS au niveau 2 (AAD `evenement|<id>|2`) ; `survenu_le` reste en
 * clair, c'est lui qu'on filtre (« tel jour »), et une heure seule ne dit pas ce qui a été dit.
 */
export const evenements = pgTable(
  "evenements",
  {
    id: text("id").primaryKey(),
    genre: text("genre", { enum: GENRES_EVENEMENT }).notNull(),
    source: text("source", { enum: SOURCES_EVENEMENT }).notNull(),
    /** Le fichier Drive de l'export. */
    sourceRef: text("source_ref").notNull(),
    /** Le rang dans l'export, 0 = le plus ancien. */
    position: integer("position").notNull(),
    survenuLe: timestamp("survenu_le", { withTimezone: true }).notNull(),
    auteurId: text("auteur_id")
      .notNull()
      .references(() => personnes.id),
    fil: text("fil"),
    /** `null` = un message sans texte (photo, audio seuls). */
    texte: text("texte"),
    piecesJointes: integer("pieces_jointes").notNull().default(0),
    secretsRetires: integer("secrets_retires").notNull().default(0),
    niveau: integer("niveau").notNull().default(2),
    ecrivainApp: text("ecrivain_app").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression LOGIQUE, posée quand le papier d'origine est oublié. */
    supprimeLe: timestamp("supprime_le", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("evenements_position").on(t.sourceRef, t.position),
    index("evenements_survenu").on(t.survenuLe),
    index("evenements_auteur").on(t.auteurId, t.survenuLe),
    check("evenements_niveau", sql`${t.niveau} BETWEEN 0 AND 3`),
  ],
);

/** Qui a écrit, et à qui : la jointure qui répond à « ce que j'ai dit à X ». */
export const evenementPersonnes = pgTable(
  "evenement_personnes",
  {
    evenementId: text("evenement_id")
      .notNull()
      .references(() => evenements.id, { onDelete: "cascade" }),
    personneId: text("personne_id")
      .notNull()
      .references(() => personnes.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES_EVENEMENT }).notNull(),
  },
  (t) => [
    uniqueIndex("evenement_personnes_cle").on(t.evenementId, t.personneId, t.role),
    index("evenement_personnes_personne").on(t.personneId),
  ],
);

/**
 * Les DEMANDES « Que peut-on changer ici ? » du hub (ADR 0021, migration 0027). Pas des faits :
 * ni source, ni validation, jamais servies à un modèle. Contenu borné par `lib/demandes.ts` ;
 * `nom` est CHIFFRÉ au niveau 1 (AAD `demande|<id>|1`), `empreinte` rend l'écriture idempotente.
 */
export const demandes = pgTable(
  "demandes",
  {
    id: text("id").primaryKey(),
    empreinte: text("empreinte").notNull(),
    type: text("type").notNull(),
    app: text("app").notNull(),
    genre: text("genre").notNull(),
    nom: text("nom").notNull(),
    demandeLe: timestamp("demande_le", { withTimezone: true }).notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("demandes_empreinte").on(t.empreinte), index("demandes_demande_le").on(t.demandeLe)],
);

/**
 * Les NOTES que LIA laisse au coordinateur (ADR 0022, migration 0028). Des observations, jamais
 * des consignes : `texte` est CHIFFRÉ au niveau 1 (AAD `note_lia|<id>|1`), borné par
 * `lib/lia/notes.ts` ; `jour` (Québec) porte le plafond quotidien, `luLe` la lecture.
 */
export const notesLia = pgTable(
  "notes_lia",
  {
    id: text("id").primaryKey(),
    genre: text("genre").notNull(),
    app: text("app").notNull(),
    texte: text("texte").notNull(),
    jour: text("jour").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    luLe: timestamp("lu_le", { withTimezone: true }),
  },
  (t) => [index("notes_lia_jour").on(t.jour), index("notes_lia_lu_le").on(t.luLe)],
);

/**
 * Le CACHE du monde (ADR 0024, migration 0029) : ce qu'une source publique a rendu (la météo d'ECCC),
 * déjà lu et borné par `lib/monde/`, et quand. Aucune donnée de Marc : rien n'y est chiffré.
 */
export const mondeCache = pgTable("monde_cache", {
  cle: text("cle").primaryKey(),
  corps: text("corps").notNull(),
  luLe: timestamp("lu_le", { withTimezone: true }).notNull(),
});

/** Ce que la relecture de LIA a décidé d'un fait (ADR 0025, migration 0030). */
export const DECISIONS_LIA = ["valide", "doute", "sans-source"] as const;

/**
 * La TRACE de chaque relecture de LIA (ADR 0025 § 4) : un fait relu une fois, jamais deux. La
 * raison du modèle est CHIFFRÉE (elle cite la source) ; l'extrait lu et la valeur ne laissent
 * qu'une empreinte keyée, de quoi prouver ce qui a été comparé sans le garder. `en_pile` : ce
 * doute fait partie des cinq du jour mis en tête de la pile de Marc.
 */
export const validationsLia = pgTable(
  "validations_lia",
  {
    id: serial("id").primaryKey(),
    faitId: text("fait_id")
      .notNull()
      .references(() => faits.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: DECISIONS_LIA }).notNull(),
    verdict: text("verdict"),
    signalCode: boolean("signal_code").notNull(),
    raison: text("raison"),
    empreinteSource: text("empreinte_source"),
    empreinteValeur: text("empreinte_valeur").notNull(),
    extracteur: text("extracteur").notNull(),
    /** Le jour de Québec, `AAAA-MM-JJ` : c'est sur lui que se comptent les cinq doutes. */
    jour: text("jour").notNull(),
    enPile: boolean("en_pile").notNull().default(false),
    reluLe: timestamp("relu_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("validations_lia_fait").on(t.faitId), index("validations_lia_jour").on(t.jour, t.enPile)],
);

export const DECISIONS_PAPIER = ["vrai", "doute"] as const;

/**
 * La seconde lecture d'un PAPIER par DriveAI (ADR 0026, migration 0031). Aucune valeur : les NOMS
 * des champs qui divergent (virgules) et une empreinte keyée de chaque lecture. Une par (papier,
 * extracteur). `vrai` sort le papier de la pile sans `avis_pile` (geste de Marc) ; `en_pile` : un des cinq doutes du jour.
 */
export const relecturesPieces = pgTable(
  "relectures_pieces",
  {
    id: serial("id").primaryKey(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: DECISIONS_PAPIER }).notNull(),
    divergents: text("divergents"),
    empreintePremiere: text("empreinte_premiere").notNull(),
    empreinteSeconde: text("empreinte_seconde").notNull(),
    extracteurPremiere: text("extracteur_premiere").notNull(),
    extracteurSeconde: text("extracteur_seconde").notNull(),
    jour: text("jour").notNull(),
    enPile: boolean("en_pile").notNull().default(false),
    reluLe: timestamp("relu_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relectures_pieces_unicite").on(t.pieceId, t.extracteurSeconde),
    index("relectures_pieces_jour").on(t.jour, t.enPile),
    check("relectures_pieces_decision", sql`${t.decision} IN ('vrai', 'doute')`),
  ],
);

/**
 * L'AGENDA DU JOUR que DriveAI envoie (ADR 0029, migration 0032) : un envoi complet par jour,
 * qui remplace le précédent. `agenda_envois` est le point de bascule (une ligne par jour) ;
 * `agenda_evenements` porte les événements de chaque envoi, et seuls ceux de l'envoi courant se
 * lisent. Le titre est CHIFFRÉ au niveau 2 (AAD `agenda|<envoi>|<position>`) ; heures et durées
 * restent en clair. Deux jours gardés au plus : ce n'est pas une mémoire.
 */
export const agendaEnvois = pgTable("agenda_envois", {
  jour: text("jour").primaryKey(),
  envoi: text("envoi").notNull(),
  app: text("app").notNull(),
  nombre: integer("nombre").notNull(),
  luLe: timestamp("lu_le", { withTimezone: true }).notNull(),
  recuLe: timestamp("recu_le", { withTimezone: true }).notNull().defaultNow(),
});

export const agendaEvenements = pgTable(
  "agenda_evenements",
  {
    id: serial("id").primaryKey(),
    envoi: text("envoi").notNull(),
    jour: text("jour").notNull(),
    position: integer("position").notNull(),
    debut: timestamp("debut", { withTimezone: true }).notNull(),
    dureeMin: integer("duree_min").notNull(),
    journeeEntiere: boolean("journee_entiere").notNull().default(false),
    titre: text("titre").notNull(),
  },
  (t) => [
    uniqueIndex("agenda_evenements_unicite").on(t.envoi, t.position),
    index("agenda_evenements_jour").on(t.jour),
    check("agenda_evenements_duree", sql`${t.dureeMin} BETWEEN 0 AND 1440`),
  ],
);

export type Fait = typeof faits.$inferSelect;
export type NouveauFait = typeof faits.$inferInsert;
export type Provenance = typeof provenances.$inferSelect;
export type Perimetre = typeof perimetres.$inferSelect;
export type EntreeJournal = typeof accesJournal.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Lien = typeof liens.$inferSelect;
export type NouveauLien = typeof liens.$inferInsert;
export type Piece = typeof pieces.$inferSelect;
export type NouvellePiece = typeof pieces.$inferInsert;
export type PieceExemplaire = typeof pieceExemplaires.$inferSelect;
