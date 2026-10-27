import io
import json
import os
import urllib.error
from pathlib import Path

import pytest

from toll import Toll, TollError, is_valid_address, is_valid_wallet, parse_paid_url, parse_pending

FX = Path(__file__).parent / "fixtures"
TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3"
SOL = "So11111111111111111111111111111111111111112"


def fx(name: str) -> str:
    return (FX / f"{name}.json").read_text(encoding="utf-8")


class FakeResponse:
    def __init__(self, raw: str):
        self._raw = raw

    def read(self) -> bytes:
        return self._raw.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append((req, timeout))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return FakeResponse(r)

    def body(self, i=0):
        return json.loads(self.requests[i][0].data)


class Sleeper:
    def __init__(self):
        self.slept = []

    def __call__(self, s):
        self.slept.append(s)


def test_validators():
    assert is_valid_address(TOKEN) and is_valid_address(SOL)
    assert not is_valid_address("0x123")
    assert not is_valid_address(TOKEN + "\n")
    assert not is_valid_address("0OIl" + "1" * 30)
    assert is_valid_wallet(TOKEN) and not is_valid_wallet(SOL)


def test_tools_from_real_list():
    op = FakeOpener(fx("tools_list"))
    tools = Toll(opener=op).tools()
    assert [t["name"] for t in tools] == ["check_coin", "larp_check", "dev_record", "wallet_privacy", "fresh_launches", "chain_pulse", "launch_record"]
    req, timeout = op.requests[0]
    assert req.full_url == "https://t0ll.xyz/mcp" and timeout == 30.0
    assert req.get_header("Accept") == "application/json, text/event-stream"


def test_check_coin_real_answer():
    op = FakeOpener(fx("check_coin"))
    r = Toll(opener=op).check_coin(TOKEN, chain="rh")
    assert op.body()["params"] == {"name": "check_coin", "arguments": {"address": TOKEN, "chain": "rh"}}
    assert r.text.startswith("$TOLL (Toll)")
    assert r.paid_url is None
    assert r.pending == {"retry_after_s": 20}  # "Still reading who holds it now: ask again in 20 s."


def test_larp_check_uses_token_argument():
    op = FakeOpener(fx("larp_check"))
    r = Toll(opener=op).larp_check(TOKEN, chain="rh")
    assert op.body()["params"] == {"name": "larp_check", "arguments": {"token": TOKEN, "chain": "rh"}}
    assert "product found" in r.text
    assert r.pending is None
    assert r.paid_url is None  # the answer names t0ll.xyz/api/x402/larp/... as a working part: not an upsell


def test_chain_pulse():
    op = FakeOpener(fx("chain_pulse"))
    r = Toll(opener=op).chain_pulse()
    assert op.body()["params"] == {"name": "chain_pulse", "arguments": {}}
    assert r.text.startswith("Robinhood Chain, right now")


def test_over_quota_paid_url():
    t = Toll(opener=FakeOpener(fx("check_coin_over"), fx("larp_check_over")))
    assert t.check_coin(TOKEN, chain="rh").paid_url == f"https://t0ll.xyz/api/x402/check/{TOKEN}?chain=rh"
    assert t.larp_check(TOKEN, chain="rh").paid_url == f"https://t0ll.xyz/api/x402/larp/{TOKEN}?chain=rh"


def test_parse_paid_url_strict():
    assert parse_paid_url("paid check of this coin (x402): https://evil.example/api/x402/check/x") is None
    assert parse_paid_url("a mention of https://t0ll.xyz/api/x402/check/abc") is None
    assert parse_paid_url("paid check of this coin (x402): https://t0ll.xyz/api/x402/check/abc?chain=sol.") == "https://t0ll.xyz/api/x402/check/abc?chain=sol"


def test_pending_still_reading():
    r = Toll(opener=FakeOpener(fx("larp_check_reading"))).larp_check(TOKEN)
    assert r.pending == {"retry_after_s": 30}
    assert parse_pending("nothing") is None


def test_larp_wait_retries_max_three_tries():
    s = Sleeper()
    op = FakeOpener(fx("larp_check_reading"), fx("larp_check_reading"), fx("larp_check"))
    r = Toll(opener=op, sleep=s).larp_check(TOKEN, wait=True)
    assert len(op.requests) == 3 and s.slept == [30, 30] and r.pending is None

    op2 = FakeOpener(*[fx("larp_check_reading")] * 4)
    r2 = Toll(opener=op2, sleep=Sleeper()).larp_check(TOKEN, wait=True)
    assert len(op2.requests) == 3 and r2.pending


