-- 0013 — une question peut porter des OPTIONS, donc se répondre d'un clic (décision de Marc,
-- 17/09 : « une page de questions avec des questions précises que je peux répondre soit en
-- QCM soit en texte alors oui, mais le reste non »).
--
-- ⚠️ Champ ADDITIF et NULLABLE, donc aucune migration de données : une question sans options
-- reste une question à texte libre, et c'est le cas de toutes celles déjà en base. L'absence
-- et le tableau vide ne veulent PAS dire la même chose — `NULL` dit « pas un QCM », `[]`
-- dirait « un QCM sans réponse possible », ce qui ne doit jamais être écrit.
--
-- ⚠️ JSON en texte, comme `predicats_proposes.extracteurs` : le schéma des options est
-- vérifié par Zod au point d'écriture (`lib/questions.ts`), pas par Postgres. Une colonne
-- `jsonb` n'aurait rien validé de plus — elle aurait seulement déplacé la garde là où
-- personne ne la relit.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS options text;--> statement-breakpoint

-- Les questions posées par une RÈGLE, à afficher en premier : ce sont les seules qui portent
-- un choix dont la mémoire a besoin pour cesser de servir une valeur douteuse.
CREATE INDEX IF NOT EXISTS questions_origine_ouvertes
  ON questions (origine) WHERE statut = 'ouverte';--> statement-breakpoint
