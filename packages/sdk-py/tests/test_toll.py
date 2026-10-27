import email.message
import io
import json
import os
import socket
import urllib.error
from pathlib import Path

import pytest

from toll_sdk import PaymentRequirements, Toll, TollError, is_valid_address, is_valid_wallet, parse_paid_url, parse_pending

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


def test_larp_wait_treats_busy_like_pending():
    s = Sleeper()
    op = FakeOpener(fx("larp_check_busy"), fx("larp_check_reading"), fx("larp_check"))
    r = Toll(opener=op, sleep=s).larp_check(TOKEN, wait=True)
    assert len(op.requests) == 3 and s.slept == [20, 30] and "product found" in r.text

    s2 = Sleeper()
    op2 = FakeOpener(*[fx("larp_check_busy")] * 3, fx("larp_check"))
    with pytest.raises(TollError) as e:
        Toll(opener=op2, sleep=s2).larp_check(TOKEN, wait=True)
    assert e.value.retry_after_s == 20 and len(op2.requests) == 3 and s2.slept == [20, 20]

    bad = json.dumps({"result": {"content": [{"type": "text", "text": "Not a token."}], "isError": True}})
    op3 = FakeOpener(bad, fx("larp_check"))
    with pytest.raises(TollError, match="Not a token"):
        Toll(opener=op3, sleep=Sleeper()).larp_check(TOKEN, wait=True)
    assert len(op3.requests) == 1


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
# A real unpaid 402 from Toll (captured once, no payment header sent): v2 PAYMENT-REQUIRED header + v1 body.
REAL_402 = json.loads(fx("x402_required"))


def msg_headers(d):
    m = email.message.Message()
    for k, v in d.items():
        m[k] = v
    return m


