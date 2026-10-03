"""Copy and verify the public portfolio into a new Cloudflare Pages directory."""

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path, PurePosixPath

PUBLIC_FILES = ("index.html", "_headers", "404.html")
PUBLIC_DIRECTORIES = ("css", "js", "fonts", "img", "play")
MANIFEST_NAME = "build-info.json"
MAX_FILES = 20_000
MAX_FILE_BYTES = 25 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024
PRIVATE_DIRECTORIES = {
    "node_modules", "tools", "raw", "src", "source", "sources", "scripts",
    "docs", "tests", "__pycache__", "output", "dist", "logs", "private",
    "_private", "secrets", "credentials", "backups", "cache", "tmp", "temp",
}
PRIVATE_FILES = {
    "vercel.json", "package.json", "package-lock.json", "pnpm-lock.yaml",
    "yarn.lock", "meta-harness.md", "agents.md", "claude.md", "_redirects",
    "credentials.json", "secrets.json",
}


def check_plain_path(path):
    """Reject links/junctions in the path, including existing parent directories."""
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError(f"Links/junctions are not allowed: {part}")
        if part.exists():
            metadata = part.lstat()
            if stat.S_ISREG(metadata.st_mode) and metadata.st_nlink > 1:
                raise ValueError(f"Hard links are not allowed: {part}")
            attributes = getattr(metadata, "st_file_attributes", 0)
            if attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError(f"Reparse points are not allowed: {part}")


def public_path(relative):
    parts = relative.parts
    if len(parts) == 1:
        return parts[0] in PUBLIC_FILES
    if not parts or parts[0] not in PUBLIC_DIRECTORIES:
        return False
    if any(part.startswith(".") or part.lower() in PRIVATE_DIRECTORIES for part in parts):
        return False
    name = parts[-1].lower()
    return not (
        name in PRIVATE_FILES or name.startswith("readme")
        or name.endswith((".map", ".log", ".pyc", ".env"))
        or name.startswith(".env")
    )


def collect_files(public_root):
    files = []
    for name in PUBLIC_FILES:
        path = public_root / name
        check_plain_path(path)
        if not path.is_file():
            raise FileNotFoundError(f"Required public file missing: {path}")
        files.append(path)
    for name in PUBLIC_DIRECTORIES:
        directory = public_root / name
        check_plain_path(directory)
        if not directory.is_dir():
            raise FileNotFoundError(f"Required public directory missing: {directory}")
        for parent, directories, filenames in os.walk(directory, followlinks=False):
            parent = Path(parent)
            retained = []
            for child_name in sorted(directories):
                child = parent / child_name
                check_plain_path(child)
                if not child_name.startswith(".") and child_name.lower() not in PRIVATE_DIRECTORIES:
                    retained.append(child_name)
            directories[:] = retained
            for child_name in sorted(filenames):
                child = parent / child_name
                check_plain_path(child)
                if public_path(PurePosixPath(child.relative_to(public_root).as_posix())):
                    if not stat.S_ISREG(child.stat().st_mode):
                        raise ValueError(f"Only regular files are allowed: {child}")
                    files.append(child)
    if len(files) + 1 > MAX_FILES:
        raise ValueError(f"Payload exceeds {MAX_FILES} files, including the manifest")
    names = [path.relative_to(public_root).as_posix().casefold() for path in files]
    if len(names) != len(set(names)):
        raise ValueError("Public paths differ only by case")
    return sorted(files, key=lambda path: path.relative_to(public_root).as_posix())


def read_hash(path):
    check_plain_path(path)
    raw, normalized = hashlib.sha256(), hashlib.sha256()
    size, pending, binary = 0, b"", False
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise ValueError(f"File exceeds {MAX_FILE_BYTES} bytes: {path}")
            raw.update(chunk)
            binary = binary or b"\0" in chunk
            text = pending + chunk
            pending = b"\r" if text.endswith(b"\r") else b""
            if pending:
                text = text[:-1]
            normalized.update(text.replace(b"\r\n", b"\n"))
    normalized.update(pending)
    return {"sha256": raw.hexdigest(), "lfSha256": normalized.hexdigest(),
            "bytes": size, "binary": binary}


def stable_hash(path):
    first, second = read_hash(path), read_hash(path)
    if first != second:
        raise RuntimeError(f"Repeated reads differ: {path}")
    return first


