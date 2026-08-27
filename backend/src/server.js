import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import {
  collectFieldErrors,
  generateJoinCode,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshExpiryDate,
  requireAuth,
  requireLead,
  signAccessToken,
  verifyPassword,
} from './auth.js';

const { Pool } = pg;
export const app = express();
const port = Number(process.env.PORT || 3000);
const connectionString = process.env.DATABASE_URL;

// Render impose TLS sur les connexions PostgreSQL externes ; en local (Docker,
// Kubernetes) la base est sur un reseau prive et n'en a pas besoin. On active
// donc le SSL uniquement si l'URL le reclame, ou via DATABASE_SSL=true.
// rejectUnauthorized: false -> Render presente un certificat auto-signe.
const useSsl =
  process.env.DATABASE_SSL === 'true' || /[?&]sslmode=require/.test(connectionString ?? '');

export const pool = new Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const TASK_STATUSES = ['todo', 'doing', 'done'];

// Palette proposee par l'interface. Elle sert de reference aux tests et fournit
// la couleur par defaut ; la validation, elle, accepte tout code hexadecimal
// valide, ce qui evite de casser les taches deja enregistrees quand la palette
// evolue.
export const TASK_COLORS = [
  '#EC4899', // rose
  '#0EA5E9', // bleu
  '#22C55E', // vert
  '#EAB308', // jaune
  '#F97316', // orange
  '#EF4444', // rouge
  '#A855F7', // violet
  '#92400E', // marron
];

export function validateTaskPayload(payload) {
  const { title, status = 'todo', color = TASK_COLORS[0] } = payload;
  return (
    Boolean(title?.trim()) &&
    TASK_STATUSES.includes(status) &&
    typeof color === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(color)
  );
}

// Render place l'application derriere un proxy : sans cette ligne, toutes les
// requetes semblent venir de la meme adresse et la limitation de debit
// bloquerait tout le monde d'un coup.
app.set('trust proxy', 1);

// helmet pose les en-tetes de securite HTTP (nosniff, frameguard, HSTS...).
// L'API ne sert que du JSON : la CSP par defaut, pensee pour des pages HTML,
// est desactivee car elle n'a rien a proteger ici.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Le code d'equipe ne compte qu'un million de combinaisons : sans limitation,
// un script les epuise en quelques minutes. Cette limite est la contre-mesure
// principale, avec la rotation du code par le chef d'equipe.
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Reessayez dans quelques minutes." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Reessayez dans quelques minutes.' },
});

// Le rafraichissement est appele automatiquement toutes les quinze minutes par
// chaque onglet ouvert : sa limite doit etre plus large que celle des routes de
// connexion, sinon un usage normal la declencherait.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de rafraichissements. Reessayez dans quelques minutes.' },
});

// Un identifiant d'URL est une chaine : sans cette verification, un appel a
// /tasks/abc partirait en base et provoquerait une erreur SQL plutot qu'un 404.
const readId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  teamId: row.team_id,
});

// Emet la paire de jetons et enregistre l'empreinte du refresh. Le client
// (pool ou connexion de transaction) est passe en parametre pour que la
// creation d'une equipe reste atomique.
async function issueSession(client, user) {
  const refreshToken = generateRefreshToken();

  await client.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, hashRefreshToken(refreshToken), refreshExpiryDate()],
  );

  return { accessToken: signAccessToken(user), refreshToken };
}

