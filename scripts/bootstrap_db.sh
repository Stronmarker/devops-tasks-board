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

# shellcheck source=scripts/_db_lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_db_lib.sh"

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

require_url "$URL"
HOST="$(db_host "$URL")"


if [ "$RESET" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Refus : --reset supprime TOUTES les donnees de $HOST." >&2
    echo "Ajoutez --force si c'est bien l'intention." >&2
    exit 1
fi

if [ "$RESET" -eq 1 ]; then
    echo "Suppression des donnees de $HOST..."
    run_sql "$URL" reset_db.sql
fi

echo "Application du schema sur $HOST..."
run_sql "$URL" init_db.sql
echo "Termine. Verifiez avec : curl <url-backend>/health"
