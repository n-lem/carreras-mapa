#!/usr/bin/env python3
"""
Extract study-plan data from one PDF or a folder of PDFs and export JSON files.

Outputs per PDF:
1) <slug>.json          -> metadata + materias
2) <slug>.materias.json -> materias only (ready for the web app)

Dependencies:
- pdfplumber
- pypdf (optional, used to improve title/career text extraction)
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency 'pdfplumber'. Install with: python -m pip install pdfplumber"
    ) from exc

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover
    PdfReader = None


CODE_RE = re.compile(r"\b\d{4}\b")
SPACE_RE = re.compile(r"\s+")
MAX_CONTINUATION_DISTANCE = 15.0


@dataclass
class Token:
    text: str
    x0: float
    top: float


@dataclass
class Row:
    page_index: int
    top: float
    tokens: list[Token] = field(default_factory=list)

    @property
    def global_top(self) -> float:
        # Big page stride to keep rows sortable across pages.
        return self.page_index * 10_000 + self.top

    @property
    def text(self) -> str:
        return " ".join(token.text for token in sorted(self.tokens, key=lambda t: t.x0))


@dataclass
class CourseBuilder:
    code: str
    year: int
    anchor_top: float
    name_parts: list[str] = field(default_factory=list)
    corr_parts: list[str] = field(default_factory=list)


def norm_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("\u00ad", "")
    return SPACE_RE.sub(" ", value).strip()


def slugify(value: str) -> str:
    value = norm_text(value).lower()
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "plan-estudios"


def parse_split_map(raw: str | None) -> dict[int, int]:
    if not raw:
        return {}
    result: dict[int, int] = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            year_raw, first_count_raw = chunk.split(":", 1)
            year = int(year_raw.strip())
            first_count = int(first_count_raw.strip())
            result[year] = first_count
        except ValueError as exc:
            raise SystemExit(
                f"Invalid --split format '{chunk}'. Expected entries like '1:5,2:5'."
            ) from exc
    return result


def iter_pdf_files(path: Path) -> Iterable[Path]:
    if path.is_file():
        if path.suffix.lower() == ".pdf":
            yield path
        return
    yield from sorted(path.rglob("*.pdf"))


def extract_rows(pdf_path: Path) -> list[Row]:
    rows: list[Row] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            words = page.extract_words(
                x_tolerance=2,
                y_tolerance=2,
                keep_blank_chars=False,
                use_text_flow=False,
            )
            page_rows: list[Row] = []

            for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
                text = norm_text(str(word.get("text", "")))
                if not text:
                    continue
                token = Token(text=text, x0=float(word["x0"]), top=float(word["top"]))

                matched = None
                for row in page_rows:
                    if abs(row.top - token.top) <= 2:
                        matched = row
                        break

                if matched is None:
                    matched = Row(page_index=page_index, top=token.top, tokens=[])
                    page_rows.append(matched)

                matched.tokens.append(token)
                matched.top = (matched.top + token.top) / 2

            for row in page_rows:
                row.tokens.sort(key=lambda token: token.x0)
            rows.extend(page_rows)

    rows.sort(key=lambda row: row.global_top)
    return rows


def get_left_code(row: Row) -> str | None:
    for token in row.tokens:
        if token.x0 < 100 and CODE_RE.fullmatch(token.text):
            return token.text
    return None


def has_header_marker(row: Row) -> bool:
    normalized = unicodedata.normalize("NFKD", row.text).encode("ascii", "ignore").decode("ascii").lower()
    return "codigo" in normalized and "asignatura" in normalized


def name_tokens(row: Row) -> list[str]:
    out: list[str] = []
    for token in row.tokens:
        if 105 <= token.x0 < 320 and token.text.lower() != "cuatrimestral":
            out.append(token.text)
    return out


def correlativa_tokens(row: Row) -> list[str]:
    return [token.text for token in row.tokens if token.x0 >= 500]


def nearest_anchor(anchor_rows: list[Row], current: Row) -> Row:
    return min(
        anchor_rows,
        key=lambda anchor: (
            abs(anchor.global_top - current.global_top),
            0 if anchor.global_top >= current.global_top else 1,
        ),
    )


def neighbor_anchors(anchor_rows: list[Row], current: Row) -> tuple[Row | None, Row | None]:
    previous = None
    following = None
    for anchor in anchor_rows:
        if anchor.global_top <= current.global_top:
            previous = anchor
            continue
        following = anchor
        break
    return previous, following


def unique_in_order(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def clean_name(raw: str) -> str:
    cleaned = norm_text(raw)
    cleaned = cleaned.strip("-,:; ")
    return cleaned


def infer_first_sem_count(total: int) -> int:
    if total <= 5:
        return total
    if total % 2 == 0:
        return total // 2
    return math.ceil(total / 2)


def extract_full_text(pdf_path: Path) -> str:
    if PdfReader is not None:
        try:
            reader = PdfReader(str(pdf_path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            pass

    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def extract_career_name(full_text: str, fallback: str) -> str:
    text = unicodedata.normalize("NFKC", full_text or "")
    # Keep line breaks to avoid swallowing extra paragraphs.
    match = re.search(r"Licenciatura en\s*([^\n\r]+)", text, flags=re.IGNORECASE)
    if match:
        return clean_name(match.group(1))
    return fallback


def extract_intermediate_title(full_text: str) -> str | None:
    text = unicodedata.normalize("NFKC", full_text or "")
    matches = re.findall(r"Anal[ií]sta(?:/a)? de Sistemas\s*\([^)]+\)", text, flags=re.IGNORECASE)
    if matches:
        # Prefer variants that include workload (hs), fallback to last match.
        for candidate in reversed(matches):
            if "hs" in candidate.lower():
                return clean_name(candidate)
        return clean_name(matches[-1])
    return None


def parse_courses(rows: list[Row], split_map: dict[int, int]) -> list[dict]:
    header_indexes = [index for index, row in enumerate(rows) if has_header_marker(row)]
    if not header_indexes:
        return []

    blocks: list[tuple[int, int, int]] = []
    for block_num, start in enumerate(header_indexes, start=1):
        end = header_indexes[block_num] if block_num < len(header_indexes) else len(rows)
        blocks.append((block_num, start + 1, end))

    result: list[dict] = []

    for year, start, end in blocks:
        block_rows = rows[start:end]
        anchor_rows = [row for row in block_rows if get_left_code(row)]
        if not anchor_rows:
            continue

        builders: dict[str, CourseBuilder] = {}
        anchor_by_code: dict[str, Row] = {}

        for anchor in anchor_rows:
            code = get_left_code(anchor)
            if not code:
                continue
            builder = builders.setdefault(
                code, CourseBuilder(code=code, year=year, anchor_top=anchor.global_top)
            )
            builder.name_parts.extend(name_tokens(anchor))
            builder.corr_parts.extend(correlativa_tokens(anchor))
            anchor_by_code[code] = anchor

        for row in block_rows:
            if get_left_code(row):
                continue

            row_name_tokens = name_tokens(row)
            row_corr_tokens = correlativa_tokens(row)
            if not row_name_tokens and not row_corr_tokens:
                continue

            anchor = nearest_anchor(anchor_rows, row)
            previous, following = neighbor_anchors(anchor_rows, row)

            # Disambiguate wrapped correlativas that can sit between two code rows.
            # If distances are almost tied and previous already has correlativas while
            # following has none in its own row, bias to the following anchor.
            if row_corr_tokens and not row_name_tokens and previous and following:
                prev_code = get_left_code(previous)
                next_code = get_left_code(following)
                if prev_code and next_code:
                    dist_prev = abs(previous.global_top - row.global_top)
                    dist_next = abs(following.global_top - row.global_top)
                    prev_has_corr = bool(builders[prev_code].corr_parts)
                    next_has_corr_in_anchor_row = bool(correlativa_tokens(following))
                    if (
                        abs(dist_prev - dist_next) <= 1
                        and any("-" in token for token in row_corr_tokens)
                        and prev_has_corr
                        and not next_has_corr_in_anchor_row
                    ):
                        anchor = following

            if abs(anchor.global_top - row.global_top) > MAX_CONTINUATION_DISTANCE:
                continue
            anchor_code = get_left_code(anchor)
            if not anchor_code:
                continue

            builders[anchor_code].name_parts.extend(row_name_tokens)
            builders[anchor_code].corr_parts.extend(row_corr_tokens)

        ordered_codes = sorted(
            builders.keys(),
            key=lambda code: builders[code].anchor_top,
        )
        first_sem_count = split_map.get(year, infer_first_sem_count(len(ordered_codes)))

        for index, code in enumerate(ordered_codes):
            builder = builders[code]
            sem_in_year = 1 if index < first_sem_count else 2
            cuatrimestre = (year - 1) * 2 + sem_in_year

            materia_name = clean_name(" ".join(builder.name_parts))
            corr_raw = " ".join(builder.corr_parts)
            correlativas = unique_in_order(CODE_RE.findall(corr_raw))
            if corr_raw.strip() == "-":
                correlativas = []

            result.append(
                {
                    "id": code,
                    "nombre": materia_name,
                    "cuatrimestre": cuatrimestre,
                    "anio": year,
                    "correlativas": correlativas,
                }
            )

    result.sort(key=lambda materia: int(materia["id"]))
    return result


def process_pdf(pdf_path: Path, output_dir: Path, split_map: dict[int, int], verbose: bool) -> tuple[Path, Path]:
    rows = extract_rows(pdf_path)
    full_text = extract_full_text(pdf_path)

    career_name = extract_career_name(full_text, fallback=pdf_path.stem)
    intermediate_title = extract_intermediate_title(full_text)
    materias = parse_courses(rows, split_map=split_map)

    if not materias:
        raise RuntimeError("No se pudieron extraer materias desde el PDF.")

    slug = slugify(career_name)
    metadata_path = output_dir / f"{slug}.json"
    materias_path = output_dir / f"{slug}.materias.json"

    payload = {
        "carrera": career_name,
        "fuente_pdf": str(pdf_path),
        "generado_en_utc": datetime.now(timezone.utc).isoformat(),
        "materias": materias,
        "hitos": [],
    }

    if intermediate_title:
        payload["hitos"].append(
            {
                "tipo": "titulo_intermedio",
                "nombre": intermediate_title,
                "anio_estimado": 3,
            }
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    web_payload = [
        {
            "id": item["id"],
            "nombre": item["nombre"],
            "cuatrimestre": item["cuatrimestre"],
            "correlativas": item["correlativas"],
        }
        for item in materias
    ]
    materias_path.write_text(json.dumps(web_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if verbose:
        print(f"[OK] {pdf_path.name} -> {materias_path.name} ({len(web_payload)} materias)")

    return metadata_path, materias_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse PDFs de planes de estudio y exportar JSON para la web."
    )
    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="PDF individual o carpeta con PDFs.",
    )
    parser.add_argument(
        "--output",
        default=Path("data/planes"),
        type=Path,
        help="Carpeta de salida (default: data/planes).",
    )
    parser.add_argument(
        "--split",
        default="",
        help=(
            "Cantidad de materias del primer cuatrimestre por anio. "
            "Formato: 1:5,2:5,3:4,4:5,5:5"
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Imprime detalle de cada PDF procesado.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    input_path: Path = args.input
    output_dir: Path = args.output
    split_map = parse_split_map(args.split)

    if not input_path.exists():
        print(f"Input no existe: {input_path}", file=sys.stderr)
        return 1

    pdf_files = list(iter_pdf_files(input_path))
    if not pdf_files:
        print(f"No se encontraron PDFs en: {input_path}", file=sys.stderr)
        return 1

    failures = 0
    for pdf_path in pdf_files:
        try:
            process_pdf(pdf_path, output_dir=output_dir, split_map=split_map, verbose=args.verbose)
        except Exception as exc:
            failures += 1
            print(f"[ERROR] {pdf_path}: {exc}", file=sys.stderr)

    if failures:
        print(f"Procesados con errores: {failures}/{len(pdf_files)}", file=sys.stderr)
        return 2

    print(f"Procesados OK: {len(pdf_files)} PDF(s). Salida: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