// ---------------------------------------------------------------------------
// Sante
// ---------------------------------------------------------------------------
app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (_error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

// Creation d'une equipe : le compte cree devient chef et recoit le code
// d'invitation. C'est la seule route qui fabrique un code.
app.post('/auth/teams', authLimiter, async (request, response) => {
  const { teamName, displayName, email, password } = request.body ?? {};

  const fields = collectFieldErrors(request.body ?? {}, { withTeamName: true });
  if (Object.keys(fields).length > 0) {
    // Le premier message sert de resume ; l'objet complet permet au formulaire
    // de signaler chaque champ fautif a sa place.
    return response.status(400).json({ error: Object.values(fields)[0], fields });
  }

  const client = await pool.connect();
  try {
    // Transaction : une equipe sans chef, ou un chef sans equipe, laisserait la
    // base dans un etat inutilisable. Les deux naissent ensemble ou pas du tout.
    await client.query('BEGIN');

    const team = await client.query(
      'INSERT INTO teams (name, join_code) VALUES ($1, $2) RETURNING id, name, join_code',
      [teamName.trim(), generateJoinCode()],
    );

    const user = await client.query(
      `INSERT INTO users (email, password_hash, display_name, role, team_id)
       VALUES ($1, $2, $3, 'lead', $4)
       RETURNING id, email, display_name, role, team_id`,
      [email.trim().toLowerCase(), await hashPassword(password), displayName.trim(), team.rows[0].id],
    );

    const session = await issueSession(client, user.rows[0]);
    await client.query('COMMIT');

    response.status(201).json({
      ...session,
      user: publicUser(user.rows[0]),
      team: { name: team.rows[0].name, joinCode: team.rows[0].join_code },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return response.status(409).json({ error: 'Cet email est deja utilise' });
    }
    response.status(500).json({ error: "Creation de l'equipe impossible" });
  } finally {
    client.release();
  }
});

// Rejoindre une equipe existante avec son code a 6 chiffres.
app.post('/auth/join', joinLimiter, async (request, response) => {
  const { code, displayName, email, password } = request.body ?? {};

  const fields = collectFieldErrors(request.body ?? {}, { withCode: true });
  if (Object.keys(fields).length > 0) {
    return response.status(400).json({ error: Object.values(fields)[0], fields });
  }

  try {
    const team = await pool.query('SELECT id FROM teams WHERE join_code = $1', [code.trim()]);

    if (team.rowCount === 0) {
      return response.status(404).json({ error: "Code d'equipe inconnu" });
    }

    const user = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role, team_id)
       VALUES ($1, $2, $3, 'member', $4)
       RETURNING id, email, display_name, role, team_id`,
      [email.trim().toLowerCase(), await hashPassword(password), displayName.trim(), team.rows[0].id],
    );

    const session = await issueSession(pool, user.rows[0]);
    response.status(201).json({ ...session, user: publicUser(user.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'Cet email est deja utilise' });
    }
    response.status(500).json({ error: 'Adhesion impossible' });
  }
});

app.post('/auth/login', authLimiter, async (request, response) => {
  const { email, password } = request.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return response.status(400).json({ error: 'Email et mot de passe requis' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, display_name, role, team_id FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    const user = result.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;

    // Meme reponse que l'email existe ou non : distinguer les deux cas
    // permettrait d'enumerer les comptes de l'application.
    if (!valid) {
      return response.status(401).json({ error: 'Identifiants invalides' });
    }

    const session = await issueSession(pool, user);
    response.json({ ...session, user: publicUser(user) });
  } catch (_error) {
    response.status(500).json({ error: 'Connexion impossible' });
  }
});

// Echange un jeton de rafraichissement contre une nouvelle paire. C'est la
// seule route qui prolonge une session.
app.post('/auth/refresh', refreshLimiter, async (request, response) => {
  const { refreshToken } = request.body ?? {};

  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return response.status(400).json({ error: 'Jeton de rafraichissement requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stored = await client.query(
      `SELECT r.id, r.user_id, r.revoked_at, r.expires_at,
              u.id AS uid, u.email, u.display_name, u.role, u.team_id
       FROM refresh_tokens r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1
       FOR UPDATE`,
      [hashRefreshToken(refreshToken)],
    );

    const row = stored.rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return response.status(401).json({ error: 'Session expiree' });
    }

    // Un jeton deja consomme qui revient signifie qu'une copie circule : soit
    // elle a ete volee, soit c'est l'original qui revient apres le vol. On ne
    // peut pas distinguer les deux, donc on coupe toute la session de
    // l'utilisateur et on le force a se reconnecter.
    if (row.revoked_at) {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [row.user_id],
      );
      await client.query('COMMIT');
      return response.status(401).json({ error: 'Session compromise, reconnexion requise' });
    }

    if (new Date(row.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return response.status(401).json({ error: 'Session expiree' });
    }

    // Rotation : le jeton presente est consomme et remplace. Un jeton ne sert
    // donc jamais deux fois, ce qui rend la reutilisation detectable ci-dessus.
    await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [row.id]);

    const user = {
      id: row.uid,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      team_id: row.team_id,
    };
    const session = await issueSession(client, user);

    await client.query('COMMIT');
    response.json({ ...session, user: publicUser({ ...user, id: row.uid }) });
  } catch (_error) {
    await client.query('ROLLBACK');
    response.status(500).json({ error: 'Rafraichissement impossible' });
  } finally {
    client.release();
  }
});

// Deconnexion : on supprime le jeton de rafraichissement cote serveur. Le jeton
// d'acces reste techniquement valide jusqu'a son expiration, mais il ne peut
// plus etre renouvele - d'ou sa duree de quinze minutes.
app.post('/auth/logout', async (request, response) => {
  const { refreshToken } = request.body ?? {};

  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return response.status(400).json({ error: 'Jeton de rafraichissement requis' });
  }

  try {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hashRefreshToken(refreshToken)],
    );
    // Toujours 204, que le jeton ait existe ou non : une reponse differente
    // permettrait de tester la validite d'un jeton vole.
    response.status(204).end();
  } catch (_error) {
    response.status(500).json({ error: 'Deconnexion impossible' });
  }
});

// Permet au frontend de verifier au chargement qu'un jeton stocke est toujours
// valide, et de recuperer l'identite sans la faire transiter par le navigateur.
app.get('/auth/me', requireAuth, async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.team_id, t.name AS team_name
       FROM users u JOIN teams t ON t.id = u.team_id
       WHERE u.id = $1`,
      [request.user.id],
    );

    if (result.rowCount === 0) {
      return response.status(401).json({ error: 'Compte introuvable' });
    }

    response.json({ user: publicUser(result.rows[0]), team: { name: result.rows[0].team_name } });
  } catch (_error) {
    response.status(500).json({ error: 'Lecture du profil impossible' });
  }
});

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------
app.get('/team', requireAuth, async (request, response) => {
  try {
    const team = await pool.query('SELECT id, name, join_code FROM teams WHERE id = $1', [
      request.user.teamId,
    ]);

    if (team.rowCount === 0) {
      return response.status(404).json({ error: 'Equipe introuvable' });
    }

    const members = await pool.query(
      'SELECT id, display_name, role, created_at FROM users WHERE team_id = $1 ORDER BY created_at',
      [request.user.teamId],
    );

    response.json({
      name: team.rows[0].name,
      // Le code n'est renvoye qu'au chef. Un membre qui inspecte les reponses
      // reseau de l'application ne doit pas pouvoir le recuperer.
      joinCode: request.user.role === 'lead' ? team.rows[0].join_code : null,
      members: members.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        role: row.role,
        joinedAt: row.created_at,
      })),
    });
  } catch (_error) {
    response.status(500).json({ error: "Lecture de l'equipe impossible" });
  }
});

