#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from os import environ
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ORIGIN = environ.get("LENOVO_SHORTLINK_ORIGIN", "http://127.0.0.1:5174").rstrip("/")
LISTEN_HOST = environ.get("LENOVO_SHORTLINK_LISTEN_HOST", "127.0.0.1")
HOST_PATHS = {
    "ad.tianlu2026.org": "/ad-machine/full-service.html",
    "pos.tianlu2026.org": "/android-pos-lite.html",
    "gaokao2026.tianlu2026.org": "/gaokao-2026/mobile.html",
    "lenovo.tianlu2026.org": None,
    "halo.tianlu2026.org": None,
}
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_OPTIONS(self):
        self._proxy()

    def _proxy(self):
        host = (self.headers.get("Host") or "").split(":", 1)[0].lower()
        forced_path = HOST_PATHS.get(host)
        if host not in HOST_PATHS:
            self.send_error(404, "Unknown host")
            return

        target_path = forced_path if forced_path is not None and self.path in {"", "/"} else self.path
        target_url = f"{ORIGIN}{target_path}"
        body = None
        if self.command in {"POST", "PUT", "PATCH"}:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length) if length else None

        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_BY_HOP}
        origin_host = ORIGIN.split("://", 1)[-1]
        headers["Host"] = origin_host
        request = Request(target_url, data=body, headers=headers, method=self.command)

        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() not in HOP_BY_HOP:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            for key, value in error.headers.items():
                if key.lower() not in HOP_BY_HOP:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except URLError as error:
            self.send_error(502, f"Origin unreachable: {error.reason}")


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, 19517), ProxyHandler)
    server.serve_forever()
