#!/usr/bin/env python3
"""Fail-closed installer for exact-lockfile npm cache artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path


class DependencyCacheError(RuntimeError):
    pass


_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise DependencyCacheError(f"command failed: {args[0]}")
    return result.stdout.strip()


def _safe_extract_zip(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            mode = (member.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise DependencyCacheError("artifact ZIP contains a symlink")
            target = (destination / member.filename).resolve()
            if os.path.commonpath([destination.resolve(), target]) != str(destination.resolve()):
                raise DependencyCacheError("artifact ZIP contains an unsafe path")
        zf.extractall(destination)


def _safe_extract_tar(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        for member in members:
            if member.issym() or member.islnk():
                raise DependencyCacheError("cache archive contains a link")
            target = (destination / member.name).resolve()
            if os.path.commonpath([destination.resolve(), target]) != str(destination.resolve()):
                raise DependencyCacheError("cache archive contains an unsafe path")
        tf.extractall(destination, members=members)


def _find_exact(root: Path, name: str) -> Path:
    matches = [path for path in root.rglob(name) if path.is_file()]
    if len(matches) != 1:
        raise DependencyCacheError(f"expected exactly one {name}")
    return matches[0]


def _read_manifest(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DependencyCacheError("invalid manifest.json") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise DependencyCacheError("unsupported dependency cache manifest")
    return value


def _require_hash(manifest: dict[str, object], key: str) -> str:
    value = manifest.get(key)
    if not isinstance(value, str) or not _SHA256_RE.fullmatch(value):
        raise DependencyCacheError(f"invalid manifest field: {key}")
    return value


def verify_artifact(
    artifact_zip: Path,
    repo: Path,
    expected_source_sha: str | None,
) -> tuple[dict[str, object], Path, tempfile.TemporaryDirectory[str]]:
    if not artifact_zip.is_file():
        raise DependencyCacheError("artifact ZIP not found")
    lockfile = repo / "package-lock.json"
    package = repo / "package.json"
    if not lockfile.is_file() or not package.is_file():
        raise DependencyCacheError("package.json/package-lock.json not found")

    temp_dir = tempfile.TemporaryDirectory(prefix="prihrash-dependency-cache-")
    root = Path(temp_dir.name)
    extracted = root / "artifact"
    extracted.mkdir()
    try:
        _safe_extract_zip(artifact_zip, extracted)
        manifest = _read_manifest(_find_exact(extracted, "manifest.json"))
        cache_archive = _find_exact(extracted, "npm-cache.tar.gz")

        source_sha = manifest.get("source_sha")
        if not isinstance(source_sha, str) or not _GIT_SHA_RE.fullmatch(source_sha):
            raise DependencyCacheError("invalid manifest source_sha")
        if expected_source_sha is not None:
            if not _GIT_SHA_RE.fullmatch(expected_source_sha) or source_sha != expected_source_sha:
                raise DependencyCacheError("source SHA mismatch")

        if _sha256(lockfile) != _require_hash(manifest, "package_lock_sha256"):
            raise DependencyCacheError("package-lock.json mismatch")
        if _sha256(package) != _require_hash(manifest, "package_json_sha256"):
            raise DependencyCacheError("package.json mismatch")
        if _sha256(cache_archive) != _require_hash(manifest, "cache_archive_sha256"):
            raise DependencyCacheError("cache archive checksum mismatch")

        node_major = manifest.get("node_major")
        npm_major = manifest.get("npm_major")
        platform = manifest.get("platform")
        arch = manifest.get("arch")
        if not isinstance(node_major, int) or node_major != 22:
            raise DependencyCacheError("unsupported manifest Node major")
        if not isinstance(npm_major, int) or npm_major <= 0:
            raise DependencyCacheError("invalid manifest npm major")
        if platform not in {"linux", "darwin", "win32"} or not isinstance(arch, str) or not arch:
            raise DependencyCacheError("invalid manifest runtime fingerprint")

        current_node_major = int(_run(["node", "-p", "process.versions.node.split('.')[0]"]))
        current_npm_major = int(_run(["npm", "--version"]).split(".", 1)[0])
        current_platform = _run(["node", "-p", "process.platform"])
        current_arch = _run(["node", "-p", "process.arch"])
        if current_node_major != node_major:
            raise DependencyCacheError("Node major mismatch")
        if current_npm_major != npm_major:
            raise DependencyCacheError("npm major mismatch")
        if current_platform != platform or current_arch != arch:
            raise DependencyCacheError("runtime platform/arch mismatch")

        cache_dir = root / "npm-cache"
        cache_dir.mkdir()
        _safe_extract_tar(cache_archive, cache_dir)
        return manifest, cache_dir, temp_dir
    except Exception:
        temp_dir.cleanup()
        raise


def install(artifact_zip: Path, repo: Path, expected_source_sha: str | None, verify_only: bool) -> dict[str, object]:
    manifest, cache_dir, temp_dir = verify_artifact(artifact_zip, repo, expected_source_sha)
    try:
        result: dict[str, object] = {
            "status": "PASS",
            "source_sha": manifest["source_sha"],
            "package_lock_sha256": manifest["package_lock_sha256"],
            "verified": True,
            "installed": False,
        }
        if verify_only:
            return result

        _run(
            [
                "npm",
                "ci",
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--cache",
                str(cache_dir),
            ],
            cwd=repo,
        )
        _run(["npm", "ls", "--depth=0"], cwd=repo)
        result["installed"] = True
        return result
    finally:
        temp_dir.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-zip", required=True, type=Path)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--source-sha")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    try:
        result = install(args.artifact_zip, args.repo.resolve(), args.source_sha, args.verify_only)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (DependencyCacheError, OSError, ValueError, tarfile.TarError, zipfile.BadZipFile) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
