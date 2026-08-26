import cors from 'cors';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
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

export function validateTaskPayload(payload) {
  const { title, status = 'todo' } = payload;
  return Boolean(title?.trim()) && ['todo', 'doing', 'done'].includes(status);
}

app.use(cors());
app.use(express.json());

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (_error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.get('/tasks', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.title, t.description, t.status, t.created_at,
             p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY t.created_at DESC, t.id DESC
    `);
    response.json(result.rows);
  } catch (_error) {
    response.status(500).json({ error: 'Unable to retrieve tasks' });
  }
});

app.post('/tasks', async (request, response) => {
  const { title, description = '', status = 'todo', projectId = null } = request.body;
  if (!validateTaskPayload(request.body)) {
    return response.status(400).json({ error: 'A title and a valid status are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, status, project_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, status, created_at`,
      [title.trim(), description.trim(), status, projectId],
    );
    response.status(201).json(result.rows[0]);
  } catch (_error) {
    response.status(500).json({ error: 'Unable to create task' });
  }
});

app.get('/projects', async (_request, response) => {
  try {
    const result = await pool.query('SELECT id, name, description FROM projects ORDER BY name');
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
