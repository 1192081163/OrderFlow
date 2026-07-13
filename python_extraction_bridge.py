from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import desktop_runner


def row_to_json(row: Any) -> dict[str, Any]:
    return {
        "values": row.values,
        "notes": row.notes,
        "manualCheck": row.manual_check,
        "sourceFile": row.source_file,
    }


def result_to_json(result: desktop_runner.ExtractionResult) -> dict[str, Any]:
    return {
        "inputFiles": [str(path) for path in result.input_files],
        "rows": [row_to_json(row) for row in result.rows],
        "skippedFiles": result.skipped_files,
        "failures": [{"path": str(item.path), "error": item.error} for item in result.failures],
        "outputs": {
            "outputDir": str(result.outputs.output_dir),
            "csvOutput": str(result.outputs.csv_output),
            "xlsxOutput": str(result.outputs.xlsx_output),
            "auditOutput": str(result.outputs.audit_output),
        },
    }


def progress_to_jsonl(index: int, total: int, path: Path, status: str, phase: str) -> None:
    print(
        json.dumps(
            {
                "type": "progress",
                "index": index,
                "total": total,
                "filename": path.name,
                "status": status,
                "phase": phase,
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
        flush=True,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run order extraction rules engine.")
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--infer-manual", dest="infer_manual", action="store_true", default=True)
    parser.add_argument("--no-infer-manual", dest="infer_manual", action="store_false")
    parser.add_argument("--progress-jsonl", action="store_true")
    parser.add_argument("paths", nargs="+")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    result = desktop_runner.run_extraction(
        [Path(item) for item in args.paths],
        recursive=args.recursive,
        infer_manual=args.infer_manual,
        progress=progress_to_jsonl if args.progress_jsonl else None,
    )
    print(json.dumps(result_to_json(result), ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
