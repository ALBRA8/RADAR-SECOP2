#!/bin/bash
# CLEAN-ROOM re-ejecución con protocolo corregido (Task 4, PROMPT 05 §28)
set -o pipefail
CR=/home/z/cleanroom-radar
PASS=0; FAIL=0
ck() { if [ "$1" = "0" ]; then echo "PASS: $2"; PASS=$((PASS+1)); else echo "FAIL: $2"; FAIL=$((FAIL+1)); fi; }

echo "=== 1. CLON LIMPIO ==="
rm -rf $CR && git clone -q /home/z/my-project $CR 2>&1
ck $? "git clone desde el repo real"
N=$(git -C $CR ls-files | wc -l); echo "archivos trackeados: $N"
[ "$N" -gt 200 ]; ck $? "el clon trae el trabajo nuevo (>200 archivos)"

echo "=== 2. SIN ARTEFACTOS ==="
[ ! -d $CR/node_modules ] && [ ! -d $CR/.next ] && [ ! -f $CR/.env ]; ck $? "sin node_modules/.next/.env"
rm -f $CR/db/custom.db; ck $? "db demo eliminada (se regenera desde schema)"

echo "=== 3. ENV DOCUMENTADO (ruta absoluta, var de entorno global neutralizada) ==="
unset DATABASE_URL
echo "DATABASE_URL=file:$CR/db/custom.db" > $CR/.env
grep -q "file:$CR/db/custom.db" $CR/.env; ck $? ".env con ruta absoluta al clon"

echo "=== 4-5. INSTALL + PRISMA ==="
cd $CR && bun install > /tmp/cr_install.log 2>&1; ck $? "bun install ($(tail -1 /tmp/cr_install.log | head -c 60))"
bunx prisma generate > /tmp/cr_gen.log 2>&1; ck $? "prisma generate"
unset DATABASE_URL; bunx prisma db push > /tmp/cr_push.log 2>&1
ck $? "prisma db push ($(grep -o 'in sync.*' /tmp/cr_push.log | head -c 40))"
[ -f $CR/db/custom.db ]; ck $? "DB nueva creada en db/custom.db"

echo "=== 6. BUILD PRODUCCIÓN ==="
T0=$(date +%s); unset DATABASE_URL; bun run build > /tmp/cr_build.log 2>&1; RC=$?
T1=$(date +%s)
ck $RC "bun run build (${T0}s→${T1}s, $((T1-T0))s, exit=$RC)"

echo "=== 7. START :3100 ==="
pkill -f "next start" 2>/dev/null; sleep 1
cd $CR && DATABASE_URL="file:$CR/db/custom.db" PORT=3100 nohup bun run start > /tmp/cr_start.log 2>&1 &
OK=0
for i in $(seq 1 30); do
  C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/ --max-time 3 2>/dev/null)
  [ "$C" = "200" ] && OK=1 && break; sleep 2
done
[ $OK = "1" ]; ck $? "servidor producción arriba en :3100"

echo "=== 8. HEALTH CHECKS ==="
for EP in "/" "/api/health" "/api/dashboard" "/api/opportunities" "/api/skills" "/api/doctor"; do
  C=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3100$EP" --max-time 15)
  echo "  $EP → $C"
  [ "$C" = "200" ]; ck $? "GET $EP = 200"
done
TOOLS=$(curl -s -X POST http://localhost:3100/api/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' --max-time 10 | grep -o '"name"' | wc -l)
echo "  MCP tools: $TOOLS"; [ "$TOOLS" -ge 12 ]; ck $? "MCP tools/list >= 12"

echo "=== 9. PERSISTENCIA EN CLON ==="
curl -s -X POST http://localhost:3100/api/memory -H "Content-Type: application/json" -d '{"type":"SEMANTIC","key":"clean-room:test","content":"prueba clean-room","summary":"aislamiento"}' --max-time 10 > /dev/null
G=$(curl -s "http://localhost:3100/api/memory?q=clean-room" --max-time 10)
echo "$G" | grep -q "clean-room:test"; ck $? "memoria persiste en DB del clon"

echo "=== 10. AISLAMIENTO (BD original intacta) ==="
O=$(curl -s "http://localhost:3000/api/memory?q=clean-room" --max-time 10)
echo "$O" | grep -q "clean-room:test" && R=1 || R=0
[ $R = "0" ]; ck $? "BD del proyecto original SIN contaminar"

echo "=== 11. SIN RUTAS ABSOLUTAS EN BUILD ==="
M=$(grep -rl "/home/z/my-project" $CR/.next --include="*.js" 2>/dev/null | head -3)
[ -z "$M" ]; ck $? "0 rutas absolutas al proyecto original en chunks"

echo "=== 12. LIMPIEZA ==="
fuser -k 3100/tcp 2>/dev/null; sleep 1
C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/ --max-time 3 2>/dev/null)
[ "$C" != "200" ]; ck $? "puerto 3100 liberado"
D=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health --max-time 5)
[ "$D" = "200" ]; ck $? "dev server :3000 intacto"

echo ""
echo "===================================="
echo "CLEAN-ROOM: PASS=$PASS FAIL=$FAIL"
[ $FAIL = "0" ] && echo "VEREDICTO: CLEAN-ROOM PASS" || echo "VEREDICTO: CLEAN-ROOM FAIL"
echo "===================================="
