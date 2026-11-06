"""Integration checks for the portable local app, using only the standard library."""
import contextlib
import hashlib
import importlib.util
import json
import os
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("locus_launcher", ROOT / "run_locus.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


@contextlib.contextmanager
def serving(directory):
    server = launcher.create_server(directory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:%s" % server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


class LocalPackageTests(unittest.TestCase):
    def test_loopback_static_assets_and_offline_policy(self):
        with serving(ROOT / "dist") as url:
            for name, mime in [("/", "text/html"), ("/app.js", "text/javascript"),
                               ("/core.js", "text/javascript"), ("/worker.js", "text/javascript")]:
                with urllib.request.urlopen(url + name, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(mime, response.headers["Content-Type"])
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                    self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])
                    self.assertTrue(response.read())
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(url + "/../run_locus.py", timeout=3)
            self.assertEqual(denied.exception.code, 404)
        self.assertNotIn("@import", (ROOT / "dist/style.css").read_text())
        self.assertNotIn("https://", (ROOT / "dist/style.css").read_text())

    def test_no_directory_listing_or_symlink_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            app = folder / "app"
            app.mkdir()
            (app / "empty").mkdir()
            outside = folder / "outside.txt"
            outside.write_text("outside")
            (app / "escape.txt").symlink_to(outside)
            with serving(app) as url:
                for route, expected in [("/empty/", 404), ("/escape.txt", 403)]:
                    with self.assertRaises(urllib.error.HTTPError) as denied:
                        urllib.request.urlopen(url + route, timeout=3)
                    self.assertEqual(denied.exception.code, expected)

    def test_extracted_release_launches_and_checksum_matches(self):
        subprocess.run([sys.executable, "tools/package_release.py"], cwd=ROOT,
                       check=True, capture_output=True)
        version = json.loads((ROOT / "package.json").read_text())["version"]
        archive = ROOT / "releases" / ("locus-" + version + ".zip")
        sums = (ROOT / "releases/SHA256SUMS.txt").read_text()
        self.assertIn(hashlib.sha256(archive.read_bytes()).hexdigest(), sums)
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(archive) as bundle:
                names = bundle.namelist()
                self.assertFalse(any("/.git/" in n or "/.openai/" in n or n.endswith(".DS_Store") for n in names))
                bundle.extractall(tmp)
            app = Path(tmp) / ("Locus-" + version)
            process = subprocess.Popen([sys.executable, str(app / "run_locus.py"), "--no-browser"],
                                       cwd=tmp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            lines = queue.Queue()
            def read_url():
                for line in process.stdout:
                    if line.startswith("http://127.0.0.1:"):
                        lines.put(line.strip())
                        break
            threading.Thread(target=read_url, daemon=True).start()
            try:
                url = lines.get(timeout=10)
                with urllib.request.urlopen(url, timeout=3) as response:
                    self.assertIn(b"Sequence dotplot", response.read())
                with urllib.request.urlopen(url + "worker.js", timeout=3) as response:
                    self.assertIn(b"computeMatches", response.read())
                if os.name != "nt":
                    process.send_signal(signal.SIGINT)
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 0, stderr)
                    self.assertIn("Locus stopped", stdout)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
