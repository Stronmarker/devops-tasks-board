#!/usr/bin/env bash
#
# Interroge /health une fois par seconde et affiche le code HTTP avec l'heure.
# Destine a tourner dans un terminal pendant qu'un pod est supprime dans un
# autre : la colonne de codes 200 qui ne s'interrompt pas est la preuve visible
# que le service reste disponible pendant le remplacement.
#
#   ./scripts/watch_health.sh                        # cluster Kubernetes
#   ./scripts/watch_health.sh http://localhost:3000  # Docker Compose
#
# Ctrl+C pour arreter.

set -uo pipefail

URL="${1:-http://localhost:30300}/health"

VERT=$'\033[32m'; ROUGE=$'\033[31m'; GRIS=$'\033[90m'; RAZ=$'\033[0m'

printf '%s  %s%s%s\n\n' "$(date +%T)" "$GRIS" "surveillance de $URL" "$RAZ"

while true; do
    debut=$(date +%s%N)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL" || echo 000)
    ms=$(( ($(date +%s%N) - debut) / 1000000 ))

    if [ "$code" = "200" ]; then
        printf '%s  %sHTTP %s%s  %4s ms\n' "$(date +%T)" "$VERT" "$code" "$RAZ" "$ms"
    else
        printf '%s  %sHTTP %s%s  %4s ms  %sSERVICE INDISPONIBLE%s\n' \
            "$(date +%T)" "$ROUGE" "$code" "$RAZ" "$ms" "$ROUGE" "$RAZ"
    fi

    sleep 1
done