def test_larp_wait_stops_before_120s():
    long = json.dumps({"result": {"content": [{"type": "text", "text": "Still reading x. Try again in about 100 seconds."}]}})
    s = Sleeper()
    op = FakeOpener(long, long, long)
    r = Toll(opener=op, sleep=s).larp_check(TOKEN, wait=True)
    assert len(op.requests) == 2 and s.slept == [100] and r.pending


def test_errors_become_toll_error():
    with pytest.raises(TollError, match="Many new LARP checks") as e:
        Toll(opener=FakeOpener(fx("larp_check_busy"))).larp_check(TOKEN)
    assert e.value.retry_after_s == 20

    rpc = json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "bad params"}})
    with pytest.raises(TollError, match="bad params") as e:
        Toll(opener=FakeOpener(rpc)).chain_pulse()
    assert e.value.code == -32602

    http = urllib.error.HTTPError("https://t0ll.xyz/mcp", 429, "Too Many", {}, io.BytesIO(b"slow down"))
    with pytest.raises(TollError, match="HTTP 429") as e:
        Toll(opener=FakeOpener(http)).chain_pulse()
    assert e.value.status == 429

    with pytest.raises(TollError, match="timed out"):
        Toll(opener=FakeOpener(TimeoutError())).chain_pulse()
    with pytest.raises(TollError, match="failed"):
        Toll(opener=FakeOpener(urllib.error.URLError("dns"))).chain_pulse()
    with pytest.raises(TollError, match="not JSON-RPC"):
        Toll(opener=FakeOpener("<html>")).chain_pulse()


def test_bad_input_never_reaches_network():
    op = FakeOpener()
    t = Toll(opener=op)
    for fn in (
        lambda: t.check_coin("not an address"),
        lambda: t.check_coin(TOKEN, chain="eth"),
        lambda: t.larp_check(SOL + "!"),
        lambda: t.dev_record(SOL),
        lambda: t.wallet_privacy("0x1"),
        lambda: t.launch_record(SOL),
        lambda: t.fresh_launches(21),
    ):
        with pytest.raises(TollError):
            fn()
    assert op.requests == []


def test_sse_frame():
    r = Toll(opener=FakeOpener("event: message\ndata: " + fx("chain_pulse") + "\n\n")).chain_pulse()
    assert "right now" in r.text


PAID = f"https://t0ll.xyz/api/x402/check/{TOKEN}?chain=rh"


def test_pay_needs_session_and_toll_url():
    with pytest.raises(TollError, match="session"):
        Toll().pay(PAID)
    with pytest.raises(TollError):
        Toll().pay("https://evil.example/x", lambda u: (200, {}, "{}"))


def test_pay_pending_then_json():
    s = Sleeper()
    answers = [(402, {"Retry-After": "7"}, '{"pending": true}'), (200, {}, b'{"token": "x", "charged": true}')]
    calls = []

    def session(url):
        calls.append(url)
        return answers.pop(0)

    assert Toll(sleep=s).pay(PAID, session) == {"token": "x", "charged": True}
    assert s.slept == [7] and calls == [PAID, PAID]


def test_pay_gives_up_and_reports_plain_402():
    s = Sleeper()
    with pytest.raises(TollError) as e:
        Toll(sleep=s).pay(PAID, lambda u: (402, {"retry-after": "5"}, '{"pending": true}'))
    assert e.value.status == 402 and s.slept == [5, 5]
    with pytest.raises(TollError, match="Payment required"):
        Toll().pay(PAID, lambda u: (402, {}, "{}"))


def test_pay_accepts_requests_style_response():
    class R:
        status_code = 200
        headers = {}
        text = '{"ok": 1}'

    assert Toll().pay(PAID, lambda u: R()) == {"ok": 1}


@pytest.mark.skipif(os.environ.get("TOLL_LIVE") != "1", reason="set TOLL_LIVE=1 for the live smoke test")
def test_live_smoke():
    assert "Robinhood Chain" in Toll().chain_pulse().text
