import { useCallback, useEffect, useState } from 'react';
import AuthScreen from './AuthScreen.jsx';
import Board from './Board.jsx';
import TeamPanel from './TeamPanel.jsx';
import {
  apiFetch,
  clearSession,
  hasSession,
  logout as apiLogout,
  refreshSession,
  setSession as storeTokens,
} from './api.js';

export default function App() {
  const [session, setSession] = useState(null);
  const [team, setTeam] = useState(null);
  // checking couvre l'instant ou un jeton existe mais n'a pas encore ete
  // valide : afficher l'ecran de connexion pendant ce temps ferait clignoter
  // l'interface a chaque rechargement.
  const [checking, setChecking] = useState(hasSession());

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
    // La revocation cote serveur est lancee sans etre attendue : l'interface se
    // ferme immediatement, et l'echec eventuel du reseau n'empeche pas de sortir.
    apiLogout();
    setSession(null);
    setTeam(null);
  }, []);

  const authenticate = async ({ accessToken, refreshToken, user }) => {
    storeTokens({ accessToken, refreshToken });
    setSession({ user });
    await loadTeam();
  };

  useEffect(() => {
    if (!hasSession()) return;

    // Au chargement, seul le jeton de rafraichissement subsiste. On l'echange
    // contre un jeton d'acces, puis on demande au serveur qui nous sommes : un
    // jeton stocke ne prouve rien, il peut avoir ete revoque entre-temps.
    refreshSession()
      .then(() => apiFetch('/auth/me'))
      .then(async ({ user }) => {
        setSession({ user });
        await loadTeam();
      })
      .catch(clearSession)
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

  const isLead = session.user.role === 'lead';

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
        <Board isLead={isLead} onUnauthorized={logout} />
        {team && (
          <TeamPanel
            team={team}
            isLead={isLead}
            currentUserId={session.user.id}
            onTeamChange={setTeam}
          />
        )}
      </div>
    </main>
  );
}
