# carreras-unpaz
Mapa de plan de estudio

## Extraer planes desde PDFs

Script: `tools/pdf_to_plan_json.py`

### 1) Instalar dependencias

```bash
python -m pip install -r tools/requirements.txt
```

### 2) Procesar un PDF

```bash
python tools/pdf_to_plan_json.py --input "C:\\Users\\nahuel\\Downloads\\2021-11-23 Planesdeestudioa4LGTI_1.pdf" --output data/planes --split "1:5,2:5,3:4,4:5,5:5" --verbose
```

### 3) Procesar carpeta completa

```bash
python tools/pdf_to_plan_json.py --input "C:\\Users\\nahuel\\Downloads\\planes" --output data/planes --verbose
```

Salidas por PDF:
- `<slug>.json`: metadata + materias + hitos.
- `<slug>.materias.json`: array listo para la web (`id`, `nombre`, `cuatrimestre`, `correlativas`).
