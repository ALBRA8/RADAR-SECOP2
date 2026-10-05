#!/usr/bin/env bash
# AUDIT 7-c — Caminos de degradación sin credenciales reales (solo lectura/POST de prueba)
B=http://localhost:3000
H='Content-Type: application/json'

run() { echo "--- $1"; shift; curl -s -m 60 -w '\n[HTTP %{http_code}]\n' "$@"; echo; }

echo "=== a) POST /api/channels/telegram/webhook (update válido, bot SIN configurar) ==="
run "a" -X POST $B/api/channels/telegram/webhook -H "$H" \
  -d '{"update_id":990001,"message":{"message_id":990001,"date":1759700000,"chat":{"id":777001,"type":"private"},"from":{"id":777001,"first_name":"Audit7C"},"text":"Hola, prueba de auditoria 7c"}}'

echo "=== b1) POST /api/channels/telegram/poll (sin token) ==="
run "b1" -X POST $B/api/channels/telegram/poll -H "$H"

echo "=== b2) GET /api/channels/telegram/poll (sin token) ==="
run "b2" $B/api/channels/telegram/poll

echo "=== c1) GET whatsapp/webhook verify con hub.verify_token (config NO existe) ==="
run "c1" "$B/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=audit7c-token&hub.challenge=CHALLENGE123"

echo "=== c2) GET whatsapp/webhook sin params ==="
run "c2" "$B/api/channels/whatsapp/webhook"

echo "=== d1) POST /api/media/analyze con .bin no soportado ==="
run "d1" -X POST $B/api/media/analyze -F "file=@/home/z/my-project/scripts/audit_7c_bad.bin;type=application/octet-stream;filename=audit_7c_bad.bin"

echo "=== d2) POST /api/media/analyze con archivo VACÍO ==="
run "d2" -X POST $B/api/media/analyze -F "file=@/home/z/my-project/scripts/audit_7c_empty.bin;type=text/plain;filename=audit_7c_empty.txt"

echo "=== e) GET /api/media/ID_INEXISTENTE/file ==="
run "e" "$B/api/media/audit7c-id-inexistente-000000/file"

echo "=== f1) MCP initialize (para sesión) ==="
INIT=$(curl -s -m 30 -D /tmp/audit_7c_mcp_headers -X POST $B/api/mcp -H "$H" -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"audit7c","version":"1.0"}}}')
echo "$INIT"
SID=$(grep -i 'mcp-session-id' /tmp/audit_7c_mcp_headers | tr -d '\r' | awk '{print $2}')
echo "[SID=$SID]"

echo "=== f2) MCP tools/call tool DESCONOCIDA ==="
run "f2" -X POST $B/api/mcp -H "$H" ${SID:+-H "Mcp-Session-Id: $SID"} \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tool_que_no_existe_audit7c","arguments":{}}}'

echo "=== f3) MCP tools/call get_opportunity id INEXISTENTE ==="
run "f3" -X POST $B/api/mcp -H "$H" ${SID:+-H "Mcp-Session-Id: $SID"} \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_opportunity","arguments":{"id":"NOEXISTE-AUDIT-7C"}}}'

echo "=== f4) GET /api/mcp (debe ser 405) ==="
run "f4" $B/api/mcp

echo "=== g1) POST /api/proposals/INEXISTENTE/export ==="
run "g1" -X POST "$B/api/proposals/NOEXISTE-PROPOSAL-7C/export"

echo "=== g2) GET /api/proposals/INEXISTENTE/export (método que usa la UI) ==="
run "g2" "$B/api/proposals/NOEXISTE-PROPOSAL-7C/export"
