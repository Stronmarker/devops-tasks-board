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
| `make build` | Construit les images |
| `make start` | Démarre les services en arrière-plan |
| `make stop` | Arrête les services |
| `make restart` | Redémarre les services |
| `make logs` | Suit les journaux |
| `make test` | Lance les tests backend dans Docker |
| `make reset` | Supprime les volumes et réinitialise la base |
| `make clean` | Supprime services, volumes et images locales |

## Architecture

Le frontend communique avec l'API backend. Le backend persiste les tâches et projets dans PostgreSQL. Docker Compose fournit le réseau, les volumes et l'ordre de démarrage local.

## Qualite et securite

Les tests, l'analyse SAST, l'analyse dynamique avec OWASP ZAP et la matrice des risques seront ajoutés progressivement dans le pipeline CI/CD.