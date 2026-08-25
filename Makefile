COMPOSE_FILE := infra/docker/docker-compose.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: build start stop restart logs test reset clean

build:
	$(COMPOSE) build

start:
	$(COMPOSE) up -d

stop:
	$(COMPOSE) down

restart: stop start

logs:
	$(COMPOSE) logs -f

test:
	$(COMPOSE) run --rm -e NODE_ENV=test backend npm test

reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build

clean:
	$(COMPOSE) down -v --rmi local