// Rotation du code : la reponse a un depart de membre ou a un code diffuse par
// erreur. Les comptes deja crees restent valides, seul l'ancien code cesse
// d'ouvrir la porte.
app.post('/team/code', requireAuth, requireLead, async (request, response) => {
  try {
    const result = await pool.query(
      'UPDATE teams SET join_code = $1 WHERE id = $2 RETURNING join_code',
      [generateJoinCode(), request.user.teamId],
    );
    response.json({ joinCode: result.rows[0].join_code });
  } catch (_error) {
    response.status(500).json({ error: 'Rotation du code impossible' });
  }
});

// Retirer un membre de l'equipe. La suppression du compte emporte ses jetons de
// rafraichissement (ON DELETE CASCADE) : la personne ne peut plus prolonger sa
// session et perd l'acces des l'expiration de son jeton d'acces, soit au plus
// quinze minutes. Ses taches restent au tableau, elles appartiennent a l'equipe.
app.delete('/team/members/:id', requireAuth, requireLead, async (request, response) => {
  const id = readId(request.params.id);

  if (!id) {
    return response.status(400).json({ error: 'Identifiant de membre invalide' });
  }

  // Un chef qui se retire laisserait une equipe sans personne pour gerer le
  // code d'invitation ni les membres.
  if (id === request.user.id) {
    return response.status(400).json({ error: 'Vous ne pouvez pas vous retirer de votre equipe' });
  }

  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 AND team_id = $2', [
      id,
      request.user.teamId,
    ]);

    if (result.rowCount === 0) {
      return response.status(404).json({ error: 'Membre introuvable' });
    }

    response.status(204).end();
  } catch (_error) {
    response.status(500).json({ error: 'Retrait impossible' });
  }
});

