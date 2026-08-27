# Fonctions partagees par les scripts de base de donnees.
# Fichier destine a etre source, pas execute directement.

SQL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infra/db" && pwd)"

# Les NOTICE d'idempotence noieraient une vraie erreur dans le bruit. On remonte
# le seuil a warning : les erreurs restent visibles.
export PGOPTIONS='-c client_min_messages=warning'

# Hote seul, sans identifiants : les scripts affichent sur quelle base ils
# agissent sans jamais ecrire un mot de passe dans un terminal ou un journal.
db_host() {
    printf '%s' "$1" | sed -E 's#^[a-zA-Z+]+://[^@]*@##; s#[:/?].*$##'
}

require_url() {
    if [ -z "${1:-}" ]; then
        echo "Erreur : aucune URL de base fournie." >&2
        echo "  DATABASE_URL=\"postgres://...\" make <cible>, ou renseignez .env" >&2
        exit 1
    fi
}

run_sql() {
    local url="$1" file="$2"

    if command -v psql >/dev/null 2>&1; then
        # ON_ERROR_STOP : sans lui, psql poursuit apres une erreur et renvoie 0,
        # ce qui ferait passer une operation ratee pour un succes.
        psql "$url" -v ON_ERROR_STOP=1 -q -f "$SQL_DIR/$file"
    else
        # Repli sans psql installe : le client officiel dans un conteneur.
        # localhost designerait le conteneur lui-meme, d'ou la reecriture.
        local url_docker="${url//localhost/host.docker.internal}"
        url_docker="${url_docker//127.0.0.1/host.docker.internal}"
        docker run --rm -i -e PGOPTIONS -v "$SQL_DIR:/sql:ro" postgres:15-alpine \
            psql "$url_docker" -v ON_ERROR_STOP=1 -q -f "/sql/$file"
    fi
}
