"""Prepare a verified, public-file-only Vercel upload without altering the checkout."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

PUBLIC_DIRECTORIES = ('css', 'fonts', 'img', 'js', 'play')
PUBLIC_FILES = ('index.html', 'vercel.json')


def stable_hash(path):
    first = hashlib.sha256(path.read_bytes()).hexdigest()
    second = hashlib.sha256(path.read_bytes()).hexdigest()
    if first != second:
        raise RuntimeError(f'Repeated reads differ: {path}')
    return first


def prepare(source, target):
    source = source.resolve()
    target = target.resolve()
    if target == source or target.is_relative_to(source):
        raise ValueError('Use a new staging folder outside the source checkout.')
    if target.exists():
        raise FileExistsError(f'Staging folder already exists: {target}')
    receipt_path = target.parent / (target.name + '.receipt.json')
    if receipt_path.exists():
        raise FileExistsError(f'Receipt already exists: {receipt_path}')
    inputs = []
    for name in PUBLIC_DIRECTORIES:
        directory = source / 'portfolio' / name
        if not directory.is_dir():
            raise FileNotFoundError(f'Required site directory is missing: {directory}')
        inputs.extend(path for path in directory.rglob('*') if path.is_file())
    inputs.extend(source / 'portfolio' / name for name in PUBLIC_FILES)
    inputs.append(source / '.vercel' / 'project.json')
    # A partial staging folder is retained on failure so that no original is lost.
    receipt = []
    for original in sorted(inputs):
        if original.is_symlink():
            raise ValueError(f'Symlink is outside this upload contract: {original}')
        relative = original.relative_to(source)
        if any(part in {'.git', 'node_modules', 'META-HARNESS.md'} or part.startswith('.env')
               for part in relative.parts):
            raise ValueError(f'Private/runtime file found in the static site: {relative}')
        destination = target / relative
        expected = stable_hash(original)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, destination)
        if stable_hash(destination) != expected:
            raise RuntimeError(f'Staged copy differs: {relative}')
        receipt.append({'path': relative.as_posix(), 'sha256': expected,
                        'bytes': original.stat().st_size})
    receipt_path.write_text(json.dumps({'source': str(source), 'stage': str(target),
                                       'files': receipt}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'stage': str(target), 'files': len(receipt),
                      'bytes': sum(item['bytes'] for item in receipt),
                      'receipt': str(receipt_path), 'repeatedReadsMatched': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    prepare(options.source, options.output)
