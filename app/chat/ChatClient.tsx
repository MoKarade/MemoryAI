"use client";
// app/chat/ChatClient.tsx — la conversation en cours, et l'historique à gauche.
//
// ⚠️ Cet en-tête disait « la conversation vit ICI, dans `sessionStorage`, et nulle part
// ailleurs » (ADR 0001 §5.5). C'est faux depuis l'ADR 0002 : chaque tour est consigné en base,
// chiffré. Et l'écran le répétait à Marc (« rien de cette conversation n'est conservé »). Depuis
// [L2] (ADR 0011), l'historique à gauche rouvre une conversation gardée ; `sessionStorage` ne
// sert plus qu'à survivre à un rechargement de l'onglet. « Épingler » envoie UNE valeur relue
// par Marc, jamais la conversation.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { epinglerAction, historiqueChatAction, ouvrirConversationAction, type ApercuHistorique } from "./actions";
import { CLE_BROUILLON_CHAT } from "@/lib/partage";
import { decouperAnnotation } from "@/lib/chat/liens";
import { messageDeReponse } from "@/lib/chat/messageDeReponse";
import { DEPART_VIDE, departDeSession } from "@/lib/chat/depart";
import { FUSEAU } from "@/lib/fuseau";

interface Message {
  role: "user" | "assistant";
  content: string;
  coutUsd?: number;
  outils?: string[];
}

interface Props {
  modeles: { id: string; nom: string }[];
  modeleDefaut: string;
  n2Possible: boolean;
  n3Possible: boolean;
  plafondUsd: number;
  configure: boolean;
  predicats: { predicat: string; description: string; types: string[] }[];
  /**
   * La question déjà écrite dans le champ, quand on arrive depuis « Demander à Lia
   * là-dessus » ([L33a]). ⚠️ Elle est PRÉREMPLIE, jamais envoyée : arriver sur une page qui
   * a déjà dépensé un appel payant sans qu'on ait cliqué serait un effet de bord d'une
   * NAVIGATION, et le plafond du jour est commun à tout le chat.
   */
  saisieInitiale?: string;
  /** [L2] Les conversations gardées, lues au rendu de la page. `null` = base indisponible. */
  historiqueInitial: ApercuHistorique[] | null;
}

const CLE_SESSION = "memoryai-chat";

/**
 * Trois amorces, écrites une fois. ⚠️ Elles PRÉREMPLISSENT le champ, elles n'envoient rien :
 * un clic sur une suggestion qui partirait seul dépenserait un appel payant sans que Marc ait
 * relu la question (même règle que `saisieInitiale`). Aucune ne contient de donnée perso : ce
 * sont des questions, pas des réponses.
 */
const SUGGESTIONS = ["Quand finit mon bail ?", "Ce que tu sais de moi", "Où est mon passeport ?"] as const;

const sansAbonnement = () => () => {};

function lireStockage(cle: string): string | null {
  try {
    return sessionStorage.getItem(cle);
  } catch {
    return null; // sans sessionStorage, le chat s'ouvre vide
  }
}

/**
 * Le serveur et le premier rendu du navigateur affichent un chat VIDE (c'est ce que le HTML
 * contient) ; une fois l'onglet hydraté, l'écran est remonté UNE fois avec ce que
 * `sessionStorage` a gardé. `useSyncExternalStore` est l'outil de React pour « ceci n'existe
 * que dans le navigateur » : pas d'effet qui rappelle `setState`, pas d'écart d'hydratation.
 */
export function ChatClient(props: Props) {
  const restaurer = useSyncExternalStore(sansAbonnement, () => true, () => false);
  return <ChatClientInterne key={restaurer ? "onglet" : "serveur"} restaurer={restaurer} {...props} />;
}

