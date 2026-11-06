"""toll-sdk (import toll_sdk): client for Toll's remote MCP server (https://t0ll.xyz/mcp).

Information only, not financial advice.
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

__all__ = [
    "resolve_client_id",
    "FUNDAMENTALS_PERIODS",
    "RH_ONLY",
    "STOCK_EVENT_KINDS",
    "TOOL_NAMES",
    "CHECK_COINS_MAX",
    "PaymentRequirements",
    "SignPayment",
    "Toll",
    "TollError",
    "TollResult",
    "is_valid_address",
    "is_valid_stock_id",
    "is_valid_wallet",
    "parse_paid_url",
    "parse_pending",
    "read_requirements",
]

_EVM = re.compile(r"0x[0-9a-fA-F]{40}")
# A ticker as Robinhood lists it (NVDA, BRK.B, $NVDA) or a Stock Token contract (0x + 40 hex). Same rule as the API.
_STOCK_ID = re.compile(r"(0x[0-9a-fA-F]{40}|\$?[A-Za-z][A-Za-z0-9.\-]{0,11})")

RH_ONLY = "Toll reads Robinhood Chain only right now."
"""What Toll answers for any chain but Robinhood Chain (chain id 4663)."""

TOOL_NAMES = (
    "check_coin",
    "pre_buy_check",
    "check_coins",
    "larp_check",
    "dev_record",
    "wallet_privacy",
    "fresh_launches",
    "chain_pulse",
    "launch_record",
    "check_agent",
    "check_hook",
    "check_tx",
    "presign_risk_report",
    "stock_token",
    "stock_tokens",
    "fundamentals",
    "insider_trades",
    "institutions",
    "guidance",
    "macro",
    "stock_events",
    "watch_coin",
    "my_watches",
    "unwatch_coin",
)
"""Every tool of https://t0ll.xyz/mcp, in the server's order."""

CHECK_COINS_MAX = 20
"""check_coins takes 1 to 20 addresses."""

FUNDAMENTALS_PERIODS = ("ttm", "annual", "quarterly")
STOCK_EVENT_KINDS = (
    "listed",
    "delisted",
    "multiplier_scheduled",
    "multiplier_applied",
    "corporate_action",
    "feed_stale",
    "feed_paused",
    "feed_resumed",
    "filing",
)
# Only the upsell line counts: a finished LARP answer also lists Toll's own x402 endpoint as a "working part".
_PAID_URL = re.compile(r"paid (?:LARP )?check of this coin \(x402\):\s*(https://t0ll\.xyz/api/x402/[^\s)\"'<>]+)", re.I)
_AGAIN = re.compile(r"again in (?:about )?(\d+)\s*(?:s\b|sec)", re.I)
_PAID_PREFIX = "https://t0ll.xyz/api/x402/"
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{22,64}$")
_PROCESS_ID: Optional[str] = None


def _random_id() -> str:
    return base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")


def resolve_client_id(explicit: Optional[str] = None, home: Optional[str] = None) -> str:
    """The stable install id sent as x-toll-client so Toll can count returning agents (no wallet, no personal data):
    `explicit` when it matches [A-Za-z0-9_-]{22,64}, else the one kept in ~/.toll/client-id (created once), else a
    random id for this process. Never raises."""
    global _PROCESS_ID
    given = (explicit or "").strip() if isinstance(explicit, str) else ""
    if _CLIENT_ID_RE.match(given):
        return given
    try:
        base = home if home is not None else os.path.expanduser("~")
        folder = os.path.join(base, ".toll")
        path = os.path.join(folder, "client-id")
        try:
            with open(path, "r", encoding="utf-8") as fh:
                have = fh.read().strip()
            if _CLIENT_ID_RE.match(have):
                return have
        except OSError:
            pass
        fresh = _random_id()
        os.makedirs(folder, exist_ok=True)
        line = fresh + "\n"
        def read_valid() -> Optional[str]:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    have = fh.read().strip()
                return have if _CLIENT_ID_RE.match(have) else None
            except OSError:
                return None

        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            # the file exists: its writer may not have finished (retry the read briefly), else it holds junk
            for _ in range(3):
                have = read_valid()
                if have:
                    return have
                time.sleep(0.02)
            # junk or empty: replace it atomically, then trust whatever valid id is on disk
            tmp = f"{path}.{_random_id()}.tmp"
            try:
                with open(tmp, "w", encoding="utf-8") as fh:
                    fh.write(line)
                os.replace(tmp, path)
            except OSError:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            return read_valid() or fresh
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(line)
        return read_valid() or fresh

    except Exception:
        pass
    if _PROCESS_ID is None:
        _PROCESS_ID = _random_id()
    return _PROCESS_ID


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
    decision: Optional[str] = None  # pre_buy_check only: BLOCK / WARN / ALLOW / WAIT (None when the answer has none)


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
    """Token address on Robinhood Chain: 0x + 40 hex."""
    return isinstance(value, str) and bool(_EVM.fullmatch(value))


