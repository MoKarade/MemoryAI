import type { Metadata, Viewport } from "next";
// Outfit, police commune du hub, auto-hébergée via @fontsource : aucune requête externe.
import "@fontsource-variable/outfit";
import "./globals.css";
import { LiaMaison } from "@/components/LiaMaison";
import { ServiceWorker } from "@/components/ServiceWorker";
import { liaAutorisee } from "@/lib/lia/monter";

export const metadata: Metadata = {
  title: "MemoryAI",
  description: "La mémoire de l'écosystème hub perso — une base de faits typés sur Marc.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MemoryAI", statusBarStyle: "black-translucent" },
};

/**
 * ⚠️ `themeColor` vit ICI et pas dans le CSS : c'est la couleur de la barre système de
 * l'app installée. Elle doit valoir `--bg-systeme` de `globals.css` (tests/couleurs.test.ts),
 * sinon le lancement fait un flash d'une autre couleur, et personne ne relit un manifeste
 * (leçon JobAI). `viewportFit: "cover"` va avec les marges de sécurité d'Android, sans quoi le
 * bas de page passe sous la barre de gestes.
 */
export const viewport: Viewport = {
  // Sombre seul (Marc, 22/10/2026) : une seule teinte, celle du fond.
  themeColor: "#07090d",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // LIA vit chez elle sur toutes les pages connectées (ADR 0017) ; jamais sur /login.
  const lia = await liaAutorisee();
  return (
    <html lang="fr-CA">
      <body>
        {children}
        {lia ? <LiaMaison /> : null}
        <ServiceWorker />
      </body>
    </html>
  );
}
