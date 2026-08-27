import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, validateTaskPayload, TASK_COLORS } from './server.js';

test.after(() => pool.end());

test('accepts a task with a title and a valid status', () => {
  assert.equal(validateTaskPayload({ title: 'Ajouter un scan SAST', status: 'todo' }), true);
});

test('uses todo as the default status', () => {
  assert.equal(validateTaskPayload({ title: 'Documenter le déploiement' }), true);
});

test('rejects an empty title', () => {
  assert.equal(validateTaskPayload({ title: '   ', status: 'todo' }), false);
});

test('rejects an unknown status', () => {
  assert.equal(validateTaskPayload({ title: 'Tâche invalide', status: 'blocked' }), false);
});

test('accepte les couleurs proposees par l interface', () => {
  for (const color of TASK_COLORS) {
    assert.equal(validateTaskPayload({ title: 'Tache coloree', color }), true, color);
  }
});

// La couleur finit dans un attribut de style du frontend : une valeur libre
// ouvrirait une injection. Seul un code hexadecimal a six chiffres est accepte.
test('rejette une couleur qui n est pas un code hexadecimal complet', () => {
  for (const color of ['rouge', '#FFF', '#GGGGGG', 'red; background:url(x)', '', 42]) {
    assert.equal(validateTaskPayload({ title: 'Tache', color }), false, String(color));
  }
});
