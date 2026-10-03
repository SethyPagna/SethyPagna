"""Verify the complete public Pages release twice against an exact main commit."""

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from prepare_cloudflare import MAX_FILE_BYTES, MAX_FILES, public_path

ORIGIN = "https://sethy-pagna.pages.dev"
WORKERS = 4
CHUNK_BYTES = 256 * 1024
SHA1 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MIME_TYPES = {
    ".js": {"application/javascript", "text/javascript", "application/ecmascript", "text/ecmascript"},
    ".css": {"text/css"},
    ".wasm": {"application/wasm"},
}
PRIVATE_PROBES = (
    ".git/HEAD", ".env", "README.md", "vercel.json", "package.json", "META-HARNESS.md",
    "scripts/prepare_cloudflare.py", "docs/PROGRESS.md", "tools/allchess-arcade/src/main.tsx",
    ".github/workflows/verify-portfolio-cloudflare.yml", "cloudflare-public.receipt.json",
    "_headers", "js/main.js.map", "__release-verification-missing__.js",
    "play/allchess/__release-verification-missing__.wasm",
)


class VerificationError(Exception):
    pass


class AbsoluteDeadlineExceeded(BaseException):
    pass


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise VerificationError("Invalid manifest path")
    if any(ord(char) < 32 or ord(char) == 127 for char in value) or any(char in value for char in "\\%?#:"):
        raise VerificationError(f"Unsafe manifest path: {value!r}")
    if unicodedata.normalize("NFC", value) != value:
        raise VerificationError(f"Non-canonical Unicode path: {value!r}")
    parts = value.split("/")
    if any(part in {"", ".", ".."} or part.startswith(".") for part in parts):
        raise VerificationError(f"Unsafe manifest path: {value!r}")
    if value == "_headers" or not public_path(PurePosixPath(value)):
        raise VerificationError(f"Path is not a served public artifact: {value!r}")
    return value


def validate_manifest(raw, expected_sha):
    try:
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise VerificationError(f"Duplicate JSON key: {key}")
                result[key] = value
            return result
        manifest = json.loads(raw, object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"Invalid build-info JSON: {error}") from error
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "sourceRevision", "sourceState", "files"}:
        raise VerificationError("Unexpected build-info schema fields")
    if type(manifest["schema"]) is not int or manifest["schema"] != 1:
        raise VerificationError("Unsupported build-info schema")
    if manifest["sourceRevision"] != expected_sha or manifest["sourceState"] != "git-matched":
        raise VerificationError("Published release is not git-matched at the expected commit")
    entries = manifest["files"]
    if not isinstance(entries, list) or not entries or len(entries) + 1 > MAX_FILES:
        raise VerificationError("Manifest file count is empty or exceeds the Pages limit")
    names, folded = set(), set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "bytes", "sha256"}:
            raise VerificationError("Unexpected manifest file fields")
        path = safe_path(entry["path"])
        if path in names or path.casefold() in folded:
            raise VerificationError(f"Duplicate/case-colliding manifest path: {path}")
        names.add(path)
        folded.add(path.casefold())
        if type(entry["bytes"]) is not int or not 0 <= entry["bytes"] <= MAX_FILE_BYTES:
            raise VerificationError(f"Invalid artifact size: {path}")
        if not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]):
            raise VerificationError(f"Invalid artifact digest: {path}")
    if not {"index.html", "404.html"}.issubset(names):
        raise VerificationError("Required HTML artifacts are missing")
    for extension in MIME_TYPES:
        if not any(path.endswith(extension) for path in names):
            raise VerificationError(f"No representative {extension} artifact in manifest")
    return manifest


