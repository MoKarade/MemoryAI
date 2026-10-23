"use client";
// components/SauvetageEnDirect.tsx — lancer le sauvetage et le suivre jusqu'au bout (ADR 0019 §6, étape 4).
//
// Une passe est bornée dans le temps (une fonction Vercel a une durée maximale) : ce bouton les
// enchaîne, en passant à chacune l'endroit où la précédente s'est arrêtée, jusqu'au bout du
// balayage. Fermer la page arrête l'enchaînement ; rien n'est abîmé, chaque ligne est atomique.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { passeSauvetageAction } from "@/app/regler/sauvetage/actions";
import type { Reprise } from "@/lib/sauvetage/sauvetage";

interface Totaux {
  passes: number;
  sauves: number;
  echecs: number;
}

const MESSAGES_ARRET: Record<string, string> = {
  "acces-refuse":
    "L’ancien déploiement refuse l’accès : la session ou le secret de contournement n’est pas accepté. Rien n’a été écrit pour les lignes restantes.",
  "oracle-en-panne":
    "L’ancien déploiement ne répond plus (plusieurs pannes de suite). Ce qui est sauvé l’est ; relance plus tard.",
  "pas-ouvert": "Il n’y a rien à sauver dans cette base.",
  clos: "Le sauvetage est clos.",
};

export function SauvetageEnDirect() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [totaux, setTotaux] = useState<Totaux | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function lancer() {
    setEnCours(true);
    setMessage(null);
    let reprise: Reprise | null = null;
    let cumul: Totaux = { passes: 0, sauves: 0, echecs: 0 };
    setTotaux(cumul);
    try {
      for (;;) {
        const issue = await passeSauvetageAction(reprise);
        if (!issue.ok) {
          setMessage(
            issue.raison === "acces"
              ? `Il manque des réglages : ${(issue.manque ?? []).join(", ")}. Rien n’a été écrit.`
              : (MESSAGES_ARRET[issue.raison] ?? issue.raison),
          );
          break;
        }
        const r = issue.resultat;
        cumul = {
          passes: cumul.passes + 1,
          sauves: cumul.sauves + r.sauves.faits + r.sauves.pieces,
          echecs: cumul.echecs + r.echecs.faits + r.echecs.pieces,
        };
        setTotaux(cumul);
        if (r.arret) {
          setMessage(MESSAGES_ARRET[r.arret] ?? r.arret);
          break;
        }
        if (r.termine) {
          setMessage("Balayage terminé. Les lignes en échec se retentent en relançant.");
          break;
        }
        reprise = r.reprise;
      }
    } catch {
      // L'action a levé (coupure réseau, fonction tuée) : ce qui est écrit l'est ligne par ligne,
      // la relance reprend où la base en est.
      setMessage("La passe a été interrompue. Ce qui est sauvé l’est ; relance pour continuer.");
    } finally {
      setEnCours(false);
      router.refresh();
    }
  }

  return (
    <div className="sauvetage-direct">
      <button type="button" className="bouton bouton-principal" onClick={lancer} disabled={enCours}>
        {enCours ? "Sauvetage en cours…" : "Lancer le sauvetage"}
      </button>
      {totaux && (
        <p className="hint" aria-live="polite">
          {totaux.passes} passe(s) · {totaux.sauves} ligne(s) sauvée(s) · {totaux.echecs} échec(s)
        </p>
      )}
      {message && <p className="alerte bandeau">{message}</p>}
    </div>
  );
}
