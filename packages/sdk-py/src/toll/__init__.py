"""toll-sdk: client for Toll's remote MCP server (https://t0ll.xyz/mcp).

Information only, not financial advice.
"""
from __future__ import annotations

import base64
import json
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

__all__ = [
    "PaymentRequirements",
    "SignPayment",
    "Toll",
    "TollError",
    "TollResult",
    "is_valid_address",
    "is_valid_wallet",
    "parse_paid_url",
    "parse_pending",
    "read_requirements",
]

_EVM = re.compile(r"0x[0-9a-fA-F]{40}")
_BASE58 = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
# Only the upsell line counts: a finished LARP answer also lists Toll's own x402 endpoint as a "working part".
_PAID_URL = re.compile(r"paid (?:LARP )?check of this coin \(x402\):\s*(https://t0ll\.xyz/api/x402/[^\s)\"'<>]+)", re.I)
_AGAIN = re.compile(r"again in (?:about )?(\d+)\s*(?:s\b|sec)", re.I)
_PAID_PREFIX = "https://t0ll.xyz/api/x402/"
_TIMEOUTS = (TimeoutError, socket.timeout)
_SETTLE_NOTE = (
    " The payment may have settled: do not retry this call with a new signature;"
    " resend the same payment header to get the answer."
)


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
    pending: Optional[Dict[str, int]]  # {"retry_after_s": n}: part of the answer is still being read, ask again then


@dataclass
class PaymentRequirements:
    """What a paid URL asks for, read from its 402 answer."""

    x402_version: int
    """2 when the 402 carried a PAYMENT-REQUIRED header (sent back as PAYMENT-SIGNATURE), else 1 (X-PAYMENT)."""
    payment_required: Dict[str, Any]
    """The decoded 402 object: base64 JSON of the PAYMENT-REQUIRED header (v2) or the JSON body (v1)."""
    accepts: List[Dict[str, Any]]
    """payment_required["accepts"]: scheme, network, asset, amount (v2) or maxAmountRequired (v1), payTo, ..."""


SignPayment = Callable[[PaymentRequirements, str], str]
"""sign(requirements, url) -> the payment header value. pay() calls it at most once per call."""


