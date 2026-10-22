// lib/chat/agent.ts — le chat plein écran : un tour de conversation avec le SDK Anthropic
// (ADR 0001 §5.5), les outils `memoryai_*` en processus, le plafond compté AVANT tout.
//
// CE QUI NE CHANGE PAS QUEL QUE SOIT LE MODÈLE :
//   - les faits n'entrent PAS dans les RÈGLES du prompt système : ils arrivent en résultat
//     d'outil, balisés — le même `OUTILS` que le MCP, même `lecture.ts`, même journal
//     (`lecteur: chat`). ⚠️ Seule exception depuis [L27] : le bloc `<profil>`, que la fonction
//     pure `construireProfil` tire des faits VALIDÉS de niveau 0 et 1, balisé comme donnée et
//     journalisé à chaque tour (`chargerCouches`) ;
//   - chaque appel au modèle est COMPTÉ dès que la réponse arrive, avant de la lire : l'appel
//     est facturé même si elle est inutilisable ;
//   - le budget se vérifie AVANT chaque appel, y compris entre deux tours d'outils : un tour
//     d'outils n'est pas une exception au plafond ;
//   - la bascule N2 est celle de la CONVERSATION (Q11) : l'argument `inclure_n2` du modèle est
//     ÉCRASÉ par elle — un modèle ne s'ouvre pas le niveau 2 tout seul. ⚠️ `inclure_n3` suit
//     exactement la même règle depuis le 19/09/2026, et pour une raison plus forte encore :
//     ce qu'il ouvre est le contenu des papiers d'identité. Un modèle qui pourrait le
//     demander lui-même n'aurait aucune bascule devant lui.
//
// Le client Anthropic est INJECTÉ (interface minimale) : les tests exercent la boucle avec un
// faux modèle, et le vrai n'est construit que dans la route.

import type { DepotAdmin } from "../depotAdmin";
import { budgetOuvert, coutUsd, jourQuebec, lireUsage, type IdModele } from "../coutChat";
import { cleJournalDepuisEnv } from "../journal";
import { journaliserAcces } from "../journalAcces";
import { OUTILS, type ContexteOutils } from "../mcp/outils";
import { annoterReponse, type Annotation, type FaitServi, type PieceServie } from "./liens";
import { construirePrompt, REGLES_SYSTEME, type Couches } from "./prompt";

export const MAX_TOURS_OUTILS = 6;
export const MAX_MESSAGES = 40;
export const MAX_TOKENS_SORTIE = 1500;

/**
 * Les RÈGLES du prompt système : QUI parle et COMMENT, jamais un fait (`lib/chat/prompt.ts`).
 * Gardé sous ce nom pour les tests qui lisent ce que le dépôt écrit ; ce que le modèle reçoit
 * vraiment est `construirePrompt(couches)` : ces règles, puis la voix et le profil de Marc.
 */
export const PROMPT_SYSTEME = REGLES_SYSTEME;

export interface MessageChat {
  role: "user" | "assistant";
  content: string;
}

/** Ce que la boucle attend d'un client : le sous-ensemble de `messages.create` qu'elle emploie. */
export interface ClientModele {
  create(params: {
    model: string;
    max_tokens: number;
    system: string;
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
    messages: unknown[];
  }): Promise<ReponseModele>;
}

export interface ReponseModele {
  content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[];
  stop_reason: string | null;
  usage?: unknown;
}

export interface ResultatTour {
  reponse: string;
  coutUsd: number;
  appels: number;
  outilsAppeles: string[];
  /**
   * [L25] Ce que le post-traitement a fait de la réponse. PUBLIÉ, jamais silencieux : si
   * le modèle invente des références ou n'emploie aucune valeur servie, ça se LIT ici au
   * lieu de se deviner. C'est aussi ce qui rend la mesure du lot possible (« 0/20
   * affirmations sans lien ni marque ») sans relire les réponses à la main.
   */
  annotation: Annotation;
  /** Le plafond a-t-il coupé le tour ? */
  plafondAtteint: boolean;
}

/**
 * ⚠⚠ LE PLAFOND EST UN ARGUMENT du message, pas une constante lue au vol. Depuis [L34] Marc
 * le règle dans l'app : un message qui citerait la valeur par défaut dirait « sur 1 $ » à
 * quelqu'un qui en a mis cinq. Un texte affiché est une affirmation, et celle-ci sert à
 * décider s'il faut relever le plafond — donc elle doit citer CELUI qui a coupé.
 */
export class PlafondAtteintError extends Error {
  constructor(
    public depenseUsd: number,
    public plafondUsd: number,
  ) {
    super(`Plafond du chat atteint : ${depenseUsd.toFixed(2)} $ sur ${plafondUsd} $ aujourd'hui.`);
    this.name = "PlafondAtteintError";
  }
}

