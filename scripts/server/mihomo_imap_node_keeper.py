#!/usr/bin/env python3
"""Keep mihomo's selected proxy usable for enterprise WeCom IMAP."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import logging
import socket
import ssl
import subprocess
import sys
import time
from typing import Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


GROUP_TYPES = {"Selector", "URLTest", "Fallback", "LoadBalance", "Relay"}
BAD_TYPES = {"Reject"}


@dataclass(frozen=True)
class KeeperResult:
    status: str
    selected: str | None = None
    reason: str | None = None


class MihomoController:
    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def current_proxy(self, group: str) -> str:
        payload = self._json("GET", f"/proxies/{quote(group, safe='')}")
        current = payload.get("now")
        if not isinstance(current, str) or not current:
            raise RuntimeError(f"mihomo group {group!r} has no current proxy")
        return current

    def candidates(self, group: str) -> list[str]:
        payload = self._json("GET", f"/proxies/{quote(group, safe='')}")
        candidates = payload.get("all")
        if not isinstance(candidates, list):
            raise RuntimeError(f"mihomo group {group!r} has no candidate list")
        return [item for item in candidates if isinstance(item, str) and item]

    def proxy_type(self, name: str) -> str:
        try:
            payload = self._json("GET", f"/proxies/{quote(name, safe='')}")
        except RuntimeError:
            return ""
        proxy_type = payload.get("type")
        return proxy_type if isinstance(proxy_type, str) else ""

    def select_proxy(self, group: str, name: str) -> None:
        self._json("PUT", f"/proxies/{quote(group, safe='')}", {"name": name})

    def _json(self, method: str, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"} if body is not None else {}
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except (HTTPError, URLError, TimeoutError) as error:
            raise RuntimeError(f"mihomo controller request failed: {method} {path}: {error}") from error
        if not raw:
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise RuntimeError(f"mihomo controller returned invalid JSON for {method} {path}") from error
        if not isinstance(parsed, dict):
            raise RuntimeError(f"mihomo controller returned non-object JSON for {method} {path}")
        return parsed


class NodeKeeper:
    def __init__(
        self,
        controller: object,
        check_imap: Callable[[], bool],
        group: str = "GLOBAL",
        max_candidates: int = 0,
        settle_seconds: float = 0.5,
        logger: logging.Logger | None = None,
    ) -> None:
        self.controller = controller
        self.check_imap = check_imap
        self.group = group
        self.max_candidates = max_candidates
        self.settle_seconds = settle_seconds
        self.logger = logger or logging.getLogger("mihomo-imap-node-keeper")

    def run(self) -> KeeperResult:
        original = self.controller.current_proxy(self.group)
        self.logger.info("current %s node is %s", self.group, original)
        if self.check_imap():
            self.logger.info("current node passed IMAP check; no switch needed")
            return KeeperResult(status="healthy", selected=original)

        self.logger.warning("current node failed IMAP check; searching candidates")
        tested = 0
        for candidate in self._candidate_names(original):
            tested += 1
            self.logger.info("testing candidate %s", candidate)
            self.controller.select_proxy(self.group, candidate)
            if self.settle_seconds > 0:
                time.sleep(self.settle_seconds)
            if self.check_imap():
                self.logger.info("selected %s after successful IMAP check", candidate)
                return KeeperResult(status="switched", selected=candidate)
            self.logger.warning("candidate %s failed IMAP check", candidate)

        self.logger.error("no candidate passed IMAP check after %s attempts; restoring %s", tested, original)
        if self.controller.current_proxy(self.group) != original:
            self.controller.select_proxy(self.group, original)
        return KeeperResult(status="failed", selected=original, reason="no candidate passed IMAP check")

    def _candidate_names(self, original: str) -> Iterable[str]:
        yielded = 0
        for name in self.controller.candidates(self.group):
            if name == original:
                continue
            proxy_type = self.controller.proxy_type(name)
            if proxy_type in BAD_TYPES or proxy_type in GROUP_TYPES:
                self.logger.info("skipping %s because type is %s", name, proxy_type)
                continue
            yield name
            yielded += 1
            if self.max_candidates > 0 and yielded >= self.max_candidates:
                break


def imap_via_socks5_is_healthy(
    socks_host: str,
    socks_port: int,
    target_host: str,
    target_port: int,
    timeout: float,
    logger: logging.Logger,
) -> bool:
    return curl_imaps_is_healthy(socks_host, socks_port, target_host, target_port, timeout, logger)


def curl_imaps_is_healthy(
    socks_host: str,
    socks_port: int,
    target_host: str,
    target_port: int,
    timeout: float,
    logger: logging.Logger,
) -> bool:
    command = [
        "curl",
        "-sS",
        "-v",
        "--max-time",
        str(timeout),
        "--proxy",
        f"socks5h://{socks_host}:{socks_port}",
        f"imaps://{target_host}:{target_port}/",
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout + 2,
        )
    except FileNotFoundError:
        logger.warning("IMAP check failed: curl is not installed")
        return False
    except subprocess.TimeoutExpired:
        logger.warning("IMAP check failed: curl timed out after %.1fs", timeout + 2)
        return False

    output = completed.stdout + completed.stderr
    if is_imap_curl_output_healthy(completed.returncode, output):
        return True
    logger.warning("IMAP check failed: curl exit %s; %s", completed.returncode, summarize_curl_output(output))
    return False


def is_imap_curl_output_healthy(return_code: int, output: str) -> bool:
    upper = output.upper()
    fatal_markers = (
        "SSL_ERROR",
        "UNEXPECTED_EOF",
        "TIMED OUT",
        "COULD NOT CONNECT",
        "CONNECTION REFUSED",
    )
    healthy_markers = (
        "CAPABILITY",
        "IMAP4SERVER READY",
        "IMAP4REV1",
    )
    if any(marker in upper for marker in fatal_markers):
        return False
    return return_code in {0, 21} and any(marker in upper for marker in healthy_markers)


def summarize_curl_output(output: str) -> str:
    for line in reversed(output.splitlines()):
        stripped = line.strip()
        if stripped:
            return stripped[:240]
    return "no curl output"


def python_socks_imap_is_healthy(
    socks_host: str,
    socks_port: int,
    target_host: str,
    target_port: int,
    timeout: float,
    logger: logging.Logger,
) -> bool:
    sock: socket.socket | None = None
    tls_sock: ssl.SSLSocket | None = None
    try:
        sock = _socks5_connect(socks_host, socks_port, target_host, target_port, timeout)
        context = ssl.create_default_context()
        tls_sock = context.wrap_socket(sock, server_hostname=target_host)
        sock = None
        tls_sock.settimeout(timeout)
        banner = _read_some(tls_sock)
        if b"IMAP" not in banner and b"OK" not in banner:
            tls_sock.sendall(b"A001 CAPABILITY\r\n")
            banner += _read_some(tls_sock)
        healthy = b"IMAP" in banner or b"CAPABILITY" in banner or b"OK" in banner
        if not healthy:
            logger.warning("IMAP TLS succeeded but response was not recognized: %r", banner[:120])
        return healthy
    except Exception as error:
        logger.warning("IMAP check failed: %s", error)
        return False
    finally:
        if tls_sock is not None:
            tls_sock.close()
        if sock is not None:
            sock.close()


def _socks5_connect(
    socks_host: str,
    socks_port: int,
    target_host: str,
    target_port: int,
    timeout: float,
) -> socket.socket:
    sock = socket.create_connection((socks_host, socks_port), timeout=timeout)
    sock.settimeout(timeout)
    sock.sendall(b"\x05\x01\x00")
    if _recv_exact(sock, 2) != b"\x05\x00":
        raise RuntimeError("SOCKS5 proxy does not allow no-auth connections")

    host_bytes = target_host.encode("idna")
    if len(host_bytes) > 255:
        raise RuntimeError("target host is too long for SOCKS5 domain request")
    request = b"\x05\x01\x00\x03" + bytes([len(host_bytes)]) + host_bytes + target_port.to_bytes(2, "big")
    sock.sendall(request)
    header = _recv_exact(sock, 4)
    if len(header) != 4 or header[0] != 5:
        raise RuntimeError("invalid SOCKS5 connect response")
    if header[1] != 0:
        raise RuntimeError(f"SOCKS5 connect failed with reply code {header[1]}")
    atyp = header[3]
    if atyp == 1:
        _recv_exact(sock, 4)
    elif atyp == 3:
        length = _recv_exact(sock, 1)[0]
        _recv_exact(sock, length)
    elif atyp == 4:
        _recv_exact(sock, 16)
    else:
        raise RuntimeError(f"invalid SOCKS5 address type {atyp}")
    _recv_exact(sock, 2)
    return sock


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("socket closed unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_some(sock: ssl.SSLSocket) -> bytes:
    chunks: list[bytes] = []
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        try:
            chunk = sock.recv(4096)
        except socket.timeout:
            break
        if not chunk:
            break
        chunks.append(chunk)
        if b"\r\n" in chunk or b"\n" in chunk:
            break
    return b"".join(chunks)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Keep mihomo GLOBAL node healthy for WeCom IMAP.")
    parser.add_argument("--controller", default="http://127.0.0.1:9090")
    parser.add_argument("--group", default="GLOBAL")
    parser.add_argument("--socks-host", default="127.0.0.1")
    parser.add_argument("--socks-port", type=int, default=7891)
    parser.add_argument("--target-host", default="imap.exmail.qq.com")
    parser.add_argument("--target-port", type=int, default=993)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--max-candidates", type=int, default=0, help="0 means test every eligible candidate.")
    parser.add_argument("--settle-seconds", type=float, default=0.5)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logger = logging.getLogger("mihomo-imap-node-keeper")
    controller = MihomoController(args.controller, timeout=args.timeout)
    checker = lambda: imap_via_socks5_is_healthy(
        args.socks_host,
        args.socks_port,
        args.target_host,
        args.target_port,
        args.timeout,
        logger,
    )
    result = NodeKeeper(
        controller,
        checker,
        group=args.group,
        max_candidates=args.max_candidates,
        settle_seconds=args.settle_seconds,
        logger=logger,
    ).run()
    return 0 if result.status in {"healthy", "switched"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
