#!/usr/bin/env bash
#
# Suppression complete de la base : les tables elles-memes, pas seulement leur
# contenu. Operation irreversible et sans sauvegarde prealable.
#
# Pour tout reconstruire ensuite : make db-bootstrap
#
# Trois protections, parce que la cible peut etre la base de production :
#   - le mot "supprimer" doit etre tape en toutes lettres
#   - l'hote vise est affiche avant la question
#   - la commande refuse de s'executer sans clavier, donc jamais dans une CI

set -euo pipefail

# shellcheck source=scripts/_db_lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_db_lib.sh"

URL="${1:-${DATABASE_URL:-}}"
require_url "$URL"
HOST="$(db_host "$URL")"

# Sans terminal, impossible de demander une confirmation : on refuse plutot que
# de laisser passer. Un pipeline automatise ne peut donc pas declencher ceci.
if [ ! -r /dev/tty ]; then
    echo "Refus : cette commande exige une confirmation au clavier." >&2
    echo "Elle ne peut pas etre lancee depuis un script ou une CI." >&2
    exit 1
fi

cat <<TXT

  ┌────────────────────────────────────────────────────────┐
  │  SUPPRESSION COMPLETE DE LA BASE                       │
  └────────────────────────────────────────────────────────┘

  Hote vise : $HOST

  Seront supprimees definitivement :
    - toutes les equipes et leurs codes d'invitation
    - tous les comptes et leurs mots de passe
    - toutes les taches et tous les projets
    - toutes les sessions ouvertes

  Aucune sauvegarde n'est effectuee.
  Pour reconstruire ensuite : make db-bootstrap

TXT

printf '  Tapez "supprimer" pour confirmer : '
read -r reponse < /dev/tty || reponse=''
echo

if [ "$reponse" != "supprimer" ]; then
    echo "  Annule. Rien n'a ete supprime."
    exit 1
fi

echo "  Suppression des tables de $HOST..."
run_sql "$URL" drop_db.sql
echo "  Termine. La base est vide. Rejouez : make db-bootstrap"
