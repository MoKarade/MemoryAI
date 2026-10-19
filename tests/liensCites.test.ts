// tests/liensCites.test.ts — [L25] « forcément des liens à chaque fois », prouvé.
//
// Marc, le 17/09 : « je veux une quasi certitude sur ce qu'elle dit sur moi avec forcément des
// liens à chaque fois ». Ce fichier existe pour que « forcément » veuille dire quelque chose.
//
// ⚠️ CE QUE CES CAS NE FONT PAS : vérifier que le PROMPT demande une citation. Un prompt
// respecté 95 % du temps ne donne pas une quasi-certitude, et un test qui lit le prompt
// certifierait la demande, pas le résultat. Ils vérifient donc ce que `annoterReponse` FAIT
// d'une réponse — y compris d'une réponse qui n'a rien cité du tout, qui est le cas que le
// post-traitement existe pour rattraper.
//
// La frontière entre ce qui est GARANTI et ce qui est DEMANDÉ est nette, et tenue ici :
//   - garanti par le code : le lien ajouté, la référence inventée retirée, « (à confirmer) » ;
//   - demandé au modèle : « (déduit) » sur une affirmation qui n'emploie aucune valeur servie.
// Le second n'est pas testable autrement qu'en mesurant les 10 questions du socle — c'est la
// mesure du lot, pas une garde.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { annoterReponse, decouperAnnotation, REGLES_CITATION, type FaitServi } from "../lib/chat/liens";
import { PROMPT_SYSTEME, tourDeChat, type ClientModele, type ReponseModele } from "../lib/chat/agent";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLot } from "../lib/ecrireFaits";
import { baliserFait } from "../lib/mcp/balisage";
import type { ContexteOutils } from "../lib/mcp/outils";
import type { Ecrivain } from "../lib/jetons";
import { BON } from "./fixtures/faits";

// Des identifiants de la BONNE FORME : le motif de citation exige 36 caractères hexadécimaux
// et tirets. Un id bidon court passerait le `replace` sans être reconnu, et le cas ne
// mesurerait plus rien.
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const INCONNU = "99999999-9999-4999-8999-999999999999";

const fait = (id: string, etiquette: string, statut = "valide", lien: string | null = null): FaitServi => ({
  id,
  etiquette,
  statut,
  lien,
});

