import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "MemoryAI",
  description: "La mémoire de l'écosystème hub perso — une base de faits typés sur Marc.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MemoryAI", statusBarStyle: "black-translucent" },
};

/**
 * ⚠️ `themeColor` vit ICI et pas dans le CSS : c'est la couleur de la barre système de
 * l'app installée. Une valeur claire oubliée y fait un flash blanc au démarrage, et personne
 * ne relit un manifeste (leçon JobAI). `viewportFit: "cover"` va avec les marges de sécurité
 * d'Android, sans quoi le bas de page passe sous la barre de gestes.
 */
export const viewport: Viewport = {
  // ⚠️ DEUX valeurs, une par thème : l'app suit `prefers-color-scheme` et ne l'impose pas
  // (règle de produit du dépôt). Une seule couleur ici donnerait une barre système à contre-
  // emploi à la moitié des lancements, et ça ne se voit qu'une fois l'app installée.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#10141c" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CA">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
