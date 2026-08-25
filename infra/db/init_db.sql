-- =====================================================================
-- DevOps Tasks Board - Schema + donnees de demo
-- Idempotent : peut etre rejoue sans erreur (local, Minikube, Render)
-- =====================================================================

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

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);

-- ---------------------------------------------------------------------
-- Donnees de demo (ON CONFLICT => rejouable)
-- ---------------------------------------------------------------------
INSERT INTO projects (name, description) VALUES
    ('Pipeline CI/CD',      'Mise en place de l''integration et du deploiement continus'),
    ('Securite applicative','Scans SAST/DAST et gestion des secrets'),
    ('Observabilite',       'Logs, metriques et sondes de sante')
ON CONFLICT (name) DO NOTHING;

INSERT INTO tasks (title, description, status, project_id)
SELECT v.title, v.description, v.status, p.id
FROM (VALUES
    ('Ajouter un scan SAST',            'Integrer un job de scan statique dans la CI', 'todo',  'Securite applicative'),
    ('Mettre en place un livenessProbe','Sonde HTTP /health sur le backend',           'doing', 'Observabilite'),
    ('Externaliser les secrets',        'Deplacer les mots de passe dans un Secret K8s','todo',  'Securite applicative'),
    ('Builder les images Docker',       'Job build_docker_images dans le pipeline',    'done',  'Pipeline CI/CD'),
    ('Deployer sur Render',             'Web Service backend + frontend',              'todo',  'Pipeline CI/CD')
) AS v(title, description, status, project_name)
JOIN projects p ON p.name = v.project_name
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.title = v.title);
