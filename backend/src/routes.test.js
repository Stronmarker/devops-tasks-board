import test from 'node:test';
import assert from 'node:assert/strict';
import { app, pool } from './server.js';

// Tests d'integration : ils demarrent le serveur HTTP sur un port ephemere et
// tapent sur une vraie base PostgreSQL. Ils verifient la chaine complete
// (route -> authentification -> requete SQL -> reponse JSON), la ou
// server.test.js et auth.test.js testent les briques isolement.
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

// Chaque execution cree ses propres equipes : les tests ne dependent ni des
// donnees de demo, ni d'un run precedent, et peuvent tourner en parallele.
const runId = `${process.pid}-${process.hrtime.bigint()}`;
const email = (role) => `${role}-${runId}@test.local`;
const password = 'Motdepasse1';

let server;
let baseUrl;
let lead;
let otherTeamLead;
let member;

const call = (path, { method = 'GET', token, body } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const createTeam = async (role, teamName) => {
  const response = await call('/auth/teams', {
    method: 'POST',
    body: { teamName, displayName: 'Chef de test', email: email(role), password },
  });
  assert.equal(response.status, 201, `creation de l'equipe ${teamName}`);
  return response.json();
};

test.before(async () => {
  if (!databaseReachable) return;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  lead = await createTeam('lead', `Equipe test ${runId}`);
  otherTeamLead = await createTeam('autre', `Autre equipe ${runId}`);

  member = await (
    await call('/auth/join', {
      method: 'POST',
      body: {
        code: lead.team.joinCode,
        displayName: 'Membre de test',
        email: email('membre'),
        password,
      },
    })
  ).json();
});

test.after(async () => {
  if (databaseReachable) {
    // Les equipes sont supprimees en cascade : comptes, projets et taches
    // partent avec elles. Un test ne doit rien laisser derriere lui.
    await pool.query('DELETE FROM teams WHERE name LIKE $1', [`%${runId}`]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ---------------------------------------------------------------------------
// Sante
// ---------------------------------------------------------------------------
test('GET /health confirme que la base repond', { skip }, async () => {
  const response = await call('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------
test('la creation d une equipe renvoie un jeton et un code a six chiffres', { skip }, () => {
  assert.ok(lead.accessToken);
  assert.equal(lead.user.role, 'lead');
  assert.match(lead.team.joinCode, /^[0-9]{6}$/);
});

test('un email deja utilise est refuse', { skip }, async () => {
  const response = await call('/auth/teams', {
    method: 'POST',
    body: { teamName: 'Doublon', displayName: 'Doublon', email: email('lead'), password },
  });
  assert.equal(response.status, 409);
});

test('la connexion renvoie un jeton, un mauvais mot de passe non', { skip }, async () => {
  const ok = await call('/auth/login', { method: 'POST', body: { email: email('lead'), password } });
  assert.equal(ok.status, 200);

  const session = await ok.json();
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);

  const ko = await call('/auth/login', {
    method: 'POST',
    body: { email: email('lead'), password: 'MauvaisMotdepasse1' },
  });
  assert.equal(ko.status, 401);
});

test('un compte inexistant renvoie la meme erreur qu un mot de passe faux', { skip }, async () => {
  const response = await call('/auth/login', {
    method: 'POST',
    body: { email: `fantome-${runId}@test.local`, password },
  });

  // Message identique au cas precedent : sinon l'ecart de reponse permettrait
  // d'enumerer les comptes existants de l'application.
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Identifiants invalides' });
});

test('rejoindre avec un code inconnu echoue', { skip }, async () => {
  const response = await call('/auth/join', {
    method: 'POST',
    body: { code: '000000', displayName: 'Intrus', email: email('intrus'), password },
  });
  assert.equal(response.status, 404);
});

test('rejoindre avec le bon code cree un membre, pas un chef', { skip }, async () => {
  assert.equal(member.user.role, 'member');
  assert.equal(member.user.teamId, lead.user.teamId);

  // Le code d'invitation ne doit jamais parvenir a un membre.
  const team = await (await call('/team', { token: member.accessToken })).json();
  assert.equal(team.joinCode, null);
  assert.equal(team.members.length, 2);
});

test('seul le chef voit le code et peut le faire tourner', { skip }, async () => {
  const avant = await (await call('/team', { token: lead.accessToken })).json();
  assert.equal(avant.joinCode, lead.team.joinCode);

  const rotation = await call('/team/code', { method: 'POST', token: lead.accessToken });
  assert.equal(rotation.status, 200);

  const { joinCode } = await rotation.json();
  assert.match(joinCode, /^[0-9]{6}$/);
  assert.notEqual(joinCode, lead.team.joinCode);
  lead.team.joinCode = joinCode;
});

// ---------------------------------------------------------------------------
// Protection des routes metier
// ---------------------------------------------------------------------------
test('sans jeton, toutes les routes metier renvoient 401', { skip }, async () => {
  for (const path of ['/tasks', '/projects', '/team']) {
    const response = await call(path);
    assert.equal(response.status, 401, `${path} devrait etre protege`);
  }
});

test('un jeton invalide est refuse comme une absence de jeton', { skip }, async () => {
  const response = await call('/tasks', { token: 'jeton.completement.invente' });
  assert.equal(response.status, 401);
});

test('un membre ne peut pas faire tourner le code de l equipe', { skip }, async () => {
  const response = await call('/team/code', { method: 'POST', token: member.accessToken });
  assert.equal(response.status, 403);
});

// ---------------------------------------------------------------------------
// Cycle de vie de la session
// ---------------------------------------------------------------------------
test('le rafraichissement rend une nouvelle paire et consomme l ancienne', { skip }, async () => {
  const depart = await (
    await call('/auth/login', { method: 'POST', body: { email: email('lead'), password } })
  ).json();

  const response = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: depart.refreshToken },
  });
  assert.equal(response.status, 200);

  const renouvelee = await response.json();
  assert.ok(renouvelee.accessToken);
  assert.notEqual(renouvelee.refreshToken, depart.refreshToken, 'le jeton doit tourner');

  // Le nouveau jeton d'acces ouvre bien les routes metier.
  const tasks = await call('/tasks', { token: renouvelee.accessToken });
  assert.equal(tasks.status, 200);
});

test('rejouer un jeton de rafraichissement coupe toute la session', { skip }, async () => {
  const depart = await (
    await call('/auth/login', { method: 'POST', body: { email: email('lead'), password } })
  ).json();

  const premiere = await (
    await call('/auth/refresh', { method: 'POST', body: { refreshToken: depart.refreshToken } })
  ).json();

  // Rejouer le jeton deja consomme : c'est la signature d'une copie volee.
  const rejeu = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: depart.refreshToken },
  });
  assert.equal(rejeu.status, 401);

  // Consequence : meme le jeton legitime issu de la rotation est invalide.
  const apres = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: premiere.refreshToken },
  });
  assert.equal(apres.status, 401, 'toute la session doit etre revoquee');
});

