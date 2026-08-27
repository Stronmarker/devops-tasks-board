import { useState } from 'react';
import { apiFetch } from './api.js';

// Trois parcours partagent le meme ecran : se connecter, rejoindre une equipe
// avec son code, ou en creer une. Les regrouper evite trois pages presque
// identiques et rend le choix visible des l'arrivee.
const MODES = {
  login: {
    label: 'Se connecter',
    submit: 'Se connecter',
    path: '/auth/login',
    fields: ['email', 'password'],
    hint: 'Vous avez deja un compte dans une equipe.',
  },
  join: {
    label: 'Rejoindre une equipe',
    submit: "Rejoindre l'equipe",
    path: '/auth/join',
    fields: ['code', 'displayName', 'email', 'password'],
    hint: "Demandez son code a 6 chiffres au chef d'equipe.",
  },
  create: {
    label: 'Creer une equipe',
    submit: "Creer l'equipe",
    path: '/auth/teams',
    fields: ['teamName', 'displayName', 'email', 'password'],
    hint: 'Vous devenez chef de cette equipe et recevez son code.',
  },
};

const FIELDS = {
  code: { label: "Code d'equipe", type: 'text', inputMode: 'numeric', maxLength: 6, placeholder: '482913' },
  teamName: { label: "Nom de l'equipe", type: 'text', placeholder: 'DevOps Delivery Lab' },
  displayName: { label: 'Votre nom', type: 'text', placeholder: 'Alex' },
  email: { label: 'Email', type: 'email', placeholder: 'vous@exemple.fr' },
  password: { label: 'Mot de passe', type: 'password', placeholder: '8 caracteres minimum' },
};

const EMPTY = { code: '', teamName: '', displayName: '', email: '', password: '' };

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const config = MODES[mode];

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  const update = (field) => (event) => setValues({ ...values, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError('');

    try {
      const body = Object.fromEntries(config.fields.map((field) => [field, values[field].trim()]));
      // La reponse contient la paire de jetons et l'utilisateur : on la
      // transmet telle quelle, l'ecran n'a pas a connaitre sa composition.
      onAuthenticated(await apiFetch(config.path, { method: 'POST', body }));
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <header className="auth-header">
          <p className="eyebrow">DEVOPS DELIVERY LAB</p>
          <h1>Tasks Board</h1>
          <p className="intro">Le tableau de votre equipe, accessible sur invitation.</p>
        </header>

        <div className="auth-tabs" role="tablist" aria-label="Mode d'acces">
          {Object.entries(MODES).map(([key, value]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? 'auth-tab is-active' : 'auth-tab'}
              onClick={() => switchMode(key)}
            >
              {value.label}
            </button>
          ))}
        </div>

        <form className="auth-form" onSubmit={submit}>
          <p className="auth-hint">{config.hint}</p>

          {config.fields.map((field) => (
            <label key={field} className="auth-field" htmlFor={`auth-${field}`}>
              <span>{FIELDS[field].label}</span>
              <input
                id={`auth-${field}`}
                type={FIELDS[field].type}
                inputMode={FIELDS[field].inputMode}
                maxLength={FIELDS[field].maxLength}
                placeholder={FIELDS[field].placeholder}
                value={values[field]}
                onChange={update(field)}
                autoComplete={field === 'password' ? 'current-password' : 'off'}
                required
              />
            </label>
          ))}

          {/* role="alert" : un lecteur d'ecran annonce l'erreur des son apparition. */}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Patientez...' : config.submit}
          </button>
        </form>
      </section>
    </main>
  );
}