export async function tourDeChat(params: {
  client: ClientModele;
  modele: IdModele;
  messages: MessageChat[];
  inclureN2: boolean;
  inclureN3: boolean;
  outils: ContexteOutils;
  admin: DepotAdmin;
  /**
   * [L27] La voix et le profil de Marc, déjà balisés (`chargerCouches`). Absents, Lia n'a que
   * ses règles : c'est le comportement d'avant, et celui des tests qui n'y touchent pas. La
   * route, elle, les passe toujours.
   */
  couches?: Couches;
  /**
   * Les SEULS outils offerts au modèle (ADR 0016). Absent, tous : c'est le chat de Marc. Une
   * liste blanche, et tenue aux DEUX bouts : l'outil absent n'est pas décrit au modèle, et un
   * appel qui le nommerait quand même reçoit « Outil inconnu » au lieu d'être exécuté.
   */
  outilsPermis?: ReadonlySet<string>;
}): Promise<ResultatTour> {
  const { client, modele, inclureN2, inclureN3, outils, admin, outilsPermis } = params;
  const offerts = outilsPermis ? OUTILS.filter((o) => outilsPermis.has(o.name)) : OUTILS;
  const systeme = construirePrompt(params.couches);
  const historique = params.messages.slice(-MAX_MESSAGES);
  if (historique.length === 0 || historique[historique.length - 1]!.role !== "user") {
    throw new Error("Le dernier message doit venir de Marc.");
  }
  const jour = jourQuebec(outils.maintenant());
  const tools = offerts.map((o) => ({ name: o.name, description: o.description, input_schema: o.inputSchema as Record<string, unknown> }));
  const conversation: unknown[] = historique.map((m) => ({ role: m.role, content: m.content }));
  // ⚠️ Les faits servis s'ACCUMULENT sur tout le tour, pas sur le dernier appel d'outil.
  // Un tour agentique en fait jusqu'à 6 : ne garder que le dernier laisserait sans lien
  // tout ce que le modèle a appris au deuxième appel et cité au sixième.
  const servis = new Map<string, FaitServi>();
  // Les PAPIERS servis s'accumulent pareil : un passeport trouvé au deuxième appel et cité à la
  // fin doit rester une source, pas devenir « (non sourcé) ».
  const piecesServies = new Map<string, PieceServie>();
  const resultat: ResultatTour = {
    reponse: "",
    coutUsd: 0,
    appels: 0,
    outilsAppeles: [],
    plafondAtteint: false,
    annotation: annoterReponse("", []),
  };

  for (let tour = 0; tour <= MAX_TOURS_OUTILS; tour++) {
    // Le budget se lit en base à CHAQUE appel : deux onglets ne se partagent pas un compteur en mémoire.
    // Le poste `chat` et rien d'autre : une passe d'apprentissage ne doit pas fermer le chat.
    const depense = await admin.depenseDuJourUsd(jour, "chat");
    // Le plafond se lit à chaque tour, comme la dépense : Marc peut le baisser pendant qu'un
    // import tourne, et une boucle qui l'aurait lu une seule fois continuerait sur l'ancien.
    const plafondsEffectifs = await admin.plafonds();
    if (!budgetOuvert(depense, "chat", plafondsEffectifs))
      throw new PlafondAtteintError(depense, plafondsEffectifs.chat);

    const reponse = await client.create({ model: modele, max_tokens: MAX_TOKENS_SORTIE, system: systeme, tools, messages: conversation });

    // COMPTÉ AVANT D'ÊTRE LU.
    const { usage } = lireUsage(reponse.usage);
    const cout = coutUsd(modele, usage);
    await admin.enregistrerDepense({ jour, poste: "chat", modele, ...usage, coutUsd: cout });
    resultat.coutUsd += cout;
    resultat.appels++;

    const textes = reponse.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text);
    const appels = reponse.content.filter((b): b is Extract<ReponseModele["content"][number], { type: "tool_use" }> => b.type === "tool_use");

    if (appels.length === 0 || reponse.stop_reason !== "tool_use" || tour === MAX_TOURS_OUTILS) {
      const brut = textes.join("\n").trim() || (appels.length ? "Je n'ai pas pu terminer : trop d'allers-retours avec la mémoire." : "");
      // [L25] LE point qui décide. La garantie vit ici parce que c'est le seul endroit
      // par lequel TOUTE réponse passe — une garde se pose au point qui décide.
      resultat.annotation = annoterReponse(brut, [...servis.values()], [...piecesServies.values()]);
      resultat.reponse = resultat.annotation.texte;
      return resultat;
    }

    conversation.push({ role: "assistant", content: reponse.content });
    const retours = [];
    for (const appel of appels) {
      const outil = offerts.find((o) => o.name === appel.name);
      let texte: string;
      let erreur = false;
      if (!outil) {
        texte = `Outil inconnu : ${appel.name}`;
        erreur = true;
      } else {
        try {
          // La bascule de la CONVERSATION écrase ce que le modèle demande.
          const args = { ...appel.input, inclure_n2: inclureN2, inclure_n3: inclureN3 };
          const r = await outil.executer(args, outils);
          await journaliserAcces(
            outils.lecture,
            cleJournalDepuisEnv(outils.env),
            {
              lecteur: outils.lecteur,
              outil: outil.name,
              usage: r.usage,
              niveauMaxServi: r.niveauMaxServi,
              idsFaits: r.faitsServis.map((f) => f.id),
              idsPieces: r.piecesServies?.map((x) => x.id) ?? [],
              questionEmpreinte: r.questionEmpreinte,
            },
            outils.maintenant,
          );
          texte = r.texte;
          // Indexé par `id` : deux outils qui servent le même fait ne le comptent pas deux
          // fois, et le dernier vu gagne (même valeur, même statut — la lecture est pure).
          for (const f of r.faitsServis) servis.set(f.id, f);
          for (const x of r.piecesServies ?? []) piecesServies.set(x.id, x);
          resultat.outilsAppeles.push(outil.name);
        } catch (err) {
          texte = `Impossible de répondre : ${err instanceof Error ? err.message : "erreur"}`;
          erreur = true;
        }
      }
      retours.push({ type: "tool_result", tool_use_id: appel.id, content: texte, ...(erreur ? { is_error: true } : {}) });
    }
    conversation.push({ role: "user", content: retours });
  }
  return resultat;
}
