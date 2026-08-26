import test from 'node:test';
import assert from 'node:assert/strict';
import { app, pool } from './server.js';

// Tests d'integration : ils demarrent le serveur HTTP sur un port ephemere et
// tapent sur une vraie base PostgreSQL. Ils verifient donc la chaine complete
// (route -> requete SQL -> reponse JSON), la ou server.test.js ne teste que la
// validation en memoire.
//
// Sans base joignable (developpement local hors Docker), la suite est ignoree
// explicitement plutot que de faire echouer la CI pour une raison hors sujet.
// Dans le pipeline, un service PostgreSQL est demarre : elle s'execute toujours.

const databaseReachable = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);

const skip = databaseReachable
  ? false
  : 'PostgreSQL injoignable : lancer `make start` ou definir DATABASE_URL';

let server;
let baseUrl;

test.before(async () => {
  if (!databaseReachable) return;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /health confirme que la base repond', { skip }, async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

test('GET /tasks renvoie une liste de taches exploitable', { skip }, async () => {
  const response = await fetch(`${baseUrl}/tasks`);
  assert.equal(response.status, 200);

  const tasks = await response.json();
  assert.ok(Array.isArray(tasks));
  for (const task of tasks) {
    assert.equal(typeof task.title, 'string');
    assert.ok(['todo', 'doing', 'done'].includes(task.status));
  }
});

test('GET /projects renvoie les projets de demonstration', { skip }, async () => {
  const response = await fetch(`${baseUrl}/projects`);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).length > 0);
});

test('POST /tasks cree la tache puis la retrouve dans la liste', { skip }, async () => {
  const title = `Tache de test ${process.pid}-${process.hrtime.bigint()}`;

  const created = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, status: 'doing' }),
  });
  assert.equal(created.status, 201);

  const task = await created.json();
  assert.equal(task.title, title);
  assert.equal(task.status, 'doing');

  try {
    const tasks = await (await fetch(`${baseUrl}/tasks`)).json();
    assert.ok(tasks.some((item) => item.id === task.id));
  } finally {
    // On nettoie : un test ne doit pas laisser de trace dans la base.
    await pool.query('DELETE FROM tasks WHERE id = $1', [task.id]);
  }
});

test('POST /tasks refuse un statut inconnu', { skip }, async () => {
  const response = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Tache invalide', status: 'blocked' }),
  });
  assert.equal(response.status, 400);
});
