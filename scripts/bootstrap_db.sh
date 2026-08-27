#!/usr/bin/env bash
#
# Restauration de la base du DevOps Tasks Board.
#
# Applique infra/db/init_db.sql sur la base ciblee. Le script SQL etant
# idempotent, il cree ce qui manque et laisse le reste intact : on peut donc le
# rejouer sans risque sur une base deja peuplee.
#
# Cas d'usage principal : la base managee Render expire au bout de 30 jours sur
# le plan gratuit. Il faut alors en creer une nouvelle, mettre a jour la
# variable DATABASE_URL du backend, et rejouer ce script.
#
#   ./scripts/bootstrap_db.sh "postgres://..."      # cree / met a niveau
#   ./scripts/bootstrap_db.sh --reset --force "..." # vide puis recree
#
# L'URL peut aussi venir de la variable d'environnement DATABASE_URL.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_DIR="$ROOT_DIR/infra/db"

RESET=0
FORCE=0
URL="${DATABASE_URL:-}"

usage() {
    cat <<'TXT'
Restauration de la base du DevOps Tasks Board.

Applique infra/db/init_db.sql sur la base ciblee. Le script SQL etant
idempotent, il cree ce qui manque et laisse le reste intact : on peut donc le
rejouer sans risque sur une base deja peuplee.

Usage :
  ./scripts/bootstrap_db.sh "postgres://..."        cree ou met a niveau
  ./scripts/bootstrap_db.sh --reset --force "..."   vide puis recree
  DATABASE_URL="postgres://..." ./scripts/bootstrap_db.sh

Options :
  --reset   vide toutes les tables avant d'appliquer le schema
  --force   confirme la suppression (obligatoire avec --reset)
  -h        affiche cette aide

Cas d'usage principal : la base managee Render expire au bout de 30 jours sur
le plan gratuit. Creer une nouvelle base, mettre a jour DATABASE_URL sur le
service backend, puis rejouer ce script.
TXT
}

while [ $# -gt 0 ]; do
    case "$1" in
        --reset) RESET=1 ;;
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "Option inconnue : $1" >&2; exit 1 ;;
        *) URL="$1" ;;
    esac
    shift
done

if [ -z "$URL" ]; then
    echo "Erreur : aucune URL de base fournie." >&2
    echo "  ./scripts/bootstrap_db.sh \"postgres://...\"  ou  DATABASE_URL=... $0" >&2
    exit 1
fi

# Hote seul, sans identifiants : le script affiche sur quelle base il agit sans
# jamais ecrire un mot de passe dans un terminal ou un journal de CI.
HOST="$(printf '%s' "$URL" | sed -E 's#^[a-zA-Z+]+://[^@]*@##; s#[:/?].*$##')"

# Les NOTICE d'idempotence ("relation deja existante") noieraient une vraie
# erreur dans le bruit. On remonte le seuil a warning : les erreurs restent
# visibles, et ON_ERROR_STOP interrompt le script des la premiere.
export PGOPTIONS='-c client_min_messages=warning'

run_sql() {
    local file="$1"

    if command -v psql >/dev/null 2>&1; then
        # ON_ERROR_STOP : sans lui, psql poursuit apres une erreur et renvoie 0,
        # ce qui ferait passer une restauration ratee pour un succes.
        psql "$URL" -v ON_ERROR_STOP=1 -q -f "$SQL_DIR/$file"
    else
        # Repli sans psql installe : le client officiel dans un conteneur.
        # localhost designerait le conteneur lui-meme, d'ou la reecriture.
        local url_docker="${URL//localhost/host.docker.internal}"
        url_docker="${url_docker//127.0.0.1/host.docker.internal}"
        docker run --rm -i -e PGOPTIONS -v "$SQL_DIR:/sql:ro" postgres:15-alpine \
            psql "$url_docker" -v ON_ERROR_STOP=1 -q -f "/sql/$file"
    fi
}

if [ "$RESET" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Refus : --reset supprime TOUTES les donnees de $HOST." >&2
    echo "Ajoutez --force si c'est bien l'intention." >&2
    exit 1
fi

if [ "$RESET" -eq 1 ]; then
    echo "Suppression des donnees de $HOST..."
    run_sql reset_db.sql
fi

echo "Application du schema sur $HOST..."
run_sql init_db.sql
echo "Termine. Verifiez avec : curl <url-backend>/health"