function ChatClientInterne({
  restaurer,
  modeles,
  modeleDefaut,
  n2Possible,
  n3Possible,
  plafondUsd,
  configure,
  predicats,
  saisieInitiale,
  historiqueInitial,
}: Props & { restaurer: boolean }) {
  const [depart] = useState(() =>
    restaurer
      ? departDeSession(
          lireStockage(CLE_SESSION),
          lireStockage(CLE_BROUILLON_CHAT),
          modeles.map((m) => m.id),
        )
      : DEPART_VIDE,
  );
  const [messages, setMessages] = useState<Message[]>(depart.messages);
  const [modele, setModele] = useState(depart.modele ?? modeleDefaut);
  const [inclureN2, setInclureN2] = useState(false);
  // ⚠️ ADR 0011 : OUVERT PAR DÉFAUT quand l'interrupteur hors produit l'autorise. Ce qui
  // garantit « seulement moi » n'est pas cette case : c'est la route (session revérifiée à
  // chaque tour, app sans invité) et la liste des lecteurs, qui ferme le MCP quoi qu'il demande.
  const [inclureN3, setInclureN3] = useState(n3Possible);
  const [saisie, setSaisie] = useState(saisieInitiale || depart.brouillon || "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [epingle, setEpingle] = useState<{ index: number; predicat: string; valeur: string; message?: string } | null>(null);
  // L'identifiant de la conversation gardée en base (ADR 0002 §5.2). Le serveur la crée au
  // premier tour et rend son identifiant ; on le lui renvoie ensuite pour que les tours
  // suivants s'ajoutent à la MÊME conversation plutôt que d'en ouvrir une par message.
  const [conversationId, setConversationId] = useState<string | null>(depart.conversationId);
  const [historique, setHistorique] = useState<ApercuHistorique[] | null>(historiqueInitial);
  const [avisHistorique, setAvisHistorique] = useState<string | null>(null);
  // Revue #71 : pendant qu'une conversation se rouvre, rien ne part — sinon un envoi ou un
  // second clic mêlerait les messages de l'une à l'identifiant de l'autre.
  const [ouverture, setOuverture] = useState(false);
  const occupe = enCours || ouverture;
  const fin = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLTextAreaElement>(null);
  // Les réglages et l'historique, repliés par défaut : la conversation garde l'écran.
  const [optionsOuvertes, setOptionsOuvertes] = useState(false);

  /**
   * Le brouillon laissé par `/partage` (socle S6). Consommé UNE fois, puis retiré : un
   * partage qui ressurgirait à chaque ouverture du chat serait pire qu'un partage perdu.
   * Il ne s'ENVOIE pas tout seul — c'est Marc qui appuie, sinon la mémoire « agit toute
   * seule », ce que l'ADR 0004 §3 interdit. Il est lu à l'état initial (sans effet de bord,
   * donc sans risque au double rendu) ; le retrait se fait ici, une fois l'écran monté.
   */
  useEffect(() => {
    if (!restaurer) return;
    try {
      sessionStorage.removeItem(CLE_BROUILLON_CHAT);
    } catch {
      /* sans sessionStorage, le chat s'ouvre vide — visible, plutôt que muet */
    }
  }, [restaurer]);

  useEffect(() => {
    // ⚠️ Pas avant la restauration : le premier rendu (celui du serveur) est VIDE, et son
    // effet écraserait la session de l'onglet avant que le second rendu ne la relise.
    if (!restaurer) return;
    try {
      sessionStorage.setItem(CLE_SESSION, JSON.stringify({ messages, modele, conversationId }));
    } catch {
      /* sans sessionStorage, le chat marche quand même, sans mémoire d'onglet */
    }
    fin.current?.scrollIntoView({ block: "end" });
  }, [restaurer, messages, modele, conversationId]);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    const texte = saisie.trim();
    if (!texte || occupe) return;
    const suivants: Message[] = [...messages, { role: "user", content: texte }];
    setMessages(suivants);
    setSaisie("");
    setErreur(null);
    setEnCours(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modele, inclureN2, inclureN3, conversationId, messages: suivants.map((m) => ({ role: m.role, content: m.content })) }),
      });
      // ⚠️ Le TEXTE d'abord : un `r.json()` sur un corps vide levait « Unexpected end of JSON
      // input », et c'est tout ce que Marc voyait d'un crédit épuisé (24/09).
      const brut = await r.text();
      if (!r.ok) {
        setErreur(messageDeReponse(r.status, brut));
        return;
      }
      const corps = JSON.parse(brut) as { reponse?: string; coutUsd?: number; outilsAppeles?: string[]; conversationId?: string };
      if (corps.conversationId) setConversationId(corps.conversationId);
      setMessages([...suivants, { role: "assistant", content: corps.reponse ?? "", coutUsd: corps.coutUsd, outils: corps.outilsAppeles }]);
      void rafraichirHistorique();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setEnCours(false);
    }
  }

  async function rafraichirHistorique() {
    try {
      const r = await historiqueChatAction();
      if (r.ok) setHistorique(r.conversations);
    } catch {
      /* l'historique reste celui d'avant : la conversation, elle, a marché */
    }
  }

  /**
   * ⚠️ [L2] « Effacer » vidait l'écran et GARDAIT l'identifiant : le message suivant
   * s'ajoutait à l'ancienne conversation en base. Une nouvelle conversation remet les deux à
   * zéro, et la case N3 retrouve son défaut.
   */
  function nouvelleConversation() {
    setMessages([]);
    setEpingle(null);
    setConversationId(null);
    setErreur(null);
    setAvisHistorique(null);
    setInclureN3(n3Possible);
    setOptionsOuvertes(false);
  }

  async function ouvrir(id: string) {
    if (occupe || id === conversationId) return;
    setErreur(null);
    setAvisHistorique(null);
    setOuverture(true);
    try {
      const r = await ouvrirConversationAction(id);
      if (!r.ok) {
        setAvisHistorique(r.message ?? "Impossible de rouvrir cette conversation.");
        return;
      }
      setMessages(r.messages.map((m) => ({ role: m.role, content: m.content })));
      setConversationId(id);
      setEpingle(null);
      setOptionsOuvertes(false);
      if (r.tronquee) setAvisHistorique(`Les ${r.tronquee} premiers messages ne sont pas affichés.`);
    } catch (err) {
      setAvisHistorique(err instanceof Error ? `Impossible de rouvrir : ${err.message}` : "Impossible de rouvrir cette conversation.");
    } finally {
      setOuverture(false);
    }
  }

  function choisirSuggestion(texte: string) {
    setSaisie(texte);
    champ.current?.focus();
  }

  async function confirmerEpingle() {
    if (!epingle) return;
    const def = predicats.find((p) => p.predicat === epingle.predicat);
    const r = await epinglerAction({ predicat: epingle.predicat, valeur: epingle.valeur, valeur_type: def?.types[0] ?? "texte" });
    setEpingle({ ...epingle, message: r.message });
  }

  const totalSession = messages.reduce((s, m) => s + (m.coutUsd ?? 0), 0);
  // La définition du prédicat CHOISI, ou rien tant qu'il ne l'est pas : c'est elle qui dit à
  // Marc ce que le champ attend (une date, un texte) au lieu de le lui faire deviner.
  const epingleDef = epingle ? predicats.find((p) => p.predicat === epingle.predicat) : undefined;

  return (
    <main className="chat">
      <div className="chat-outils">
        <button
          type="button"
          className="chat-bascule"
          aria-expanded={optionsOuvertes}
          aria-controls="chat-options"
          onClick={() => setOptionsOuvertes((o) => !o)}
        >
          Options et historique{historique?.length ? ` (${historique.length})` : ""}
        </button>
        <button type="button" className="chat-bascule chat-nouvelle" onClick={nouvelleConversation} disabled={occupe || messages.length === 0}>
          Nouvelle
        </button>
        <div id="chat-options" className="chat-options-corps" hidden={!optionsOuvertes}>
          <div className="chat-reglages">
            <label>
              Modèle{" "}
              <select className="champ" value={modele} onChange={(e) => setModele(e.target.value)} disabled={occupe}>
                {modeles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </label>
            <label title={n2Possible ? "Autorise, pour cette conversation, les faits de niveau 2 (domicile, santé, relations, famille, finances). Journalisé." : "MEMORYAI_N2_CHAT n'est pas posée : le niveau 2 n'est jamais servi."}>
              <input type="checkbox" checked={inclureN2} disabled={!n2Possible || enCours} onChange={(e) => setInclureN2(e.target.checked)} /> Niveau 2 pour cette conversation
            </label>
            <label title={n3Possible ? "Ouvert par défaut : le CONTENU de tes papiers d'identité et d'immigration (niveau 3), numéros compris, pour cette conversation. Jamais servi au connecteur claude.ai. Journalisé." : "MEMORYAI_N3_CHAT n'est pas posée : le contenu des papiers d'identité n'est jamais servi."}>
              <input type="checkbox" checked={inclureN3} disabled={!n3Possible || enCours} onChange={(e) => setInclureN3(e.target.checked)} /> Papiers d’identité (niveau 3)
            </label>
            <p className="hint">
              {totalSession.toFixed(4)} $ US cette conversation · plafond {plafondUsd.toFixed(2)} $/jour
            </p>
          </div>
          <nav aria-label="Conversations gardées" className="chat-historique-liste">
            {historique === null && <p className="hint">Historique indisponible : la base ne répond pas.</p>}
            {historique?.length === 0 && <p className="hint">Aucune conversation gardée pour l’instant.</p>}
            {historique && historique.length > 0 && (
              <ul>
                {historique.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`chat-historique-item${c.id === conversationId ? " actif" : ""}`}
                      aria-current={c.id === conversationId ? "true" : undefined}
                      onClick={() => void ouvrir(c.id)}
                      disabled={occupe}
                    >
                      <span className="chat-historique-titre">{c.titre ?? "(titre illisible)"}</span>
                      <span className="hint">
                        {new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short", timeZone: FUSEAU }).format(new Date(c.quand))}
                        {" · "}
                        {c.nbMessages} message{c.nbMessages > 1 ? "s" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {avisHistorique && <p className="hint">{avisHistorique}</p>}
          </nav>
        </div>
      </div>

      {!configure && <p className="alerte bandeau">ANTHROPIC_API_KEY manquante : le chat est désactivé. Les autres pages marchent.</p>}

      <section className="chat-fil" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <p className="chat-vide">
            Pose une question sur ce que la mémoire sait de toi. La conversation est gardée, chiffrée : tu la retrouves dans l’historique.
          </p>
        )}
        {messages.map((m, i) => (
          <article key={i} className={`bulle ${m.role}`}>
            {/* ⚠️ Le texte de MARC reste du texte : il ne porte pas d'annotation, et le
                segmenter chercherait des liens dans ce qu'il a tapé. Seule la réponse de
                Lia est découpée — par une fonction PURE, jamais par une regex dans le JSX,
                et jamais par `dangerouslySetInnerHTML` : une réponse de modèle contient de
                la donnée de tiers (ADR 0001). */}
            {m.role === "user" ? (
              <p className="bulle-texte">{m.content}</p>
            ) : (
              <p className="bulle-texte">
                {decouperAnnotation(m.content).map((seg, j) =>
                  seg.type === "lien" ? (
                    <a
                      key={j}
                      href={seg.href}
                      className="lien-fait"
                      aria-label={seg.cible === "piece" ? "Voir le papier cité et tout ce qu'il contient" : "Voir le fait cité, sa provenance et sa date"}
                      title={seg.cible === "piece" ? "Voir ce papier et tout ce qu'il contient" : "Voir ce fait, sa provenance et sa date"}
                    >
                      {"→"}
                    </a>
                  ) : seg.type === "document" ? (
                    // ⚠️ Le libellé est un MOT, pas une icône : « où est mon avis de
                    // cotisation » attend un papier, et « papier » le dit sans deviner.
                    <a key={j} href={seg.href} className="lien-doc" target="_blank" rel="noopener noreferrer">
                      papier
                    </a>
                  ) : seg.type === "marque" ? (
                    <span key={j} className="marque-fait">{seg.texte}</span>
                  ) : (
                    <span key={j}>{seg.texte}</span>
                  ),
                )}
              </p>
            )}
            {m.role === "assistant" && (
              <p className="bulle-meta">
                {m.outils?.length ? `outils : ${m.outils.join(", ")} · ` : ""}
                {m.coutUsd !== undefined ? `${m.coutUsd.toFixed(4)} $ US` : ""}
                {" · "}
                <button type="button" className="bouton-texte" onClick={() => setEpingle({ index: i, predicat: "", valeur: "" })}>
                  Épingler
                </button>
              </p>
            )}
            {epingle?.index === i && (
              <div className="epingle">
                {/* ⚠️ RIEN N'EST PRÉ-REMPLI, et c'est un correctif. Jusqu'au 17/09 ce formulaire
                    proposait le PREMIER prédicat du vocabulaire et la RÉPONSE ENTIÈRE du
                    modèle comme valeur. Vu sur une capture de Marc : une réponse sur son bail,
                    prédicat proposé `emploi.employeur`, valeur « Ton bail se termine le 30 juin
                    2028 (validé). Il a débuté le 1er avril 2025, appartement… ». Un clic de
                    trop et la mémoire portait une phrase de 200 caractères sous un prédicat
                    sans rapport, en fiabilité `marc` — la plus haute. Un défaut par
                    PRÉ-REMPLISSAGE est le plus traître : il ne demande aucune erreur, juste de
                    la confiance. */}
                <label>
                  Prédicat{" "}
                  <select className="champ" value={epingle.predicat} onChange={(e) => setEpingle({ ...epingle, predicat: e.target.value })}>
                    <option value="">— choisis ce que cette valeur affirme —</option>
                    {predicats.map((p) => (
                      <option key={p.predicat} value={p.predicat}>
                        {p.predicat} — {p.description}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valeur (≤ 200 caractères, une date AAAA-MM-JJ, ou un identifiant Drive){" "}
                  <input
                    className="champ"
                    type="text"
                    value={epingle.valeur}
                    maxLength={200}
                    placeholder={epingleDef?.types.includes("date") ? "2028-06-30" : "la valeur seule, pas la phrase"}
                    onChange={(e) => setEpingle({ ...epingle, valeur: e.target.value })}
                  />
                </label>
                {epingleDef ? (
                  <p className="hint">
                    {epingleDef.description} · type attendu : {epingleDef.types.join(" ou ")}
                  </p>
                ) : (
                  <p className="hint">
                    Recopie la valeur seule depuis la réponse — une date, un nom, un montant. Pas la phrase autour :
                    c&rsquo;est elle qui sera servie à tes assistants comme un fait sur toi.
                  </p>
                )}
                <div className="ligne">
                  {/* Désactivé tant que le prédicat ou la valeur manquent : le serveur
                      refuserait de toute façon (`predicat_inconnu`), mais un bouton qui part
                      pour échouer apprend à ignorer les refus. */}
                  <button
                    type="button"
                    className="bouton bouton-principal"
                    disabled={!epingle.predicat || !epingle.valeur.trim()}
                    onClick={confirmerEpingle}
                  >
                    Retenir
                  </button>
                  <button type="button" className="bouton bouton-second" onClick={() => setEpingle(null)}>
                    Annuler
                  </button>
                </div>
                {epingle.message && <p className="hint">{epingle.message}</p>}
              </div>
            )}
          </article>
        ))}
        {enCours && <p className="hint chat-attente">Lia cherche…</p>}
        {erreur && <p className="alerte bandeau">{erreur}</p>}
        <div ref={fin} />
      </section>

      <div className="chat-bas">
        {/* Les suggestions ne se montrent que champ vide et rien en cours : tant qu'on écrit ou
            qu'on attend, elles ne servent qu'à encombrer. */}
        {configure && !occupe && !saisie.trim() && (
          <ul className="chat-suggestions" aria-label="Suggestions de questions">
            {SUGGESTIONS.map((q) => (
              <li key={q}>
                <button type="button" className="suggestion" onClick={() => choisirSuggestion(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="chat-saisie" onSubmit={envoyer}>
          <label htmlFor="saisie" className="sr-only">
            Message
          </label>
          <textarea
            ref={champ}
            className="champ"
            id="saisie"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void envoyer(e as unknown as React.FormEvent);
              }
            }}
            rows={1}
            placeholder="Demande-moi n'importe quoi…"
            disabled={!configure || occupe}
          />
          <button type="submit" className="chat-envoyer" aria-label="Envoyer" disabled={!configure || occupe || !saisie.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  );
}