describe("[L25] le lien est AJOUTÉ quand le modèle l'a oublié", () => {
  it("une valeur servie sans lien en reçoit un", () => {
    // LE cas pour lequel ce module existe : le modèle a bien employé la donnée et n'a pas cité.
    const a = annoterReponse("Tu habites à Québec.", [fait(ID1, "Québec")]);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
    expect(a.liensAjoutes).toBe(1);
    expect(a.texte).toMatch(/Québec \[→/);
  });

  it("MUTATION — un lien déjà posé par le modèle n'est PAS doublé", () => {
    // Sans ce cas, `annoterReponse` empilerait les liens à chaque passage et la fonction ne
    // serait pas sûre à rejouer.
    const deja = `Tu habites à Québec [→/fait/${ID1}].`;
    const a = annoterReponse(deja, [fait(ID1, "Québec")]);
    expect(a.texte).toBe(deja);
    expect(a.liensAjoutes).toBe(0);
    expect(a.liensDejaPresents).toBe(1);
  });

  it("CONTRÔLE NÉGATIF — sans aucun fait servi, le texte n'est pas touché", () => {
    // Sinon « le module relie » serait indiscernable de « le module réécrit tout ».
    const t = "Je ne sais pas où tu habites.";
    const a = annoterReponse(t, []);
    expect(a.texte).toBe(t);
    expect(a.liensAjoutes).toBe(0);
  });
});

describe("[L25] une référence INVENTÉE est retirée et signalée", () => {
  it("MUTATION — retirer la passe 1 laisse une fausse source dans la réponse", () => {
    // Le cas le plus grave : le modèle fabrique une source. On ne le corrige pas en silence.
    const a = annoterReponse(`Tu as un chat [→/fait/${INCONNU}].`, [fait(ID1, "Québec")]);
    expect(a.texte).not.toContain(INCONNU);
    expect(a.texte).toContain("(non sourcé)");
    expect(a.refsInconnus).toBe(1);
  });

  it("L'ORDRE DES PASSES est le correctif : une valeur suivie d'un faux ref reçoit le VRAI", () => {
    // ⚠️ Si la passe 2 tournait d'abord, la valeur serait vue « déjà reliée » — par une
    // référence fausse — et garderait sa mauvaise source. C'est pour ça que les inventées
    // sont neutralisées AVANT.
    const a = annoterReponse(`Tu habites à Québec [→/fait/${INCONNU}].`, [fait(ID1, "Québec")]);
    expect(a.refsInconnus).toBe(1);
    expect(a.liensAjoutes).toBe(1);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
    expect(a.texte).toContain("(non sourcé)");
    expect(a.texte).not.toContain(INCONNU);
  });
});

describe("[BACKLOG, revue #72] une citation en MAJUSCULES n'est ni validée ni retirée en silence", () => {
  // Des id avec de VRAIES lettres hexadécimales (a-f) : ID1/ID2/ID3 ne contiennent que des
  // chiffres, `.toUpperCase()` n'y changerait rien et le cas ne mesurerait plus rien.
  const ID_HEX = "aabbccdd-1234-4abc-8def-abcdefabcdef";
  const INCONNU_HEX = "facefeed-9999-4abc-8def-abcdefabcdef";

  it("un id RÉEL cité en majuscules est reconnu (l'UUID que le modèle écrit n'a pas de casse)", () => {
    const a = annoterReponse(`Tu habites à Québec [→/fait/${ID_HEX.toUpperCase()}].`, [fait(ID_HEX, "Québec")]);
    expect(a.texte).toContain(`[→/fait/${ID_HEX}]`);
    expect(a.texte).not.toContain(ID_HEX.toUpperCase());
    expect(a.liensDejaPresents).toBe(1);
    expect(a.refsInconnus).toBe(0);
  });

  it("un id INCONNU cité en majuscules est retiré, pas laissé tel quel", () => {
    // Avant le correctif : ni reconnu (pas de lien) NI signalé — un texte qui ressemble à
    // une citation sans en être une, invisible au contrôle des sources inventées.
    const a = annoterReponse(`Tu as un chat [→/fait/${INCONNU_HEX.toUpperCase()}].`, [fait(ID_HEX, "Québec")]);
    expect(a.texte).not.toContain(INCONNU_HEX.toUpperCase());
    expect(a.texte).toContain("(non sourcé)");
    expect(a.refsInconnus).toBe(1);
  });

  it("un PAPIER cité en majuscules est reconnu au même titre qu'un fait", () => {
    const a = annoterReponse(`Ton passeport [→/pieces/${ID_HEX.toUpperCase()}].`, [], [{ id: ID_HEX, lien: null, forme: "complete" }]);
    expect(a.texte).toContain(`[→/pieces/${ID_HEX}]`);
    expect(a.liensDejaPresents).toBe(1);
    expect(a.refsInconnus).toBe(0);
  });
});

describe("[L25] un fait `propose` se DIT — décision de Marc du 17/09, contre ma reco", () => {
  it("MUTATION — retirer la marque rend un fait non validé indiscernable d'un fait validé", () => {
    // ADR 0005 §9 : Marc a choisi de SERVIR les `propose`, marqués. La marque EST la garde.
    const a = annoterReponse("Tu aimes les musées.", [fait(ID1, "les musées", "propose")]);
    expect(a.texte).toContain("(à confirmer)");
    expect(a.marquesAConfirmer).toBe(1);
  });

  it("CONTRÔLE NÉGATIF — un fait `valide` ne porte PAS la marque", () => {
    // Sans lui, une marque posée partout ne distinguerait plus rien — un avertissement
    // permanent est un avertissement mort.
    const a = annoterReponse("Tu aimes les musées.", [fait(ID1, "les musées", "valide")]);
    expect(a.texte).not.toContain("(à confirmer)");
    expect(a.marquesAConfirmer).toBe(0);
  });
});

describe("[L25] une valeur AMBIGUË reçoit TOUS ses liens (ADR §7, risque n° 1)", () => {
  it("MUTATION — n'en garder qu'un affirmerait un choix que rien ne soutient", () => {
    // Deux faits portent « Québec » : la ville de résidence et une ancienne ville. Choisir
    // arbitrairement serait une affirmation sans source ; la fiche dira lesquels.
    const a = annoterReponse("Tu habites à Québec.", [fait(ID1, "Québec"), fait(ID2, "Québec")]);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
    expect(a.texte).toContain(`[→/fait/${ID2}]`);
    expect(a.liensAjoutes).toBe(2);
  });

  it("l'ambiguïté survit au mélange des statuts : chacun garde SA marque", () => {
    const a = annoterReponse("Tu habites à Québec.", [fait(ID1, "Québec", "valide"), fait(ID2, "Québec", "propose")]);
    expect(a.marquesAConfirmer).toBe(1);
    // Le validé n'hérite pas de la marque du proposé.
    const avantMarque = a.texte.slice(0, a.texte.indexOf("(à confirmer)"));
    expect(avantMarque).toContain(`[→/fait/${ID2}]`);
  });
});

describe("[L25] les limites de l'appariement, tenues plutôt que cachées", () => {
  it("MUTATION — abaisser LONGUEUR_MIN_APPARIEMENT relierait de la prose au hasard", () => {
    // Une valeur de trois caractères apparaît par accident. Un lien FAUX est pire qu'un lien
    // absent : il donne à une phrase l'autorité d'une source qui ne dit pas ça.
    const a = annoterReponse("Oui, je crois que oui.", [fait(ID1, "oui")]);
    expect(a.liensAjoutes).toBe(0);
    expect(a.texte).not.toContain("[→");
  });

  it("MUTATION — retirer les bornes Unicode relierait « Québec » dans « Québecois »", () => {
    // ⚠️ `\b` de JavaScript est ASCII : un motif écrit avec `\b` ne borne PAS un mot accentué.
    // Les bornes sont donc des classes Unicode explicites, et ce cas le prouve.
    const a = annoterReponse("Un Québecois typique.", [fait(ID1, "Québec")]);
    expect(a.liensAjoutes).toBe(0);
  });

  it("MUTATION — retirer le tri par longueur casse la valeur la plus LONGUE", () => {
    // « Québec » est contenu dans « America/Toronto (heure du Québec) ». Sans le tri, la
    // courte se relierait d'abord et couperait la longue en deux morceaux qui ne
    // s'apparient plus — la valeur la plus informative perdrait son lien.
    const longue = "America/Toronto (heure du Québec)";
    const a = annoterReponse(`Ton fuseau est America/Toronto (heure du Québec).`, [
      fait(ID1, longue),
      fait(ID2, "Québec"),
    ]);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
    // La longue est reliée ENTIÈRE : le lien vient après la parenthèse fermante.
    expect(a.texte).toContain(`(heure du Québec) [→/fait/${ID1}]`);
  });

  it("une valeur servie ABSENTE de la réponse est comptée, pas inventée", () => {
    // Le module ne fabrique rien : ce qui n'est pas employé est publié comme non employé.
    const a = annoterReponse("Je ne sais pas.", [fait(ID1, "Québec"), fait(ID2, "Marque")]);
    expect(a.valeursNonEmployees).toBe(2);
    expect(a.liensAjoutes).toBe(0);
  });

  it("une réponse VIDE compte toutes les valeurs comme non employées", () => {
    const a = annoterReponse("", [fait(ID1, "Québec")]);
    expect(a.texte).toBe("");
    expect(a.valeursNonEmployees).toBe(1);
  });
});

describe("[L25] la couche RÈGLES est FIXE et le balisage porte une cible", () => {
  it("MUTATION — retirer REGLES_CITATION du prompt rend le post-traitement solitaire", () => {
    // Le code rattrape ce que le modèle oublie ; encore faut-il le lui demander, sinon il ne
    // cite JAMAIS et tout repose sur l'appariement textuel — donc rien sur une déduction.
    expect(PROMPT_SYSTEME).toContain("[→/fait/<id>]");
    expect(PROMPT_SYSTEME).toContain("(déduit)");
    for (const ligne of REGLES_CITATION.split("\n")) {
      expect(PROMPT_SYSTEME).toContain(ligne);
    }
  });

  it("MUTATION — retirer `ref` du balisage laisse le modèle sans rien à citer", () => {
    // Avant [L25], le balisage portait l'`id` mais aucune ADRESSE : « donne le lien Drive
    // quand il existe » ne couvrait que les papiers, donc un fait ORDINAIRE n'avait pas de
    // cible. C'est la moitié du défaut que Marc décrivait par « forcément des liens ».
    const balise = baliserFait({
      id: ID3,
      predicat: "logement.ville",
      domaine: "logement",
      description: "",
      valeur: "Québec",
      valeurType: "texte",
      lien: null,
      attributs: null,
      niveau: 1,
      statut: "valide",
      fiabiliteSource: "app",
      confiance: 1,
      valideDe: null,
      valideA: null,
      creeLe: "2026-09-18T00:00:00Z",
      provenance: null,
    });
    expect(balise).toContain(`ref="/fait/${ID3}"`);
    // Et la valeur reste ÉCHAPPÉE : `ref` ne doit pas avoir ouvert une porte de sortie.
    expect(balise).toContain(">Québec</fait>");
  });
});


describe("[L25c] les DOCUMENTS — le cas que Marc a signalé le 18/09", () => {
  // ⚠⚠ « j'ai pas les liens pour les documents ». Mesuré sur sa base : un fait
  // `type="ref_document"` a pour VALEUR un fileId opaque que le modèle n'écrit jamais, et
  // son libellé humain dans `attributs.type`. L'appariement par valeur ne POUVAIT pas tirer
  // — et les documents sont la majorité de sa donnée (2 729 papiers).
  const DRIVE = "https://drive.google.com/file/d/1FICTIFexemple0000000000000000000/view";
  const FAUX = "https://drive.google.com/file/d/1inventeParLeModele00000000000000/view";

  it("MUTATION — apparier sur `valeur` au lieu de l'étiquette ne relie AUCUN document", () => {
    // Le modèle écrit le libellé, pas le fileId. C'est LE cas de ce lot.
    const a = annoterReponse("Ton Avis de cotisation 2024 est dans Drive.", [
      fait(ID1, "Avis de cotisation", "valide", DRIVE),
    ]);
    expect(a.liensAjoutes).toBe(1);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
  });

  it("MUTATION — retirer le marqueur de document laisse Marc à un clic du papier", () => {
    // Les DEUX affordances : la fiche dit ce que la mémoire sait, le lien ouvre le papier.
    // « Où est mon avis de cotisation » attend le second.
    const a = annoterReponse("Ton Avis de cotisation est là.", [
      fait(ID1, "Avis de cotisation", "valide", DRIVE),
    ]);
    expect(a.texte).toContain(`[↗${DRIVE}]`);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
  });

  it("CONTRÔLE NÉGATIF — un fait SANS document ne reçoit que sa fiche", () => {
    // Sans lui, « le marqueur de papier est posé » serait indiscernable de « il est posé
    // partout » — et un lien mort vaut moins que pas de lien du tout.
    const a = annoterReponse("Tu habites à Québec.", [fait(ID1, "Québec")]);
    expect(a.texte).toContain(`[→/fait/${ID1}]`);
    expect(a.texte).not.toContain("[↗");
  });

  it("MUTATION — un lien Drive INVENTÉ est retiré comme un id inventé", () => {
    // Plus dangereux qu'un id fabriqué : un lien a l'air cliquable et vérifiable.
    const a = annoterReponse(`Vois [↗${FAUX}].`, [fait(ID1, "Québec", "valide", DRIVE)]);
    expect(a.texte).not.toContain(FAUX);
    expect(a.texte).toContain("(non sourcé)");
    expect(a.refsInconnus).toBe(1);
  });

  it("un lien Drive RÉELLEMENT servi et déjà cité par le modèle est GARDÉ", () => {
    // Le contrôle inverse du précédent : sans lui, « les liens inventés sont retirés »
    // serait satisfait par « tous les liens sont retirés ».
    const a = annoterReponse(`Vois [↗${DRIVE}].`, [fait(ID1, "Québec", "valide", DRIVE)]);
    expect(a.texte).toContain(DRIVE);
    expect(a.refsInconnus).toBe(0);
    expect(a.liensDejaPresents).toBe(1);
  });

  it("le découpage rend un segment `document` distinct du segment `lien`", () => {
    const segments = decouperAnnotation(`Avis [→/fait/${ID1}] [↗${DRIVE}].`);
    expect(segments.some((x) => x.type === "lien")).toBe(true);
    expect(segments.find((x) => x.type === "document")).toEqual({ type: "document", href: DRIVE });
  });
});

describe("[L25] le RENDU : découper sans rien perdre", () => {
  it("INVARIANT — recoller les segments redonne le texte, caractère pour caractère", () => {
    // LA garde qui compte. Un découpage qui perd un morceau de phrase est invisible à l'œil
    // sur une réponse longue, et il mangerait du texte que Marc doit lire. L'invariant est
    // insensible aux ajouts de marques futures, contrairement à un compte de segments.
    const t = `Tu habites à Québec [→/fait/${ID1}] (à confirmer) et tu roules en Marque [→/fait/${ID2}]. Le reste est (déduit).`;
    const segments = decouperAnnotation(t);
    const recolle = segments
      .map((x) => (x.type === "lien" ? `[→${x.href}]` : x.type === "document" ? `[↗${x.href}]` : x.texte))
      .join("");
    expect(recolle).toBe(t);
  });

  it("un lien devient un segment `lien` qui porte son href ET son id", () => {
    const segments = decouperAnnotation(`Québec [→/fait/${ID1}].`);
    const lien = segments.find((x) => x.type === "lien");
    expect(lien).toEqual({ type: "lien", href: `/fait/${ID1}`, id: ID1, cible: "fait" });
  });

  it("les TROIS marques sont reconnues — celles du code et celle du modèle", () => {
    // « à confirmer » et « non sourcé » sont posées par le post-traitement ; « déduit » est
    // demandée au modèle. Les trois doivent être STYLÉES pareil : ce sont toutes des
    // réserves sur ce que la phrase vaut, et une réserve qui ne se voit pas ne sert à rien.
    for (const marque of ["(à confirmer)", "(non sourcé)", "(déduit)"]) {
      const segments = decouperAnnotation(`Une phrase ${marque}.`);
      expect(segments.some((x) => x.type === "marque" && x.texte === marque), marque).toBe(true);
    }
  });

  it("CONTRÔLE NÉGATIF — un texte sans annotation rend UN seul segment de texte", () => {
    // Sans lui, « le découpage marche » serait indiscernable d'un découpage qui émiette tout.
    const segments = decouperAnnotation("Bonjour Marc, je ne sais pas.");
    expect(segments).toEqual([{ type: "texte", texte: "Bonjour Marc, je ne sais pas." }]);
  });

  it("un id de MAUVAISE forme n'est pas pris pour un lien", () => {
    // Le motif exige 36 caractères : un `[→/fait/abc]` écrit par un modèle reste du TEXTE,
    // il ne devient pas un lien mort cliquable.
    const segments = decouperAnnotation("Vois [→/fait/abc].");
    expect(segments.every((x) => x.type === "texte")).toBe(true);
  });
});

// ── La garde qui TRAVERSE : du tour de chat jusqu'à la réponse rendue ──────────────────────
//
// ⚠️ Les cas ci-dessus prouvent que le module fait son travail ; ils ne prouvent PAS qu'il est
// BRANCHÉ. Un trou entre deux moitiés testées n'appartient à personne — leçon du dépôt. Ceux
// qui suivent partent d'un faux modèle et lisent ce que `tourDeChat` REND.

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const MAINTENANT = new Date("2026-09-18T15:00:00Z");

function outils(): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef" },
    lecteur: "chat",
    maintenant: () => MAINTENANT,
  };
}

