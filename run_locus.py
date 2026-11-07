#!/usr/bin/env python3
"""Launch Locus locally with Python's standard library (Python 3.9+)."""

import argparse
import functools
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "0.2.0"
APP_DIRECTORY = Path(__file__).resolve().parent / "dist"


class LocalAppHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css"}

    def send_head(self):
        # Serve only bundled application assets, including when a symlink exists.
        root = Path(self.directory).resolve()
        target = Path(self.translate_path(self.path)).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(403, "Outside application directory")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        # The downloadable app has no external resources or network APIs.
        self.send_header("Content-Security-Policy", "default-src 'self'; "
                         "script-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "worker-src 'self' blob:; img-src 'self' data: blob:; "
                         "connect-src 'self'; object-src 'none'; base-uri 'none'; "
                         "frame-ancestors 'none'")
        super().end_headers()

    def log_message(self, format, *args):
        # Request paths and imported filenames do not need to be logged.
        pass


def create_server(directory=APP_DIRECTORY, port=0):
    handler = functools.partial(LocalAppHandler, directory=str(directory))
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run Locus locally; no installation or Internet access required.")
    parser.add_argument("--version", action="version", version="Locus " + VERSION)
    parser.add_argument("--port", type=int, default=0, help="Local port (default: choose a free port)")
    parser.add_argument("--no-browser", action="store_true", help="Print the URL without opening a browser")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    if sys.version_info < (3, 9):
        parser.error("Locus requires Python 3.9 or later")
    if not (APP_DIRECTORY / "index.html").is_file():
        parser.error("The dist folder is missing. Extract the complete Locus download before launching.")
    try:
        server = create_server(port=args.port)
    except OSError as error:
        parser.exit(1, "Cannot start Locus: %s. Try another --port, or omit it.\n" % error)
    url = "http://127.0.0.1:%s/" % server.server_address[1]
    print("\nLocus %s\n%s\n\nKeep this window open. Press Ctrl+C to stop.\n"
          "Genome and annotation files stay in your browser.\n" % (VERSION, url), flush=True)
    if not args.no_browser:
        opener = threading.Timer(0.3, webbrowser.open, args=(url,))
        opener.daemon = True
        opener.start()
    with server:
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            print("\nLocus stopped.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
