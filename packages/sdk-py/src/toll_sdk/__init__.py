"""toll-sdk (import toll_sdk): client for Toll's remote MCP server (https://t0ll.xyz/mcp).

Information only, not financial advice.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union
from urllib.parse import quote, urlencode

__all__ = [
    "resolve_client_id",
    "BLOCKLIST_KINDS",
    "COIN_WATCH_EVENTS",
    "WALLET_WATCH_EVENTS",
    "TICKET_SUFFIX_MAGIC",
    "TOLL_ALLOW_SIGNER",
    "TOLL_FACILITATOR",
    "SCREEN_OUTCOMES",
    "screen_of",
    "BUDGET_DOMAIN",
    "BUDGET_MAX_PAYTOS",
    "BUDGET_TYPES",
    "RECEIPT_DOMAIN",
    "RECEIPT_TYPES",
    "REVOKE_TYPES",
    "budget_typed_data",
    "receipt_typed_data",
    "revoke_typed_data",
    "toll_offer_receipt_of",
    "append_ticket_suffix",
    "assessment_of",
    "coin_badge_embed",
    "coin_badge_url",
    "read_webhook",
    "ticket_ask_of",
    "ticket_of_answer",
    "verify_webhook",
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
    "wallet_approvals",
    "fresh_launches",
    "chain_pulse",
    "launch_record",
    "check_agent",
    "find_paid_api",
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
    "watch_wallet",
    "unwatch_wallet",
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
    assessment: Optional[Dict[str, Any]] = None  # check_tx only: the ERC-8265 RiskAssessment the answer ends with
    action: Optional[str] = None  # check_tx only: ALLOW / WARN / BLOCK from the assessment
    ticket: Optional[Dict[str, Any]] = None  # check_tx with ticket=...: x-toll.ticket ({ticket, signature, signer} or {why})


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


def _query(query: Any) -> str:
    """A find-paid-API query: trimmed, at most 200 characters; "" = none."""
    if query is None:
        return ""
    if not isinstance(query, str):
        raise TollError("Invalid query: use a few words of text.")
    q = query.strip()
    if len(q) > 200:
        raise TollError("Invalid query: at most 200 characters.")
    return q


# -- the x402 facilitator (x402.t0ll.xyz) ------------------------------------
TOLL_FACILITATOR = "https://x402.t0ll.xyz"
"""Toll's x402 facilitator: keyless, USDG on Robinhood Chain (also at https://t0ll.xyz/api/facilitator)."""

SCREEN_OUTCOMES = ("allow", "warn", "block", "not-read")
"""toll-screen outcomes: check_tx's word on a payment at /verify and /settle; not-read is never a refusal."""


