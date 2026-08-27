import { useState } from 'react';
import { apiFetch } from './api.js';

// Panneau reserve au chef d'equipe : il y lit le code d'invitation et peut le
// remplacer. Les membres voient la meme liste, mais l'API leur renvoie
// joinCode = null, donc le bloc du code n'apparait tout simplement pas.
export default function TeamPanel({ team, onTeamChange }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const rotate = async () => {
    setPending(true);
    setError('');
    try {
      const { joinCode } = await apiFetch('/team/code', { method: 'POST' });
      onTeamChange({ ...team, joinCode });
    } catch (rotateError) {
      setError(rotateError.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="team-panel">
      <h2>{team.name}</h2>

      {team.joinCode && (
        <div className="join-code">
          <p className="join-code-label">Code d&apos;invitation</p>
          {/* Espace les chiffres a la lecture sans les separer dans le DOM :
              le code reste copiable d'un bloc. */}
          <p className="join-code-value">{team.joinCode}</p>
          <p className="join-code-help">
            Toute personne disposant de ce code peut rejoindre l&apos;equipe. Faites-le tourner si
            vous l&apos;avez diffuse par erreur ou si quelqu&apos;un quitte l&apos;equipe.
          </p>
          <button type="button" onClick={rotate} disabled={pending}>
            {pending ? 'Rotation...' : 'Generer un nouveau code'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <h3>Membres ({team.members.length})</h3>
      <ul className="member-list">
        {team.members.map((member) => (
          <li key={member.id}>
            <span>{member.displayName}</span>
            <span className={member.role === 'lead' ? 'badge badge-lead' : 'badge'}>
              {member.role === 'lead' ? "Chef d'equipe" : 'Membre'}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