// ---------------------------------------------------------------------------
// Taches et projets - cloisonnes par equipe
// ---------------------------------------------------------------------------
app.get('/tasks', requireAuth, async (request, response) => {
  try {
    // Le filtre sur team_id vient du jeton, jamais d'un parametre de requete :
    // un utilisateur ne peut pas demander les taches d'une autre equipe.
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.color, t.created_at,
              p.name AS project_name, u.display_name AS created_by_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users    u ON u.id = t.created_by
       WHERE t.team_id = $1
       ORDER BY t.created_at DESC, t.id DESC`,
      [request.user.teamId],
    );
    response.json(result.rows);
  } catch (_error) {
    response.status(500).json({ error: 'Unable to retrieve tasks' });
  }
});

app.post('/tasks', requireAuth, async (request, response) => {
  const {
    title,
    description = '',
    status = 'todo',
    projectId = null,
    color = TASK_COLORS[0],
  } = request.body ?? {};

  if (!validateTaskPayload(request.body ?? {})) {
    return response.status(400).json({ error: 'A title, a valid status and a valid color are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, status, color, project_id, team_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, status, color, created_at`,
      [
        title.trim(),
        description.trim(),
        status,
        color.toUpperCase(),
        projectId,
        request.user.teamId,
        request.user.id,
      ],
    );
    response.status(201).json(result.rows[0]);
  } catch (_error) {
    response.status(500).json({ error: 'Unable to create task' });
  }
});

// Deplacer une tache d'une colonne a l'autre. Reserve au chef d'equipe :
// l'avancement du tableau est une decision de pilotage, pas une action
// individuelle.
app.patch('/tasks/:id', requireAuth, requireLead, async (request, response) => {
  const id = readId(request.params.id);
  const { status } = request.body ?? {};

  if (!id) {
    return response.status(400).json({ error: 'Identifiant de tache invalide' });
  }

  if (!TASK_STATUSES.includes(status)) {
    return response.status(400).json({ error: 'Statut invalide' });
  }

  try {
    // La clause team_id est ce qui empeche un chef de modifier la tache d'une
    // autre equipe en devinant son identifiant.
    const result = await pool.query(
      `UPDATE tasks SET status = $1
       WHERE id = $2 AND team_id = $3
       RETURNING id, title, description, status, color, created_at`,
      [status, id, request.user.teamId],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ error: 'Tache introuvable' });
    }

    response.json(result.rows[0]);
  } catch (_error) {
    response.status(500).json({ error: 'Deplacement impossible' });
  }
});

app.delete('/tasks/:id', requireAuth, requireLead, async (request, response) => {
  const id = readId(request.params.id);

  if (!id) {
    return response.status(400).json({ error: 'Identifiant de tache invalide' });
  }

  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 AND team_id = $2', [
      id,
      request.user.teamId,
    ]);

    if (result.rowCount === 0) {
      return response.status(404).json({ error: 'Tache introuvable' });
    }

    response.status(204).end();
  } catch (_error) {
    response.status(500).json({ error: 'Suppression impossible' });
  }
});

app.get('/projects', requireAuth, async (request, response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description FROM projects WHERE team_id = $1 ORDER BY name',
      [request.user.teamId],
    );
    response.json(result.rows);
  } catch (_error) {
    response.status(500).json({ error: 'Unable to retrieve projects' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}
