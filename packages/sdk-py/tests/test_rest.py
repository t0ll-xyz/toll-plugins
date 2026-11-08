import datetime
import email.message
import hashlib
import hmac
import io
import json
import urllib.error
from pathlib import Path

import pytest

from toll_sdk import (
    COIN_WATCH_EVENTS,
    TOLL_ALLOW_SIGNER,
    WALLET_WATCH_EVENTS,
    Toll,
    TollError,
    append_ticket_suffix,
    assessment_of,
    coin_badge_embed,
    coin_badge_url,
    read_webhook,
    ticket_ask_of,
    verify_webhook,
)

FX = Path(__file__).parent / "fixtures"
WALLET = "0x4a2c93066d94f1e69f3ead5438c4efddf80a46ba"
TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3"
UUID = "0b7f8a52-2c43-4f0e-9a51-6a3f1d2e9c10"


def fx(name: str) -> str:
    return (FX / f"{name}.json").read_text(encoding="utf-8")


def _headers(h):
    m = email.message.Message()
    for k, v in (h or {}).items():
        m[k] = v
    return m


class Resp:
    def __init__(self, raw, status=200, headers=None):
        self.raw, self.status, self.headers = raw, status, _headers(headers)

    def read(self):
        return self.raw.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Opener:
    """Answers in order; a non-2xx answer is raised as urllib's HTTPError, as urllib does."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append(req)
        raw, status, headers = self.answers.pop(0)
        if 200 <= status < 300:
            return Resp(raw, status, headers)
        raise urllib.error.HTTPError(req.full_url, status, "x", _headers(headers), io.BytesIO(raw.encode()))

    def body(self, i=0):
        return json.loads(self.requests[i].data)


def j(o, status=200, headers=None):
    return (json.dumps(o), status, headers or {})


ROW = {
    "kind": "erc20", "token": TOKEN, "symbol": "TOLL", "spender": "0x000000000022d473030f116ddee9f6b43ac78ba3", "amount": str(2**256 - 1),
    "unlimited": True, "spenderFacts": {"type": "contract", "name": "Permit2", "named": "known"}, "risk": "medium",
    "why": "an unlimited allowance to a contract Toll knows", "block": 109000000, "tx": "0x" + "ab" * 32,
    "revoke": {"to": TOKEN, "data": "0x095ea7b3", "value": "0", "does": "approve(spender, 0)", "check": {"action": "ALLOW", "warnings": []}},
}


def test_approvals_ok_live_shape():
    ok = {"state": "ok", "wallet": WALLET, "chainId": 4663, "rows": [ROW], "total": 1, "more": 0, "counts": {"high": 0, "medium": 1, "low": 0},
          "logs": 3, "pairsNotRead": 0, "notes": [], "readTo": 109459126, "readAt": "2026-11-08T19:13:43.966Z"}
    op = Opener(j(ok))
    a = Toll(opener=op, client_id="c" * 22).approvals(WALLET.upper().replace("0X", "0x"))
    req = op.requests[0]
    assert req.full_url == f"https://t0ll.xyz/api/approvals/{WALLET}" and req.get_method() == "GET"
    assert req.get_header("X-toll-client") == "c" * 22 and req.get_header("Authorization") is None
    assert a["state"] == "ok" and a["rows"][0]["revoke"]["check"]["action"] == "ALLOW"


def test_approvals_not_read_is_an_answer():
    nr = {"state": "not read", "wallet": WALLET, "reason": "the approval logs could not be read (history service: history service answered 429)"}
    a = Toll(opener=Opener(j(nr, 503, {"retry-after": "30"}))).approvals(WALLET)
    assert a == {**nr, "retry_after_s": 30}


def test_approvals_errors():
    op = Opener(j({"error": "Too many requests: 6 a minute. Try again in a minute."}, 429, {"retry-after": "60"}),
                j({"error": "The approvals list is unavailable right now. Try again shortly."}, 503))
    t = Toll(opener=op)
    with pytest.raises(TollError) as e:
        t.approvals(WALLET)
    assert e.value.status == 429 and e.value.retry_after_s == 60 and "6 a minute" in str(e.value)
    with pytest.raises(TollError, match="unavailable"):
        t.approvals(WALLET)
    with pytest.raises(TollError, match="Invalid wallet"):
        t.approvals("0x123")
    assert len(op.requests) == 2


def test_approvals_text_and_mcp_tool():
    text = f"Approvals of {WALLET} on Robinhood Chain: not read. x.\nRead more: https://t0ll.xyz/api/approvals/{WALLET}"
    op = Opener((text, 503, {}))
    assert Toll(opener=op).approvals_text(WALLET) == text
    assert op.requests[0].full_url.endswith("?format=text")
    op = Opener(j({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "Approvals of x"}]}}))
    assert Toll(opener=op).wallet_approvals(WALLET).text == "Approvals of x"
    assert op.body()["params"] == {"name": "wallet_approvals", "arguments": {"wallet": WALLET}}


def test_blocklist_live_shape_etag_and_query():
    op = Opener((fx("blocklist"), 200, {"etag": 'W/"a88694eb99dd1534"'}))
    r = Toll(opener=op).blocklist(since=datetime.datetime(2026, 11, 8, 12, tzinfo=datetime.timezone.utc), kind="token")
    assert op.requests[0].full_url == "https://t0ll.xyz/api/blocklist?since=2026-11-08T12%3A00%3A00.000Z&kind=token"
    assert r["not_modified"] is False and r["etag"] == 'W/"a88694eb99dd1534"'
    lst = r["list"]
    assert lst["chain_id"] == 4663 and lst["entries"][0]["kind"] == "token"
    assert all(c in lst["reasons"] for c in lst["entries"][0]["reasons"])


def test_blocklist_304_and_files():
    op = Opener(("", 304, {"etag": 'W/"e1"'}))
    assert Toll(opener=op).blocklist(etag='W/"e1"') == {"not_modified": True, "etag": 'W/"e1"'}
    assert op.requests[0].get_header("If-none-match") == 'W/"e1"'
    csv = "address,kind,reasons,first_seen,last_confirmed,evidence,tx,chain_id\n"
    op = Opener((csv, 200, {"etag": 'W/"c"'}))
    t = Toll(opener=op)
    assert t.blocklist_file("csv", kind="token", since="2026-11-08T00:00:00Z") == {"not_modified": False, "etag": 'W/"c"', "text": csv}
    assert op.requests[0].full_url == "https://t0ll.xyz/api/blocklist?format=csv&since=2026-11-08T00%3A00%3A00.000Z&kind=token"
    for bad in (lambda: t.blocklist(since="yesterday"), lambda: t.blocklist(kind="coin"), lambda: t.blocklist_file("xml")):
        with pytest.raises(TollError):
            bad()
    assert len(op.requests) == 1


def test_tx_record_live_shape_and_503():
    op = Opener((fx("record_tx"), 200, {}))
    r = Toll(opener=op).tx_record()
    assert op.requests[0].full_url == "https://t0ll.xyz/api/record/tx"
    assert [a["action"] for a in r["actions"]] == ["BLOCK", "WARN", "ALLOW"]
    assert r["windowH"] == 24 and r["calibration"]["blockAtPct"] == 40 and r["calibration"]["rules"]
    with pytest.raises(TollError, match="rather than a guess") as e:
        Toll(opener=Opener(j({"error": "The pre-sign record could not be read just now. Nothing is shown rather than a guess."}, 503))).tx_record()
    assert e.value.status == 503


def test_badge_url_and_embed():
    T = TOKEN.upper().replace("0X", "0x")
    assert coin_badge_url(T) == f"https://t0ll.xyz/badge/{TOKEN}"
    assert coin_badge_url(T, size="lg") == f"https://t0ll.xyz/badge/{TOKEN}?size=lg"
    e = coin_badge_embed(T)
    assert e["html"] == f'<a href="https://t0ll.xyz/check/{TOKEN}"><img src="https://t0ll.xyz/badge/{TOKEN}" alt="Toll check" width="200" height="28"></a>'
    assert e["markdown"] == f"[![Toll check](https://t0ll.xyz/badge/{TOKEN})](https://t0ll.xyz/check/{TOKEN})"
    assert e["react"] == f'<a href="https://t0ll.xyz/check/{TOKEN}"><img src="https://t0ll.xyz/badge/{TOKEN}" alt="Toll check" width={{200}} height={{28}} /></a>'
    assert 'width="300" height="42"' in coin_badge_embed(T, size="lg")["html"]
    assert Toll(base_url="http://localhost:3000/").badge_url(T) == f"http://localhost:3000/badge/{TOKEN}"
    with pytest.raises(TollError):
        coin_badge_url("0x12")


def test_coin_watches_rest():
    added = {"id": UUID, "token": TOKEN, "url": "https://a.example/h", "cap": 3, "events": list(COIN_WATCH_EVENTS),
             "signature": "x-toll-signature: sha256=<hex HMAC-SHA256(secret, raw body)>", "secret": "s" * 64, "note": "Keep the secret."}
    op = Opener(j(added, 201), j({"watches": [{"id": UUID, "token": TOKEN}], "cap": 3}), j({"deleted": UUID}))
    t = Toll(opener=op, toll_key="k1")
    a = t.create_coin_watch(TOKEN, "https://a.example/h")
    req = op.requests[0]
    assert req.full_url == "https://t0ll.xyz/api/watch" and req.get_method() == "POST"
    assert req.get_header("Authorization") == "Bearer k1"
    assert op.body() == {"token": TOKEN, "url": "https://a.example/h"}
    assert a["created"] is True and a["secret"] == "s" * 64
    assert t.list_coin_watches()["watches"][0]["id"] == UUID
    assert t.delete_coin_watch(UUID) == {"deleted": UUID}
    assert op.requests[2].full_url == f"https://t0ll.xyz/api/watch?id={UUID}" and op.requests[2].get_method() == "DELETE"


def test_wallet_watches_rest():
    again = {"id": UUID, "address": WALLET, "url": "https://a.example/w", "cap": 3, "events": list(WALLET_WATCH_EVENTS), "signature": "s", "note": "Already watched."}
    op = Opener(j(again), j({"watches": [], "cap": 3}), j({"deleted": UUID}))
    t = Toll(opener=op, toll_key="k1")
    a = t.create_wallet_watch(WALLET, "https://a.example/w")
    assert op.requests[0].full_url == "https://t0ll.xyz/api/watch/wallet" and op.body() == {"address": WALLET, "url": "https://a.example/w"}
    assert a["created"] is False and "secret" not in a
    assert t.list_wallet_watches() == {"watches": [], "cap": 3}
    t.delete_wallet_watch(UUID)
    assert op.requests[2].full_url == f"https://t0ll.xyz/api/watch/wallet?id={UUID}"


def test_watch_errors():
    op = Opener()
    with pytest.raises(TollError, match="Toll key"):
        Toll(opener=op).list_coin_watches()
    with pytest.raises(TollError, match="Invalid watch id"):
        Toll(opener=op, toll_key="k").delete_wallet_watch("w1")
    assert not op.requests
    op = Opener(j({"error": "Coin watches for agents are not open yet.", "open": False}, 404),
                j({"error": "Send your Toll key (Authorization: Bearer <key>, made at https://t0ll.xyz/toll#keys): watches belong to a wallet."}, 401),
                j({"error": "This key's tier watches up to 3 wallets.", "cap": 3}, 403))
    t = Toll(opener=op, toll_key="k")
    with pytest.raises(TollError, match="WATCH_API") as e:
        t.list_coin_watches()
    assert e.value.status == 404
    with pytest.raises(TollError, match="Bearer"):
        t.list_wallet_watches()
    with pytest.raises(TollError, match="up to 3 wallets"):
        t.create_wallet_watch(WALLET, "https://a.example/w")


def test_watch_wallet_over_mcp():
    with pytest.raises(TollError, match="Toll key"):
        Toll(opener=Opener()).watch_wallet(WALLET, "https://a.example/w")
    ans = lambda o: j({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": json.dumps(o, indent=2) + "\n\nDocs: https://t0ll.xyz/llms.txt"}]}})
    op = Opener(ans({"id": UUID, "secret": "s"}), ans({"deleted": UUID}))
    t = Toll(opener=op, toll_key="k1")
    assert t.watch_wallet(WALLET, "https://a.example/w") == {"id": UUID, "secret": "s"}
    assert op.body()["params"] == {"name": "watch_wallet", "arguments": {"address": WALLET, "url": "https://a.example/w"}}
    assert op.requests[0].get_header("X-toll-pass") == "k1"
    assert t.unwatch_wallet(UUID) == {"deleted": UUID}
    assert op.body(1)["params"] == {"name": "unwatch_wallet", "arguments": {"id": UUID}}


def test_verify_webhook():
    secret = "9f" * 32
    raw = json.dumps({"type": "toll.watch", "event": "verdict_changed", "events": ["verdict_changed"], "watch_id": UUID, "token": TOKEN, "chain": "rh",
                      "verdict": {"before": "CAREFUL", "now": "AGAINST"}, "new_against": [], "check_url": f"https://t0ll.xyz/check/{TOKEN}", "at": "2026-11-08T19:00:00Z"})
    sig = "sha256=" + hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    assert verify_webhook(secret, raw, sig) and verify_webhook(secret, raw.encode(), "sha256=" + sig[7:].upper())
    assert not verify_webhook(secret, raw + " ", sig)
    assert not verify_webhook("other", raw, sig)
    assert not verify_webhook(secret, raw, None) and not verify_webhook(secret, raw, "sha256=zz")
    assert read_webhook(secret, raw, sig)["verdict"]["now"] == "AGAINST"
    with pytest.raises(TollError, match="does not match"):
        read_webhook(secret, raw, "sha256=" + "0" * 64)


TICKET = {"scope": 1, "verdict": 0, "account": "0x2222222222222222222222222222222222222222", "consumer": "0x" + "0" * 40,
          "subject": "0x" + "9c" * 32, "validAfter": 1793000000, "validUntil": 1793000060, "nonce": "0x" + "91" * 32, "reportHash": "0x" + "d9" * 32}


def tx_answer(xtoll):
    ra = {"version": "erc-8265/1", "action": "ALLOW", "warnings": [], "scanners": [{"provider": "Toll"}], "x-toll": xtoll}
    text = "\n".join(["ALLOW: none of the checks Toll runs found a reason to stop (not a promise that it is safe).", "- no warnings", "", "RiskAssessment (ERC-8265):", json.dumps(ra)])
    return j({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": text}]}})


def test_check_tx_ticket_true():
    op = Opener(tx_answer({"ticket": {"ticket": TICKET, "signature": "0x" + "11" * 65, "signer": TOLL_ALLOW_SIGNER}}))
    r = Toll(opener=op).check_tx(to=TOKEN, data="0x", value=0, from_=TICKET["account"], ticket=True)
    assert op.body()["params"]["arguments"] == {"to": TOKEN, "data": "0x", "value": 0, "from": TICKET["account"], "ticket": {}}
    assert r.action == "ALLOW" and r.ticket["signer"] == TOLL_ALLOW_SIGNER and r.assessment["action"] == "ALLOW"


def test_check_tx_ticket_options():
    C = "0x3333333333333333333333333333333333333333"
    op = Opener(tx_answer({"ticket": {"why": "No ticket: the request has no from."}}), tx_answer({}))
    t = Toll(opener=op)
    r = t.check_tx(to=TOKEN, ticket={"consumer": C, "scope": "v4swap"})
    assert op.body()["params"]["arguments"]["ticket"] == {"consumer": C, "scope": "v4swap"}
    assert r.ticket == {"why": "No ticket: the request has no from."}
    r2 = t.check_tx(to=TOKEN, ticket=False)
    assert "ticket" not in op.body(1)["params"]["arguments"] and r2.ticket is None
    with pytest.raises(TollError, match="consumer"):
        t.check_tx(to=TOKEN, ticket={"consumer": "0x12"})
    with pytest.raises(TollError, match="scope"):
        t.check_tx(to=TOKEN, ticket={"scope": "tx"})
    assert ticket_ask_of(True) == {} and ticket_ask_of(False) is None and assessment_of("no json") is None


def test_append_ticket_suffix_matches_toll_allow_vectors():
    vec = json.loads(fx("allowticket-vectors.viem"))
    assert len(vec["vectors"]) >= 2
    for v in vec["vectors"]:
        assert append_ticket_suffix(v["data"], v["ticket"], v["signature"]) == v["suffixedData"].lower(), v["name"]
