#!/bin/bash
# Uso: ./upload-trips.sh /percorso/a/TripMy.json
#
# Prima di usarlo la prima volta:
#   export MYTRAVEL_URL="https://mytravel-maxpego.vercel.app"
#   export MYTRAVEL_ADMIN_SECRET="la-tua-password-segreta"
# (la stessa password che hai messo nella env var ADMIN_UPLOAD_SECRET su Vercel)

set -e

if [ -z "$1" ]; then
  echo "Uso: $0 /percorso/a/TripMy.json"
  exit 1
fi

if [ -z "$MYTRAVEL_URL" ] || [ -z "$MYTRAVEL_ADMIN_SECRET" ]; then
  echo "Imposta prima MYTRAVEL_URL e MYTRAVEL_ADMIN_SECRET (vedi commento in cima allo script)"
  exit 1
fi

curl -s -X POST "$MYTRAVEL_URL/api/upload-trips" \
  -H "Authorization: Bearer $MYTRAVEL_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  --data-binary "@$1" | python3 -m json.tool
