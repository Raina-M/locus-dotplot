#!/usr/bin/env python3
"""Build dependency-free ZIP/tar downloads from an explicit source allowlist."""

import gzip
import hashlib
import io
import json
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOP_LEVEL = ["README.md", "QUICKSTART.md", "ARCHITECTURE.md", "CHANGELOG.md",
             "package.json", "run_locus.py", "Start Locus.command",
             "Start Locus.bat", "start-locus.sh", ".gitignore"]


def build():
    version = json.loads((ROOT / "package.json").read_text())["version"]
    folder = "Locus-" + version
    output = ROOT / "releases"
    output.mkdir(exist_ok=True)
    files = [ROOT / name for name in TOP_LEVEL]
    for directory, extensions in [("dist", {".js", ".css", ".html", ".fa", ".bed", ".bedgraph"}),
                                  ("tests", {".mjs", ".py"}), ("tools", {".py"})]:
        files.extend(p for p in sorted((ROOT / directory).rglob("*"))
                     if p.is_file() and not p.is_symlink() and p.suffix in extensions
                     and "__pycache__" not in p.parts)
    zip_path = output / ("locus-" + version + ".zip")
    tar_path = output / ("locus-" + version + ".tar.gz")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            name = folder + "/" + file.relative_to(ROOT).as_posix()
            entry = zipfile.ZipInfo(name, date_time=(2026, 11, 6, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = ((0o100755 if file.suffix in {".sh", ".command"} else 0o100644) << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, file.read_bytes())
    with tar_path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for file in files:
                    data = file.read_bytes()
                    entry = tarfile.TarInfo(folder + "/" + file.relative_to(ROOT).as_posix())
                    entry.size = len(data)
                    entry.mode = 0o755 if file.suffix in {".sh", ".command"} else 0o644
                    archive.addfile(entry, io.BytesIO(data))
    manifest = output / "SHA256SUMS.txt"
    manifest.write_text("".join(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name + "\n"
                                for path in [zip_path, tar_path]), encoding="utf-8")
    for path in [zip_path, tar_path, manifest]:
        print(path)


if __name__ == "__main__":
    build()