def git(source, *arguments):
    try:
        return subprocess.check_output(
            ["git", "-C", str(source), *arguments], stderr=subprocess.PIPE, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise VerificationError("Git lookup failed; an intact checkout of the expected main commit is required") from error


def committed_files(source, expected_sha):
    """Read Git objects independently of HTTP claims and validate their object IDs."""
    if git(source, "rev-parse", "HEAD").decode().strip() != expected_sha:
        raise VerificationError("Current main checkout HEAD differs from expected source SHA")
    records = git(source, "ls-tree", "-r", "-z", expected_sha, "--", "portfolio")
    selected, headers = {}, None
    for record in records.split(b"\0"):
        if not record:
            continue
        metadata, name = record.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split()
        name = name.decode("utf-8")
        if not name.startswith("portfolio/"):
            continue
        relative = name[len("portfolio/"):]
        if not public_path(PurePosixPath(relative)):
            continue
        if mode not in {"100644", "100755"} or kind != "blob":
            raise VerificationError(f"Public Git entry is not a regular file: {relative}")
        if relative == "_headers":
            headers = (mode, object_id)
        else:
            safe_path(relative)
            selected[relative] = object_id
    if headers is None or not {"index.html", "404.html"}.issubset(selected):
        raise VerificationError("Required Pages files are absent from the expected commit")
    if len(selected) + 2 > MAX_FILES:
        raise VerificationError("Committed payload exceeds Pages file limit including control files")
    if len(selected) != len({path.casefold() for path in selected}):
        raise VerificationError("Committed public files contain case collisions")
    process = subprocess.Popen(
        ["git", "-C", str(source), "cat-file", "--batch"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    observed = {}
    try:
        for path, object_id in sorted({**selected, "_headers": headers[1]}.items()):
            process.stdin.write((object_id + "\n").encode("ascii"))
            process.stdin.flush()
            response = process.stdout.readline().decode("ascii").strip().split()
            if len(response) != 3 or response[:2] != [object_id, "blob"]:
                raise VerificationError(f"Cannot read committed Git blob: {path}")
            size = int(response[2])
            if not 0 <= size <= MAX_FILE_BYTES:
                raise VerificationError(f"Committed file exceeds Pages limit: {path}")
            remaining, digest = size, hashlib.sha256()
            object_digest = hashlib.sha1(f"blob {size}\0".encode("ascii"))
            while remaining:
                chunk = process.stdout.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    raise VerificationError(f"Truncated committed blob: {path}")
                digest.update(chunk)
                object_digest.update(chunk)
                remaining -= len(chunk)
            if process.stdout.read(1) != b"\n" or object_digest.hexdigest() != object_id:
                raise VerificationError(f"Committed Git object digest mismatch: {path}")
            observed[path] = {"path": path, "bytes": size, "sha256": digest.hexdigest(), "gitBlob": object_id}
        process.stdin.close()
        process.wait(timeout=30)
        if process.returncode:
            raise VerificationError("Git object reader failed")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        process.stdout.close()
    control = observed.pop("_headers")
    return observed, control


class HtmlRedirects(urllib.request.HTTPRedirectHandler):
    """Permit only Pages' same-origin clean HTML canonicalization, at most two hops."""
    def redirect_request(self, request, handle, code, message, headers, new_url):
        old, new = urllib.parse.urlsplit(request.full_url), urllib.parse.urlsplit(new_url)
        clean = old.path[:-len("index.html")] if old.path.endswith("/index.html") else old.path[:-5]
        if (code not in {301, 302, 307, 308} or not old.path.endswith(".html")
                or new.scheme + "://" + new.netloc != ORIGIN or new.path not in {clean, clean + "/"}
                or new.query or new.fragment or getattr(request, "redirect_count", 0) >= 2):
            raise VerificationError("Unexpected HTTP redirect")
        redirected = super().redirect_request(request, handle, code, message, headers, new_url)
        redirected.redirect_count = getattr(request, "redirect_count", 0) + 1
        return redirected


class Downloader:
    def __init__(self, timeout, deadline):
        self.timeout, self.deadline = timeout, deadline

    def fetch(self, path, *, keep_body=False):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise VerificationError("Verification deadline exceeded")
        request = urllib.request.Request(ORIGIN + "/" + urllib.parse.quote(path, safe="/"), headers={
            "User-Agent": "Pagna-Pages-release-verifier/1", "Accept-Encoding": "identity",
            "Cache-Control": "no-cache", "Pragma": "no-cache",
        })
        opener = urllib.request.build_opener(HtmlRedirects())
        try:
            response = opener.open(request, timeout=min(self.timeout, remaining))
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.status
            headers = {name: response.headers.get(name, "") for name in (
                "Content-Type", "Cache-Control", "Content-Encoding", "Content-Length", "ETag", "CF-Ray",
            )}
            if headers["Content-Encoding"].lower() not in {"", "identity"}:
                raise VerificationError(f"Unexpected compressed representation: {path}")
            size, digest, prefix, chunks = 0, hashlib.sha256(), b"", []
            while True:
                if time.monotonic() > self.deadline:
                    raise VerificationError("Verification deadline exceeded")
                # read() can wait to fill its buffer while slow bytes avoid the socket timeout.
                chunk = response.read1(CHUNK_BYTES)
                if time.monotonic() > self.deadline:
                    raise VerificationError("Verification deadline exceeded")
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise VerificationError(f"HTTP body exceeds Pages file size limit: {path}")
                digest.update(chunk)
                prefix = (prefix + chunk)[:256]
                if keep_body:
                    chunks.append(chunk)
            length = headers["Content-Length"]
            if length and (not length.isdigit() or int(length) != size):
                raise VerificationError(f"HTTP Content-Length mismatch: {path}")
            result = {"status": status, "url": response.geturl(), "bytes": size,
                      "sha256": digest.hexdigest(), "headers": headers}
            return result, prefix, b"".join(chunks) if keep_body else None


def check_asset(entry, result, prefix):
    path = entry["path"]
    if result["status"] != 200 or (result["bytes"], result["sha256"]) != (entry["bytes"], entry["sha256"]):
        raise VerificationError(f"HTTP status/size/digest mismatch: {path}")
    extension = PurePosixPath(path).suffix.lower()
    mime = result["headers"]["Content-Type"].split(";", 1)[0].strip().lower()
    if extension in MIME_TYPES and mime not in MIME_TYPES[extension]:
        raise VerificationError(f"Unexpected MIME {mime!r}: {path}")
    if extension in {".js", ".wasm"} and prefix.lstrip().lower().startswith((b"<!doctype html", b"<html")):
        raise VerificationError(f"HTML fallback served as an executable artifact: {path}")
    if extension == ".wasm" and not prefix.startswith(b"\x00asm"):
        raise VerificationError(f"Invalid WASM signature: {path}")
    if extension == ".js":
        directives = [part.strip().lower() for part in result["headers"]["Cache-Control"].split(",")]
        ages = [part for part in directives if part.startswith("max-age=")]
        if not {"public", "must-revalidate"}.issubset(directives) or ages != ["max-age=0"] or "immutable" in directives:
            raise VerificationError(f"JavaScript is missing the required revalidation cache policy: {path}")


def download_pass(entries, downloader):
    """Keep only four requests in flight and stop scheduling immediately on failure."""
    pending, results, errors = {}, [], []
    iterator = iter(entries)
    def download(entry):
        result, prefix, _ = downloader.fetch(entry["path"])
        result["path"] = entry["path"]
        try:
            check_asset(entry, result, prefix)
        except VerificationError as error:
            result["error"] = str(error)
        return result
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS)
    alarm_aborted = False
    try:
        def submit_next():
            entry = next(iterator, None)
            if entry:
                pending[executor.submit(download, entry)] = entry["path"]
        for _ in range(WORKERS):
            submit_next()
        while pending:
            done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                path = pending.pop(future)
                try:
                    result = future.result()
                except Exception as error:
                    result = {"path": path, "error": f"{type(error).__name__}: {error}"}
                results.append(result)
                if "error" in result:
                    errors.append(result["error"])
            if not errors:
                for _ in done:
                    submit_next()
    except AbsoluteDeadlineExceeded:
        alarm_aborted = True
        raise
    finally:
        # An alarm must reach the proof writer even if an HTTP worker is opening headers.
        executor.shutdown(wait=not alarm_aborted, cancel_futures=alarm_aborted)
    return sorted(results, key=lambda result: result["path"]), errors


def verify(source, expected_sha, proof, *, timeout=20, deadline_seconds=900, downloader=None):
    if not SHA1.fullmatch(expected_sha):
        raise VerificationError("Expected source SHA must be exactly 40 lowercase hexadecimal characters")
    if not 5 <= timeout <= 30 or not 60 <= deadline_seconds <= 1200:
        raise VerificationError("HTTP timeout must be 5–30 seconds; overall deadline 60–1200 seconds")
    baseline, control = committed_files(source, expected_sha)
    proof["checkoutSourceRevision"] = expected_sha
    proof["gitControlFile"] = control
    expected_entries = [{key: entry[key] for key in ("path", "bytes", "sha256")}
                        for _, entry in sorted(baseline.items())]
    expected_manifest = {"schema": 1, "sourceRevision": expected_sha, "sourceState": "git-matched", "files": expected_entries}
    expected_raw = (json.dumps(expected_manifest, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
    expected_digest = hashlib.sha256(expected_raw).hexdigest()
    proof["committedArtifactCount"] = len(baseline)
    proof["expectedManifestSha256"] = expected_digest
    proof["files"] = [{**entry, "reads": []} for _, entry in sorted(baseline.items())]
    records = {entry["path"]: entry for entry in proof["files"]}
    downloader = downloader or Downloader(timeout, time.monotonic() + deadline_seconds)
    proof["manifestReads"], proof["passes"], proof["privatePaths"] = [], [], []
    for number in (1, 2):
        result, _, raw = downloader.fetch("build-info.json", keep_body=True)
        proof["manifestReads"].append({"pass": number, **result})
        if result["status"] != 200:
            raise VerificationError(f"Public build-info returned HTTP {result['status']}; no release bytes were verified")
        if result["sha256"] != expected_digest:
            raise VerificationError("Public build-info digest differs from the independently reconstructed Git manifest")
        mime = result["headers"]["Content-Type"].split(";", 1)[0].strip().lower()
        if mime != "application/json":
            raise VerificationError("Public build-info is not application/json")
        manifest = validate_manifest(raw, expected_sha)
        if manifest != expected_manifest:
            raise VerificationError("Public file index differs from committed release content")
        results, errors = download_pass(manifest["files"], downloader)
        for read in results:
            records[read["path"]]["reads"].append({"pass": number, **read})
        proof["passes"].append({"pass": number, "completedFiles": len(results), "errors": errors})
        if errors or len(results) != len(baseline):
            raise VerificationError(f"HTTP pass {number} failed; full release verification is incomplete")
        for path in PRIVATE_PROBES:
            result, _, _ = downloader.fetch(path)
            proof["privatePaths"].append({"pass": number, "path": path, **result})
            if result["status"] != 404:
                raise VerificationError(f"Private/missing path must return HTTP 404: {path}")
    if git(source, "rev-parse", "HEAD").decode().strip() != expected_sha:
        raise VerificationError("Local checkout changed during verification")
    proof["ok"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-source-sha", required=True)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--deadline-seconds", type=int, default=900)
    options = parser.parse_args()
    started = time.monotonic()
    proof = {"schema": 1, "origin": ORIGIN, "expectedSourceRevision": options.expected_source_sha,
             "startedAt": timestamp(), "workers": WORKERS, "httpRetries": 0, "ok": False, "errors": []}
    alarm_available = sys.platform == "linux" and hasattr(signal, "setitimer")
    proof["deadlineMode"] = "linux-sigalrm" if alarm_available else "cooperative"
    proof["deadlineSeconds"] = options.deadline_seconds
    proof["socketInactivityTimeoutSeconds"] = options.timeout
    absolute_expired, previous_handler = False, None
    def absolute_deadline(signum, frame):
        nonlocal absolute_expired
        absolute_expired = True
        raise AbsoluteDeadlineExceeded("Absolute CLI verification deadline exceeded")
    try:
        if alarm_available and 60 <= options.deadline_seconds <= 1200:
            previous_handler = signal.signal(signal.SIGALRM, absolute_deadline)
            signal.setitimer(signal.ITIMER_REAL, options.deadline_seconds)
        try:
            verify(options.source, options.expected_source_sha, proof,
                   timeout=options.timeout, deadline_seconds=options.deadline_seconds)
        finally:
            if previous_handler is not None:
                signal.setitimer(signal.ITIMER_REAL, 0)
    except (Exception, AbsoluteDeadlineExceeded) as error:
        proof["ok"] = False
        proof["errors"].append(f"{type(error).__name__}: {error}")
    finally:
        if previous_handler is not None:
            signal.signal(signal.SIGALRM, previous_handler)
    # The verification alarm excludes proof writing. Workers never own/mutate proof.
    proof["finishedAt"], proof["durationSeconds"] = timestamp(), round(time.monotonic() - started, 3)
    try:
        options.report.parent.mkdir(parents=True, exist_ok=True)
        with options.report.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(proof, handle, indent=2, ensure_ascii=True)
            handle.write("\n")
        print(json.dumps({"ok": proof["ok"], "origin": ORIGIN, "expectedSourceRevision": options.expected_source_sha,
                          "verifiedFiles": len(proof.get("files", [])) if proof["ok"] else 0, "errors": proof["errors"]}), flush=True)
    finally:
        if absolute_expired:
            # CPython otherwise joins blocked executor workers at exit, delaying upload forever.
            # Only this CLI's absolute alarm takes this path, after the proof is closed.
            sys.stdout.flush()
            sys.stderr.flush()
            os._exit(1)
    return 0 if proof["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
