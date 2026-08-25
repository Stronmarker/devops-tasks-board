import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, validateTaskPayload } from './server.js';

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