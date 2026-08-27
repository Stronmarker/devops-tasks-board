import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateJoinCode,
  hashPassword,
  signToken,
  validateCredentialsPayload,
  validateEmail,
  validateJoinCode,
  validatePassword,
  verifyPassword,
  verifyToken,
} from './auth.js';

// Tests unitaires : aucune base, aucun serveur. Ils verifient les briques de
// securite isolement, la ou routes.test.js verifie leur assemblage.

test('accepte un email correctement forme', () => {
  assert.equal(validateEmail('chef@tasks.local'), true);
});

test('rejette un email sans domaine ou vide', () => {
  assert.equal(validateEmail('chef@tasks'), false);
  assert.equal(validateEmail('pas-un-email'), false);
  assert.equal(validateEmail(''), false);
  assert.equal(validateEmail(undefined), false);
});

test('exige au moins huit caracteres melant lettres et chiffres', () => {
  assert.equal(validatePassword('Demo1234!'), true);
  assert.equal(validatePassword('court1'), false, 'trop court');
  assert.equal(validatePassword('quelquechose'), false, 'aucun chiffre');
  assert.equal(validatePassword('12345678'), false, 'aucune lettre');
});

test('un code d equipe est exactement six chiffres', () => {
  assert.equal(validateJoinCode('482913'), true);
  assert.equal(validateJoinCode('48291'), false, 'cinq chiffres');
  assert.equal(validateJoinCode('4829134'), false, 'sept chiffres');
  assert.equal(validateJoinCode('48291a'), false, 'une lettre');
});

test('les codes generes respectent le format et ne se repetent pas', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i += 1) {
    const code = generateJoinCode();
    assert.match(code, /^[0-9]{6}$/);
    codes.add(code);
  }
  // Un generateur casse (constante, compteur) produirait une poignee de
  // valeurs distinctes ; 200 tirages sur un million doivent rester varies.
  assert.ok(codes.size > 190, `seulement ${codes.size} codes distincts sur 200`);
});

test('refuse une inscription incomplete', () => {
  const valide = { email: 'a@b.fr', password: 'Motdepasse1', displayName: 'Alex' };
  assert.equal(validateCredentialsPayload(valide), true);
  assert.equal(validateCredentialsPayload({ ...valide, email: 'nope' }), false);
  assert.equal(validateCredentialsPayload({ ...valide, password: 'court' }), false);
  assert.equal(validateCredentialsPayload({ ...valide, displayName: 'A' }), false);
  assert.equal(validateCredentialsPayload({}), false);
});

test('le mot de passe est hache et jamais stocke en clair', async () => {
  const password = 'Motdepasse1';
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.ok(!hash.includes(password));
  assert.match(hash, /^\$2[aby]\$/, 'doit etre un hash bcrypt');
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('MauvaisMotdepasse1', hash), false);
});

test('deux hachages du meme mot de passe different (sel aleatoire)', async () => {
  const [premier, second] = await Promise.all([hashPassword('Motdepasse1'), hashPassword('Motdepasse1')]);
  // Sans sel, deux comptes partageant un mot de passe auraient le meme hash :
  // une seule table arc-en-ciel casserait les deux d'un coup.
  assert.notEqual(premier, second);
});

test('le jeton transporte l identite et l equipe', () => {
  const token = signToken({ id: 7, team_id: 3, role: 'lead', display_name: 'Chef' });
  const payload = verifyToken(token);

  assert.equal(payload.sub, '7');
  assert.equal(payload.teamId, 3);
  assert.equal(payload.role, 'lead');
});

test('un jeton modifie est rejete', () => {
  const token = signToken({ id: 7, team_id: 3, role: 'member', display_name: 'Membre' });
  const [entete, charge, signature] = token.split('.');

  // On remplace la charge utile par un role d'administrateur en gardant la
  // signature d'origine : c'est l'attaque que la signature doit bloquer.
  const forgee = Buffer.from(JSON.stringify({ sub: '7', teamId: 3, role: 'lead' })).toString(
    'base64url',
  );

  assert.equal(verifyToken(`${entete}.${forgee}.${signature}`), null);
  assert.equal(verifyToken('pas.un.jeton'), null);
  assert.notEqual(charge, forgee);
});