def git_baseline(source, public_root, relatives):
    """Read committed blobs independently; no Git writes or network operations."""
    try:
        root = subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    root = Path(root).resolve()
    prefix = public_root.relative_to(root).as_posix()
    revision = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True,
    ).strip()
    tree = subprocess.check_output(
        ["git", "-C", str(root), "ls-tree", "-r", "-z", revision, "--", prefix],
    )
    blobs = {}
    for record in tree.split(b"\0"):
        if not record:
            continue
        metadata, filename = record.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split()
        name = filename.decode("utf-8")
        relative = name[len(prefix) + 1:]
        if kind == "blob" and public_path(PurePosixPath(relative)):
            blobs[relative] = (mode, object_id)
    hashes = {}
    process = subprocess.Popen(
        ["git", "-C", str(root), "cat-file", "--batch"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    try:
        for relative in sorted(set(relatives) & blobs.keys()):
            mode, object_id = blobs[relative]
            process.stdin.write((object_id + "\n").encode("ascii"))
            process.stdin.flush()
            header = process.stdout.readline().decode("ascii").strip().split()
            if len(header) != 3 or header[:2] != [object_id, "blob"]:
                raise RuntimeError(f"Cannot read Git baseline: {relative}")
            remaining = size = int(header[2])
            digest = hashlib.sha256()
            while remaining:
                chunk = process.stdout.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    raise RuntimeError(f"Truncated Git blob: {relative}")
                digest.update(chunk)
                remaining -= len(chunk)
            if process.stdout.read(1) != b"\n":
                raise RuntimeError(f"Malformed Git blob response: {relative}")
            hashes[relative] = {"blob": object_id, "mode": mode,
                                "sha256": digest.hexdigest(), "bytes": size}
        process.stdin.close()
        process.wait()
        if process.returncode:
            raise RuntimeError("Git baseline reader failed")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait()
        process.stdout.close()
    return {"revision": revision, "files": hashes,
            "missingPublicFiles": sorted(blobs.keys() - set(relatives))}


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode("utf-8")


def prepare(source, output):
    source, output = source.absolute(), output.absolute()
    check_plain_path(source)
    check_plain_path(output)
    source, output = source.resolve(), output.resolve()
    public_root = source / "portfolio"
    if output == public_root or output.is_relative_to(public_root) or public_root.is_relative_to(output):
        raise ValueError("Output must be outside portfolio and cannot contain the source")
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")
    receipt_path = output.with_name(output.name + ".receipt.json")
    check_plain_path(receipt_path)
    if receipt_path.exists():
        raise FileExistsError(f"Receipt already exists: {receipt_path}")
    inputs = collect_files(public_root)
    relatives = [path.relative_to(public_root).as_posix() for path in inputs]
    baseline = git_baseline(source, public_root, relatives)
    # Preflight all source reads before creating any upload directory.
    observed = {relative: stable_hash(path) for path, relative in zip(inputs, relatives)}
    entries, matched = [], True
    output.mkdir(parents=True, exist_ok=False)
    for original, relative in zip(inputs, relatives):
        expected = observed[relative]
        check_plain_path(original)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, destination)
        copied = stable_hash(destination)
        if copied["sha256"] != expected["sha256"] or copied["bytes"] != expected["bytes"]:
            raise RuntimeError(f"Copied bytes differ: {relative}")
        entry = {"path": relative, "bytes": expected["bytes"], "sha256": expected["sha256"],
                 "sourceReadsMatched": True, "destinationReadsMatched": True}
        if baseline:
            blob = baseline["files"].get(relative)
            normalization = "none"
            agreement = bool(blob and blob["mode"] in {"100644", "100755"}
                             and blob["sha256"] == expected["sha256"])
            if (blob and blob["mode"] in {"100644", "100755"} and not agreement
                    and not expected["binary"] and blob["sha256"] == expected["lfSha256"]):
                agreement, normalization = True, "crlf_to_lf"
            entry["git"] = {"tracked": bool(blob), "matched": agreement,
                            "normalization": normalization, **(blob or {})}
            matched = matched and agreement
        entries.append(entry)
    state = "unversioned"
    if baseline:
        matched = matched and not baseline["missingPublicFiles"]
        state = "git-matched" if matched else "modified"
    manifest = {"schema": 1, "sourceRevision": baseline["revision"] if baseline else None,
                "sourceState": state,
                "files": [{key: entry[key] for key in ("path", "bytes", "sha256")}
                          for entry in entries if entry["path"] != "_headers"]}
    manifest_data = json_bytes(manifest)
    if len(manifest_data) > MAX_FILE_BYTES:
        raise ValueError("Generated manifest exceeds file size limit")
    manifest_path = output / MANIFEST_NAME
    with manifest_path.open("xb") as handle:
        handle.write(manifest_data)
    manifest_hash = stable_hash(manifest_path)
    if manifest_hash["sha256"] != hashlib.sha256(manifest_data).hexdigest():
        raise RuntimeError("Generated manifest readback differs")
    receipt = {"schema": 1, "source": str(source), "stage": str(output),
               "sourceRevision": manifest["sourceRevision"], "sourceState": state,
               "missingGitPublicFiles": baseline["missingPublicFiles"] if baseline else [],
               "files": entries, "manifest": {"path": MANIFEST_NAME, **manifest_hash,
                                               "destinationReadsMatched": True}}
    receipt_data = json_bytes(receipt)
    with receipt_path.open("xb") as handle:
        handle.write(receipt_data)
    if stable_hash(receipt_path)["sha256"] != hashlib.sha256(receipt_data).hexdigest():
        raise RuntimeError("Receipt readback differs")
    return {"stage": str(output), "receipt": str(receipt_path),
            "files": len(entries) + 1, "bytes": sum(entry["bytes"] for entry in entries) + len(manifest_data),
            "sourceRevision": manifest["sourceRevision"], "sourceState": state,
            "repeatedReadsMatched": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    try:
        print(json.dumps(prepare(options.source, options.output)))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Staging failed: {error}\nPartial output, if any, is retained.\n")


if __name__ == "__main__":
    main()