def screen_of(answer: Any) -> Optional[Dict[str, Any]]:
    """extensions.screen of a facilitator /verify or /settle answer, checked: {"outcome", "codes": [str]}, or None
    when it is absent or malformed."""
    ext = answer.get("extensions") if isinstance(answer, dict) else None
    s = ext.get("screen") if isinstance(ext, dict) else None
    if not isinstance(s, dict) or s.get("outcome") not in SCREEN_OUTCOMES:
        return None
    codes = s.get("codes")
    return {"outcome": s["outcome"], "codes": [c for c in codes if isinstance(c, str)] if isinstance(codes, list) else []}


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
        facilitator_url: Optional[str] = None,
    ) -> None:
        """toll_key: a Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every MCP call: carries the key
        wallet's daily tier (more new coins and Markets calls a day, the live stock_events feed).
        client_id: a stable install id sent as x-toll-client so Toll can count returning agents (22-64 chars of
        A-Z a-z 0-9 _ -; anything else is ignored). Default: a random id kept in ~/.toll/client-id, else per process.
        facilitator_url: the x402 facilitator find_paid_apis() reads. Default: https://x402.t0ll.xyz with the default
        base_url, else {base_url}/api/facilitator."""
        self.base_url = base_url.rstrip("/")
        default_fac = TOLL_FACILITATOR if self.base_url == "https://t0ll.xyz" else f"{self.base_url}/api/facilitator"
        self.facilitator_url = (facilitator_url or default_fac).rstrip("/")
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

    def watch_wallet(self, address: str, url: str) -> Dict[str, Any]:
        """Watch a wallet over MCP: Toll reads it about once a minute and POSTs a signed JSON event to url on a new
        approval, a new EIP-7702 delegation or a token received whose check is against. "secret" comes back the first
        time only. Needs a Toll key; wallet watches have their own cap."""
        _check_wallet(address)
        self._need_key("watch_wallet")
        return self._watch_data(self.call("watch_wallet", {"address": address, "url": str(url)})) or {}

    def unwatch_wallet(self, watch_id: str) -> Dict[str, Any]:
        """Remove one wallet watch by its id (from my_watches' wallet_watches)."""
        self._need_key("unwatch_wallet")
        return self._watch_data(self.call("unwatch_wallet", {"id": str(watch_id)})) or {}

    def wallet_approvals(self, wallet: str) -> TollResult:
        """A wallet's live token approvals on Robinhood Chain as text, over MCP: each with its risk and the revoke call
        checked by check_tx. For the typed JSON use approvals()."""
        _check_wallet(wallet)
        return self.call("wallet_approvals", {"wallet": wallet})

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

    def find_paid_api(self, query: Optional[str] = None, limit: Optional[int] = None) -> TollResult:
        """find_paid_api: paid APIs (x402) an agent can buy on Robinhood Chain, by what it needs ("weather", "stock
        quotes", or nothing for every operator's best endpoint), verified payTo first. Text; find_paid_apis() for JSON."""
        q = _query(query)
        _check_limit(limit, 20)
        return self.call("find_paid_api", _opt(query=q or None, limit=limit))

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
        ticket: Union[bool, Dict[str, Any], None] = None,
        authorization_list: Optional[List[Any]] = None,
        message: Optional[Dict[str, Any]] = None,
        origin: Optional[str] = None,
        rpc: Optional[Dict[str, Any]] = None,
        user_op: Optional[Dict[str, Any]] = None,
        entry_point: Optional[str] = None,
        intent: Optional[Dict[str, Any]] = None,
    ) -> TollResult:
        """Pre-sign check on Robinhood Chain: ALLOW / WARN / BLOCK with the reasons (an ERC-8265 RiskAssessment).

        Pass a transaction (to, data, value, from_), an EIP-712 signature request (typed_data) or an x402 payment
        (x402: the PaymentRequired from the 402, or one accepts entry; agent_id optional).
        0.7.1, everything else the live tool reads: authorization_list (a type-4 EIP-7702 transaction's list, or a
        signAuthorization alone: [{chainId, address, nonce, ...}]), message ({"kind": "personal_sign" | "eth_sign",
        "data": ...}) with origin (the site asking), rpc (the wallet request as sent: {"method", "params"}), user_op
        (an ERC-4337 user operation) with entry_point, and intent (what the agent means to do).
        ticket: True (scope "call", any consumer) or {"consumer": 0x..., "scope": "call" | "v4swap"} asks for a single-use
        ALLOW ticket for this exact call; it comes back in result.ticket ({ticket, signature, signer} or {why}). A BLOCK is
        never signed; no ticket without from_. Same option as @tollxyz/guard 0.4.1.
        The result also carries .assessment (the RiskAssessment JSON) and .action (ALLOW / WARN / BLOCK).
        """
        if (to is None and typed_data is None and x402 is None and not authorization_list
                and not isinstance(message, dict) and not isinstance(rpc, dict) and not isinstance(user_op, dict)):
            raise TollError("check_tx needs a transaction (to, data, value, from_), typed_data, x402, "
                            "authorization_list, message, rpc or user_op.")
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
            authorizationList=authorization_list,
            message=message,
            origin=origin,
            rpc=rpc,
            userOp=user_op,
            entryPoint=entry_point,
            intent=intent,
        )
        if from_ is not None:
            args["from"] = from_
        ask = ticket_ask_of(ticket)
        if ask is not None:
            if "consumer" in ask and not is_valid_address(ask["consumer"]):
                raise TollError("Invalid ticket consumer: expected 0x + 40 hex characters.")
            if "scope" in ask and ask["scope"] not in ("call", "v4swap"):
                raise TollError('Invalid ticket scope: use "call" or "v4swap".')
            args["ticket"] = ask
        r = self.call("check_tx", args)
        r.assessment = assessment_of(r.text)
        a = (r.assessment or {}).get("action")
        r.action = a if a in ("ALLOW", "WARN", "BLOCK") else None
        r.ticket = ticket_of_answer(r.assessment)
        return r

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

    # -- REST (t0ll.xyz/api) ------------------------------------------------
    def _rest(self, method: str, path: str, auth: bool = False, body: Any = None, headers: Optional[Dict[str, str]] = None) -> tuple:
        h = {"accept": "application/json", "x-toll-client": self._client_id}
        if auth and self._toll_key:
            h["authorization"] = f"Bearer {self._toll_key}"
        data = None
        if body is not None:
            h["content-type"] = "application/json"
            data = json.dumps(body).encode()
        h.update(headers or {})
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=h)
        return self._http(req, self.timeout)

    def approvals(self, wallet: str) -> Dict[str, Any]:
        """GET /api/approvals/{wallet}: the wallet's live approvals on Robinhood Chain (ERC-20, NFT approval-for-all,
        Permit2), newest first (at most 200, "more" counts the rest), each with risk, why, spenderFacts and a revoke call
        {to, data, value, does, check} checked by check_tx. {"state": "not read", "reason", "retry_after_s"} (HTTP 503)
        means the logs could not be read this time, never that there are none. Raises TollError on a bad address, a rate
        limit (6 a minute) or when the list is unavailable."""
        _check_wallet(wallet)
        status, headers, raw = self._rest("GET", f"/api/approvals/{wallet.lower()}")
        data = _try_json(raw)
        if 200 <= status < 300 and isinstance(data, dict) and data.get("state") == "ok":
            return data
        if isinstance(data, dict) and data.get("state") == "not read":
            s = _retry_after(headers)
            return {**data, **({"retry_after_s": s} if s is not None else {})}
        raise _rest_error(status, headers, raw)

    def approvals_text(self, wallet: str) -> str:
        """GET /api/approvals/{wallet}?format=text: the same list as plain lines ending with a t0ll.xyz link."""
        _check_wallet(wallet)
        status, headers, raw = self._rest("GET", f"/api/approvals/{wallet.lower()}?format=text", headers={"accept": "text/plain"})
        if 200 <= status < 300 or (status == 503 and raw.startswith("Approvals of ")):
            return raw
        raise _rest_error(status, headers, raw)

    @staticmethod
    def _blocklist_path(fmt: Optional[str], since: Any, kind: Optional[str]) -> str:
        q: Dict[str, str] = {}
        if fmt:
            q["format"] = fmt
        if since is not None:
            q["since"] = _iso(since)
        if kind is not None:
            if kind not in BLOCKLIST_KINDS:
                raise TollError("Invalid kind: use token, contract or wallet.")
            q["kind"] = kind
        return "/api/blocklist" + (f"?{urlencode(q)}" if q else "")

    def blocklist(self, since: Any = None, kind: Optional[str] = None, etag: Optional[str] = None) -> Dict[str, Any]:
        """GET /api/blocklist: Toll's open Robinhood Chain blocklist (free, no key, open license with attribution).
        Returns {"not_modified": False, "etag", "list": {...entries, reasons, changelog...}}, or {"not_modified": True,
        "etag"} when etag (from the last pull) still matches. since (datetime or ISO text): an incremental pull.
        A coin that is not listed is not cleared."""
        path = self._blocklist_path(None, since, kind)
        status, headers, raw = self._rest("GET", path, headers={"if-none-match": etag} if etag else None)
        tag = _header(headers, "etag")
        if status == 304:
            return {"not_modified": True, "etag": tag or etag or ""}
        data = _try_json(raw)
        if not 200 <= status < 300 or not isinstance(data, dict) or not isinstance(data.get("entries"), list):
            raise _rest_error(status, headers, raw)
        return {"not_modified": False, "etag": tag, "list": data}

    def blocklist_file(self, fmt: str, since: Any = None, kind: Optional[str] = None, etag: Optional[str] = None) -> Dict[str, Any]:
        """The blocklist as "csv" (address,kind,reasons,first_seen,last_confirmed,evidence,tx,chain_id) or "txt" (one
        address a line): {"not_modified": False, "etag", "text"} or {"not_modified": True, "etag"}."""
        if fmt not in ("csv", "txt"):
            raise TollError("Invalid format: use csv or txt (blocklist() returns the JSON).")
        path = self._blocklist_path(fmt, since, kind)
        h = {"accept": "text/csv" if fmt == "csv" else "text/plain"}
        if etag:
            h["if-none-match"] = etag
        status, headers, raw = self._rest("GET", path, headers=h)
        tag = _header(headers, "etag")
        if status == 304:
            return {"not_modified": True, "etag": tag or etag or ""}
        if not 200 <= status < 300:
            raise _rest_error(status, headers, raw)
        return {"not_modified": False, "etag": tag, "text": raw}

    def tx_record(self) -> Dict[str, Any]:
        """GET /api/record/tx: the pre-sign record. Every check_tx call that named a coin, scored by how the coin stood
        24 h later (actions: BLOCK / WARN / ALLOW with rugged, dead, alive, not read), the weekly trend, the latest scored
        calls (never a wallet) and the calibration re-run weekly. Same numbers as t0ll.xyz/agents/record."""
        status, headers, raw = self._rest("GET", "/api/record/tx")
        data = _try_json(raw)
        if not 200 <= status < 300 or not isinstance(data, dict) or not isinstance(data.get("actions"), list):
            raise _rest_error(status, headers, raw)
        return data

    def find_paid_apis(
        self,
        query: Optional[str] = None,
        pay_to: Optional[str] = None,
        operator: Optional[str] = None,
        limit: Optional[int] = None,
        type: Optional[str] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        """The facilitator's discovery catalog (x402 bazaar): GET /discovery/search?query= when query is given, else
        GET /discovery/resources. Returns {"x402Version", "items": [...], "pagination", "partialResults"?}; each item
        has resource, accepts, price, payTo, verified (payTo is its ERC-8004 agentWallet, ERC-8478), settledViaToll,
        name, agentId, operator {key, label, entries}. Facts, not a recommendation: verified does not say it delivers."""
        q = _query(query)
        if type is not None and type not in ("http", "mcp"):
            raise TollError('Invalid type: use "http" or "mcp".')
        if pay_to is not None and not is_valid_wallet(pay_to):
            raise TollError("Invalid pay_to: expected 0x + 40 hex characters.")
        if operator is not None and (not isinstance(operator, str) or not re.fullmatch(r"[\x21-\x7e]{1,128}", operator)):
            raise TollError("Invalid operator: use an operator key from a listing (for example agent:8654).")
        _check_limit(limit, 100)
        if offset is not None and (isinstance(offset, bool) or not isinstance(offset, int) or offset < 0):
            raise TollError("Invalid offset: use a whole number from 0.")
        if q and offset:
            raise TollError("Invalid offset: offset pages the list only, leave it out with query.")
        params = _opt(query=q or None, type=type, payTo=pay_to.lower() if pay_to else None, operator=operator, limit=limit,
                      offset=None if q else offset)
        url = f"{self.facilitator_url}/discovery/{'search' if q else 'resources'}" + (f"?{urlencode(params)}" if params else "")
        req = urllib.request.Request(url, method="GET", headers={"accept": "application/json", "x-toll-client": self._client_id})
        status, headers, raw = self._http(req, self.timeout)
        data = _try_json(raw)
        items = (data.get("resources") if q else data.get("items")) if isinstance(data, dict) else None
        if not 200 <= status < 300 or not isinstance(items, list):
            raise _rest_error(status, headers, raw)
        out: Dict[str, Any] = {
            "x402Version": data.get("x402Version") if isinstance(data.get("x402Version"), int) else 2,
            "items": [i for i in items if isinstance(i, dict)],
            "pagination": data.get("pagination") if isinstance(data.get("pagination"), dict) else None,
        }
        if isinstance(data.get("partialResults"), bool):
            out["partialResults"] = data["partialResults"]
        return out

    def _fac(self, method: str, path: str, body: Any = None) -> tuple:
        h = {"accept": "application/json", "x-toll-client": self._client_id}
        data = None
        if body is not None:
            h["content-type"] = "application/json"
            data = json.dumps(body).encode()
        req = urllib.request.Request(f"{self.facilitator_url}{path}", data=data, method=method, headers=h)
        return self._http(req, self.timeout)

    def paid_before(self, payer: str, pay_to: str, resource: Optional[str] = None, since: Optional[Union[int, float]] = None) -> Dict[str, Any]:
        """GET /paid on the facilitator: whether payer already paid pay_to through Toll's facilitator (settlements, escrow
        captures, batch charges), optionally for one resource and after since (unix seconds). For sellers using
        sign-in-with-x: a returning wallet can be let in without a second charge. Returns {"paid", "count", "last":
        {"tx", "ts", "amount", "receiptId", "via"} | None, "network", "sources"}. A 503 raises: never a false "not paid"."""
        q = {"payer": _address(payer, "payer").lower(), "payTo": _address(pay_to, "pay_to").lower()}
        if resource is not None:
            if not isinstance(resource, str) or len(resource) > 2048 or not _RESOURCE.fullmatch(resource):
                raise TollError("Invalid resource: an http(s) URL of at most 2048 characters, exactly as the payment named it.")
            q["resource"] = resource
        if since is not None:
            if hasattr(since, "timestamp"):
                since = int(since.timestamp())
            if isinstance(since, bool) or not isinstance(since, int) or not 0 <= since <= 9_999_999_999:
                raise TollError("Invalid since: unix seconds (a whole number) or a datetime.")
            q["since"] = str(since)
        status, headers, raw = self._fac("GET", f"/paid?{urlencode(q)}")
        data = _try_json(raw)
        if not 200 <= status < 300 or not isinstance(data, dict) or not isinstance(data.get("paid"), bool) or not isinstance(data.get("count"), int):
            raise _fac_error(status, headers, raw)
        return data

    def set_budget(self, budget: Dict[str, Any], signature: str) -> Dict[str, Any]:
        """COMING (the facilitator answers HTTP 404 budgets_off until budgets are switched on). POST /budget: set or replace
        (newer nonce) the payer's spending limits with Toll's facilitator. signature is the payer's own EIP-712 signature of
        budget_typed_data(budget); anyone may relay it. Returns {"ok", "payer", "nonce", "revoked"}."""
        m = _budget_message(budget)
        return self._post_budget({"budget": _budget_body(m), "signature": _signature(signature)})

    def revoke_budget(self, payer: str, nonce: Union[int, str], signature: str) -> Dict[str, Any]:
        """COMING (see set_budget). POST /budget {revoke}: refuse every payment until a budget with a newer nonce is set."""
        m = revoke_typed_data(payer, nonce)["message"]
        return self._post_budget({"revoke": {"payer": m["payer"], "nonce": str(m["nonce"])}, "signature": _signature(signature)})

    def get_budget(self, payer: str) -> Dict[str, Any]:
        """COMING (see set_budget). GET /budget?payer=: {"payer", "network", "day", "budget" | None, "spentToday",
        "spentByPayTo", "remainingToday"}, USDG base units as decimal strings, UTC day."""
        p = _address(payer, "payer").lower()
        status, headers, raw = self._fac("GET", f"/budget?payer={p}")
        data = _try_json(raw)
        if not 200 <= status < 300 or not isinstance(data, dict) or not isinstance(data.get("payer"), str) or "budget" not in data:
            raise _fac_error(status, headers, raw)
        return data

    def _post_budget(self, body: Dict[str, Any]) -> Dict[str, Any]:
        status, headers, raw = self._fac("POST", "/budget", body)
        data = _try_json(raw)
        if not 200 <= status < 300 or not isinstance(data, dict) or data.get("ok") is not True:
            raise _fac_error(status, headers, raw)
        return data

    def badge_url(self, token: str, size: Optional[str] = None) -> str:
        """The "Checked by Toll" badge URL for a coin on this client's base URL (see coin_badge_url)."""
        return coin_badge_url(token, size=size, base_url=self.base_url)

    def badge_embed(self, token: str, size: Optional[str] = None) -> Dict[str, str]:
        """HTML / Markdown / React snippets for a coin's badge on this client's base URL (see coin_badge_embed)."""
        return coin_badge_embed(token, size=size, base_url=self.base_url)

    def _watch_rest(self, method: str, path: str, what: str, body: Any = None) -> tuple:
        self._need_key(what)
        status, headers, raw = self._rest(method, path, auth=True, body=body)
        data = _try_json(raw)
        if status == 404 and isinstance(data, dict) and data.get("open") is False:
            raise TollError(
                f"{what}: watches for agents are not open on this server yet (it answered 404 open: false; the site's WATCH_API is off).",
                status=404,
            )
        if not 200 <= status < 300 or not isinstance(data, dict):
            raise _rest_error(status, headers, raw)
        return status, data

    def create_coin_watch(self, token: str, url: str) -> Dict[str, Any]:
        """POST /api/watch {token, url}: Toll re-reads the coin about every 10 minutes (sooner after a trade or a liquidity
        change) and POSTs a signed event to url on verdict_changed, new_against, dev_sold or cluster_sold. "secret" only
        when the watch is new ("created": True); check events with verify_webhook. Needs a Toll key (Bearer)."""
        _check_address(token, "token")
        status, data = self._watch_rest("POST", "/api/watch", "create_coin_watch", {"token": token, "url": str(url)})
        return {**data, "created": status == 201}

    def list_coin_watches(self) -> Dict[str, Any]:
        """GET /api/watch: {"watches": [...], "cap"} for this key (never the secret)."""
        return self._watch_rest("GET", "/api/watch", "list_coin_watches")[1]

    def delete_coin_watch(self, watch_id: str) -> Dict[str, Any]:
        """DELETE /api/watch?id=<uuid>: {"deleted": id}."""
        _check_uuid(watch_id)
        return self._watch_rest("DELETE", f"/api/watch?id={quote(watch_id)}", "delete_coin_watch")[1]

    def create_wallet_watch(self, address: str, url: str) -> Dict[str, Any]:
        """POST /api/watch/wallet {address, url}: Toll reads the wallet about once a minute and POSTs a signed event on a
        new approval, a new EIP-7702 delegation or a token received whose check is against (risky_token_in). "secret"
        only when new ("created": True). Needs a Toll key; wallet watches have their own cap."""
        _check_wallet(address)
        status, data = self._watch_rest("POST", "/api/watch/wallet", "create_wallet_watch", {"address": address, "url": str(url)})
        return {**data, "created": status == 201}

    def list_wallet_watches(self) -> Dict[str, Any]:
        """GET /api/watch/wallet: {"watches": [...], "cap"} for this key (never the secret)."""
        return self._watch_rest("GET", "/api/watch/wallet", "list_wallet_watches")[1]

    def delete_wallet_watch(self, watch_id: str) -> Dict[str, Any]:
        """DELETE /api/watch/wallet?id=<uuid>: {"deleted": id}."""
        _check_uuid(watch_id)
        return self._watch_rest("DELETE", f"/api/watch/wallet?id={quote(watch_id)}", "delete_wallet_watch")[1]

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


# -- REST helpers ------------------------------------------------------------
BLOCKLIST_KINDS = ("token", "contract", "wallet")
COIN_WATCH_EVENTS = ("verdict_changed", "new_against", "dev_sold", "cluster_sold")
"""The events a coin watch sends."""
WALLET_WATCH_EVENTS = ("approval", "delegation", "risky_token_in")
"""The events a wallet watch sends."""
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _check_uuid(value: object) -> None:
    if not isinstance(value, str) or not _UUID.fullmatch(value):
        raise TollError("Invalid watch id: expected the uuid from the list of your watches.")


def _iso(value: Any) -> str:
    """A datetime or ISO text as ISO UTC (what ?since takes)."""
    import datetime as _dt

    if isinstance(value, _dt.datetime):
        d = value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc)
    elif isinstance(value, str):
        try:
            d = _dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            raise TollError("Invalid since: use a datetime or an ISO time, e.g. 2026-11-08T00:00:00Z.") from None
        if d.tzinfo is None:
            d = d.replace(tzinfo=_dt.timezone.utc)
    else:
        raise TollError("Invalid since: use a datetime or an ISO time, e.g. 2026-11-08T00:00:00Z.")
    d = d.astimezone(_dt.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _retry_after(headers: Any) -> Optional[int]:
    v = _header(headers, "retry-after")
    return None if v is None else _clamp_seconds(v, 30)


def _rest_error(status: int, headers: Any, raw: str) -> TollError:
    data = _try_json(raw)
    msg = data["error"] if isinstance(data, dict) and isinstance(data.get("error"), str) else raw[:200]
    return TollError(f"Toll answered HTTP {status}" + (f": {msg}" if msg else ""), status=status, retry_after_s=_retry_after(headers))


# -- the facilitator: offer-receipt and per-payer budgets ----------------------
_EIP712_DOMAIN_TYPE = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
]

