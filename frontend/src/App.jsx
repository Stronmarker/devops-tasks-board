import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [error, setError] = useState('');

  const loadTasks = async () => {
    try {
      const response = await fetch(`${apiUrl}/tasks`);
      if (!response.ok) throw new Error('Chargement impossible');
      setTasks(await response.json());
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const addTask = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    const response = await fetch(`${apiUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, status }),
    });
    if (response.ok) {
      setTitle('');
      await loadTasks();
    } else {
      setError('Création impossible');
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">DEVOPS DELIVERY LAB</p>
        <h1>Tasks Board</h1>
        <p className="intro">Un espace simple pour piloter les tâches techniques du projet.</p>
      </header>

      <section className="workspace">
        <form className="task-form" onSubmit={addTask}>
          <label htmlFor="title">Nouvelle tâche</label>
          <div className="form-row">
            <input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex. Ajouter un scan SAST" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Statut">
              <option value="todo">À faire</option>
              <option value="doing">En cours</option>
              <option value="done">Terminée</option>
            </select>
            <button type="submit">Ajouter</button>
          </div>
        </form>

        {error && <p className="error">{error}</p>}
        <div className="board">
          {['todo', 'doing', 'done'].map((columnStatus) => (
            <section className="column" key={columnStatus}>
              <h2>{columnStatus === 'todo' ? 'À faire' : columnStatus === 'doing' ? 'En cours' : 'Terminées'}</h2>
              {tasks.filter((task) => task.status === columnStatus).map((task) => (
                <article className="task" key={task.id}>
                  <h3>{task.title}</h3>
                  {task.project_name && <p>{task.project_name}</p>}
                </article>
              ))}
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
