"use client";
// components/ConversationMaison.tsx — le panneau « Parler » (maquette v5, écart A7) : accueil, fil,
// huit suggestions, saisie. Il dessine le fil de l'accueil et n'envoie rien lui-même.
// ⚠️ Texte du modèle = DONNÉE : React l'échappe ; les blocs passent par `rendreBlocs` (lia-ui).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { rendreBlocs } from "@mokarade/lia-ui/blocs";
import { LONGUEUR_MAX_QUESTION, SUGGESTIONS, enAttente, type Tour } from "@/lib/accueil/conversation";
import { IconeEspace } from "./IconeEspace";
import { LogoMemoire } from "./LogoMemoire";

function Blocs({ blocs }: { blocs: readonly unknown[] }) {
  const dans = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dans.current;
    if (!el) return;
    el.replaceChildren();
    rendreBlocs(blocs, el);
  }, [blocs]);
  return <div className="parler-lia" ref={dans} />;
}

export function ConversationMaison({ fil, demander }: { fil: readonly Tour[]; demander: (question: string) => void }) {
  const [saisie, setSaisie] = useState("");
  const journal = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const occupee = enAttente(fil);

  // ⚠️ Pas d'`autoFocus` : au montage, le panneau est encore `visibility: hidden` (il glisse) et le
  // navigateur refuse la mise au point. On la donne une fois le panneau visible.
  useEffect(() => {
    const t = setTimeout(() => champ.current?.focus({ preventScroll: true }), 80);
    return () => clearTimeout(t);
  }, []);

  // Le fil descend tout seul à chaque nouveau message, sans faire défiler la page.
  useEffect(() => {
    const j = journal.current;
    if (j) j.scrollTop = j.scrollHeight;
  }, [fil]);

  const envoyer = (q: string) => {
    if (occupee || !q.trim()) return;
    demander(q);
    setSaisie("");
  };

  return (
    <div className="parler">
      <div className="parler-fil" ref={journal} aria-live="polite">
        {fil.length === 0 ? (
          <div className="parler-bienvenue doux">
            <LogoMemoire />
            <p>Pose-moi une question. Je choisis la forme de ma réponse.</p>
          </div>
        ) : (
          fil.map((t) => (
            <div key={t.id} className="parler-tour">
              <p className="parler-moi">{t.question}</p>
              {t.etat === "attente" ? (
                <p className="doux" role="status">LIA réfléchit…</p>
              ) : (
                <div className="parler-lia">
                  <p className={t.etat === "echec" ? "doux" : undefined}>{t.texte}</p>
                  {t.blocs && t.blocs.length > 0 ? <Blocs blocs={t.blocs} /> : null}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <form
        className="parler-saisie"
        onSubmit={(e) => {
          e.preventDefault();
          envoyer(saisie);
        }}
      >
        <div className="parler-suggestions" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s.libelle} type="button" aria-label={s.question} title={s.question} disabled={occupee} onClick={() => envoyer(s.question)}>
              <IconeEspace nom={s.icone} taille={16} />
              {s.libelle}
            </button>
          ))}
        </div>
        <div className="parler-ligne">
          <input
            ref={champ}
            className="champ"
            type="text"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Parle à LIA"
            maxLength={LONGUEUR_MAX_QUESTION}
            autoComplete="off"
            aria-label="Message à LIA"
          />
          <button type="submit" aria-label="Envoyer" disabled={occupee || !saisie.trim()}>
            <IconeEspace nom="envoyer" taille={18} />
          </button>
        </div>
        <Link href="/chat" className="parler-complet doux">Conversation complète</Link>
      </form>
    </div>
  );
}
