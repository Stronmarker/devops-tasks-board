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
K8S_DIR := infra/k8s

.PHONY: help build start stop restart logs test test-frontend lint ci \
        k8s-images k8s-init k8s-start k8s-status k8s-watch k8s-logs k8s-stop k8s-clean \
        db-reset db-bootstrap db-suppr reset clean

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
	@echo ""
	@echo "  Kubernetes :"
	@echo "  make k8s-start     Construire les images, appliquer les manifests, attendre les pods"
	@echo "  make k8s-status    Etat des pods, services et volumes"
	@echo "  make k8s-watch     Sonder /health en continu (pour la demo de resilience)"
	@echo "  make k8s-logs      Suivre les logs du backend"
	@echo "  make k8s-stop      Supprimer les deployments (le volume de donnees est conserve)"
	@echo "  make k8s-clean     Tout supprimer, volume de donnees compris"
	@echo ""
	@echo "  Base de donnees :"
	@echo "  make db-reset      Vider la base locale et rejouer les donnees de demo"
	@echo "  make db-bootstrap  Restaurer une base distante : DATABASE_URL=... make db-bootstrap"
	@echo "  make db-suppr      SUPPRIMER completement la base (confirmation au clavier)"
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
# --- Kubernetes -------------------------------------------------------------
# Les images ne sont pas poussees sur un registre : elles sont construites dans
# le demon Docker local, que le cluster Docker Desktop partage. C'est pourquoi
# les manifests portent imagePullPolicy: IfNotPresent - sans cela Kubernetes
# tenterait de les telecharger depuis Docker Hub et echouerait.
k8s-images:
	docker build -t tasks/backend:latest ./backend
	docker build -t tasks/frontend:latest ./frontend

# Le schema SQL est trop volumineux pour etre recopie a la main dans un
# manifest. On genere la ConfigMap depuis le fichier source, ce qui garantit
# que Kubernetes et Docker Compose initialisent la base avec le meme script.
# --dry-run=client | kubectl apply : cree la ressource si absente, la met a jour
# sinon, la ou un simple `kubectl create` echouerait au second appel.
k8s-init:
	kubectl create configmap postgres-init-sql \
		--from-file=01-init.sql=infra/db/init_db.sql \
		--dry-run=client -o yaml | kubectl apply -f -

k8s-start: k8s-images k8s-init
	kubectl apply -f $(K8S_DIR)
	kubectl rollout status deployment/postgres --timeout=180s
	kubectl rollout status deployment/backend  --timeout=180s
	kubectl rollout status deployment/frontend --timeout=180s
	@echo ""
	@echo "  Interface : http://localhost:30080"
	@echo "  API       : http://localhost:30300/health"

k8s-status:
	@kubectl get pods
	@echo ""
	@kubectl get svc,pvc

# Sonde /health chaque seconde. A lancer dans un terminal pendant qu'on
# supprime un pod dans un autre : la colonne de 200 ininterrompue montre que le
# service reste disponible pendant le remplacement.
k8s-watch:
	@./scripts/watch_health.sh

k8s-logs:
	kubectl logs -f deployment/backend

# Conserve le PersistentVolumeClaim : les donnees survivent a l'arret, c'est
# tout l'interet d'un volume persistant par rapport a un conteneur jetable.
k8s-stop:
	kubectl delete -f $(K8S_DIR) --ignore-not-found=true --wait=false
	kubectl delete configmap postgres-init-sql --ignore-not-found=true
	@echo "Deployments supprimes. Le volume de donnees est conserve (make k8s-clean pour l'effacer)."

k8s-clean: k8s-stop
	kubectl delete pvc postgres-pvc --ignore-not-found=true

# --- Base de donnees --------------------------------------------------------
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

# Supprime les tables elles-memes, pas seulement leur contenu. Irreversible.
# Le script demande de taper "supprimer" et refuse de s'executer sans clavier :
# aucune CI ne peut donc la declencher.
db-suppr:
	@./scripts/drop_db.sh

reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build

clean:
	$(COMPOSE) down -v --rmi local
