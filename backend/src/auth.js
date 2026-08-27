import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Cout du hachage bcrypt. 12 tours represente environ 250 ms de calcul : assez
// lent pour rendre une attaque par dictionnaire couteuse, assez rapide pour ne
// pas degrader la connexion d'un utilisateur legitime.
const SALT_ROUNDS = 12;

// Le jeton d'acces est volontairement tres court : c'est lui qui circule a
// chaque requete, donc lui qui risque d'etre intercepte. 15 minutes bornent les
// degats d'un vol. Le jeton de rafraichissement, lui, ne sort du navigateur que
// pour en obtenir un nouveau.
export const ACCESS_TTL = '15m';
export const REFRESH_TTL_DAYS = 7;

// Aucune valeur par defaut n'est prevue : un secret code en dur serait present
// dans le depot, donc connu de tous, et signerait des jetons falsifiables.
// L'application refuse de demarrer plutot que de tourner avec une securite
// factice. Le secret est fourni par docker-compose, le Secret Kubernetes ou
// les variables d'environnement Render.
export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET est obligatoire. Definissez-le dans votre environnement ' +
      '(voir backend/.env.example) avant de demarrer le backend.',
  );
}

export const PASSWORD_MIN_LENGTH = 8;

export function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Une longueur minimale accompagnee d'un melange lettres/chiffres. On ne va pas
// plus loin volontairement : imposer des regles complexes pousse a reutiliser
// des mots de passe, c'est la recommandation de l'ANSSI et du NIST.
export function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

export function validateJoinCode(code) {
  return typeof code === 'string' && /^[0-9]{6}$/.test(code.trim());
}

export function validateDisplayName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 120;
}

// Messages par champ. Un refus global ne dit pas quoi corriger : l'utilisateur
// relit ses quatre champs sans savoir lequel pose probleme.
export const FIELD_MESSAGES = {
  teamName: "Le nom de l'equipe doit faire au moins 2 caracteres",
  displayName: 'Votre nom doit faire au moins 2 caracteres',
  email: 'Email invalide (exemple : vous@domaine.fr)',
  password: `Mot de passe : ${PASSWORD_MIN_LENGTH} caracteres minimum, avec au moins une lettre et un chiffre`,
  code: "Le code d'equipe doit faire exactement 6 chiffres",
};

// Renvoie un objet vide si tout est valide, sinon un message par champ fautif.
export function collectFieldErrors(payload = {}, { withTeamName = false, withCode = false } = {}) {
  const errors = {};

  if (withTeamName && !validateDisplayName(payload.teamName)) errors.teamName = FIELD_MESSAGES.teamName;
  if (withCode && !validateJoinCode(payload.code)) errors.code = FIELD_MESSAGES.code;
  if (!validateDisplayName(payload.displayName)) errors.displayName = FIELD_MESSAGES.displayName;
  if (!validateEmail(payload.email)) errors.email = FIELD_MESSAGES.email;
  if (!validatePassword(payload.password)) errors.password = FIELD_MESSAGES.password;

  return errors;
}

export function validateCredentialsPayload(payload = {}) {
  return (
    validateEmail(payload.email) &&
    validatePassword(payload.password) &&
    validateDisplayName(payload.displayName)
  );
}

// crypto.randomInt utilise le generateur cryptographique du systeme, contrairement
// a Math.random dont la suite est previsible : un code d'equipe devinable
// annulerait la protection de l'espace de travail.
export function generateJoinCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), teamId: user.team_id, role: user.role, name: user.display_name },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL },
  );
}

// Jeton de rafraichissement : une valeur opaque, pas un JWT. Il n'a rien a
// transporter puisque le serveur le retrouve en base ; 256 bits aleatoires
// suffisent et rendent la valeur indevinable.
export function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshExpiryDate(now = new Date()) {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function readBearerToken(request) {
  const header = request.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

// Middleware place devant toutes les routes metier. Il resout l'identite une
// seule fois et depose req.user ; les routes n'ont plus a se demander qui
// appelle, elles filtrent simplement sur req.user.teamId.
export function requireAuth(request, response, next) {
  const token = readBearerToken(request);
  const payload = token ? verifyToken(token) : null;

  if (!payload) {
    return response.status(401).json({ error: 'Authentification requise' });
  }

  request.user = {
    id: Number(payload.sub),
    teamId: payload.teamId,
    role: payload.role,
    displayName: payload.name,
  };
  next();
}

// Le code d'equipe est un secret d'administration : seul le chef le lit et le
// fait tourner. Un membre qui obtiendrait le code pourrait inviter n'importe
// qui sans que le chef le sache.
export function requireLead(request, response, next) {
  if (request.user?.role !== 'lead') {
    return response.status(403).json({ error: "Reserve au chef d'equipe" });
  }
  next();
}
