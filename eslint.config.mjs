// Flat config natif : eslint-config-next 16 exporte ses configurations au format flat
// (`eslint-config-next/core-web-vitals`, `/typescript`) — plus de FlatCompat ni de
// @eslint/eslintrc, qui ne sait pas relire la config 16. Inclut les règles du React Compiler
// (eslint-plugin-react-hooks 7). eslint reste en 9 : eslint-plugin-react, embarqué ici, plante
// sur eslint 10. Même fichier qu'app-template.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  // `next lint` ignorait ces dossiers implicitement ; l'ESLint CLI, non. Sans cette
  // liste, `eslint .` scanne node_modules et .next et rend des milliers de faux positifs.
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
