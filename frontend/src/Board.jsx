import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import ConfirmButton from './ConfirmButton.jsx';

// Palette proposee a l'utilisateur. Le backend revalide la valeur recue : une
// couleur choisie ailleurs que dans cette liste est rejetee cote serveur.
const COLORS = [
  { value: '#6366F1', name: 'Indigo' },
  { value: '#0EA5E9', name: 'Bleu' },
  { value: '#22C55E', name: 'Vert' },
  { value: '#F97316', name: 'Orange' },
  { value: '#EF4444', name: 'Rouge' },
  { value: '#A855F7', name: 'Violet' },
];

const COLUMNS = [
  { status: 'todo', label: 'A faire' },
  { status: 'doing', label: 'En cours' },
  { status: 'done', label: 'Terminees' },
];

export default function Board({ isLead, onUnauthorized }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [color, setColor] = useState(COLORS[0].value);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // useCallback : sans identite stable, la fonction serait recreee a chaque
  // rendu et l'effet ci-dessous se relancerait en boucle.
  const loadTasks = useCallback(async () => {
    try {
      setTasks(await apiFetch('/tasks'));
      setError('');
    } catch (loadError) {
      // Un jeton expire pendant la session doit ramener a l'ecran de connexion,
      // pas afficher un tableau vide sans explication.
      if (loadError.status === 401) return onUnauthorized();
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Deplacer et supprimer sont reserves au chef d'equipe. Le serveur le verifie
  // aussi : masquer un bouton n'est pas une protection, seulement du confort.
  const runLeadAction = async (action) => {
    try {
      await action();
      await loadTasks();
    } catch (actionError) {
      if (actionError.status === 401) return onUnauthorized();
      setError(actionError.message);
    }
  };

  const moveTask = (task, direction) => {
    const index = COLUMNS.findIndex((column) => column.status === task.status);
    const target = COLUMNS[index + direction];
    if (!target) return;

    return runLeadAction(() =>
      apiFetch(`/tasks/${task.id}`, { method: 'PATCH', body: { status: target.status } }),
    );
  };

  const deleteTask = (task) => runLeadAction(() => apiFetch(`/tasks/${task.id}`, { method: 'DELETE' }));

  const addTask = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;

    try {
      await apiFetch('/tasks', { method: 'POST', body: { title, status, color } });
      setTitle('');
      await loadTasks();
    } catch (addError) {
      if (addError.status === 401) return onUnauthorized();
      setError(addError.message);
    }
  };

  return (
    <section className="workspace">
      <form className="task-form" onSubmit={addTask}>
        <label htmlFor="title">Nouvelle tache</label>
        <div className="form-row">
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex. Ajouter un scan SAST"
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Statut">
            {COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
          <button type="submit" className="primary">
            Ajouter
          </button>
        </div>

        {/* Groupe de boutons radio : la couleur reste selectionnable au clavier
            et chaque option porte son nom, jamais la couleur seule. */}
        <fieldset className="color-picker">
          <legend>Couleur</legend>
          {COLORS.map((option) => (
            <label key={option.value} className="color-option">
              <input
                type="radio"
                name="color"
                value={option.value}
                checked={color === option.value}
                onChange={(event) => setColor(event.target.value)}
              />
              <span className="color-dot" style={{ backgroundColor: option.value }} aria-hidden="true" />
              <span className="color-name">{option.name}</span>
            </label>
          ))}
        </fieldset>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="loading">Chargement des taches...</p>
      ) : (
        <div className="board">
          {COLUMNS.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column.status);

            return (
              <section className="column" key={column.status}>
                <h2>
                  {column.label} <span className="count">{columnTasks.length}</span>
                </h2>

                {columnTasks.length === 0 ? (
                  <p className="empty">Aucune tache</p>
                ) : (
                  columnTasks.map((task) => {
                    const index = COLUMNS.findIndex((c) => c.status === task.status);

                    return (
                      <article
                        className="task"
                        key={task.id}
                        style={{ borderLeftColor: task.color || COLORS[0].value }}
                      >
                        <h3>{task.title}</h3>
                        {task.project_name && <p className="task-project">{task.project_name}</p>}
                        {task.created_by_name && (
                          <p className="task-author">Ajoutee par {task.created_by_name}</p>
                        )}

                        {isLead && (
                          <div className="task-actions">
                            {/* Le titre est repris dans chaque intitule : sans
                                lui, un lecteur d'ecran annoncerait quinze
                                boutons "Avancer" indiscernables. */}
                            <button
                              type="button"
                              className="move"
                              aria-label={`Reculer : ${task.title}`}
                              title="Reculer"
                              disabled={index === 0}
                              onClick={() => moveTask(task, -1)}
                            >
                              &#8592;
                            </button>
                            <button
                              type="button"
                              className="move"
                              aria-label={`Avancer : ${task.title}`}
                              title="Avancer"
                              disabled={index === COLUMNS.length - 1}
                              onClick={() => moveTask(task, 1)}
                            >
                              &#8594;
                            </button>
                            <ConfirmButton
                              label="Supprimer"
                              title={`Supprimer : ${task.title}`}
                              onConfirm={() => deleteTask(task)}
                            />
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
