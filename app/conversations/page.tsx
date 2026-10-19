// app/conversations/page.tsx — ce que la mémoire garde de vos échanges (ADR 0002 §5.2).
//
// Elle dit COMBIEN, de QUAND, ce que ça PÈSE, et combien de fragments le scan de secrets a
// retirés. Elle ne montre AUCUN contenu : la liste sert à décider quoi oublier, pas à relire.
//
// ⚠️ LA MESURE EST LE POINT DE CETTE PAGE. Marc a tranché « aucune purge automatique » (ADR
// 0002 §4, question B) sur une base qui plafonne à 0,5 Go. La décision de rétention se
// prendra sur un chiffre réel — celui-ci — et jamais sur une estimation.

import { Nav } from "@/components/Nav";
import { depotConversationsDrizzle, PLAFOND_NEON_OCTETS } from "@/lib/conversations/depot";
import { FUSEAU } from "@/lib/fuseau";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { oublierConversationAction } from "./actions";
import { extraireAction } from "./extraireAction";

export const dynamic = "force-dynamic";
const LIMITE = 50;

const SOURCES: Record<string, string> = {
  memoryai: "le chat de MemoryAI",
  "claude-ai": "claude.ai",
  "claude-code": "Claude Code",
};

function octets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function quand(d: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: FUSEAU }).format(d);
}

export default async function ConversationsPage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="conversations" />
        <main className="page">
          <h1>Conversations</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const depot = depotConversationsDrizzle(acces.db);
  const [liste, mesure] = await Promise.all([depot.liste(LIMITE), depot.mesure()]);

  return (
    <>
      <Nav active="conversations" />
      <main className="page">
        <h1>Conversations</h1>
        <p className="lead">
          {mesure.nombre === 0
            ? "Rien de gardé pour l'instant. Le chat de MemoryAI consigne ses échanges ; claude.ai et Claude Code suivront."
            : `${mesure.nombre} conversation(s), ${mesure.messages} message(s), ${octets(mesure.octets)} de texte. Le contenu est chiffré et n'est servi à aucune app.`}
        </p>

        {mesure.alerte && (
          <p className="alerte bandeau">
            La base approche son plafond : {octets(mesure.octets)} sur {octets(PLAFOND_NEON_OCTETS)} (
            {Math.round(mesure.partDuPlafond * 100)} %). Rien n&apos;est purgé automatiquement — c&apos;est à toi de décider ce
            que tu gardes.
          </p>
        )}

        {mesure.secretsRetires > 0 && (
          <p className="hint">
            {mesure.secretsRetires} fragment(s) masqué(s) par le scan de secrets avant chiffrement. C&apos;est une
            heuristique : elle attrape les formes connues, elle ne garantit rien.
          </p>
        )}

        <p className="hint">
          « En tirer des faits » relit la conversation et PROPOSE ce qu&apos;elle contient de durable : les faits
          atterrissent dans « à valider », jamais directement dans la mémoire. C&apos;est un appel payant, sous le
          même plafond que le chat.
        </p>

        <section className="liste-faits" aria-label="Conversations">
          {liste.map((c) => (
            <article key={c.id} className="carte tuile">
              <h2>{quand(c.debutLe)}</h2>
              <p className="hint">
                {SOURCES[c.source] ?? c.source} · {c.nbMessages} message(s) · {octets(c.octets)} · dernier échange{" "}
                {quand(c.finLe)}
                {c.secretsRetires > 0 ? ` · ${c.secretsRetires} fragment(s) masqué(s)` : ""}
                {c.extraiteJusqua !== null ? ` · ${c.extraiteJusqua} message(s) déjà lus pour en tirer des faits` : ""}
              </p>
              <div className="actions-fait">
                {c.nbMessages > (c.extraiteJusqua ?? 0) && (
                  <form action={extraireAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="bouton bouton-principal">
                      {c.extraiteJusqua === null ? "En tirer des faits" : "Extraire la suite"}
                    </button>
                  </form>
                )}
                <form action={oublierConversationAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="bouton-texte">
                    Oublier
                  </button>
                </form>
              </div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