RECEIPT_DOMAIN = {"name": "x402 receipt", "version": "1", "chainId": 1}
"""The x402 offer-receipt spec's EIP-712 receipt domain (chainId 1 by the spec, whatever the payment network)."""
RECEIPT_TYPES = {
    "Receipt": [
        {"name": "version", "type": "uint256"},
        {"name": "network", "type": "string"},
        {"name": "resourceUrl", "type": "string"},
        {"name": "payer", "type": "string"},
        {"name": "issuedAt", "type": "uint256"},
        {"name": "transaction", "type": "string"},
    ],
}
"""The spec's canonical receipt types (v1)."""

BUDGET_DOMAIN = {"name": "Toll Facilitator Budget", "version": "1", "chainId": 4663}
"""The budget's EIP-712 domain: no verifyingContract (nothing on chain checks it)."""
BUDGET_TYPES = {
    "Budget": [
        {"name": "payer", "type": "address"},
        {"name": "perPayment", "type": "uint256"},
        {"name": "perDay", "type": "uint256"},
        {"name": "perPayTo", "type": "uint256"},
        {"name": "payToCaps", "type": "PayToCap[]"},
        {"name": "allowedPayTos", "type": "address[]"},
        {"name": "validUntil", "type": "uint64"},
        {"name": "nonce", "type": "uint256"},
    ],
    "PayToCap": [
        {"name": "payTo", "type": "address"},
        {"name": "perDay", "type": "uint256"},
    ],
}
REVOKE_TYPES = {"Revoke": [{"name": "payer", "type": "address"}, {"name": "nonce", "type": "uint256"}]}
BUDGET_MAX_PAYTOS = 50
"""At most this many pay_to_caps and allowed_pay_tos."""

