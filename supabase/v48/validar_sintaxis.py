"""Parseo offline; no conecta ni ejecuta SQL. Requiere pglast de desarrollo."""
from pathlib import Path
from pglast import parse_sql, parse_plpgsql

for path in sorted(Path(__file__).parent.glob('*.sql')):
    sql = path.read_text(encoding='utf-8')
    print(f'{path.name}: {len(parse_sql(sql))} sentencias; '
          f'{len(parse_plpgsql(sql))} bloques PL/pgSQL; sintaxis OK')
