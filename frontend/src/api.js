const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Le jeton d'acces ne vit qu'en memoire : il disparait a la fermeture de
// l'onglet et n'est jamais ecrit sur le disque. Seul le jeton de
// rafraichissement est conserve, pour qu'un rechargement de page ne deconnecte
// pas l'utilisateur.
//
// Le rafraichissement reste dans localStorage : un cookie httpOnly resisterait
// mieux au XSS, mais le frontend et l'API sont sur deux domaines distincts, ce
// qui imposerait SameSite=None, Secure et une configuration CORS fragile.
// Compromis documente dans docs/decisions.md.
const REFRESH_KEY = 'tasks-board-refresh';

let accessToken = null;
// Une seule requete de rafraichissement a la fois : le serveur fait tourner le
// jeton a chaque usage, donc deux appels concurrents presenteraient le meme
// jeton et le second serait vu comme une reutilisation frauduleuse.
let refreshPromise = null;

const readRefreshToken = () => {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    // Navigation privee ou stockage bloque : la session vivra le temps de l'onglet.
    return null;
  }
};

const writeRefreshToken = (token) => {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* stockage indisponible */
  }
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function hasSession() {
  return Boolean(accessToken || readRefreshToken());
}

export function setSession({ accessToken: access, refreshToken }) {
  accessToken = access;
  writeRefreshToken(refreshToken);
}

export function clearSession() {
  accessToken = null;
  refreshPromise = null;
  writeRefreshToken(null);
}

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { response, payload };
}

// Echange le jeton de rafraichissement contre une nouvelle paire. Volontairement
// hors de apiFetch : passer par l'intercepteur ferait boucler un echec de
// rafraichissement sur lui-meme.
export function refreshSession() {
  if (refreshPromise) return refreshPromise;

  const refreshToken = readRefreshToken();
  if (!refreshToken) return Promise.reject(new ApiError('Session expiree', 401));

  refreshPromise = request('/auth/refresh', { method: 'POST', body: { refreshToken } })
    .then(({ response, payload }) => {
      if (!response.ok) {
        clearSession();
        throw new ApiError(payload.error || 'Session expiree', 401);
      }
      setSession(payload);
      return payload;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function apiFetch(path, { method = 'GET', body, retry = true } = {}) {
  const { response, payload } = await request(path, { method, body, token: accessToken });

  // Le jeton d'acces dure quinze minutes : expirer en pleine session est le cas
  // normal, pas une erreur. On le renouvelle et on rejoue la requete une fois,
  // sans que l'utilisateur voie quoi que ce soit.
  if (response.status === 401 && retry && readRefreshToken()) {
    await refreshSession();
    return apiFetch(path, { method, body, retry: false });
  }

  if (!response.ok) {
    throw new ApiError(payload.error || 'Une erreur est survenue', response.status);
  }

  return payload;
}

export async function logout() {
  const refreshToken = readRefreshToken();

  if (refreshToken) {
    // La revocation cote serveur est ce qui rend la deconnexion reelle : sans
    // elle, le jeton resterait utilisable pendant sept jours.
    await request('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
  }

  clearSession();
}

export { apiUrl };
