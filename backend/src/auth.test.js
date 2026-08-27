import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFieldErrors,
  generateJoinCode,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshExpiryDate,
  REFRESH_TTL_DAYS,
  signAccessToken,
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

test('signale precisement le champ fautif, pas un refus global', () => {
  const base = { teamName: 'Mon equipe', displayName: 'Alex', email: 'alex@test.fr', password: 'Alex1234' };
  const champs = (patch) => Object.keys(collectFieldErrors({ ...base, ...patch }, { withTeamName: true }));

  assert.deepEqual(champs({}), [], 'une saisie correcte ne produit aucune erreur');
  assert.deepEqual(champs({ password: 'motdepasse' }), ['password'], 'mot de passe sans chiffre');
  assert.deepEqual(champs({ password: 'Alex123' }), ['password'], 'sept caracteres');
  assert.deepEqual(champs({ email: 'alex@test' }), ['email'], 'domaine incomplet');
  assert.deepEqual(champs({ displayName: 'A' }), ['displayName'], 'nom trop court');
  assert.deepEqual(champs({ teamName: '' }), ['teamName'], "nom d'equipe vide");
});

test('cumule les erreurs quand plusieurs champs sont fautifs', () => {
  const champs = collectFieldErrors({ displayName: '', email: 'nope', password: 'x' }, { withCode: true });
  assert.deepEqual(Object.keys(champs).sort(), ['code', 'displayName', 'email', 'password']);
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
  const token = signAccessToken({ id: 7, team_id: 3, role: 'lead', display_name: 'Chef' });
  const payload = verifyToken(token);

  assert.equal(payload.sub, '7');
  assert.equal(payload.teamId, 3);
  assert.equal(payload.role, 'lead');
});

test('un jeton de rafraichissement est long, aleatoire et opaque', () => {
  const jetons = new Set();
  for (let i = 0; i < 100; i += 1) {
    const token = generateRefreshToken();
    // 32 octets en base64url : indevinable, et sans structure lisible
    // contrairement a un JWT dont la charge utile se decode a vue.
    assert.ok(token.length >= 42, `jeton trop court : ${token.length}`);
    assert.equal(token.includes('.'), false);
    jetons.add(token);
  }
  assert.equal(jetons.size, 100, 'les jetons doivent tous differer');
});

test('seule l empreinte du jeton de rafraichissement est stockable', () => {
  const token = generateRefreshToken();
  const empreinte = hashRefreshToken(token);

  assert.match(empreinte, /^[0-9a-f]{64}$/, 'SHA-256 en hexadecimal');
  assert.notEqual(empreinte, token);
  // Deterministe : c'est ce qui permet de retrouver la ligne en base par index.
  assert.equal(hashRefreshToken(token), empreinte);
  assert.notEqual(hashRefreshToken(generateRefreshToken()), empreinte);
});

test('la date d expiration du rafraichissement est a sept jours', () => {
  const maintenant = new Date('2026-08-27T10:00:00Z');
  const expiration = refreshExpiryDate(maintenant);
  const jours = (expiration - maintenant) / (24 * 60 * 60 * 1000);

  assert.equal(jours, REFRESH_TTL_DAYS);
  assert.equal(jours, 7);
});

test('un jeton modifie est rejete', () => {
  const token = signAccessToken({ id: 7, team_id: 3, role: 'member', display_name: 'Membre' });
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
