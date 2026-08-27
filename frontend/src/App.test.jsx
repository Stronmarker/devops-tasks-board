import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

// Ces tests montent reellement l'application dans un DOM (jsdom). C'est ce type
// de test qui detecte une page blanche : un `curl` sur l'index HTML renvoie 200
// meme quand le bundle JavaScript plante au demarrage.

const TASKS = [
  { id: 1, title: 'Ecrire le pipeline', status: 'todo', color: '#F97316', project_name: 'DevOps', created_by_name: 'Chef' },
  { id: 2, title: 'Deployer sur Render', status: 'doing', color: '#0EA5E9', project_name: null, created_by_name: null },
];

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
      'POST /auth/login': { body: { token: 'jeton-valide', user: { displayName: 'Chef', role: 'lead' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'chef@tasks.local' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'Demo1234!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());
    expect(localStorage.getItem('tasks-board-token')).toBe('jeton-valide');
  });
});

describe('Session active', () => {
  beforeEach(() => {
    localStorage.setItem('tasks-board-token', 'jeton-valide');
  });

  it('valide le jeton aupres du serveur avant d ouvrir le tableau', async () => {
    const fetchMock = mockApi({
      '/auth/me': { body: { user: { displayName: 'Chef', role: 'lead' }, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: TASKS },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());

    const [, options] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/me'));
    expect(options.headers.Authorization).toBe('Bearer jeton-valide');
  });

  it('repartit les taches par statut et compte chaque colonne', async () => {
    mockApi({
      '/auth/me': { body: { user: { displayName: 'Chef', role: 'lead' }, team: { name: 'Lab' } } },
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
      '/auth/me': { body: { user: { displayName: 'Chef', role: 'lead' }, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { body: [] },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('482913')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Generer un nouveau code' })).toBeDefined();
  });

  it('cache le code d invitation a un simple membre', async () => {
    mockApi({
      '/auth/me': { body: { user: { displayName: 'Membre', role: 'member' }, team: { name: 'Lab' } } },
      '/team': { body: { ...TEAM_LEAD, joinCode: null } },
      '/tasks': { body: [] },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('DevOps Delivery Lab')).toBeDefined());
    expect(screen.queryByText('482913')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generer un nouveau code' })).toBeNull();
  });

  it('renvoie vers la connexion et efface le jeton si le serveur repond 401', async () => {
    mockApi({
      '/auth/me': { body: { user: { displayName: 'Chef', role: 'lead' }, team: { name: 'Lab' } } },
      '/team': { body: TEAM_LEAD },
      '/tasks': { status: 401, body: { error: 'Authentification requise' } },
    });
    render(<App />);

    // Un jeton expire en cours de session doit ramener a l'ecran de connexion,
    // pas afficher un tableau vide sans explication.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Se connecter' })).toBeDefined());
    expect(localStorage.getItem('tasks-board-token')).toBeNull();
  });

  it('envoie la couleur choisie lors de la creation d une tache', async () => {
    const fetchMock = mockApi({
      '/auth/me': { body: { user: { displayName: 'Chef', role: 'lead' }, team: { name: 'Lab' } } },
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
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(JSON.parse(call[1].body)).toMatchObject({ title: 'Tache coloree', color: '#22C55E' });
    });
  });
});
