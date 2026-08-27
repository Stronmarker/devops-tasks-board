import { useCallback, useEffect, useState } from 'react';
import AuthScreen from './AuthScreen.jsx';
import Board from './Board.jsx';
import TeamPanel from './TeamPanel.jsx';
import { apiFetch, clearToken, getToken, setToken } from './api.js';

export default function App() {
  const [session, setSession] = useState(null);
  const [team, setTeam] = useState(null);
  // checking couvre l'instant ou un jeton existe mais n'a pas encore ete
  // valide : afficher l'ecran de connexion pendant ce temps ferait clignoter
  // l'interface a chaque rechargement.
  const [checking, setChecking] = useState(Boolean(getToken()));

  const loadTeam = async () => {
    try {
      setTeam(await apiFetch('/team'));
    } catch {
      setTeam(null);
    }
  };

  // Identite stable : Board recoit cette fonction en dependance de son effet
  // de chargement, une nouvelle reference a chaque rendu le relancerait en boucle.
  const logout = useCallback(() => {
    clearToken();
    setSession(null);
    setTeam(null);
  }, []);

  const authenticate = async ({ token, user }) => {
    setToken(token);
    setSession({ user });
    await loadTeam();
  };

  useEffect(() => {
    if (!getToken()) return;

    // Un jeton present ne prouve rien : il peut avoir expire ou avoir ete
    // revoque cote base. On demande au serveur avant d'ouvrir le tableau.
    apiFetch('/auth/me')
      .then(async ({ user }) => {
        setSession({ user });
        await loadTeam();
      })
      .catch(clearToken)
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="shell">
        <p className="loading">Verification de la session...</p>
      </main>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={authenticate} />;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">DEVOPS DELIVERY LAB</p>
          <h1>Tasks Board</h1>
          <p className="intro">
            {session.user.displayName}
            {session.user.role === 'lead' ? " - chef d'equipe" : ' - membre'}
          </p>
        </div>
        <button type="button" className="ghost" onClick={logout}>
          Se deconnecter
        </button>
      </header>

      <div className="layout">
        <Board onUnauthorized={logout} />
        {team && <TeamPanel team={team} onTeamChange={setTeam} />}
      </div>
    </main>
  );
}
