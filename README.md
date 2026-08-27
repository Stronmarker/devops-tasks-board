# DevOps Tasks Board

Application de démonstration pour piloter des tâches DevOps avec un frontend React/Vite, une API Express et PostgreSQL.

## Prerequis

Seuls Git, Docker Desktop et Make sont nécessaires sur la machine. Node.js et npm sont exécutés uniquement dans les conteneurs.

## Demarrage local

```bash
make start
```

- Interface : http://localhost:5173
- API : http://localhost:3000
- Sante de l'API : http://localhost:3000/health

Les données de démonstration sont initialisées automatiquement au premier démarrage de PostgreSQL.

L'application demande une authentification. Deux comptes de démonstration existent :

| Compte | Email | Mot de passe | Rôle |
| --- | --- | --- | --- |
| Chef d'équipe | `chef@tasks.local` | `Demo1234!` | Voit le code d'invitation et peut le renouveler |
| Membre | `membre@tasks.local` | `Membre1234!` | Accès au tableau uniquement |

Le code d'invitation de l'équipe de démonstration est **482913**. Ces comptes n'existent que
pour la démonstration : leurs identifiants sont publiés ici et dans `infra/db/init_db.sql`.

## Authentification et equipes

Une équipe est un espace de travail fermé. On n'y entre que de deux façons : en créant sa
propre équipe (on en devient chef), ou en fournissant le code à 6 chiffres remis par le chef.
Sans compte, aucune route métier ne répond autre chose que `401`.

| Route | Accès | Rôle |
| --- | --- | --- |
| `POST /auth/teams` | Public | Crée une équipe et son chef, renvoie le code d'invitation |
| `POST /auth/join` | Public + code | Crée un membre dans l'équipe correspondant au code |
| `POST /auth/login` | Public | Renvoie la paire de jetons |
| `POST /auth/refresh` | Jeton de rafraîchissement | Échange le jeton contre une nouvelle paire |
| `POST /auth/logout` | Jeton de rafraîchissement | Révoque la session côté serveur |
| `GET /auth/me` | Jeton d'accès | Valide le jeton et renvoie l'identité |
| `GET /team` | Jeton d'accès | Membres de l'équipe ; le code n'est renvoyé qu'au chef |
| `POST /team/code` | Jeton d'accès + rôle chef | Remplace le code d'invitation |
| `DELETE /team/members/:id` | Jeton d'accès + rôle chef | Retire un membre de l'équipe |
| `GET`/`POST /tasks`, `GET /projects` | Jeton d'accès | Cloisonnés sur l'équipe du jeton |
| `PATCH /tasks/:id` | Jeton d'accès + rôle chef | Déplace la tâche d'une colonne à l'autre |
| `DELETE /tasks/:id` | Jeton d'accès + rôle chef | Supprime la tâche |

### Répartition des droits

| Action | Membre | Chef |
| --- | :---: | :---: |
| Voir le tableau et les projets | ✅ | ✅ |
| Créer une tâche | ✅ | ✅ |
| Déplacer une tâche entre colonnes | ❌ | ✅ |
| Supprimer une tâche | ❌ | ✅ |
| Voir le code d'invitation | ❌ | ✅ |
| Renouveler le code | ❌ | ✅ |
| Retirer un membre | ❌ | ✅ |

L'interface masque les boutons qu'un membre n'a pas le droit d'utiliser, mais **c'est le
serveur qui décide** : `requireLead` protège chaque route réservée. Masquer un bouton est du
confort, pas une protection — un appel direct à l'API reçoit `403`.

Deux garde-fous complètent le rôle : un chef ne peut pas se retirer lui-même, ce qui
laisserait l'équipe sans personne pour gérer le code et les membres ; et retirer un membre
supprime ses jetons de rafraîchissement en cascade, donc il perd l'accès au plus tard quinze
minutes après. Ses tâches restent au tableau : elles appartiennent à l'équipe, pas à lui.

### Deux jetons, deux rôles

| | Durée | Où il vit | Ce qu'il fait |
| --- | --- | --- | --- |
| Accès | 15 minutes | Mémoire du navigateur, jamais sur le disque | Accompagne chaque requête |
| Rafraîchissement | 7 jours | `localStorage`, **et en base côté serveur** | Sert uniquement à obtenir une nouvelle paire |

