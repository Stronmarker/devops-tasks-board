import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import { clearSession } from './api.js';

// Ces tests montent reellement l'application dans un DOM (jsdom). C'est ce type
// de test qui detecte une page blanche : un `curl` sur l'index HTML renvoie 200
// meme quand le bundle JavaScript plante au demarrage.

const TASKS = [
  { id: 1, title: 'Ecrire le pipeline', status: 'todo', color: '#F97316', project_name: 'DevOps', created_by_name: 'Chef' },
  { id: 2, title: 'Deployer sur Render', status: 'doing', color: '#0EA5E9', project_name: null, created_by_name: null },
];

const LEAD = { id: 1, displayName: 'Chef', role: 'lead' };
const MEMBER = { id: 2, displayName: 'Membre', role: 'member' };

const TEAM_LEAD = {
  name: 'DevOps Delivery Lab',
  joinCode: '482913',
  members: [
    { id: 1, displayName: 'Chef', role: 'lead', joinedAt: '2026-08-01' },
    { id: 2, displayName: 'Membre', role: 'member', joinedAt: '2026-08-02' },
  ],
};

// Faux serveur : chaque test declare ce que l'API repond, route par route.
const mockApi = (routes) => {
  const fetchMock = vi.fn((url, options = {}) => {
    const path = String(url).replace('http://localhost:3000', '');
    const handler = routes[`${options.method || 'GET'} ${path}`] ?? routes[path];

    if (!handler) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });

    const { status = 200, body = {} } = handler;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  localStorage.clear();
  // Le jeton d'acces vit dans un module : il faut le reinitialiser entre deux
  // tests, sinon une session fuit d'un test a l'autre.
  clearSession();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sans session', () => {
  it("affiche l'ecran de connexion, pas le tableau", () => {
    mockApi({});
    render(<App />);

    expect(screen.getByRole('tab', { name: 'Se connecter' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'A faire' })).toBeNull();
  });

  it('propose les trois parcours et demande un code pour rejoindre', () => {
    mockApi({});
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Rejoindre une equipe' }));
    expect(screen.getByLabelText("Code d'equipe")).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Creer une equipe' }));
    expect(screen.getByLabelText("Nom de l'equipe")).toBeDefined();
  });

  it('annonce la regle du mot de passe avant toute saisie', () => {
    mockApi({});
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Creer une equipe' }));
    // La contrainte doit etre lisible des l'arrivee : la decouvrir au moment du
    // refus est la premiere cause d'abandon sur un formulaire d'inscription.
    expect(screen.getByText('8 caracteres minimum, avec au moins une lettre et un chiffre')).toBeDefined();
  });

  it('affiche l erreur sous le champ fautif et le marque invalide', async () => {
    mockApi({
      'POST /auth/teams': {
        status: 400,
        body: {
          error: 'Mot de passe invalide',
          fields: { password: 'Mot de passe : 8 caracteres minimum, avec au moins une lettre et un chiffre' },
        },
      },
    });
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Creer une equipe' }));
    fireEvent.change(screen.getByLabelText("Nom de l'equipe"), { target: { value: 'Mon equipe' } });
    fireEvent.change(screen.getByLabelText('Votre nom'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alex@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'motdepasse' } });
    fireEvent.click(screen.getByRole('button', { name: "Creer l'equipe" }));

    await waitFor(() =>
      expect(screen.getByLabelText('Mot de passe').getAttribute('aria-invalid')).toBe('true'),
    );

    // L'erreur disparait des que l'utilisateur corrige le champ.
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'Motdepasse1' } });
    expect(screen.getByLabelText('Mot de passe').getAttribute('aria-invalid')).toBeNull();
  });

  it("affiche le message d'erreur renvoye par l'API en cas d'identifiants faux", async () => {
    mockApi({ 'POST /auth/login': { status: 401, body: { error: 'Identifiants invalides' } } });
    render(<App />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'chef@tasks.local' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'MauvaisMotdepasse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Identifiants invalides'));
    expect(screen.queryByRole('heading', { name: 'A faire' })).toBeNull();
  });

  it('ouvre le tableau apres une connexion reussie et conserve le jeton', async () => {
    mockApi({
      'POST /auth/login': {
        body: {
          accessToken: 'acces-valide',
          refreshToken: 'refresh-valide',
          user: { displayName: 'Chef', role: 'lead' },
        },
      },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'chef@tasks.local' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'Demo1234!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    // Seul le jeton de rafraichissement est ecrit sur le disque ; le jeton
    // d'acces reste en memoire du module.
    expect(localStorage.getItem('tasks-board-refresh')).toBe('refresh-valide');
    expect(localStorage.getItem('tasks-board-token')).toBeNull();
  });
});

