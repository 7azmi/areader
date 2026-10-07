#!/usr/bin/env python3
"""Serve only Riwaq's public assets; never expose conversion scripts or API keys."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {"index.html", "styles.css", "app.js"}
PUBLIC_FOLDERS = {"assets", "vendor", "books"}
PUBLIC_EXTENSIONS = {".svg", ".ttf", ".woff2", ".js", ".json", ".md", ".png", ".jpg", ".webp"}


class PublicHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        raw = unquote(urlsplit(self.path).path)
        relative = raw.lstrip("/") or "index.html"
        path = Path(relative)
        resolved = (ROOT / path).resolve()
        safe = resolved.is_relative_to(ROOT) and not any(part.startswith(".") or part.endswith(".conversion") for part in path.parts)
        canonical = resolved.relative_to(ROOT) if resolved.is_relative_to(ROOT) else Path("blocked")
        safe = safe and not any(part.startswith(".") or part.endswith(".conversion") for part in canonical.parts)
        allowed = relative in PUBLIC_FILES or (canonical.parts[0] in PUBLIC_FOLDERS and canonical.suffix in PUBLIC_EXTENSIONS)
        if not safe or not allowed or not resolved.is_file():
            self.send_error(404, "Not found")
            return None
        if raw == "/":
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), PublicHandler) as server:
        print(f"Riwaq is ready at http://{args.host}:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