test('un jeton de rafraichissement inconnu est refuse', { skip }, async () => {
  const response = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: 'jeton-qui-n-existe-pas' },
  });
  assert.equal(response.status, 401);
});

test('la deconnexion empeche tout rafraichissement ulterieur', { skip }, async () => {
  const session = await (
    await call('/auth/login', { method: 'POST', body: { email: email('lead'), password } })
  ).json();

  const logout = await call('/auth/logout', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  });
  assert.equal(logout.status, 204);

  const response = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  });
  assert.equal(response.status, 401, 'une session deconnectee ne se prolonge pas');
});

// ---------------------------------------------------------------------------
// Taches
// ---------------------------------------------------------------------------
test('POST /tasks cree la tache avec sa couleur puis la retrouve', { skip }, async () => {
  const title = `Tache de test ${runId}`;

  const created = await call('/tasks', {
    method: 'POST',
    token: lead.accessToken,
    body: { title, status: 'doing', color: '#22C55E' },
  });
  assert.equal(created.status, 201);

  const task = await created.json();
  assert.equal(task.title, title);
  assert.equal(task.status, 'doing');
  assert.equal(task.color, '#22C55E');

  const tasks = await (await call('/tasks', { token: lead.accessToken })).json();
  const found = tasks.find((item) => item.id === task.id);
  assert.ok(found, 'la tache creee doit apparaitre dans la liste');
  assert.equal(found.created_by_name, 'Chef de test');
});

test('POST /tasks refuse un statut ou une couleur invalides', { skip }, async () => {
  for (const body of [
    { title: 'Statut invalide', status: 'blocked' },
    { title: 'Couleur invalide', color: 'rouge' },
    { title: 'Couleur trop courte', color: '#FFF' },
    { title: '   ' },
  ]) {
    const response = await call('/tasks', { method: 'POST', token: lead.accessToken, body });
    assert.equal(response.status, 400, `payload accepte a tort : ${JSON.stringify(body)}`);
  }
});

// ---------------------------------------------------------------------------
// Actions reservees au chef d'equipe
// ---------------------------------------------------------------------------
const createTask = async (title, token = lead.accessToken) => {
  const response = await call('/tasks', { method: 'POST', token, body: { title } });
  assert.equal(response.status, 201, `creation de "${title}"`);
  return response.json();
};

