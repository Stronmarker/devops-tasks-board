import { useState } from 'react';
import { apiFetch } from './api.js';
import ConfirmButton from './ConfirmButton.jsx';

// Panneau reserve au chef d'equipe : il y lit le code d'invitation et peut le
// remplacer. Les membres voient la meme liste, mais l'API leur renvoie
// joinCode = null, donc le bloc du code n'apparait tout simplement pas.
export default function TeamPanel({ team, isLead, currentUserId, onTeamChange }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const removeMember = async (id) => {
    setError('');
    try {
      await apiFetch(`/team/members/${id}`, { method: 'DELETE' });
      // On relit l'equipe plutot que de retirer la ligne localement : la liste
      // affichee reste ainsi celle du serveur, sans divergence possible.
      onTeamChange(await apiFetch('/team'));
    } catch (removeError) {
      setError(removeError.message);
    }
  };

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
        </div>
      )}

      <h3>Membres ({team.members.length})</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="member-list">
        {team.members.map((member) => (
          <li key={member.id}>
            <span className="member-name">{member.displayName}</span>
            <span className={member.role === 'lead' ? 'badge badge-lead' : 'badge'}>
              {member.role === 'lead' ? "Chef d'equipe" : 'Membre'}
            </span>
            {/* Le chef ne peut pas se retirer : l'equipe se retrouverait sans
                personne pour gerer le code ni les membres. */}
            {isLead && member.id !== currentUserId && (
              <ConfirmButton
                label="Retirer"
                title={`Retirer ${member.displayName} de l'equipe`}
                onConfirm={() => removeMember(member.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
