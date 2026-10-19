#!/usr/bin/env python3
"""Validate a Zotero Translation Reader build before publishing it.

Run after `npm run build`:

    python3 scripts/verify_release.py
    python3 scripts/verify_release.py --tag v2.4.38

The script uses only the Python standard library. It checks the package and
lockfile identity, the packaged manifest, the XPI archive itself, the bundled
license notice and reader storage revision, and the channel's update feeds. It writes
`build/SHA256SUMS.txt` for the packaged XPI and exits non-zero if any check
fails, so the release workflow stops before uploading anything.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

REPOSITORY = "Kinetic27/zotero_paper_translate"
PACKAGE_NAME = "zotero-translation-reader"
ADDON_ID = "zotero-paper-translate@kinetic27"
ADDON_NAME = "Zotero Translation Reader"
ZOTERO_MIN_VERSION = "7.9.9"
ZOTERO_MAX_VERSION = "10.9.9"
READER_STORAGE_REVISION = "generic-reading-order-v9"
LICENSE_NOTICE = "chrome/content/notices/gajae-code.txt"
SUMS_NAME = "SHA256SUMS.txt"

VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?")
TEST_PATH_PARTS = {"test", "tests", "__tests__", "__snapshots__"}
TEST_SUFFIXES = (".test.js", ".test.mjs", ".test.ts", ".spec.js", ".spec.ts")


class Report:
    """Collect every problem instead of stopping at the first one."""

    def __init__(self) -> None:
        self.problems: list[str] = []

    def check(self, condition: bool, message: str) -> bool:
        if condition:
            print(f"ok   {message}")
        else:
            self.problems.append(message)
            print(f"FAIL {message}")
        return bool(condition)

    def fail(self, message: str) -> None:
        self.check(False, message)


def nested(value: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def load_json(path: Path, report: Report, label: str) -> Any:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        report.fail(f"{label}: missing {path}")
        return None
    except OSError as error:
        report.fail(f"{label}: cannot read {path}: {error}")
        return None
    try:
        return json.loads(text)
    except ValueError as error:
        report.fail(f"{label}: invalid JSON in {path}: {error}")
        return None


def versioned_xpi_url(version: str) -> str:
    return (
        f"https://github.com/{REPOSITORY}/releases/download/v{version}/{PACKAGE_NAME}.xpi"
    )


def update_feed_url(version: str) -> str:
    feed = "update-beta.json" if "-" in version else "update.json"
    return f"https://github.com/{REPOSITORY}/releases/download/release/{feed}"


def check_manifest(
    report: Report, label: str, manifest: Any, version: str
) -> None:
    if not isinstance(manifest, dict):
        report.fail(f"{label} is a JSON object")
        return

    report.check(
        manifest.get("manifest_version") == 2,
        f"{label} manifest_version is 2",
    )
    report.check(
        manifest.get("name") == ADDON_NAME,
        f'{label} name is "{ADDON_NAME}" (got {manifest.get("name")!r})',
    )
    report.check(
        manifest.get("version") == version,
        f'{label} version is "{version}" (got {manifest.get("version")!r})',
    )

    zotero = nested(manifest, "applications", "zotero")
    if not isinstance(zotero, dict):
        report.fail(f"{label} declares applications.zotero")
        return

    report.check(
        zotero.get("id") == ADDON_ID,
        f'{label} addon ID is "{ADDON_ID}" (got {zotero.get("id")!r})',
    )
    report.check(
        zotero.get("strict_min_version") == ZOTERO_MIN_VERSION,
        f'{label} strict_min_version is stable "{ZOTERO_MIN_VERSION}" '
        f'(got {zotero.get("strict_min_version")!r})',
    )
    report.check(
        zotero.get("strict_max_version") == ZOTERO_MAX_VERSION,
        f'{label} strict_max_version is stable "{ZOTERO_MAX_VERSION}" '
        f'(got {zotero.get("strict_max_version")!r})',
    )

    expected_feed = update_feed_url(version)
    report.check(
        zotero.get("update_url") == expected_feed,
        f"{label} update_url is {expected_feed} (got {zotero.get('update_url')!r})",
    )


def looks_like_test(name: str) -> bool:
    parts = name.rstrip("/").split("/")
    if any(part.lower() in TEST_PATH_PARTS for part in parts[:-1]):
        return True
    base = parts[-1]
    return base.endswith(TEST_SUFFIXES) or ".test." in base or ".spec." in base


def check_feed(
    report: Report, path: Path, version: str, digest: str
) -> None:
    feed = load_json(path, report, path.name)
    if feed is None:
        return

    addons = feed.get("addons")
    if not isinstance(addons, dict):
        report.fail(f"{path.name} lists addons")
        return
    report.check(
        set(addons) == {ADDON_ID},
        f'{path.name} only publishes "{ADDON_ID}" (got {sorted(addons)})',
    )

    updates = nested(addons, ADDON_ID, "updates")
    if not isinstance(updates, list) or not updates:
        report.fail(f'{path.name} contains an update entry for "{ADDON_ID}"')
        return
    report.check(
        len(updates) == 1,
        f"{path.name} has exactly one update entry (got {len(updates)})",
    )

    entry = updates[0]
    if not isinstance(entry, dict):
        report.fail(f"{path.name} update entry is a JSON object")
        return

    report.check(
        entry.get("version") == version,
        f'{path.name} version is "{version}" (got {entry.get("version")!r})',
    )
    report.check(
        entry.get("update_link") == versioned_xpi_url(version),
        f"{path.name} update_link is {versioned_xpi_url(version)} "
        f"(got {entry.get('update_link')!r})",
    )
    report.check(
        entry.get("update_hash") == f"sha512:{digest}",
        f"{path.name} update_hash is the SHA-512 of the built XPI "
        f"(got {entry.get('update_hash')!r})",
    )

    zotero = nested(entry, "applications", "zotero")
    report.check(
        nested(zotero, "strict_min_version") == ZOTERO_MIN_VERSION
        and nested(zotero, "strict_max_version") == ZOTERO_MAX_VERSION,
        f"{path.name} keeps Zotero bounds {ZOTERO_MIN_VERSION}-{ZOTERO_MAX_VERSION}",
    )


def verify(root: Path, tag: str | None) -> list[str]:
    report = Report()

    pkg = load_json(root / "package.json", report, "package.json")
    if pkg is None:
        return report.problems

    if not report.check(
        pkg.get("name") == PACKAGE_NAME,
        f'package.json name is "{PACKAGE_NAME}" (got {pkg.get("name")!r})',
    ):
        return report.problems
    version = pkg.get("version")
    if not report.check(
        isinstance(version, str) and VERSION_PATTERN.fullmatch(version) is not None,
        f'package.json version is a release version (got {version!r})',
    ):
        return report.problems

    lock = load_json(root / "package-lock.json", report, "package-lock.json")
    if lock is not None:
        report.check(
            lock.get("name") == PACKAGE_NAME and lock.get("version") == version,
            f'package-lock.json root is "{PACKAGE_NAME}" {version} '
            f'(got {lock.get("name")!r} {lock.get("version")!r})',
        )
        lock_root = nested(lock, "packages", "")
        report.check(
            nested(lock_root, "name") == PACKAGE_NAME
            and nested(lock_root, "version") == version,
            f'package-lock.json packages[""] is "{PACKAGE_NAME}" {version}',
        )

    addon_ref = nested(pkg, "config", "addonRef")
    if not isinstance(addon_ref, str) or not addon_ref:
        report.fail("package.json config.addonRef names the bundled script")
        return report.problems

    if tag is not None:
        report.check(
            tag == f"v{version}",
            f'tag "{tag}" matches the package version "v{version}"',
        )

    print(f"\nrelease version: {version}")

    build = root / "build"
    xpi = build / f"{PACKAGE_NAME}.xpi"
    if not xpi.is_file():
        report.fail(f"built XPI exists at {xpi.relative_to(root)} (run `npm run build`)")
        return report.problems

    built_manifest = load_json(
        build / "addon" / "manifest.json", report, "build/addon/manifest.json"
    )
    if built_manifest is not None:
        check_manifest(report, "build/addon/manifest.json", built_manifest, version)

    data = xpi.read_bytes()
    sha512 = hashlib.sha512(data).hexdigest()
    sha256 = hashlib.sha256(data).hexdigest()

    try:
        archive = zipfile.ZipFile(xpi)
    except (OSError, zipfile.BadZipFile) as error:
        report.fail(f"XPI is a readable ZIP archive: {error}")
        return report.problems

    with archive:
        bad_entry = archive.testzip()
        report.check(
            bad_entry is None,
            "XPI CRCs are intact"
            + ("" if bad_entry is None else f" (first bad entry: {bad_entry})"),
        )

        names = archive.namelist()
        duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
        report.check(
            not duplicates,
            "XPI has no duplicate entries"
            + ("" if not duplicates else f" (got {duplicates})"),
        )

        required = [
            "manifest.json",
            "bootstrap.js",
            "prefs.js",
            LICENSE_NOTICE,
            f"chrome/content/scripts/{addon_ref}.js",
            "chrome/content/scripts/customElements.js",
        ]
        for name in required:
            report.check(name in names, f'XPI contains "{name}"')
        report.check(
            any(name.startswith("locale/en-US/") for name in names),
            "XPI contains the en-US locale",
        )

        test_entries = [name for name in names if looks_like_test(name)]
        report.check(
            not test_entries,
            "XPI bundles no test sources"
            + ("" if not test_entries else f" (got {test_entries})"),
        )
        report.check(
            not any(name.endswith(".ts") for name in names),
            "XPI bundles no TypeScript sources",
        )

        xpi_manifest: Any = None
        if "manifest.json" in names:
            try:
                xpi_manifest = json.loads(
                    archive.read("manifest.json").decode("utf-8")
                )
            except (ValueError, UnicodeDecodeError) as error:
                report.fail(f"XPI manifest.json is valid JSON: {error}")
        if xpi_manifest is not None:
            check_manifest(report, "XPI manifest.json", xpi_manifest, version)
            if built_manifest is not None:
                report.check(
                    xpi_manifest == built_manifest,
                    "XPI manifest matches build/addon/manifest.json",
                )

        scripts = [
            name
            for name in names
            if name.startswith("chrome/content/scripts/") and name.endswith(".js")
        ]
        report.check(bool(scripts), "XPI contains the bundled scripts")
        bundled = b"".join(
            archive.read(name) for name in scripts if name in names
        )
        report.check(
            READER_STORAGE_REVISION.encode() in bundled,
            f'bundled scripts retain the reader storage revision "{READER_STORAGE_REVISION}"',
        )

        if LICENSE_NOTICE in names:
            notice = archive.read(LICENSE_NOTICE).decode("utf-8", errors="replace")
            report.check(
                "MIT License" in notice and "Permission is hereby granted" in notice,
                "bundled Gajae Code notice contains the MIT license text",
            )
            report.check(
                "Gajae Code" in notice,
                "bundled Gajae Code notice names its origin",
            )

    if "-" not in version:
        check_feed(report, build / "update.json", version, sha512)
    check_feed(report, build / "update-beta.json", version, sha512)

    sums = build / SUMS_NAME
    sums.write_text(f"{sha256}  {xpi.name}\n", encoding="utf-8", newline="\n")
    print(f"ok   wrote {sums.relative_to(root)} (sha256 {sha256})")

    return report.problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify the packaged Zotero Translation Reader release."
    )
    parser.add_argument(
        "--tag",
        help="release tag being published, e.g. v2.4.38 (checked against package.json)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repository root (default: the parent of this script's directory)",
    )
    args = parser.parse_args(argv)

    if args.tag is not None and not args.tag.strip():
        parser.error("--tag must not be empty")

    root = args.root.resolve()
    print(f"verifying release build in {root}")
    problems = verify(root, args.tag)

    if problems:
        print(f"\n{len(problems)} problem(s) found; refusing to publish.")
        return 1

    print("\nAll release checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
