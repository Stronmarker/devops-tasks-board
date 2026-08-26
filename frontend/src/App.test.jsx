import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

// Ces tests montent reellement le composant dans un DOM (jsdom). C'est ce type
// de test qui detecte une page blanche : un `curl` sur l'index HTML renvoie 200
// meme quand le bundle JavaScript plante au demarrage.

const tasks = [
  { id: 1, title: 'Ecrire le pipeline', status: 'todo', project_name: 'DevOps' },
  { id: 2, title: 'Deployer sur Render', status: 'doing', project_name: null },
  { id: 3, title: 'Conteneuriser', status: 'done', project_name: null },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(tasks) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('affiche le titre et les trois colonnes du tableau', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks Board' })).toBeDefined();
    for (const column of ['À faire', 'En cours', 'Terminées']) {
      expect(screen.getByRole('heading', { level: 2, name: column })).toBeDefined();
    }
  });

  it('charge les taches depuis l API et les repartit par statut', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Ecrire le pipeline')).toBeDefined());
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:3000/tasks');
    expect(screen.getByText('Deployer sur Render')).toBeDefined();
    expect(screen.getByText('Conteneuriser')).toBeDefined();
  });

  it('affiche un message quand l API est indisponible', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Chargement impossible')).toBeDefined());
  });
});