describe('Session active', () => {
  // Au chargement, le navigateur n'a que le jeton de rafraichissement : c'est
  // l'etat reel apres un F5.
  const REFRESH_OK = {
    'POST /auth/refresh': {
      body: { accessToken: 'acces-frais', refreshToken: 'refresh-suivant' },
    },
  };

  beforeEach(() => {
    localStorage.setItem('tasks-board-refresh', 'refresh-valide');
  });

  it('valide le jeton aupres du serveur avant d ouvrir le tableau', async () => {
    const fetchMock = mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    // Le rafraichissement precede toute requete metier, et /auth/me part avec
    // le jeton d'acces tout juste obtenu.
    const [, refreshOptions] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/auth/refresh'),
    );
    expect(JSON.parse(refreshOptions.body)).toEqual({ refreshToken: 'refresh-valide' });

    const [, options] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/me'));
    expect(options.headers.Authorization).toBe('Bearer acces-frais');
    expect(localStorage.getItem('tasks-board-refresh')).toBe('refresh-suivant');
  });

  it('repartit les taches par statut et compte chaque colonne', async () => {
    mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());
    expect(screen.getByText('Deployer sur Render')).toBeDefined();
    expect(screen.getByRole('heading', { name: /Terminees/ }).textContent).toContain('0');
    expect(screen.getByText('Ajoutee par Chef')).toBeDefined();
  });

  it('montre le code d invitation au chef d equipe', async () => {
    mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: [] },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('482913')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Generer un nouveau code' })).toBeDefined();
  });

  it('cache le code d invitation a un simple membre', async () => {
    mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: MEMBER, team: { name: 'Lab' } } },
      '/team': { body: { ...TEAM_LEAD, joinCode: null } },
      '/tasks': { body: [] },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('DevOps Delivery Lab')).toBeDefined());
    expect(screen.queryByText('482913')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generer un nouveau code' })).toBeNull();
  });

  it('rejoue la requete apres un rafraichissement, sans deconnecter', async () => {
    let premierAppel = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((url, options = {}) => {
        const path = String(url).replace('http://localhost:3000', '');
        const ok = (body, status = 200) =>
          Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

        if (path === '/auth/refresh')
          return ok({ accessToken: 'acces-frais', refreshToken: 'refresh-suivant' });
        if (path === '/auth/me') return ok({ user: LEAD, team: { name: 'Lab' } });
        if (path === '/team') return ok(TEAM_LEAD);
        if (path === '/tasks' && options.method !== 'POST') {
          // Premiere lecture : le jeton d'acces vient d'expirer. La seconde,
          // apres rafraichissement, doit reussir sans intervention.
          if (premierAppel) {
            premierAppel = false;
            return ok({ error: 'Authentification requise' }, 401);
          }
          return ok(TASKS);
        }
        return ok({ error: 'Not found' }, 404);
      }),
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());
    expect(screen.queryByRole('tab', { name: 'Se connecter' })).toBeNull();
  });

  it('renvoie vers la connexion quand le rafraichissement lui-meme echoue', async () => {
    mockApi({
      'POST /auth/refresh': { status: 401, body: { error: 'Session expiree' } },
    });
    render(<App />);

    // Session revoquee cote serveur : plus rien a tenter, on repart de zero.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Se connecter' })).toBeDefined());
    expect(localStorage.getItem('tasks-board-refresh')).toBeNull();
  });

  it('le chef peut avancer une tache, et pas la reculer depuis la premiere colonne', async () => {
    const fetchMock = mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
      'PATCH /tasks/1': { body: { id: 1, status: 'doing' } },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    // La tache est dans "A faire" : reculer n'a pas de sens.
    expect(screen.getByLabelText('Reculer : Ecrire le pipeline').disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Avancer : Ecrire le pipeline'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(JSON.parse(call[1].body)).toEqual({ status: 'doing' });
    });
  });

  it('la suppression d une tache demande une confirmation', async () => {
    const fetchMock = mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
      'DELETE /tasks/1': { status: 204 },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    const bouton = screen.getByTitle('Supprimer : Ecrire le pipeline');
    fireEvent.click(bouton);

    // Premier clic : rien n'est envoye, le bouton demande confirmation.
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
    expect(bouton.textContent).toBe('Confirmer ?');

    fireEvent.click(bouton);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(true),
    );
  });

  it('un membre ne voit aucun bouton de deplacement ni de suppression', async () => {
    mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: MEMBER, team: { name: 'Lab' } } },
      '/team': { body: { ...TEAM_LEAD, joinCode: null } },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    expect(screen.queryByLabelText('Avancer : Ecrire le pipeline')).toBeNull();
    expect(screen.queryByTitle('Supprimer : Ecrire le pipeline')).toBeNull();
    expect(screen.queryByTitle(/Retirer .* de l'equipe/)).toBeNull();
  });

  it('le chef retire un membre mais pas lui-meme', async () => {
    const fetchMock = mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: [] },
      'DELETE /team/members/2': { status: 204 },
    });
    render(<App />);

    // "Membre" est a la fois le nom et le libelle du badge : on attend le
    // bouton, qui lui est sans ambiguite.
    await waitFor(() => expect(screen.getByTitle("Retirer Membre de l'equipe")).toBeDefined());

    // Aucun bouton en face de son propre nom.
    expect(screen.queryByTitle("Retirer Chef de l'equipe")).toBeNull();

    const bouton = screen.getByTitle("Retirer Membre de l'equipe");
    fireEvent.click(bouton);
    fireEvent.click(bouton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, o]) => o?.method === 'DELETE' && String(url).endsWith('/team/members/2'),
        ),
      ).toBe(true),
    );
  });

  it('propose la palette a jour, sans l ancienne couleur indigo', async () => {
    mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: [] },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Nouvelle tache')).toBeDefined());

    for (const nom of ['Rose', 'Bleu', 'Vert', 'Jaune', 'Orange', 'Rouge', 'Violet', 'Marron']) {
      expect(screen.getByLabelText(nom), nom).toBeDefined();
    }
    expect(screen.queryByLabelText('Indigo')).toBeNull();
  });

  it('envoie la couleur choisie lors de la creation d une tache', async () => {
    const fetchMock = mockApi({
      ...REFRESH_OK,
      '/auth/me': { body: { user: LEAD, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: [] },
      'POST /tasks': { status: 201, body: { id: 9 } },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Nouvelle tache')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Nouvelle tache'), { target: { value: 'Tache coloree' } });
    fireEvent.click(screen.getByLabelText('Vert'));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, options]) => options?.method === 'POST' && String(url).endsWith('/tasks'),
      );
      expect(JSON.parse(call[1].body)).toMatchObject({ title: 'Tache coloree', color: '#22C55E' });
    });
  });
});