function faux(reponses: ReponseModele[]) {
  const client: ClientModele = {
    async create() {
      const r = reponses.shift();
      if (!r) throw new Error("le faux modèle n'a plus de réponse");
      return r;
    },
  };
  return { client };
}
const usage = { input_tokens: 1000, output_tokens: 100 };
const texte = (t: string): ReponseModele => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
const appelOutil = (name: string, input: Record<string, unknown>): ReponseModele => ({
  content: [{ type: "tool_use", id: "t1", name, input }],
  stop_reason: "tool_use",
  usage,
});

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
  const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };
  // ⚠️ UN FAIT-DOCUMENT, parce que c'est le cas de Marc et qu'aucune garde ne le couvrait.
  // Sa VALEUR est un fileId opaque ; son libellé humain vit dans `attributs.type`.
  await ecrireLot(
    [
      BON,
      {
        ...BON,
        predicat: "fiscal.avis",
        valeur: "1FICTIFexemple0000000000000000000",
        valeur_type: "ref_document" as const,
        attributs: { type: "Avis de cotisation", annee: "2024" },
        provenance: { ...BON.provenance, source_ref: "drive|avis2024" },
      },
    ],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
});
afterAll(async () => pg?.close());

describe("[L25] TRAVERSE — la réponse RENDUE par tourDeChat porte ses liens", () => {
  it("MUTATION — ne pas annoter à la sortie rend la réponse brute du modèle", async () => {
    // Le modèle cherche, reçoit « Entreprise Exemple », et répond SANS citer — le cas nominal
    // que le post-traitement existe pour rattraper.
    const { client } = faux([
      appelOutil("memoryai_chercher", { question: "employeur" }),
      texte("Tu travailles à la Entreprise Exemple."),
    ]);
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "où je travaille ?" }],
      inclureN2: false, inclureN3: false,
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    // Un lien, ajouté par le CODE, vers la fiche du fait réellement servi.
    expect(r.reponse).toMatch(/Entreprise Exemple \[→\/fait\/[0-9a-f-]{36}\]/);
    expect(r.annotation.liensAjoutes).toBe(1);
    // `BON` entre en `propose` (seul le couple mécanique `moteur-inventaire-v1` ×
    // `document.existe` s'auto-valide, ADR 0003) : la marque doit donc être là.
    expect(r.reponse).toContain("(à confirmer)");
  });

  it("TRAVERSE [L25c] — un DOCUMENT est relié par son libellé, et son papier est atteignable", async () => {
    // ⚠⚠ CETTE GARDE EXISTE PARCE QUE LA PERTURBATION N'AVAIT RIEN ROUGI. Les cas purs
    // ci-dessus appellent `annoterReponse` avec un `FaitServi` fabriqué à la main : ils
    // testent le module et JAMAIS le code qui CONSTRUIT l'étiquette depuis
    // `attributs.type`. Remettre `etiquette: f.valeur` dans `lib/mcp/outils.ts` laissait
    // les 30 cas verts — mesuré — alors que c'est exactement le défaut que Marc a signalé.
    // Un trou entre deux moitiés testées n'appartient à personne.
    const { client } = faux([
      appelOutil("memoryai_chercher", { question: "avis de cotisation" }),
      texte("Ton Avis de cotisation 2024 est dans Drive."),
    ]);
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "où est mon avis de cotisation ?" }],
      inclureN2: false, inclureN3: false,
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    // La FICHE — ce que la mémoire sait.
    expect(r.reponse).toMatch(/Avis de cotisation[^[]*\[→\/fait\/[0-9a-f-]{36}\]/);
    // LE PAPIER — ce que Marc a demandé. Le fileId n'apparaît jamais dans la réponse : c'est
    // bien le libellé qui a servi à l'appariement.
    expect(r.reponse).toContain("drive.google.com/file/d/1FICTIFexemple0000000000000000000/view");
    expect(r.annotation.liensAjoutes).toBeGreaterThanOrEqual(1);
  });

  it("ANTI-VACUITÉ — sans appel d'outil, il n'y a rien à relier et rien n'est ajouté", async () => {
    // Sans ce cas, « la réponse porte un lien » pourrait venir d'un lien posé à tort partout.
    const { client } = faux([texte("Bonjour Marc.")]);
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "salut" }],
      inclureN2: false, inclureN3: false,
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    expect(r.reponse).toBe("Bonjour Marc.");
    expect(r.annotation.liensAjoutes).toBe(0);
    expect(r.annotation.refsInconnus).toBe(0);
  });

  it("une référence inventée par le modèle est retirée AVANT d'atteindre Marc", async () => {
    const { client } = faux([
      appelOutil("memoryai_chercher", { question: "employeur" }),
      texte(`Tu as un chien [→/fait/${INCONNU}].`),
    ]);
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "un animal ?" }],
      inclureN2: false, inclureN3: false,
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    expect(r.reponse).not.toContain(INCONNU);
    expect(r.reponse).toContain("(non sourcé)");
    expect(r.annotation.refsInconnus).toBe(1);
  });
});
