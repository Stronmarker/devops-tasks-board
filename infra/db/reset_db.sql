-- =====================================================================
-- ATTENTION - Ce script SUPPRIME toutes les donnees.
-- ---------------------------------------------------------------------
-- Il vide les tables sans les supprimer : le schema reste en place, seul
-- le contenu part. Rejouer init_db.sql ensuite remet les donnees de demo.
--
-- TRUNCATE plutot que DELETE : l'operation est immediate et ne laisse pas
-- de lignes mortes a nettoyer.
--   RESTART IDENTITY -> les compteurs d'id repartent a 1
--   CASCADE          -> les tables liees par cle etrangere suivent
--
-- Ne jamais lancer sur une base de production sans sauvegarde prealable.
-- =====================================================================
TRUNCATE TABLE refresh_tokens, tasks, projects, users, teams
    RESTART IDENTITY CASCADE;
