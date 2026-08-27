-- =====================================================================
-- DevOps Tasks Board - Schema + donnees de demo
-- Idempotent : peut etre rejoue sans erreur (local, Kubernetes, Render).
-- Il sert aussi de script de migration : les bases deja en production
-- (Render) sont mises a niveau par les ALTER ... IF NOT EXISTS ci-dessous.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Equipes et comptes
-- ---------------------------------------------------------------------
-- Une equipe est un espace de travail ferme. On n'y entre qu'avec son code
-- a 6 chiffres, remis par le chef d'equipe.
CREATE TABLE IF NOT EXISTS teams (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    join_code  CHAR(6)      NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT teams_join_code_check CHECK (join_code ~ '^[0-9]{6}$')
);

-- password_hash contient un hash bcrypt, jamais le mot de passe. La colonne
-- est volontairement nommee ainsi pour qu'une relecture du schema suffise a
-- verifier qu'aucun mot de passe n'est stocke en clair.
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(180) NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    display_name  VARCHAR(120) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'member',
    team_id       INTEGER      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_check CHECK (role IN ('lead', 'member'))
);

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);

-- ---------------------------------------------------------------------
-- Projets et taches
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    status      VARCHAR(20)  NOT NULL DEFAULT 'todo',
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'doing', 'done'))
);

-- Migration : colonnes ajoutees avec l'authentification par equipe.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS color      VARCHAR(7) NOT NULL DEFAULT '#6366F1';

-- La couleur est une decoration : elle vient en plus du statut, jamais a sa
-- place. Le format est contraint pour qu'une valeur arbitraire ne puisse pas
-- etre injectee dans le style du frontend.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_color_check') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_team_id    ON tasks(team_id);

-- ---------------------------------------------------------------------
-- Donnees de demo (rejouables)
-- ---------------------------------------------------------------------
-- Equipe de demonstration. Son code est publie dans le README : il permet au
-- correcteur d'ouvrir le tableau sans creer de compte. Un vrai deploiement
-- ferait tourner ce code des la premiere connexion.
INSERT INTO teams (name, join_code) VALUES ('DevOps Delivery Lab', '482913')
ON CONFLICT (join_code) DO NOTHING;

-- Comptes de demonstration. Mots de passe documentes dans le README :
--   chef@tasks.local   -> Demo1234!
--   membre@tasks.local -> Membre1234!
-- Ce sont des comptes de demo assumes, jamais un modele pour la production.
INSERT INTO users (email, password_hash, display_name, role, team_id)
SELECT v.email, v.password_hash, v.display_name, v.role, t.id
FROM (VALUES
    ('chef@tasks.local',   '$2b$12$Zq5WmM/W35kvmF8KIRAODOwSEm2CILji0e.vm4cVJKZ7jW5yIdCAi', 'Chef d''equipe', 'lead'),
    ('membre@tasks.local', '$2b$12$L0am2Fg8JkZ0vQehafSJw.cirRi3cXJnLnpUpWC9XNkecm16EBJSC', 'Membre',         'member')
) AS v(email, password_hash, display_name, role)
JOIN teams t ON t.join_code = '482913'
ON CONFLICT (email) DO NOTHING;

INSERT INTO projects (name, description, team_id)
SELECT v.name, v.description, t.id
FROM (VALUES
    ('Pipeline CI/CD',      'Mise en place de l''integration et du deploiement continus'),
    ('Securite applicative','Scans SAST/DAST et gestion des secrets'),
    ('Observabilite',       'Logs, metriques et sondes de sante')
) AS v(name, description)
JOIN teams t ON t.join_code = '482913'
ON CONFLICT (name) DO NOTHING;

INSERT INTO tasks (title, description, status, color, project_id, team_id, created_by)
SELECT v.title, v.description, v.status, v.color, p.id, t.id, u.id
FROM (VALUES
    ('Ajouter un scan SAST',            'Integrer un job de scan statique dans la CI',   'todo',  '#F97316', 'Securite applicative'),
    ('Mettre en place un livenessProbe','Sonde HTTP /health sur le backend',             'doing', '#0EA5E9', 'Observabilite'),
    ('Externaliser les secrets',        'Deplacer les mots de passe dans un Secret K8s', 'todo',  '#EF4444', 'Securite applicative'),
    ('Builder les images Docker',       'Job build_docker_images dans le pipeline',      'done',  '#22C55E', 'Pipeline CI/CD'),
    ('Deployer sur Render',             'Web Service backend + frontend',                'todo',  '#6366F1', 'Pipeline CI/CD')
) AS v(title, description, status, color, project_name)
JOIN projects p ON p.name = v.project_name
JOIN teams    t ON t.join_code = '482913'
JOIN users    u ON u.email = 'chef@tasks.local'
WHERE NOT EXISTS (SELECT 1 FROM tasks x WHERE x.title = v.title);

-- Rattachement des lignes anterieures a l'authentification, qui n'avaient pas
-- d'equipe. Sans cela elles resteraient invisibles pour tout le monde.
UPDATE projects SET team_id = (SELECT id FROM teams WHERE join_code = '482913') WHERE team_id IS NULL;
UPDATE tasks    SET team_id = (SELECT id FROM teams WHERE join_code = '482913') WHERE team_id IS NULL;

-- Une fois les donnees rattachees, l'appartenance a une equipe devient
-- obligatoire : plus aucune tache ne peut exister hors d'un espace de travail.
ALTER TABLE tasks    ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN team_id SET NOT NULL;
