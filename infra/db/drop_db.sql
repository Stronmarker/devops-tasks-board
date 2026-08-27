-- =====================================================================
-- DESTRUCTION COMPLETE - supprime les tables, pas seulement les donnees.
-- ---------------------------------------------------------------------
-- Apres ce script la base est vide : plus aucune table, donc plus de
-- schema. L'application ne peut plus demarrer tant que init_db.sql n'a
-- pas ete rejoue (make db-bootstrap).
--
-- A ne pas confondre avec reset_db.sql, qui vide les tables en les
-- laissant en place.
--
-- CASCADE supprime aussi les contraintes qui pointent vers ces tables.
-- L'ordre importe peu grace a lui, mais on va du plus dependant au moins
-- dependant pour que le script reste lisible.
-- =====================================================================
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS tasks          CASCADE;
DROP TABLE IF EXISTS projects       CASCADE;
DROP TABLE IF EXISTS users          CASCADE;
DROP TABLE IF EXISTS teams          CASCADE;
