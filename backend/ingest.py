#!/usr/bin/env python3
"""Load downloaded San Diego CSV datasets into a persistent DuckDB database."""

import json
import sys
import time
from pathlib import Path

import duckdb

DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = Path(__file__).parent / "san_diego.duckdb"

SKIP_KEYWORDS = ["dictionary", "dict_"]


def sanitize_name(stem: str) -> str:
    """Turn a CSV filename stem into a valid SQL table name."""
    name = stem
    for suffix in ("_datasd", "_datasd_v1"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return name.replace("-", "_").replace(" ", "_").strip("_").lower()


def is_dictionary(path: Path) -> bool:
    low = path.stem.lower()
    return any(kw in low for kw in SKIP_KEYWORDS)


def ingest(force: bool = False):
    if not DATA_DIR.exists():
        print(f"No data directory at {DATA_DIR}. Run download_datasets.py first.")
        sys.exit(1)

    if DB_PATH.exists() and not force:
        print(f"Database already exists at {DB_PATH} ({DB_PATH.stat().st_size / 1e6:.0f} MB)")
        print("Use --force to rebuild.")
        return

    if DB_PATH.exists():
        DB_PATH.unlink()

    con = duckdb.connect(str(DB_PATH))

    con.execute("""
        CREATE TABLE _metadata (
            table_name VARCHAR PRIMARY KEY,
            dataset VARCHAR,
            filename VARCHAR,
            row_count BIGINT,
            columns JSON,
            is_geo BOOLEAN DEFAULT FALSE
        )
    """)

    csv_files = sorted(DATA_DIR.glob("**/*.csv"))
    geojson_files = sorted(DATA_DIR.glob("**/*.geojson"))
    print(f"Found {len(csv_files)} CSV files and {len(geojson_files)} GeoJSON files in {DATA_DIR}")

    used_names: dict[str, Path] = {}
    loaded = 0
    skipped = 0
    errors = []
    t_start = time.monotonic()

    for filepath in csv_files:
        if is_dictionary(filepath):
            skipped += 1
            continue

        dataset = filepath.parent.name
        tname = sanitize_name(filepath.stem)

        if tname in used_names:
            tname = f"{sanitize_name(dataset)}_{tname}"
        if tname in used_names:
            tname = f"{tname}_{abs(hash(str(filepath))) % 10000}"
        used_names[tname] = filepath

        try:
            t0 = time.monotonic()
            con.execute(f'DROP TABLE IF EXISTS "{tname}"')
            con.execute(f"""
                CREATE TABLE "{tname}" AS
                SELECT * FROM read_csv_auto('{filepath}',
                    ignore_errors=true,
                    sample_size=20000,
                    all_varchar=false)
            """)
            elapsed = time.monotonic() - t0

            row_count = con.execute(f'SELECT count(*) FROM "{tname}"').fetchone()[0]
            cols_info = con.execute(f"PRAGMA table_info('{tname}')").fetchall()
            col_names = [row[1] for row in cols_info]

            con.execute(
                "INSERT INTO _metadata VALUES (?, ?, ?, ?, ?, ?)",
                [tname, dataset, filepath.name, row_count, json.dumps(col_names), False],
            )

            size_mb = filepath.stat().st_size / 1024 / 1024
            loaded += 1
            print(
                f"  \033[32m✓\033[0m [{loaded:3d}] {tname}"
                f"  ({row_count:>9,} rows, {size_mb:>7.1f} MB, {elapsed:.1f}s)",
                flush=True,
            )
        except Exception as e:
            errors.append((filepath, str(e)))
            print(f"  \033[31m✗\033[0m {tname}: {e}", flush=True)

    con.close()
    elapsed_total = time.monotonic() - t_start
    db_size = DB_PATH.stat().st_size / 1024 / 1024

    print(f"\n{'=' * 60}")
    print(f"Done in {elapsed_total:.0f}s")
    print(f"  Loaded:  {loaded} tables")
    print(f"  Skipped: {skipped} (dictionaries)")
    print(f"  Errors:  {len(errors)}")
    print(f"  DB size: {db_size:.0f} MB ({DB_PATH})")
    if errors:
        print("\nErrors:")
        for fp, err in errors[:10]:
            print(f"  {fp.name}: {err}")


if __name__ == "__main__":
    force = "--force" in sys.argv
    ingest(force=force)
