const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Le jeton est conserve dans localStorage pour survivre a un rechargement de
// page. C'est une faiblesse assumee : un script injecte dans la page pourrait
// le lire (XSS). Le choix vient du deploiement Render, ou le frontend et l'API
// sont sur deux domaines distincts, ce qui rend un cookie httpOnly nettement
// plus fragile a configurer. Voir docs/decisions.md.
const TOKEN_KEY = 'tasks-board-token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Navigation privee ou stockage bloque : on degrade vers une session non
    // persistante plutot que de planter au chargement.
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* stockage indisponible : la session vivra le temps de l'onglet */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* rien a nettoyer */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch(path, { method = 'GET', body, token = getToken() } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(payload.error || 'Une erreur est survenue', response.status);
  }

  return payload;
}

export { apiUrl };