Un seul jeton de longue durée poserait un problème simple : volé, il ouvrirait l'application
jusqu'à son expiration, sans recours. La paire ramène cette fenêtre à quinze minutes et rend
la déconnexion réelle — supprimer la ligne en base coupe l'accès, ce qu'un jeton purement
signé ne permet pas.

**Rotation et détection de réutilisation.** Chaque rafraîchissement consomme le jeton présenté
et en émet un nouveau. Un jeton ne sert donc jamais deux fois. Si un jeton déjà consommé
revient, c'est qu'une copie circule : impossible de distinguer le voleur de la victime, alors
**toute la session de l'utilisateur est révoquée** et il doit se reconnecter. Vérifié par un
test d'intégration.

Le frontend rejoue automatiquement une requête reçue en `401` après avoir rafraîchi son jeton :
l'utilisateur ne voit rien. Les rafraîchissements concurrents sont sérialisés, sinon deux
onglets présenteraient le même jeton et déclencheraient la détection de réutilisation.

### Choix de sécurité

- **Mots de passe** hachés avec bcrypt à 12 tours, salés automatiquement. Deux comptes
  partageant un mot de passe n'ont pas le même hash.
- **Cloisonnement** : le filtre `team_id` vient du jeton, jamais d'un paramètre de requête.
  Un utilisateur ne peut donc pas demander le tableau d'une autre équipe. C'est vérifié par
  un test d'intégration dédié.
- **Énumération de comptes** : un email inconnu et un mot de passe faux renvoient exactement
  la même réponse. Un écart permettrait de découvrir quels comptes existent.
- **Limitation de débit** : 5 tentatives par quart d'heure sur `POST /auth/join`, 20 sur les
  autres routes d'authentification. Un code à 6 chiffres ne compte qu'un million de
  combinaisons ; sans cette limite, un script les épuiserait en quelques minutes.
- **Rotation du code** : le chef peut le remplacer à tout moment. Les comptes déjà créés
  restent valides, seul l'ancien code cesse d'ouvrir la porte.
- **`JWT_SECRET` obligatoire** : le backend refuse de démarrer sans lui plutôt que d'utiliser
  une valeur par défaut qui, présente dans le dépôt, rendrait tous les jetons falsifiables.
- **Jetons de rafraîchissement stockés hachés** (SHA-256) : une fuite de la base ne donnerait
  aucun jeton utilisable. SHA-256 suffit ici, contrairement aux mots de passe — le jeton est
  fait de 256 bits tirés au hasard, il n'y a rien à deviner par dictionnaire.
- **En-têtes HTTP** posés par Helmet, et corps de requête limité à 100 ko.

### Faiblesse assumée

Le jeton de rafraîchissement est conservé dans le `localStorage` : un script injecté dans la
page pourrait le lire. Un cookie `httpOnly` y résisterait, mais le frontend et l'API sont
déployés sur deux domaines Render distincts, ce qui impose `SameSite=None`, `Secure` et une
configuration CORS nettement plus fragile.

Le jeton d'accès, lui, ne touche jamais le disque — il vit dans la mémoire du module et
disparaît à la fermeture de l'onglet. Ce compromis est documenté dans `docs/decisions.md`.

## Commandes Make

| Commande | Action |
| --- | --- |
| `make help` | Liste les cibles disponibles |
| `make build` | Construit les images |
| `make start` | Démarre les services en arrière-plan |
| `make stop` | Arrête les services |
| `make restart` | Redémarre les services |
| `make logs` | Suit les journaux |
| `make lint` | Analyse le code du backend et du frontend (ESLint) |
| `make test` | Tests backend (unitaires + intégration) dans Docker |
| `make test-frontend` | Tests frontend (composants montés dans jsdom) |
| `make ci` | Rejoue localement l'enchaînement du pipeline |
| `make db-reset` | Vide la base **locale** et rejoue les données de démo |
| `make reset` | Repart d'une base vierge et reconstruit les images |
| `make clean` | Supprime services, volumes et images locales |

Les cibles `make` passent toutes par Docker Compose : elles n'agissent que sur les conteneurs
de la machine locale. Aucune ne peut atteindre la base Render, qui n'est joignable que par son
URL externe.

## Tests