test('le chef deplace une tache d une colonne a l autre', { skip }, async () => {
  const task = await createTask(`A deplacer ${runId}`);
  assert.equal(task.status, 'todo');

  const response = await call(`/tasks/${task.id}`, {
    method: 'PATCH',
    token: lead.accessToken,
    body: { status: 'doing' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'doing');

  const tasks = await (await call('/tasks', { token: lead.accessToken })).json();
  assert.equal(tasks.find((item) => item.id === task.id).status, 'doing');
});

test('un membre ne peut ni deplacer ni supprimer une tache', { skip }, async () => {
  const task = await createTask(`Protegee ${runId}`);

  const deplacement = await call(`/tasks/${task.id}`, {
    method: 'PATCH',
    token: member.accessToken,
    body: { status: 'done' },
  });
  assert.equal(deplacement.status, 403);

  const suppression = await call(`/tasks/${task.id}`, { method: 'DELETE', token: member.accessToken });
  assert.equal(suppression.status, 403);

  // La tache doit etre intacte apres les deux tentatives.
  const tasks = await (await call('/tasks', { token: lead.accessToken })).json();
  assert.equal(tasks.find((item) => item.id === task.id).status, 'todo');
});

test('le chef supprime une tache', { skip }, async () => {
  const task = await createTask(`A supprimer ${runId}`);

  const response = await call(`/tasks/${task.id}`, { method: 'DELETE', token: lead.accessToken });
  assert.equal(response.status, 204);

  const tasks = await (await call('/tasks', { token: lead.accessToken })).json();
  assert.equal(
    tasks.some((item) => item.id === task.id),
    false,
  );
});

test('un statut inconnu ou un identifiant absurde sont refuses', { skip }, async () => {
  const task = await createTask(`Statut ${runId}`);

  const statut = await call(`/tasks/${task.id}`, {
    method: 'PATCH',
    token: lead.accessToken,
    body: { status: 'archive' },
  });
  assert.equal(statut.status, 400);

  const identifiant = await call('/tasks/abc', {
    method: 'PATCH',
    token: lead.accessToken,
    body: { status: 'done' },
  });
  assert.equal(identifiant.status, 400);
});

test('le chef d une equipe ne touche pas aux taches d une autre', { skip }, async () => {
  const task = await createTask(`Cloisonnee ${runId}`);

  // Identifiant connu, mais jeton d'une autre equipe : la clause team_id doit
  // faire echouer la requete comme si la tache n'existait pas.
  const deplacement = await call(`/tasks/${task.id}`, {
    method: 'PATCH',
    token: otherTeamLead.accessToken,
    body: { status: 'done' },
  });
  assert.equal(deplacement.status, 404);

  const suppression = await call(`/tasks/${task.id}`, {
    method: 'DELETE',
    token: otherTeamLead.accessToken,
  });
  assert.equal(suppression.status, 404);
});

test('le chef retire un membre, qui perd aussitot sa session', { skip }, async () => {
  const sortant = await (
    await call('/auth/join', {
      method: 'POST',
      body: {
        code: lead.team.joinCode,
        displayName: 'Membre sortant',
        email: email('sortant'),
        password,
      },
    })
  ).json();

  const response = await call(`/team/members/${sortant.user.id}`, {
    method: 'DELETE',
    token: lead.accessToken,
  });
  assert.equal(response.status, 204);

  const team = await (await call('/team', { token: lead.accessToken })).json();
  assert.equal(
    team.members.some((m) => m.id === sortant.user.id),
    false,
  );

  // Ses jetons de rafraichissement partent avec le compte : il ne peut plus
  // prolonger sa session au-dela de son jeton d'acces en cours.
  const refresh = await call('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: sortant.refreshToken },
  });
  assert.equal(refresh.status, 401);
});

test('un membre ne peut pas en retirer un autre', { skip }, async () => {
  const response = await call(`/team/members/${lead.user.id}`, {
    method: 'DELETE',
    token: member.accessToken,
  });
  assert.equal(response.status, 403);
});

test('le chef ne peut pas se retirer lui-meme', { skip }, async () => {
  const response = await call(`/team/members/${lead.user.id}`, {
    method: 'DELETE',
    token: lead.accessToken,
  });

  // Sinon l'equipe se retrouverait sans personne pour gerer le code ni les membres.
  assert.equal(response.status, 400);
});

test('une equipe ne voit jamais les taches d une autre', { skip }, async () => {
  const title = `Tache confidentielle ${runId}`;

  const created = await call('/tasks', {
    method: 'POST',
    token: lead.accessToken,
    body: { title },
  });
  assert.equal(created.status, 201);

  // Meme application, meme base, jeton d'une autre equipe : le filtre vient du
  // jeton et non d'un parametre, il ne peut donc pas etre contourne.
  const autres = await (await call('/tasks', { token: otherTeamLead.accessToken })).json();
  assert.equal(
    autres.some((task) => task.title === title),
    false,
    'fuite de donnees entre equipes',
  );
});

test('GET /projects ne renvoie que les projets de l equipe', { skip }, async () => {
  const response = await call('/projects', { token: lead.accessToken });
  assert.equal(response.status, 200);
  // Une equipe fraichement creee n'a aucun projet : les projets de demo
  // appartiennent a l'equipe de demonstration, pas a celle-ci.
  assert.deepEqual(await response.json(), []);
});