def _clamp_seconds(value: Any, fallback: int) -> int:
    """Seconds to wait, never below 1 (a 0 or junk value must not become a tight loop)."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return fallback
    if n != n or n in (float("inf"), float("-inf")):
        return fallback
    return max(1, int(-(-n // 1)))


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
    return {"retry_after_s": _clamp_seconds(m.group(1), 5)} if m else None


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
        sign: Optional[SignPayment] = None,
        pay_timeout: float = 300.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._opener = opener or urllib.request.build_opener()
        self.timeout = timeout
        self.pay_timeout = pay_timeout
        self._sign = sign
        self._sleep = sleep
        self._next_id = 1

    # -- transport ---------------------------------------------------------
    def _http(self, req: urllib.request.Request, timeout: float, note: str = "") -> tuple:
        """One request, body read inside the timeout. Returns (status, headers, text); HTTP errors are returned too."""
        try:
            with self._opener.open(req, timeout=timeout) as res:
                raw = res.read().decode("utf-8", "replace")
                return int(getattr(res, "status", 200) or 200), getattr(res, "headers", None) or {}, raw
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8", "replace") if hasattr(e, "read") else ""
            except Exception:
                raw = ""
            return int(e.code), e.headers or {}, raw
        except _TIMEOUTS:
            raise TollError(f"Request to {req.full_url} timed out after {timeout:g} s.{note}") from None
        except urllib.error.URLError as e:
            if isinstance(e.reason, _TIMEOUTS):
                raise TollError(f"Request to {req.full_url} timed out after {timeout:g} s.{note}") from None
            raise TollError(f"Request to {req.full_url} failed: {e}.{note}") from None
        except OSError as e:
            raise TollError(f"Request to {req.full_url} failed: {e}.{note}") from None

    def _rpc(self, method: str, params: Dict[str, Any]) -> Any:
        payload = json.dumps({"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}).encode()
        self._next_id += 1
        req = urllib.request.Request(
            f"{self.base_url}/mcp",
            data=payload,
            method="POST",
            headers={"content-type": "application/json", "accept": "application/json, text/event-stream"},
        )
        status, _headers, raw = self._http(req, self.timeout)
        if not 200 <= status < 300:
            raise TollError(f"Toll answered HTTP {status}" + (f": {raw[:200]}" if raw else ""), status=status)
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
        """LARP check.

        wait=True asks again while part of the answer is still being read, or while Toll answers that it is
        busy with many new LARP checks (a TollError with retry_after_s): max 3 tries, max 120 s waiting.
        """
        _check_address(token, "token")
        _check_chain(chain, ("rh", "sol"))
        args = {"token": token, **({"chain": chain} if chain else {})}
        if not wait:
            return self.call("larp_check", args)
        waited = 0
        tries = 0
        while True:
            tries += 1
            res: Optional[TollResult] = None
            busy: Optional[TollError] = None
            try:
                res = self.call("larp_check", args)
            except TollError as e:
                if e.retry_after_s is None:
                    raise
                busy = e
            if res is not None:
                if not res.pending:
                    return res
                s = res.pending["retry_after_s"]
            else:
                assert busy is not None and busy.retry_after_s is not None
                s = busy.retry_after_s
            if tries >= 3 or waited + s > 120:
                if busy is not None:
                    raise busy
                assert res is not None
                return res
            self._sleep(s)
            waited += s

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
    def pay(self, paid_url: str, sign: Optional[SignPayment] = None, timeout: Optional[float] = None) -> Any:
        """Pay a paid x402 URL (the paid_url of a result) and return its JSON.

        1. GET without payment: 402 with the requirements (v2 PAYMENT-REQUIRED header, else the v1 body).
        2. Call sign(requirements, url) ONCE for the payment header value.
        3. GET with it (v2: PAYMENT-SIGNATURE, v1: X-PAYMENT). On 402 {"pending": true} resend EXACTLY the
           same header after Retry-After (at least 1 s), max 5 tries and 300 s of waiting. 200 JSON is the
           answer; any other 402 after paying raises TollError "payment not accepted". It never signs twice.
        The whole call is bounded by `timeout` (default pay_timeout, 300 s).
        """
        if not isinstance(paid_url, str) or not paid_url.startswith(_PAID_PREFIX):
            raise TollError("pay() only takes https://t0ll.xyz/api/x402/... URLs.")
        signer = sign or self._sign
        if signer is None:
            raise TollError("pay() needs a sign function: Toll(sign=...) or pay(url, sign=...). See the README (paying).")
        total = self.pay_timeout if timeout is None else timeout
        deadline = time.monotonic() + total

        def left() -> float:
            return max(0.001, deadline - time.monotonic())

        def get(headers: Dict[str, str], note: str = "") -> tuple:
            req = urllib.request.Request(paid_url, method="GET", headers={"accept": "application/json", **headers})
            return self._http(req, left(), note)

        # 1. Unpaid GET: read what to pay.
        status, headers, raw = get({})
        if 200 <= status < 300:
            return _json_answer(raw, status)
        if status != 402:
            raise _http_error(status, raw)
        requirements = read_requirements(headers, raw)

        # 2. One signature for this call.
        try:
            header = signer(requirements, paid_url)
        except Exception as e:
            raise TollError(f"sign() failed, nothing was sent: {e}") from None
        if not isinstance(header, str) or not header.strip() or "\r" in header or "\n" in header:
            raise TollError("sign() must return the payment header value as one non-empty line; nothing was sent.")
        name = "PAYMENT-SIGNATURE" if requirements.x402_version == 2 else "X-PAYMENT"

        # 3. Paid GET, resending the same header while the answer is pending.
        waited = 0
        tries = 0
        while True:
            tries += 1
            if time.monotonic() >= deadline:
                raise TollError(f"pay() timed out after {total:g} s.{_SETTLE_NOTE}")
            status, headers, raw = get({name: header}, _SETTLE_NOTE)
            data = _try_json(raw)
            if status == 402 and isinstance(data, dict) and data.get("pending") is True:
                s = _clamp_seconds(_header(headers, "retry-after"), 5)
                if tries >= 5 or waited + s > 300 or time.monotonic() + s > deadline:
                    raise TollError(
                        f"The paid answer is still being read after {tries} tries (nothing is charged while it is pending)."
                        " Resend the same payment header later; do not sign a new one for this call.",
                        status=402,
                        retry_after_s=s,
                    )
                self._sleep(s)
                waited += s
                continue
            if status == 402:
                why = f" ({data['error']})" if isinstance(data, dict) and isinstance(data.get("error"), str) else ""
                raise TollError(f"payment not accepted: Toll answered 402 to the signed payment{why}. pay() does not sign again.", status=402)
            if not 200 <= status < 300:
                raise _http_error(status, raw, _SETTLE_NOTE)
            return _json_answer(raw, status)


def read_requirements(headers: Any, raw: str) -> PaymentRequirements:
    """Read a 402: v2 from the PAYMENT-REQUIRED header when it decodes, else v1 from the JSON body."""
    h = _header(headers, "payment-required")
    if h:
        try:
            pr = json.loads(base64.b64decode(h.strip()).decode("utf-8"))
            if isinstance(pr, dict) and isinstance(pr.get("accepts"), list) and pr["accepts"]:
                return PaymentRequirements(x402_version=2, payment_required=pr, accepts=pr["accepts"])
        except (ValueError, UnicodeDecodeError):
            pass
    body = _try_json(raw)
    if isinstance(body, dict) and isinstance(body.get("accepts"), list) and body["accepts"]:
        return PaymentRequirements(x402_version=1, payment_required=body, accepts=body["accepts"])
    raise TollError("Toll answered 402 without x402 payment requirements; nothing was signed.", status=402)


def _try_json(raw: str) -> Any:
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _json_answer(raw: str, status: int) -> Any:
    data = _try_json(raw)
    if data is None:
        raise TollError("The paid answer was not JSON.", status=status)
    return data


def _http_error(status: int, raw: str, note: str = "") -> TollError:
    return TollError(f"Toll answered HTTP {status}" + (f": {raw[:200]}" if raw else "") + "." + note, status=status)


def _header(headers: Any, name: str) -> Optional[str]:
    if not headers:
        return None
    get = getattr(headers, "get", None)
    if get is not None and hasattr(headers, "get_all"):  # http.client.HTTPMessage: case-insensitive
        v = get(name)
        return None if v is None else str(v)
    for k in headers:
        if str(k).lower() == name:
            return str(headers[k])
    return None
