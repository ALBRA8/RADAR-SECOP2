#!/usr/bin/env bash
# scripts/test_security.sh — asserts curl de seguridad para RADAR-SECOP2 (Task 2-e).
# Uso: bash scripts/test_security.sh   (requiere dev server en :3000)
# NO tumba el servidor: usa archivos mínimos y endpoints baratos; el rate-limit
# se prueba con requests inválidas/claras que no tocan IA ni BD pesada.

set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
ko()   { echo "[FAIL] $1 — $2"; FAIL=$((FAIL+1)); }
skip() { echo "[SKIP] $1 — $2"; }

# Codes es la lista de códigos HTTP aceptados (separados por espacio).
assert_code() { # nombre, codes, code_obtenido
  local name="$1" want="$2" got="$3"
  echo " $want" | grep -qw "$got" && ok "$name (HTTP $got)" || ko "$name" "esperado [$want], obtenido [$got]"
}

echo "── 1) Health/smoke: raíz de la API responde ──"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api")
assert_code "S1 GET /api responde" "200" "$code"

echo "── 2) .bin renombrado a .pdf → 400 (magic bytes) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/media/analyze" \
  -F "file=@/home/z/my-project/scripts/audit_7c_bad.bin;type=application/pdf;filename=pliego_falso.pdf")
assert_code "S2 bin disfrazado de PDF rechazado" "400" "$code"

echo "── 3) .bin renombrado a audio → 400 (magic audio) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/media/analyze" \
  -F "file=@/home/z/my-project/scripts/audit_7c_bad.bin;type=audio/mpeg;filename=nota_falsa.mp3")
assert_code "S3 bin disfrazado de MP3 rechazado" "400" "$code"

echo "── 4) .bin renombrado a video → 400 (magic video) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/media/analyze" \
  -F "file=@/home/z/my-project/scripts/audit_7c_bad.bin;type=video/mp4;filename=video_falso.mp4")
assert_code "S4 bin disfrazado de MP4 rechazado" "400" "$code"

echo "── 5) SVG jamás entra al inbox (denylist XSS) ──"
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>' > /tmp/sec_test.svg
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/media/analyze" \
  -F "file=@/tmp/sec_test.svg;type=image/svg+xml;filename=xss.svg")
assert_code "S5 SVG rechazado en media/analyze" "400" "$code"

echo "── 6) SVG ya almacenado no se sirve inline (415) ni inline headers ──"
# Se prueba contra un medio real del inbox: headers deben ser attachment+nosniff (o 404/415 si no hay medios).
MEDIA_ID=$(curl -s "$BASE/api/channels/messages" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    ms=[m for m in d.get('messages',[]) if m.get('mediaPath')]
    print(ms[0]['id'] if ms else '')
except Exception: print('')")
if [ -n "$MEDIA_ID" ]; then
  headers=$(curl -s -D - -o /dev/null "$BASE/api/media/$MEDIA_ID/file")
  code=$(echo "$headers" | head -1 | awk '{print $2}')
  if [ "$code" = "200" ]; then
    cd_att=$(echo "$headers" | grep -i '^content-disposition:' | grep -qi 'attachment' && echo yes || echo no)
    cd_nosniff=$(echo "$headers" | grep -i '^x-content-type-options:' | grep -qi 'nosniff' && echo yes || echo no)
    cd_csp=$(echo "$headers" | grep -i '^content-security-policy:' | grep -qi 'sandbox' && echo yes || echo no)
    if [ "$cd_att" = "yes" ] && [ "$cd_nosniff" = "yes" ] && [ "$cd_csp" = "yes" ]; then
      ok "S6 medio servido como attachment+nosniff+CSP sandbox"
    else
      ko "S6 medio servido como attachment+nosniff+CSP sandbox" "attachment=$cd_att nosniff=$cd_nosniff sandbox=$cd_csp"
    fi
  else
    assert_code "S6 medio existente servible o bloqueado" "200 415" "$code"
  fi
else
  skip "S6 medio servido con headers seguros" "no hay mensajes con medio en el inbox"
fi

echo "── 7) Media inexistente → 404 (no fuga de rutas) ──"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/media/id-inexistente-xyz/file")
assert_code "S7 media inexistente" "404" "$code"

echo "── 8) MCP abierto en dev marca X-MCP-Auth: disabled ──"
hdr=$(curl -s -D - -o /dev/null -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' | grep -i '^x-mcp-auth:' | tr -d '\r' | awk '{print $2}')
[ "$(echo "$hdr" | tr '[:upper:]' '[:lower:]')" = "disabled" ] && ok "S8 X-MCP-Auth: disabled en dev" || ko "S8 X-MCP-Auth: disabled en dev" "header=[$hdr]"

echo "── 9) Lote MCP de 11 → el ítem excedente responde -32600 ──"
body=$(python3 -c "
import json
batch=[{'jsonrpc':'2.0','id':i,'method':'ping'} for i in range(1,12)]
print(json.dumps(batch))")
resp=$(curl -s -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -d "$body")
exceed=$(python3 -c "
import json,sys
try:
    arr=json.loads('''$resp''')
    last=arr[-1] if isinstance(arr,list) else {}
    e=(last.get('error') or {}).get('code')
    print('OK' if e==-32600 else 'BAD:'+str(e))
except Exception as ex: print('ERR:'+str(ex))")
[ "$exceed" = "OK" ] && ok "S9 batch 11 → -32600 en el excedente" || ko "S9 batch 11 → -32600 en el excedente" "$exceed"

echo "── 10) Rate limit MCP: 429 tras ~60 solicitudes baratas ──"
hit429=no
for i in $(seq 1 70); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -d 'not-json')
  if [ "$code" = "429" ]; then hit429=yes; break; fi
done
[ "$hit429" = "yes" ] && ok "S10 rate limit MCP dispara 429" || ko "S10 rate limit MCP dispara 429" "70 solicitudes sin 429"

echo "── 11) Conformidad MCP: GET → 405, DELETE → 204 (puede dar 429 si S10 agotó cupo) ──"
sleep 62  # libera la ventana del rate limit antes de las comprobaciones finales
code_get=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/mcp")
code_del=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/mcp")
assert_code "S11a GET /api/mcp" "405" "$code_get"
assert_code "S11b DELETE /api/mcp" "204" "$code_del"

echo
echo "════ RESUMEN test_security.sh ════"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
