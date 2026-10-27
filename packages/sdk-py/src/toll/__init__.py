"""toll-sdk: client for Toll's remote MCP server (https://t0ll.xyz/mcp).

Information only, not financial advice.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

__all__ = [
    "Toll",
    "TollError",
    "TollResult",
    "is_valid_address",
    "is_valid_wallet",
    "parse_paid_url",
    "parse_pending",
]

_EVM = re.compile(r"0x[0-9a-fA-F]{40}")
_BASE58 = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
# Only the upsell line counts: a finished LARP answer also lists Toll's own x402 endpoint as a "working part".
_PAID_URL = re.compile(r"paid (?:LARP )?check of this coin \(x402\):\s*(https://t0ll\.xyz/api/x402/[^\s)\"'<>]+)", re.I)
_AGAIN = re.compile(r"again in (?:about )?(\d+)\s*(?:s\b|sec)", re.I)
_PAID_PREFIX = "https://t0ll.xyz/api/x402/"


class TollError(Exception):
    """Any failure: HTTP, JSON-RPC, timeout, server-side input error, bad input."""

    def __init__(
        self,
        message: str,
        status: Optional[int] = None,
        code: Optional[int] = None,
        retry_after_s: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.retry_after_s = retry_after_s


@dataclass
class TollResult:
    text: str
    paid_url: Optional[str]
    pending: Optional[Dict[str, int]]  # {"retry_after_s": n} when the server is still reading


def is_valid_address(value: object) -> bool:
    """Token address: 0x + 40 hex, or a Solana base58 mint (32-44 chars)."""
    return isinstance(value, str) and bool(_EVM.fullmatch(value) or _BASE58.fullmatch(value))


def is_valid_wallet(value: object) -> bool:
    """Wallet address: 0x + 40 hex."""
    return isinstance(value, str) and bool(_EVM.fullmatch(value))


def parse_paid_url(text: str) -> Optional[str]:
    m = _PAID_URL.search(text)
    return m.group(1).rstrip(".,;:") if m else None


def parse_pending(text: str) -> Optional[Dict[str, int]]:
    m = _AGAIN.search(text)
    return {"retry_after_s": int(m.group(1))} if m else None


def _check_address(value: object, what: str = "address") -> None:
    if not is_valid_address(value):
        raise TollError(f"Invalid {what}: expected 0x + 40 hex characters or a Solana base58 mint (32-44 characters).")


def _check_wallet(value: object) -> None:
    if not is_valid_wallet(value):
        raise TollError("Invalid wallet: expected 0x + 40 hex characters.")


def _check_chain(chain: Optional[str], allowed: tuple) -> None:
    if chain is not None and chain not in allowed:
        raise TollError(f'Invalid chain "{chain}": use {", ".join(allowed)}.')


def _parse_body(raw: str) -> Any:
    t = raw.strip()
    if t.startswith("{"):
        return json.loads(t)
    for line in t.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    raise ValueError("no data")


class Toll:
    """Client. `opener` is a urllib OpenerDirector (or anything with .open(request, timeout=...))."""

    def __init__(
        self,
        base_url: str = "https://t0ll.xyz",
        opener: Any = None,
        timeout: float = 30.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._opener = opener or urllib.request.build_opener()
        self.timeout = timeout
        self._sleep = sleep
        self._next_id = 1

    # -- transport ---------------------------------------------------------
    def _rpc(self, method: str, params: Dict[str, Any]) -> Any:
        payload = json.dumps({"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}).encode()
        self._next_id += 1
        req = urllib.request.Request(
            f"{self.base_url}/mcp",
            data=payload,
            method="POST",
            headers={"content-type": "application/json", "accept": "application/json, text/event-stream"},
        )
        try:
            with self._opener.open(req, timeout=self.timeout) as res:
                raw = res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200] if hasattr(e, "read") else ""
            raise TollError(f"Toll answered HTTP {e.code}" + (f": {detail}" if detail else ""), status=e.code) from None
        except TimeoutError:
            raise TollError(f"Request to {req.full_url} timed out after {self.timeout} s.") from None
        except (urllib.error.URLError, OSError) as e:
            raise TollError(f"Request to {req.full_url} failed: {e}") from None
        try:
            body = _parse_body(raw)
        except ValueError:
            raise TollError("Toll sent an answer that is not JSON-RPC.") from None
        if isinstance(body, dict) and body.get("error"):
            err = body["error"]
            raise TollError(f"Toll JSON-RPC error {err.get('code')}: {err.get('message')}", code=err.get("code"))
        return body.get("result") if isinstance(body, dict) else None

    # -- tools -------------------------------------------------------------
    def tools(self) -> List[Dict[str, Any]]:
        r = self._rpc("tools/list", {})
        return (r or {}).get("tools", [])

    def call(self, name: str, args: Optional[Dict[str, Any]] = None) -> TollResult:
        """Call any tool by its server name. isError answers raise TollError."""
        r = self._rpc("tools/call", {"name": name, "arguments": args or {}}) or {}
        content = r.get("content")
        text = "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict) and c.get("type") == "text") if isinstance(content, list) else ""
        if r.get("isError"):
            p = parse_pending(text)
            raise TollError(text.split("\n\n")[0] or "Toll reported an error.", retry_after_s=p["retry_after_s"] if p else None)
        pending = parse_pending(text) if re.search(r"still reading", text, re.I) else None
        return TollResult(text=text, paid_url=parse_paid_url(text), pending=pending)

    def check_coin(self, address: str, chain: Optional[str] = None) -> TollResult:
        _check_address(address)
        _check_chain(chain, ("rh", "sol", "bsc"))
        return self.call("check_coin", {"address": address, **({"chain": chain} if chain else {})})

    def larp_check(self, token: str, chain: Optional[str] = None, wait: bool = False) -> TollResult:
        """LARP check. wait=True re-asks while the server is still reading (max 3 tries, max 120 s waiting)."""
        _check_address(token, "token")
        _check_chain(chain, ("rh", "sol"))
        args = {"token": token, **({"chain": chain} if chain else {})}
        res = self.call("larp_check", args)
        if not wait:
            return res
        waited = 0
        tries = 1
        while tries < 3 and res.pending:
            s = res.pending["retry_after_s"]
            if waited + s > 120:
                break
            self._sleep(s)
            waited += s
            res = self.call("larp_check", args)
            tries += 1
        return res

    def dev_record(self, wallet: str, chain: Optional[str] = None) -> TollResult:
        _check_wallet(wallet)
        _check_chain(chain, ("rh", "bsc"))
        return self.call("dev_record", {"wallet": wallet, **({"chain": chain} if chain else {})})

    def launch_record(self, address: str) -> TollResult:
        _check_wallet(address)
        return self.call("launch_record", {"address": address})

    def wallet_privacy(self, wallet: str) -> TollResult:
        _check_wallet(wallet)
        return self.call("wallet_privacy", {"wallet": wallet})

    def fresh_launches(self, limit: Optional[int] = None) -> TollResult:
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20):
            raise TollError("Invalid limit: use a whole number from 1 to 20.")
        return self.call("fresh_launches", {} if limit is None else {"limit": limit})

    def chain_pulse(self) -> TollResult:
        return self.call("chain_pulse", {})

    # -- paying ------------------------------------------------------------
    def pay(self, paid_url: str, session: Optional[Callable[[str], Any]] = None) -> Any:
        """GET a paid x402 URL with `session`, any callable that does an x402 GET.

        `session(url)` returns (status, headers, body) where headers is a dict-like (case-insensitive
        or lowercase keys) and body is bytes or str; a requests-style object with .status_code,
        .headers and .text also works. On 402 {"pending": true} it resends after Retry-After
        (max 3 tries, max 120 s). Returns the parsed JSON.
        """
        if not isinstance(paid_url, str) or not paid_url.startswith(_PAID_PREFIX):
            raise TollError("pay() only takes https://t0ll.xyz/api/x402/... URLs.")
        if session is None:
            raise TollError("pay() needs a session: pass a callable that does an x402-aware GET (for example one built on x402's Python client).")
        waited = 0
        tries = 0
        while True:
            tries += 1
            status, headers, raw = _unpack(session(paid_url))
            try:
                data = json.loads(raw) if raw else None
            except ValueError:
                data = None
            if status == 402 and isinstance(data, dict) and data.get("pending") is True:
                try:
                    s = int(_header(headers, "retry-after") or 5)
                except ValueError:
                    s = 5
                if tries >= 3 or waited + s > 120:
                    raise TollError("The paid answer is still being read; payment not settled yet. Try again later.", status=402, retry_after_s=s)
                self._sleep(s)
                waited += s
                continue
            if status == 402:
                raise TollError("Payment required: the payment was missing or not accepted.", status=402)
            if not 200 <= status < 300:
                raise TollError(f"Toll answered HTTP {status}" + (f": {raw[:200]}" if raw else ""), status=status)
            if data is None:
                raise TollError("The paid answer was not JSON.", status=status)
            return data


def _header(headers: Any, name: str) -> Optional[str]:
    if not headers:
        return None
    for k in headers:
        if str(k).lower() == name:
            return str(headers[k])
    return None


def _unpack(res: Any) -> tuple:
    if isinstance(res, tuple) and len(res) == 3:
        status, headers, body = res
    else:
        status, headers, body = res.status_code, res.headers, res.text
    if isinstance(body, (bytes, bytearray)):
        body = bytes(body).decode("utf-8", "replace")
    return int(status), headers, body or ""
