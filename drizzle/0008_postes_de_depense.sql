-- Le budget LLM se sépare en POSTES (16/09) : le chat et l'apprentissage ne se disputent plus
-- un pot commun. Sans cette colonne, une passe d'extraction automatique pouvait couper le chat
-- de Marc pour la journée, et rien n'aurait dit lequel des deux avait mangé le budget.
--
-- ⚠️ Le défaut `'chat'` sur les lignes EXISTANTES est une approximation assumée : avant
-- aujourd'hui, les extractions lancées au bouton passaient par le même compteur et rien ne
-- permet de les distinguer après coup. L'apprentissage est donc sous-compté sur le passé.
ALTER TABLE "depenses_chat" ADD COLUMN "poste" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE INDEX "depenses_chat_jour_poste" ON "depenses_chat" USING btree ("jour","poste");
