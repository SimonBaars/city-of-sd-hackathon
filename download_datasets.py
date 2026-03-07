#!/usr/bin/env python3
"""
Download all San Diego Open Data Portal CSV and GeoJSON datasets.
Supports parallel downloads, resume on failure, and progress reporting.

Usage:
    python download_datasets.py                  # download CSV + GeoJSON
    python download_datasets.py --csv-only       # skip geojson/topojson/shp
    python download_datasets.py --all-formats    # include topojson + shapefiles
    python download_datasets.py --force          # re-download even if file exists
    python download_datasets.py --dry-run        # just list what would be downloaded
"""

import argparse
import csv
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import urllib.request
import urllib.error

DATA_DIR = Path(__file__).parent / "data"
CATALOG_PATH = Path(__file__).parent / "data-exploration" / "dataset_catalog.csv"

FORMATS_DEFAULT = {"csv", "geojson"}
FORMATS_CSV_ONLY = {"csv"}
FORMATS_ALL = {"csv", "geojson", "topojson", "shp"}

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds
CONCURRENT_DOWNLOADS = 12
CONNECT_TIMEOUT = 15
READ_TIMEOUT = 300  # 5 min for big files


def parse_catalog(catalog_path: Path, formats: set[str]) -> list[dict]:
    """Read the catalog CSV and return deduplicated download entries."""
    entries = []
    seen_urls = set()
    with open(catalog_path) as f:
        for row in csv.DictReader(f):
            fmt = row["resource_format"].strip().lower()
            url = row["resource_url"].strip()
            if fmt not in formats or url in seen_urls:
                continue
            seen_urls.add(url)
            dataset = row["dataset_name"].strip()
            entries.append({
                "dataset": dataset,
                "name": row["resource_name"].strip(),
                "url": url,
                "format": fmt,
            })
    return entries


def dest_path(entry: dict) -> Path:
    """Compute local file path: data/{dataset}/{filename}"""
    url_path = urlparse(entry["url"]).path
    filename = os.path.basename(url_path)
    return DATA_DIR / entry["dataset"] / filename


def download_one(entry: dict, force: bool = False) -> dict:
    """Download a single file with retries. Returns a result dict."""
    target = dest_path(entry)
    result = {
        "dataset": entry["dataset"],
        "name": entry["name"],
        "url": entry["url"],
        "path": str(target),
        "status": "unknown",
        "size": 0,
        "elapsed": 0,
        "error": None,
    }

    if target.exists() and not force:
        result["status"] = "skipped"
        result["size"] = target.stat().st_size
        return result

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")

    for attempt in range(1, MAX_RETRIES + 1):
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(entry["url"], headers={"User-Agent": "SD-Hackathon-Downloader/1.0"})
            with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as resp:
                with open(tmp, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 256)  # 256 KB chunks
                        if not chunk:
                            break
                        f.write(chunk)

            tmp.rename(target)
            result["status"] = "ok"
            result["size"] = target.stat().st_size
            result["elapsed"] = time.monotonic() - t0
            return result

        except Exception as e:
            result["error"] = f"attempt {attempt}/{MAX_RETRIES}: {e}"
            if tmp.exists():
                tmp.unlink()
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * attempt)

    result["status"] = "failed"
    result["elapsed"] = time.monotonic() - t0
    return result


def fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    if n < 1024 ** 3:
        return f"{n / 1024**2:.1f} MB"
    return f"{n / 1024**3:.2f} GB"


def main():
    parser = argparse.ArgumentParser(description="Download San Diego Open Data datasets")
    fmt_group = parser.add_mutually_exclusive_group()
    fmt_group.add_argument("--csv-only", action="store_true", help="Only download CSV files")
    fmt_group.add_argument("--all-formats", action="store_true", help="Include TopoJSON and Shapefiles too")
    parser.add_argument("--force", action="store_true", help="Re-download even if file already exists")
    parser.add_argument("--dry-run", action="store_true", help="Just list files, don't download")
    parser.add_argument("--workers", type=int, default=CONCURRENT_DOWNLOADS, help=f"Parallel downloads (default {CONCURRENT_DOWNLOADS})")
    args = parser.parse_args()

    if args.csv_only:
        formats = FORMATS_CSV_ONLY
    elif args.all_formats:
        formats = FORMATS_ALL
    else:
        formats = FORMATS_DEFAULT

    if not CATALOG_PATH.exists():
        print(f"ERROR: catalog not found at {CATALOG_PATH}", file=sys.stderr)
        print("Run the data exploration step first.", file=sys.stderr)
        sys.exit(1)

    entries = parse_catalog(CATALOG_PATH, formats)
    already_cached = sum(1 for e in entries if dest_path(e).exists() and not args.force)
    to_download = len(entries) - already_cached if not args.force else len(entries)
    print(f"Found {len(entries)} files ({', '.join(sorted(formats))} formats)", flush=True)
    print(f"  {already_cached} already cached, {to_download} to download", flush=True)

    if args.dry_run:
        for e in entries:
            cached = dest_path(e).exists()
            tag = " [cached]" if cached else ""
            print(f"  {e['dataset']}/{os.path.basename(dest_path(e))}{tag}")
        sys.exit(0)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    done = 0
    ok = 0
    skipped = 0
    failed = 0
    total_bytes = 0
    failures = []
    t_start = time.monotonic()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download_one, e, args.force): e for e in entries}

        for future in as_completed(futures):
            done += 1
            r = future.result()

            if r["status"] == "ok":
                ok += 1
                total_bytes += r["size"]
                icon = "\033[32m✓\033[0m"
                detail = f"{fmt_size(r['size'])} in {r['elapsed']:.1f}s"
            elif r["status"] == "skipped":
                skipped += 1
                total_bytes += r["size"]
                icon = "\033[33m⊘\033[0m"
                detail = f"{fmt_size(r['size'])} (cached)"
            else:
                failed += 1
                failures.append(r)
                icon = "\033[31m✗\033[0m"
                detail = r["error"]

            elapsed = time.monotonic() - t_start
            pct = done / len(entries) * 100
            print(f"  {icon} [{done:3d}/{len(entries)}] {pct:5.1f}% | {r['dataset']}/{os.path.basename(r['path'])}  {detail}", flush=True)

    elapsed = time.monotonic() - t_start
    print(f"\n{'=' * 60}")
    print(f"Done in {elapsed:.0f}s")
    print(f"  Downloaded: {ok}  ({fmt_size(total_bytes)} total)")
    print(f"  Skipped:    {skipped}  (already cached)")
    print(f"  Failed:     {failed}")

    if failures:
        print(f"\nFailed downloads:")
        for r in failures:
            print(f"  {r['dataset']}: {r['url']}")
            print(f"    {r['error']}")

    if failures:
        with open(DATA_DIR / "failed.txt", "w") as f:
            for r in failures:
                f.write(r["url"] + "\n")
        print(f"\nFailed URLs written to {DATA_DIR / 'failed.txt'}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