_MAX_U256 = (1 << 256) - 1
_MAX_U64 = (1 << 64) - 1
_SIG65 = re.compile(r"0x[0-9a-fA-F]{130}")
_RESOURCE = re.compile(r'https?://[^\s"\\]+')


def _uint(v: Any, name: str, top: int = _MAX_U256) -> int:
    n: Optional[int] = None
    if isinstance(v, int) and not isinstance(v, bool):
        n = v
    elif isinstance(v, str) and re.fullmatch(r"\d{1,78}", v.strip()):
        n = int(v.strip())
    if n is None or n < 0 or n > top:
        raise TollError(f"Invalid {name}: use a whole number of USDG base units (int or decimal string) from 0.")
    return n


def _address(v: Any, name: str) -> str:
    if not is_valid_wallet(v):
        raise TollError(f"Invalid {name}: expected 0x + 40 hex characters.")
    return v


def _typed(domain: Dict[str, Any], types: Dict[str, Any], primary: str, message: Dict[str, Any]) -> Dict[str, Any]:
    """EIP-712 typed data in the full-message form (EIP712Domain in types): eth_account's
    encode_typed_data(full_message=...) and eth_signTypedData_v4 take it as is."""
    return {"domain": dict(domain), "types": {"EIP712Domain": list(_EIP712_DOMAIN_TYPE), **types}, "primaryType": primary, "message": message}


