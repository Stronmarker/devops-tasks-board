# Charge un .env a la racine s'il existe, pour ne pas retaper l'URL de la base
# distante a chaque appel. Ce fichier n'est jamais versionne (voir .gitignore).
#
# Consequence a connaitre : une fois DATABASE_URL presente ici, db-bootstrap
# vise la base distante sans autre geste. La protection ne repose donc plus que
# sur --reset --force, qui reste obligatoire pour toute suppression.
#
# Ecrire les valeurs SANS guillemets : make les traiterait comme des caracteres
# du mot de passe.
-include .env
export DATABASE_URL

COMPOSE_FILE := infra/docker/docker-compose.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: help build start stop restart logs test test-frontend lint ci db-reset db-bootstrap reset clean

help:
	@echo "Cibles disponibles :"
	@echo "  make start         Demarrer la stack (frontend + backend + PostgreSQL)"
	@echo "  make stop          Arreter la stack"
	@echo "  make restart       Redemarrer la stack"
	@echo "  make logs          Suivre les logs"
	@echo "  make build         Reconstruire les images"
	@echo "  make lint          Analyser le code (backend + frontend)"
	@echo "  make test          Tests backend (unitaires + integration)"
	@echo "  make test-frontend Tests frontend (composants dans jsdom)"
	@echo "  make ci            Rejouer localement les verifications du pipeline"
	@echo "  make db-reset      Vider la base locale et rejouer les donnees de demo"
	@echo "  make db-bootstrap  Restaurer une base distante : DATABASE_URL=... make db-bootstrap"
	@echo "  make reset         Repartir d'une base vierge (reconstruit aussi les images)"
	@echo "  make clean         Tout supprimer (conteneurs, volumes, images)"

build:
	$(COMPOSE) build

start:
	$(COMPOSE) up -d

stop:
	$(COMPOSE) down

restart: stop start

logs:
	$(COMPOSE) logs -f

lint:
	cd backend && npm run lint
	cd frontend && npm run lint

test:
	$(COMPOSE) run --rm -e NODE_ENV=test backend npm test

test-frontend:
	cd frontend && npm test

# Meme enchainement que le pipeline GitHub Actions : on detecte une erreur
# avant de pousser, plutot que d'attendre le run de la CI.
ci: lint test test-frontend
	cd frontend && npm run build

# Vide la base LOCALE uniquement : la commande passe par docker compose, qui ne
# connait que les conteneurs de cette machine. Render n'est joignable que par son
# URL externe et n'est donc jamais atteint par une cible make.
db-reset:
	$(COMPOSE) exec -T db psql -U devops -d tasksdb -c \
		"TRUNCATE TABLE refresh_tokens, tasks, projects, users, teams RESTART IDENTITY CASCADE;"
	$(COMPOSE) exec -T db psql -U devops -d tasksdb -f /docker-entrypoint-initdb.d/01-init.sql
	@echo "Base locale reinitialisee avec les donnees de demo."

# Seule cible capable de viser une base DISTANTE (Render). Volontairement sans
# valeur par defaut : l'URL doit etre fournie explicitement a chaque appel, pour
# qu'une base de production ne puisse pas etre atteinte par megarde.
#   DATABASE_URL="postgres://..." make db-bootstrap
#   DATABASE_URL="postgres://..." make db-bootstrap ARGS="--reset --force"
db-bootstrap:
	@test -n "$(DATABASE_URL)" || { \
		echo "DATABASE_URL est obligatoire."; \
		echo "  DATABASE_URL=\"postgres://...\" make db-bootstrap"; \
		exit 1; }
	@./scripts/bootstrap_db.sh $(ARGS) "$(DATABASE_URL)"

reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build

clean:
	$(COMPOSE) down -v --rmi local