def is_valid_stock_id(value: object) -> bool:
    """Stock Token id: a ticker (NVDA, BRK.B, $NVDA) or its contract (0x + 40 hex)."""
    return isinstance(value, str) and bool(_STOCK_ID.fullmatch(value.strip()))


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
        raise TollError(f"Invalid {what}: expected 0x + 40 hex characters (a Robinhood Chain address). {RH_ONLY}")


def _check_wallet(value: object) -> None:
    if not is_valid_wallet(value):
        raise TollError("Invalid wallet: expected 0x + 40 hex characters.")


def _check_chain(chain: Optional[str]) -> None:
    if chain is not None and chain != "rh":
        raise TollError(f'Invalid chain "{chain}": {RH_ONLY} Use rh or leave chain out.')


def _stock_id(value: object) -> str:
    if not is_valid_stock_id(value):
        raise TollError("Invalid id: expected a ticker (NVDA, BRK.B) or a Stock Token contract (0x + 40 hex).")
    assert isinstance(value, str)
    v = value.strip()
    return v[1:] if v.startswith("$") else v


def _check_limit(limit: Optional[int], top: int) -> None:
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= top):
        raise TollError(f"Invalid limit: use a whole number from 1 to {top}.")


def _opt(**kw: Any) -> Dict[str, Any]:
    return {k: v for k, v in kw.items() if v is not None}


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
        toll_key: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> None:
        """toll_key: a Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every MCP call: carries the key
        wallet's daily tier (more new coins and Markets calls a day, the live stock_events feed).
        client_id: a stable install id sent as x-toll-client so Toll can count returning agents (22-64 chars of
        A-Z a-z 0-9 _ -; anything else is ignored). Default: a random id kept in ~/.toll/client-id, else per process."""
        self.base_url = base_url.rstrip("/")
        self._opener = opener or urllib.request.build_opener()
        self.timeout = timeout
        self.pay_timeout = pay_timeout
        self._sign = sign
        self._sleep = sleep
        self._next_id = 1
        self._toll_key = (toll_key or "").strip() or None
        self._client_id = resolve_client_id(client_id)

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
            headers={
                "content-type": "application/json",
                "accept": "application/json, text/event-stream",
                **({"x-toll-pass": self._toll_key} if self._toll_key else {}),
                "x-toll-client": self._client_id,
            },
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
        _check_chain(chain)
        return self.call("check_coin", {"address": address, **({"chain": chain} if chain else {})})

    def pre_buy_check(self, address: str) -> TollResult:
        """One call before a buy: decision BLOCK / WARN / ALLOW / WAIT with up to 3 reasons (the same calibrated
        rules as check_tx). On WAIT, pending says when to ask again. ALLOW is never a promise."""
        _check_address(address)
        r = self.call("pre_buy_check", {"address": address})
        m = re.search(r"^Decision: (BLOCK|WARN|ALLOW|WAIT)$", r.text, re.M)
        decision = m.group(1) if m else None
        pending = (r.pending or parse_pending(r.text)) if decision == "WAIT" else r.pending
        return TollResult(text=r.text, paid_url=r.paid_url, pending=pending, decision=decision)

    def check_coins(self, addresses: List[str]) -> TollResult:
        """Up to 20 coins from the checks Toll already holds: a verdict word each, or "not read yet". Free, reads nothing new."""
        if not isinstance(addresses, (list, tuple)) or not 1 <= len(addresses) <= CHECK_COINS_MAX:
            raise TollError(f"check_coins takes 1 to {CHECK_COINS_MAX} addresses.")
        return self.call("check_coins", {"addresses": [str(a) for a in addresses]})

    def _need_key(self, what: str) -> None:
        if not self._toll_key:
            raise TollError(f"{what} needs a Toll key: Toll(toll_key=...) with a key from https://t0ll.xyz/toll#keys.")

    @staticmethod
    def _watch_data(r: TollResult) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(r.text.split("\n\nDocs:")[0])
        except ValueError:
            return None

    def watch_coin(self, address: str, url: str) -> Dict[str, Any]:
        """Watch a coin: Toll POSTs a signed JSON event to url (public https) when its verdict word changes or a new
        finding against appears. Returns the JSON answer; "secret" (first time only) signs every event
        (x-toll-signature = sha256=<hex HMAC-SHA256(secret, raw body)>). Needs a Toll key."""
        _check_address(address)
        self._need_key("watch_coin")
        return self._watch_data(self.call("watch_coin", {"address": address, "url": str(url)})) or {}

    def my_watches(self) -> Dict[str, Any]:
        """The coins this Toll key's wallet watches (never the secret)."""
        self._need_key("my_watches")
        return self._watch_data(self.call("my_watches", {})) or {}

    def unwatch_coin(self, watch_id: str) -> Dict[str, Any]:
        """Remove one watch by its id (from my_watches)."""
        self._need_key("unwatch_coin")
        return self._watch_data(self.call("unwatch_coin", {"id": str(watch_id)})) or {}

    def larp_check(self, token: str, chain: Optional[str] = None, wait: bool = False) -> TollResult:
        """LARP check.

        wait=True asks again while part of the answer is still being read, or while Toll answers that it is
        busy with many new LARP checks (a TollError with retry_after_s): max 3 tries, max 120 s waiting.
        """
        _check_address(token, "token")
        _check_chain(chain)
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
        _check_chain(chain)
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

    def check_agent(self, agent_id: Any) -> TollResult:
        """One ERC-8004 agent registered on Robinhood Chain, by its agent id (for example 20030)."""
        ok = (isinstance(agent_id, int) and not isinstance(agent_id, bool) and 0 <= agent_id <= 1_000_000_000) or (
            isinstance(agent_id, str) and re.fullmatch(r"[0-9]{1,10}", agent_id) is not None
        )
        if not ok:
            raise TollError("Invalid agent id: expected a whole number (its ERC-8004 token id on Robinhood Chain).")
        return self.call("check_agent", {"id": agent_id})

    def check_hook(self, address: str) -> TollResult:
        """One Uniswap v4 hook on Robinhood Chain, by its contract address: its name, what its address lets it do,
        whether its owner can change its code, how many pools use it, and whether sells through it fail. A $TOLL
        holder's key (api_key) adds the measured cut and how its latest coins ended."""
        _check_address(address, "hook address")
        return self.call("check_hook", {"address": address})

    def check_tx(
        self,
        to: Optional[str] = None,
        data: Optional[str] = None,
        value: Any = None,
        from_: Optional[str] = None,
        typed_data: Optional[Dict[str, Any]] = None,
        x402: Optional[Dict[str, Any]] = None,
        agent_id: Any = None,
        registry: Optional[str] = None,
        strict: Optional[bool] = None,
        chain_id: Any = None,
    ) -> TollResult:
        """Pre-sign check on Robinhood Chain: ALLOW / WARN / BLOCK with the reasons (an ERC-8265 RiskAssessment).

        Pass a transaction (to, data, value, from_), an EIP-712 signature request (typed_data) or an x402 payment
        (x402: the PaymentRequired from the 402, or one accepts entry; agent_id optional).
        """
        if to is None and typed_data is None and x402 is None:
            raise TollError("check_tx needs a transaction (to, data, value, from_), typed_data or x402.")
        if chain_id is not None and str(chain_id).lower() not in ("4663", "0x1237"):
            raise TollError(f'Invalid chain_id "{chain_id}": {RH_ONLY} (chain id 4663)')
        args = _opt(
            chainId=chain_id,
            to=to,
            data=data,
            value=value,
            typedData=typed_data,
            x402=x402,
            agentId=agent_id,
            registry=registry,
            strict=strict,
        )
        if from_ is not None:
            args["from"] = from_
        return self.call("check_tx", args)

    def presign_risk_report(
        self,
        subject: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        kinds: Optional[List[str]] = None,
        version: str = "erc-presign/1",
    ) -> TollResult:
        """Agent Pre-Sign Risk Report (ERC draft, PR #2134): typed facts about an unsigned request, EIP-712 signed by
        Toll. No verdict. subject: {type: "calls", chainId: "eip155:4663", from: "eip155:4663:0x...", calls: [...]}."""
        if version != "erc-presign/1" or not isinstance(subject, dict):
            raise TollError('presign_risk_report needs version "erc-presign/1" and a subject object.')
        return self.call("presign_risk_report", _opt(version=version, subject=subject, context=context, kinds=kinds))

    def stock_token(self, stock_id: str) -> TollResult:
        """One Robinhood Stock Token by ticker (NVDA) or contract."""
        return self.call("stock_token", {"id": _stock_id(stock_id)})

    def stock_tokens(self, query: Optional[str] = None, limit: Optional[int] = None) -> TollResult:
        """The Stock Tokens Robinhood lists on Robinhood Chain; query filters by ticker or company."""
        _check_limit(limit, 250)
        q = query.strip()[:60] if isinstance(query, str) else ""
        return self.call("stock_tokens", _opt(query=q or None, limit=limit))

    def fundamentals(self, stock_id: str, period: Optional[str] = None) -> TollResult:
        """A Stock Token company's numbers from SEC filings (period: ttm, annual or quarterly)."""
        sid = _stock_id(stock_id)
        if period is not None and period not in FUNDAMENTALS_PERIODS:
            raise TollError("Invalid period: use ttm, annual or quarterly.")
        return self.call("fundamentals", _opt(id=sid, period=period))

    def insider_trades(self, stock_id: str, limit: Optional[int] = None) -> TollResult:
        """Form 4 insider trades of the last 90 days and Schedule 13D/G filings (limit: 1 to 100 rows)."""
        sid = _stock_id(stock_id)
        _check_limit(limit, 100)
        return self.call("insider_trades", _opt(id=sid, limit=limit))

    def institutions(self, stock_id: str, limit: Optional[int] = None) -> TollResult:
        """13F institutional holders for the latest quarter (limit: 1 to 20 holders)."""
        sid = _stock_id(stock_id)
        _check_limit(limit, 20)
        return self.call("institutions", _opt(id=sid, limit=limit))

    def guidance(self, stock_id: str, limit: Optional[int] = None) -> TollResult:
        """Guidance, KPIs and non-GAAP from the last 4 earnings releases, AI-extracted from cited filings."""
        sid = _stock_id(stock_id)
        _check_limit(limit, 60)
        return self.call("guidance", _opt(id=sid, limit=limit))

    def macro(self) -> TollResult:
        """US macro: the Treasury curve, the EFFR, CPI, unemployment and payrolls, each with its date."""
        return self.call("macro", {})

    def stock_events(self, since: Optional[int] = None, kind: Optional[str] = None, limit: Optional[int] = None) -> TollResult:
        """What changed on Robinhood's Stock Tokens, oldest first; since = the last answer's next.

        Without a Toll key: the last 10 events found an hour ago or more; Team holders read it live, Pro 15 minutes late.
        """
        if since is not None and (isinstance(since, bool) or not isinstance(since, int) or since < 0):
            raise TollError("Invalid since: use the next of the last answer (a whole number).")
        if kind is not None and kind not in STOCK_EVENT_KINDS:
            raise TollError(f"Invalid kind: use {', '.join(STOCK_EVENT_KINDS)}.")
        _check_limit(limit, 100)
        return self.call("stock_events", _opt(since=since, kind=kind, limit=limit))

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
