# carreras-unpaz
Mapa de correlatividades para carreras UNPAZ.

## Qué se versiona y qué no

Sí se versiona:
- `tools/pdf_to_plan_json.py` (script de extracción)
- `tools/requirements.txt`
- código web (`index.html`, `style.css`, `script.js`)

No se versiona (por diseño):
- PDFs de entrada (`data/pdfs/*`)
- JSON generados (`data/planes/*.json`)

Esto permite un repo limpio y regenerable: cada entorno genera sus propios JSON.

## Flujo para agregar carreras

1. Copiar PDFs a `data/pdfs/`.
2. Instalar dependencias:

```bash
python -m pip install -r tools/requirements.txt
```

3. Ejecutar el parser:

```bash
python tools/pdf_to_plan_json.py --input "data/pdfs" --output "data/planes" --verbose
```

4. Levantar la web (Live Server) y elegir la carrera en el selector.

## Archivos generados (locales)

Por cada PDF:
- `<slug>.json`: metadata + materias + hitos
- `<slug>.materias.json`: array listo para la web (`id`, `nombre`, `cuatrimestre`, `correlativas`)

Además:
- `catalog.json`: catálogo de carreras para poblar el selector en la interfaz.
