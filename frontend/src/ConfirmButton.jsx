import { useState } from 'react';

// Suppression en deux temps : le premier clic arme, le second execute. On evite
// window.confirm, qui bloque le navigateur, sort du style de l'application et
// n'est pas testable proprement.
export default function ConfirmButton({ label, confirmLabel = 'Confirmer ?', onConfirm, title }) {
  const [armed, setArmed] = useState(false);

  const handleClick = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    onConfirm();
  };

  return (
    <button
      type="button"
      className={armed ? 'danger is-armed' : 'danger'}
      // Quitter le bouton desarme : une confirmation oubliee ne doit pas rester
      // active en attendant un clic accidentel.
      onBlur={() => setArmed(false)}
      onClick={handleClick}
      title={title}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
