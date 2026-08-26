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
| `make reset` | Supprime les volumes et réinitialise la base |
| `make clean` | Supprime services, volumes et images locales |

## Tests

| Fichier | Type | Ce qui est vérifié |
| --- | --- | --- |
| `backend/src/server.test.js` | Unitaire | Validation des tâches (titre requis, statut autorisé) |
| `backend/src/routes.test.js` | Intégration | Routes HTTP sur une vraie base : `/health`, `/tasks`, `/projects`, création et rejet d'un statut inconnu |
| `frontend/src/App.test.jsx` | Composant | Montage du tableau dans jsdom, répartition des tâches par statut, message d'erreur si l'API est indisponible |

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
du pipeline. L'analyse SAST, l'analyse dynamique avec OWASP ZAP et la matrice des risques
seront ajoutées progressivement.
