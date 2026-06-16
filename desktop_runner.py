from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import extract


VALID_SUFFIXES = {".xlsx", ".xlsm"}


@dataclass(frozen=True)
class InputResolution:
    input_files: list[Path]
    skipped_files: list[str]
    base_dir: Path


@dataclass(frozen=True)
class OutputPaths:
    output_dir: Path
    csv_output: Path
    xlsx_output: Path
    audit_output: Path


@dataclass(frozen=True)
class ExtractionFailure:
    path: Path
    error: str


@dataclass(frozen=True)
class ExtractionResult:
    input_files: list[Path]
    rows: list[extract.ExtractedRow]
    skipped_files: list[str]
    failures: list[ExtractionFailure]
    outputs: OutputPaths


class NoInputFilesError(ValueError):
    pass


ProgressCallback = Callable[[int, int, Path, str], None]


def is_valid_order_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name.startswith(".~") or path.name.lower().startswith("~$"):
        return False
    if path.suffix.lower() not in VALID_SUFFIXES:
        return False
    if "job track" in path.name.lower():
        return False
    if path.name == "总表.xlsx":
        return False
    return True


def _iter_directory_files(path: Path, recursive: bool) -> list[Path]:
    iterator = path.rglob("*") if recursive else path.iterdir()
    return sorted(item for item in iterator if item.is_file())


def resolve_input_paths(paths: Iterable[Path | str], recursive: bool = False) -> InputResolution:
    raw_paths = [Path(path).expanduser().resolve() for path in paths]
    input_files: list[Path] = []
    skipped_files: list[str] = []
    base_dir = raw_paths[0] if raw_paths else Path.cwd()
    first_valid_file_parent: Path | None = None

    for path in raw_paths:
        if path.is_dir():
            base_dir = path
            for item in _iter_directory_files(path, recursive):
                if is_valid_order_file(item):
                    input_files.append(item)
                else:
                    skipped_files.append(item.name)
            continue
        if is_valid_order_file(path):
            input_files.append(path)
            if first_valid_file_parent is None:
                first_valid_file_parent = path.parent
        else:
            skipped_files.append(path.name)

    input_files = sorted(dict.fromkeys(input_files))
    if input_files and (not raw_paths or not raw_paths[0].is_dir()):
        base_dir = first_valid_file_parent or input_files[0].parent
    return InputResolution(input_files=input_files, skipped_files=skipped_files, base_dir=base_dir)


def default_output_paths(base_dir: Path) -> OutputPaths:
    output_dir = base_dir / "order_extraction_output"
    return OutputPaths(
        output_dir=output_dir,
        csv_output=output_dir / "extracted_job_rows.csv",
        xlsx_output=output_dir / "订单整理结果.xlsx",
        audit_output=output_dir / "audit.csv",
    )


def run_extraction(
    paths: Iterable[Path | str],
    *,
    recursive: bool = False,
    infer_manual: bool = True,
    progress: ProgressCallback | None = None,
) -> ExtractionResult:
    resolution = resolve_input_paths(paths, recursive=recursive)
    if not resolution.input_files:
        raise NoInputFilesError("No valid order Excel files were found.")

    outputs = default_output_paths(resolution.base_dir)
    rows: list[extract.ExtractedRow] = []
    failures: list[ExtractionFailure] = []
    total = len(resolution.input_files)

    for index, path in enumerate(resolution.input_files, start=1):
        if progress:
            progress(index, total, path, "running")
        try:
            rows.append(extract.extract_workbook(path, infer_manual=infer_manual))
        except Exception as exc:
            failures.append(ExtractionFailure(path=path, error=str(exc)))
            if progress:
                progress(index, total, path, "failed")
        else:
            if progress:
                progress(index, total, path, "completed")

    rows = extract.dedupe_latest_rows(rows, resolution.input_files)
    extract.write_csv(rows, outputs.csv_output)
    extract.write_xlsx(rows, outputs.xlsx_output, resolution.base_dir, resolution.input_files)
    extract.write_audit_csv(rows, outputs.audit_output)
    return ExtractionResult(
        input_files=resolution.input_files,
        rows=rows,
        skipped_files=resolution.skipped_files,
        failures=failures,
        outputs=outputs,
    )