class HttpOpener:
    """Answers like urllib: 2xx -> response object, 4xx/5xx -> HTTPError. Items: (status, headers, body) or a callable."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append((req, timeout))
        a = self.answers.pop(0)
        if callable(a):
            a = a(req, timeout)
        status, headers, body = a
        hdrs = msg_headers(headers)
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, "x", hdrs, io.BytesIO(body.encode()))
        r = FakeResponse(body)
        r.status = status
        r.headers = hdrs
        return r

    def header(self, i, name):
        h = {k.lower(): v for k, v in self.requests[i][0].header_items()}
        return h.get(name.lower())


def required(headers=None):
    return (402, REAL_402["headers"] if headers is None else headers, REAL_402["body"])


def pending(retry_after=None):
    return (402, {} if retry_after is None else {"Retry-After": retry_after}, '{"pending": true}')


class Signer:
    def __init__(self, value="c2lnbmVkLXBheW1lbnQ="):
        self.value = value
        self.seen = []

    def __call__(self, req, url):
        self.seen.append((req, url))
        return self.value


def test_pay_needs_sign_and_toll_url():
    op = HttpOpener()
    with pytest.raises(TollError, match="sign"):
        Toll(opener=op).pay(PAID)
    with pytest.raises(TollError):
        Toll(opener=op, sign=Signer()).pay("https://evil.example/x")
    assert op.requests == []


def test_pay_signs_once_across_several_pendings():
    s = Sleeper()
    sg = Signer()
    op = HttpOpener(required(), pending("7"), pending("0"), pending(), (200, {}, '{"token": "x", "charged": true}'))
    assert Toll(opener=op, sign=sg, sleep=s).pay(PAID) == {"token": "x", "charged": True}

    assert len(sg.seen) == 1  # one signature for the whole call
    req, url = sg.seen[0]
    assert isinstance(req, PaymentRequirements) and req.x402_version == 2 and url == PAID
    assert req.accepts[0]["network"] == "eip155:4663" and req.accepts[0]["amount"] == "50000"
    assert req.accepts[0]["asset"] == "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"

    assert len(op.requests) == 5
    assert op.header(0, "payment-signature") is None and op.header(0, "x-payment") is None
    for i in range(1, 5):
        assert op.requests[i][0].full_url == PAID
        assert op.header(i, "payment-signature") == "c2lnbmVkLXBheW1lbnQ="
        assert op.header(i, "x-payment") is None
    assert s.slept == [7, 1, 5]  # Retry-After 0 is clamped to 1 s, none means 5 s


def test_pay_follows_v1_with_x_payment():
    sg = Signer("djEtcGF5bWVudA==")
    op = HttpOpener(required({"content-type": "application/json"}), (200, {}, '{"ok": 1}'))
    assert Toll(opener=op, sign=sg).pay(PAID) == {"ok": 1}
    req = sg.seen[0][0]
    assert req.x402_version == 1 and req.accepts[0]["maxAmountRequired"] == "50000"
    assert op.header(1, "x-payment") == "djEtcGF5bWVudA==" and op.header(1, "payment-signature") is None


def test_pay_stops_after_five_pending_tries():
    s = Sleeper()
    sg = Signer()
    op = HttpOpener(required(), *[pending("5")] * 6)
    with pytest.raises(TollError, match="same payment header") as e:
        Toll(opener=op, sign=sg, sleep=s).pay(PAID)
    assert e.value.status == 402
    assert len(op.requests) == 6 and len(sg.seen) == 1 and s.slept == [5, 5, 5, 5]


def test_pay_stops_before_300s_waiting():
    s = Sleeper()
    sg = Signer()
    op = HttpOpener(required(), pending("200"), pending("200"))
    with pytest.raises(TollError):
        Toll(opener=op, sign=sg, sleep=s).pay(PAID)
    assert s.slept == [200] and len(sg.seen) == 1


def test_other_402_after_paying_is_not_accepted():
    sg = Signer()
    op = HttpOpener(required(), pending("3"), required())
    with pytest.raises(TollError, match="payment not accepted") as e:
        Toll(opener=op, sign=sg, sleep=Sleeper()).pay(PAID)
    assert e.value.status == 402 and len(sg.seen) == 1 and len(op.requests) == 3


def test_no_payment_sent_without_requirements_or_when_sign_fails():
    sg = Signer()
    with pytest.raises(TollError, match="without x402 payment requirements"):
        Toll(opener=HttpOpener((402, {}, "{}")), sign=sg).pay(PAID)
    assert sg.seen == []

    def bad(req, url):
        raise RuntimeError("no funds")

    op = HttpOpener(required())
    with pytest.raises(TollError, match="nothing was sent: no funds"):
        Toll(opener=op, sign=bad).pay(PAID)
    assert len(op.requests) == 1

    op = HttpOpener(required())
    with pytest.raises(TollError, match="one non-empty line"):
        Toll(opener=op, sign=lambda r, u: "a\r\nb").pay(PAID)
    assert len(op.requests) == 1


def test_pay_timeout_warns_not_to_sign_again():
    sg = Signer()

    def hang(req, timeout):
        raise TimeoutError()

    op = HttpOpener(required(), hang)
    with pytest.raises(TollError, match="may have settled") as e:
        Toll(opener=op, sign=sg).pay(PAID, timeout=40)
    assert "new signature" in str(e.value) and len(sg.seen) == 1
    assert op.requests[0][1] <= 40  # each request gets what is left of pay()'s own timeout

    op = HttpOpener(required(), lambda r, t: (_ for _ in ()).throw(urllib.error.URLError(socket.timeout())))
    with pytest.raises(TollError, match="timed out.*may have settled"):
        Toll(opener=op, sign=Signer()).pay(PAID)


def test_pay_unpaid_200_needs_no_signature():
    sg = Signer()
    assert Toll(opener=HttpOpener((200, {}, '{"free": true}')), sign=sg).pay(PAID) == {"free": True}
    assert sg.seen == []


def test_retry_after_clamped():
    assert parse_pending("try again in 0 s") == {"retry_after_s": 1}


@pytest.mark.skipif(os.environ.get("TOLL_LIVE") != "1", reason="set TOLL_LIVE=1 for the live smoke test")
def test_live_smoke():
    assert "Robinhood Chain" in Toll().chain_pulse().text
