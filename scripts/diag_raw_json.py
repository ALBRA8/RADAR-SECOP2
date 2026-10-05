#!/usr/bin/env python3
"""Diagnóstico del JSON crudo que la IA devuelve en generateProposal."""
import json

raw = open('/tmp/ai_raw_debug.txt').read()
print('raw len:', len(raw))
print('empieza con fence:', raw.strip().startswith('```'))
print('termina con fence:', raw.rstrip().endswith('```'))
print('termina con }:', raw.rstrip().endswith('}'))
print('primeros 120:', raw[:120].replace('\n', '\\n'))
print('últimos 160:', raw[-160:].replace('\n', '\\n'))

start = raw.find('{')
end = raw.rfind('}')
body = raw[start:end + 1]
try:
    json.loads(body)
    print('parse directo: OK')
except Exception as e:
    print('parse directo FALLA:', str(e)[:140])
    pos = getattr(e, 'pos', None)
    if pos:
        print('contexto error:', body[max(0, pos - 130):pos + 130].replace('\n', '\\n'))
    out = []
    i = 0
    ins = False
    while i < len(body):
        ch = body[i]
        if ins:
            if ch == '\\':
                out.append(body[i:i + 2])
                i += 2
                continue
            if ch == '"':
                ins = False
                out.append(ch)
                i += 1
                continue
            if ord(ch) < 0x20:
                out.append({'\n': '\\n', '\r': '\\r', '\t': '\\t'}.get(ch, '\\u%04x' % ord(ch)))
                i += 1
                continue
            out.append(ch)
            i += 1
            continue
        if ch == '"':
            ins = True
        out.append(ch)
        i += 1
    repaired = ''.join(out)
    try:
        json.loads(repaired)
        print('parse reparado: OK (la reparación de control chars SÍ resuelve)')
    except Exception as e2:
        print('parse reparado FALLA:', str(e2)[:140])
        pos = getattr(e2, 'pos', None)
        if pos:
            print('contexto error 2:', repaired[max(0, pos - 130):pos + 130].replace('\n', '\\n'))