| Fichier | Type | Ce qui est vérifié |
| --- | --- | --- |
| `backend/src/auth.test.js` | Unitaire | Hachage bcrypt, salage, signature et falsification de jeton, imprévisibilité des codes d'équipe et des jetons de rafraîchissement |
| `backend/src/server.test.js` | Unitaire | Validation des tâches : titre requis, statut autorisé, couleur hexadécimale stricte |
| `backend/src/routes.test.js` | Intégration | Chaîne complète sur une vraie base : inscription, connexion, rotation des jetons, **détection de réutilisation**, déconnexion, `401` sans jeton, `403` sur une action réservée au chef, et **absence de fuite entre deux équipes** |
| `frontend/src/App.test.jsx` | Composant | Écran de connexion, ouverture du tableau, code masqué aux membres, **rejeu transparent d'une requête après rafraîchissement**, retour à la connexion si la session est révoquée, couleur transmise à l'API |

Les tests d'intégration ont besoin d'une base PostgreSQL joignable. Ils sont ignorés
explicitement si `DATABASE_URL` ne répond pas, et toujours exécutés dans le pipeline,
où un service PostgreSQL est démarré à côté du job.

Le test frontend monte réellement le composant dans un DOM. C'est ce type de test qui
détecte une page blanche : un `curl` sur l'index HTML renvoie `200` même quand le bundle
JavaScript plante au démarrage.

## Pipeline CI/CD

Défini dans [.github/workflows/ci.yml](.github/workflows/ci.yml), déclenché à chaque push
et sur chaque pull request vers `main`.

```
lint (backend + frontend)
  ├── tests backend  (Node + service PostgreSQL 15)
  └── tests frontend (jsdom + build de production)
        └── build des images Docker
              └── déploiement Render          (main uniquement)
                    └── vérification /health  (post-déploiement)
```

Chaque étage ne démarre que si le précédent est vert : une régression ne peut pas
atteindre la production. Le déploiement est conditionné à `main`, de sorte qu'une branche
de travail est testée sans jamais être déployée.

Le dernier job n'est pas une formalité : il interroge `/health` sur l'URL publique jusqu'à
obtenir une réponse saine. Comme cette route exécute réellement un `SELECT 1`, un
déploiement n'est déclaré réussi que si l'application **et** sa base répondent.

### Secrets attendus

| Secret | Rôle |
| --- | --- |
| `RENDER_DEPLOY_HOOK_BACKEND` | URL de déclenchement du redéploiement du service backend |
| `RENDER_DEPLOY_HOOK_FRONTEND` | URL de déclenchement du redéploiement du site statique |

À récupérer dans Render (*Settings → Deploy Hook* de chaque service) et à déclarer dans
GitHub (*Settings → Secrets and variables → Actions*). En leur absence, le job signale
que Render redéploie via son auto-deploy natif et n'échoue pas.

## Variables d'environnement

| Variable | Service | Rôle |
| --- | --- | --- |
| `PORT` | backend | Port d'écoute de l'API |
| `DATABASE_URL` | backend | Connexion PostgreSQL complète, identifiants compris |
| `DATABASE_SSL` | backend | Force le TLS vers PostgreSQL même si l'URL ne le réclame pas |
| `JWT_SECRET` | backend | **Obligatoire.** Clé de signature des jetons d'accès. Générer une valeur par environnement : `openssl rand -base64 48` |
| `VITE_API_URL` | frontend | URL publique de l'API, compilée dans le bundle au build |

Le modèle est dans [backend/.env.example](backend/.env.example). Les valeurs réelles vivent
dans docker-compose pour le local, dans le Secret Kubernetes pour le cluster, et dans les
variables d'environnement Render pour le cloud — jamais dans le dépôt.

## Architecture

Le frontend communique avec l'API backend. Le backend persiste les tâches et projets dans PostgreSQL. Docker Compose fournit le réseau, les volumes et l'ordre de démarrage local.

## Deploiement

| Environnement | Outil | Emplacement |
| --- | --- | --- |
| Local | Docker Compose | `infra/docker/docker-compose.yml` |
| Orchestration | Kubernetes | `infra/k8s/` |
| Cloud | Render | Backend, site statique et PostgreSQL managé |

## Qualite et securite

ESLint verrouille la qualité du code des deux paquets, `npm ci` garantit des dépendances
identiques à chaque installation, et les images Docker sont reconstruites à chaque passage
du pipeline. Helmet pose les en-têtes de sécurité HTTP, bcrypt protège les mots de passe et
la limitation de débit freine les attaques par force brute — voir la section
[Authentification et equipes](#authentification-et-equipes).

L'analyse SAST, l'analyse dynamique avec OWASP ZAP et la matrice des risques seront ajoutées
progressivement.