def _budget_message(budget: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(budget, dict):
        raise TollError("Invalid budget: pass {payer, perPayment, perDay, nonce, ...}.")
    caps = budget.get("payToCaps", budget.get("pay_to_caps")) or []
    allowed = budget.get("allowedPayTos", budget.get("allowed_pay_tos")) or []
    if not isinstance(caps, list) or len(caps) > BUDGET_MAX_PAYTOS:
        raise TollError(f"Invalid payToCaps: a list of at most {BUDGET_MAX_PAYTOS}.")
    if not isinstance(allowed, list) or len(allowed) > BUDGET_MAX_PAYTOS:
        raise TollError(f"Invalid allowedPayTos: a list of at most {BUDGET_MAX_PAYTOS}.")
    seen = set()
    out_caps = []
    for i, c in enumerate(caps):
        if not isinstance(c, dict):
            raise TollError(f"Invalid payToCaps[{i}]: use {{payTo, perDay}}.")
        pt = _address(c.get("payTo", c.get("pay_to")), f"payToCaps[{i}].payTo")
        if pt.lower() in seen:
            raise TollError(f"Invalid payToCaps: {pt} is listed twice (one cap per payTo).")
        seen.add(pt.lower())
        out_caps.append({"payTo": pt, "perDay": _uint(c.get("perDay", c.get("per_day")), f"payToCaps[{i}].perDay")})

    def g(camel: str, snake: str, default: Any = None) -> Any:
        v = budget.get(camel, budget.get(snake))
        return default if v is None else v

    return {
        "payer": _address(budget.get("payer"), "payer"),
        "perPayment": _uint(g("perPayment", "per_payment"), "perPayment"),
        "perDay": _uint(g("perDay", "per_day"), "perDay"),
        "perPayTo": _uint(g("perPayTo", "per_pay_to", 0), "perPayTo"),
        "payToCaps": out_caps,
        "allowedPayTos": [_address(a, f"allowedPayTos[{i}]") for i, a in enumerate(allowed)],
        "validUntil": _uint(g("validUntil", "valid_until", 0), "validUntil", _MAX_U64),
        "nonce": _uint(budget.get("nonce"), "nonce"),
    }


def budget_typed_data(budget: Dict[str, Any]) -> Dict[str, Any]:
    """The EIP-712 typed data of a per-payer budget, for the payer wallet to sign (eth_account:
    Account.sign_typed_data(key, full_message=td)). Then Toll().set_budget(td["message"], signature). Amounts are USDG base
    units (6 decimals); keys camelCase or snake_case. Raises TollError on a malformed budget, before anything is signed."""
    return _typed(BUDGET_DOMAIN, BUDGET_TYPES, "Budget", _budget_message(budget))


def revoke_typed_data(payer: str, nonce: Union[int, str]) -> Dict[str, Any]:
    """The EIP-712 typed data of a budget revoke (refuses every payment until a budget with a newer nonce is set)."""
    return _typed(BUDGET_DOMAIN, REVOKE_TYPES, "Revoke", {"payer": _address(payer, "payer"), "nonce": _uint(nonce, "nonce")})


def receipt_typed_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    """The EIP-712 typed data of the x402 offer-receipt spec's receipt (domain "x402 receipt" / "1" / chainId 1), for the
    SELLER to sign with its own key once it has delivered. The payload is used exactly as given."""
    if not isinstance(payload, dict):
        raise TollError("Invalid receipt payload.")
    for k in ("network", "resourceUrl", "payer"):
        if not isinstance(payload.get(k), str):
            raise TollError(f"Invalid receipt payload: {k} must be text.")
    tx = payload.get("transaction", "")
    if not isinstance(tx, str):
        raise TollError("Invalid receipt payload: transaction must be text.")
    ver, at = payload.get("version"), payload.get("issuedAt")
    if isinstance(ver, bool) or not isinstance(ver, int) or ver < 1:
        raise TollError("Invalid receipt payload: version must be a whole number (1).")
    if isinstance(at, bool) or not isinstance(at, int) or at < 0:
        raise TollError("Invalid receipt payload: issuedAt must be unix seconds.")
    return _typed(RECEIPT_DOMAIN, RECEIPT_TYPES, "Receipt",
                  {"version": ver, "network": payload["network"], "resourceUrl": payload["resourceUrl"], "payer": payload["payer"],
                   "issuedAt": at, "transaction": tx})


def toll_offer_receipt_of(answer: Any) -> Optional[Dict[str, Any]]:
    """extensions["toll-offer-receipt"] of a facilitator /settle answer, checked: {"offer", "receiptPayload"} (receiptPayload
    None when nothing settled or it is malformed), or None when absent (no offer-receipt extension, another facilitator)."""
    ext = answer.get("extensions") if isinstance(answer, dict) else None
    x = ext.get("toll-offer-receipt") if isinstance(ext, dict) else None
    if not isinstance(x, dict) or not isinstance(x.get("offer"), dict) or not isinstance(x["offer"].get("read"), str):
        return None
    p = x.get("receiptPayload")
    ok = (isinstance(p, dict) and all(isinstance(p.get(k), str) for k in ("network", "resourceUrl", "payer"))
          and all(isinstance(p.get(k), int) and not isinstance(p.get(k), bool) for k in ("version", "issuedAt"))
          and isinstance(p.get("transaction", ""), str))
    return {"offer": x["offer"], "receiptPayload": p if ok else None}


def _budget_body(m: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "payer": m["payer"], "perPayment": str(m["perPayment"]), "perDay": str(m["perDay"]), "perPayTo": str(m["perPayTo"]),
        "payToCaps": [{"payTo": c["payTo"], "perDay": str(c["perDay"])} for c in m["payToCaps"]],
        "allowedPayTos": list(m["allowedPayTos"]), "validUntil": str(m["validUntil"]), "nonce": str(m["nonce"]),
    }


def _signature(v: Any) -> str:
    if isinstance(v, (bytes, bytearray)) and len(v) == 65:
        v = "0x" + bytes(v).hex()
    if isinstance(v, str) and len(v) == 130 and not v.startswith("0x"):
        v = "0x" + v  # HexBytes.hex() drops the 0x in newer eth_account
    if not isinstance(v, str) or not _SIG65.fullmatch(v):
        raise TollError("Invalid signature: expected a 65-byte 0x hex signature from the payer.")
    return v


def _fac_error(status: int, headers: Any, raw: str) -> TollError:
    data = _try_json(raw)
    code = data.get("error") if isinstance(data, dict) and isinstance(data.get("error"), str) else ""
    msg = data.get("message") if isinstance(data, dict) and isinstance(data.get("message"), str) else ""
    note = " Budgets are not switched on at this facilitator yet." if code == "budgets_off" else ""
    head = f": {code}" if code else (f": {raw[:200]}" if raw else "")
    return TollError(f"Toll's facilitator answered HTTP {status}{head}" + (f" ({msg})" if msg else "") + "." + note,
                     status=status, retry_after_s=_retry_after(headers))


# -- check_tx: the RiskAssessment and the ALLOW ticket -------------------------
TICKET_SUFFIX_MAGIC = "0x900bc3e1"
"""bytes4(keccak256("TollAllow.v1")): the last 4 bytes of a ticket-suffixed call."""
TOLL_ALLOW_SIGNER = "0x4A2C93066d94F1E69f3EAd5438c4efDdf80a46ba"
"""Toll's production ALLOW signer on Robinhood Chain (4663)."""
_RA_MARK = "RiskAssessment (ERC-8265):"


def assessment_of(text: str) -> Optional[Dict[str, Any]]:
    """The RiskAssessment JSON a check_tx answer ends with, or None."""
    i = text.rfind(_RA_MARK)
    if i < 0:
        return None
    data = _try_json(text[i + len(_RA_MARK):].strip())
    return data if isinstance(data, dict) else None


def ticket_ask_of(t: Union[bool, Dict[str, Any], None]) -> Optional[Dict[str, Any]]:
    """The ask as Toll reads it ({consumer?, scope?}), or None for none. Same as @tollxyz/guard's ticketAskOf."""
    if t is None or t is False:
        return None
    if t is True:
        return {}
    if not isinstance(t, dict):
        raise TollError('Invalid ticket: use True or {"consumer": 0x..., "scope": "call" | "v4swap"}.')
    return {k: t[k] for k in ("consumer", "scope") if t.get(k) is not None}


def ticket_of_answer(a: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """x-toll.ticket of a RiskAssessment: {ticket, signature, signer} or {why}; None when there is none."""
    x = (a or {}).get("x-toll")
    t = x.get("ticket") if isinstance(x, dict) else None
    if not isinstance(t, dict):
        return None
    if isinstance(t.get("why"), str):
        return {"why": t["why"]}
    if isinstance(t.get("ticket"), dict) and isinstance(t.get("signature"), str) and isinstance(t.get("signer"), str):
        return {"ticket": t["ticket"], "signature": t["signature"], "signer": t["signer"]}
    return None


def _hex_body(h: Any, what: str) -> str:
    if not isinstance(h, str) or not re.fullmatch(r"0x(?:[0-9a-fA-F]{2})*", h):
        raise ValueError(f"{what} must be 0x hex with whole bytes")
    return h[2:].lower()


def _word(n: int, bits: int, what: str) -> str:
    if n < 0 or n >= 1 << bits:
        raise ValueError(f"{what} does not fit in uint{bits}")
    return format(n, "064x")


def _uint_word(v: Any, bits: int, what: str) -> str:
    try:
        n = int(v, 0) if isinstance(v, str) else int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{what} must be a whole number") from None
    return _word(n, bits, what)


def _addr_word(a: Any, what: str) -> str:
    if not isinstance(a, str) or not _EVM.fullmatch(a):
        raise ValueError(f"{what} must be an address")
    return a[2:].lower().rjust(64, "0")


def _b32_word(h: Any, what: str) -> str:
    if not isinstance(h, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", h):
        raise ValueError(f"{what} must be 32 bytes")
    return h[2:].lower()


def append_ticket_suffix(data: str, ticket: Dict[str, Any], signature: str) -> str:
    """The calldata a ticket-checking contract (toll-allow) reads: data || abi.encode(ticket, signature) || uint32 len ||
    0x900bc3e1. Byte for byte the same as @tollxyz/guard's appendTicketSuffix and TollAllow.encodeSuffix."""
    body = _hex_body(data, "data")
    sig = _hex_body(signature, "signature")
    head = (
        _uint_word(ticket["scope"], 8, "ticket.scope")
        + _uint_word(ticket["verdict"], 8, "ticket.verdict")
        + _addr_word(ticket["account"], "ticket.account")
        + _addr_word(ticket["consumer"], "ticket.consumer")
        + _b32_word(ticket["subject"], "ticket.subject")
        + _uint_word(ticket["validAfter"], 64, "ticket.validAfter")
        + _uint_word(ticket["validUntil"], 64, "ticket.validUntil")
        + _b32_word(ticket["nonce"], "ticket.nonce")
        + _b32_word(ticket["reportHash"], "ticket.reportHash")
    )
    tail = _word(320, 256, "offset") + _word(len(sig) // 2, 256, "signature length") + sig + "0" * ((64 - len(sig) % 64) % 64)
    encoded = head + tail
    return "0x" + body + encoded + format(len(encoded) // 2, "08x") + TICKET_SUFFIX_MAGIC[2:]


# -- coin badge ----------------------------------------------------------------
def coin_badge_url(token: str, size: Optional[str] = None, base_url: str = "https://t0ll.xyz") -> str:
    """The "Checked by Toll" badge for a coin: an SVG (200x28, or 300x42 with size "lg") with the coin's verdict word
    from the checks Toll already holds (AGAINST / CAREFUL / CLEAR / INCOMPLETE), or "not checked yet"."""
    _check_address(token, "token")
    if size not in (None, "sm", "lg"):
        raise TollError('Invalid size: use "sm" or "lg".')
    return f"{base_url.rstrip('/')}/badge/{token.lower()}" + ("?size=lg" if size == "lg" else "")


def coin_badge_embed(token: str, size: Optional[str] = None, base_url: str = "https://t0ll.xyz") -> Dict[str, str]:
    """Copy-paste snippets for a coin's badge linking to its check page: {url, page, html, markdown, react}."""
    url = coin_badge_url(token, size=size, base_url=base_url)
    page = f"{base_url.rstrip('/')}/check/{token.lower()}"
    w, h = (300, 42) if size == "lg" else (200, 28)
    return {
        "url": url,
        "page": page,
        "html": f'<a href="{page}"><img src="{url}" alt="Toll check" width="{w}" height="{h}"></a>',
        "markdown": f"[![Toll check]({url})]({page})",
        "react": f'<a href="{page}"><img src="{url}" alt="Toll check" width={{{w}}} height={{{h}}} /></a>',
    }


# -- webhooks ------------------------------------------------------------------
def verify_webhook(secret: str, raw_body: Union[str, bytes], signature: Optional[str]) -> bool:
    """Check a watch event's x-toll-signature header: sha256=<hex HMAC-SHA256(secret, raw body)>, the secret being the
    text Toll returned when the watch was added. Pass the raw body exactly as received. Constant-time compare."""
    if not isinstance(secret, str) or not secret or not isinstance(signature, str):
        return False
    m = re.fullmatch(r"sha256=([0-9a-fA-F]{64})", signature.strip())
    if not m:
        return False
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body)
    want = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, m.group(1).lower())


def read_webhook(secret: str, raw_body: Union[str, bytes], signature: Optional[str]) -> Dict[str, Any]:
    """verify_webhook, then the parsed event (type "toll.watch" or "toll.wallet_watch"); raises TollError otherwise."""
    if not verify_webhook(secret, raw_body, signature):
        raise TollError("Webhook signature does not match: drop this request.")
    text = raw_body if isinstance(raw_body, str) else bytes(raw_body).decode("utf-8", "replace")
    data = _try_json(text)
    if not isinstance(data, dict) or data.get("type") not in ("toll.watch", "toll.wallet_watch"):
        raise TollError("Not a Toll watch event.")
    return data
