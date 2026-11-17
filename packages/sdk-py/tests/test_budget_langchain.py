"""0.7.2: budget_ms on check_tx (POST /api/tx/check) and pre_buy_check (budget_ms), and toll_sdk.langchain. Mocked HTTP."""
import email.message
import json
import os

import pytest

from toll_sdk import Toll, TollError, check_tx_text, clamp_budget_ms

TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3"
FROM = "0x000000000000000000000000000000000000dEaD"


class Resp:
    def __init__(self, raw, status=200, headers=None):
        self._raw, self.status = raw, status
        self.headers = email.message.Message()
        for k, v in (headers or {}).items():
            self.headers[k] = v

    def read(self):
        return self._raw.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Opener:
    def __init__(self, *responses):
        self.responses, self.requests = list(responses), []

    def open(self, req, timeout=None):
        self.requests.append((req, timeout))
        return self.responses.pop(0)

    def body(self, i=0):
        return json.loads(self.requests[i][0].data)


def mcp(text):
    return Resp(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": text}]}}))


NOT_READ = {"action": "WARN", "warnings": [{"code": "coin-not-read", "severity": "medium", "message": "Still being read."}]}


def test_clamp_budget_ms():
    assert clamp_budget_ms(10, 300, 30000) == 300
    assert clamp_budget_ms(1e9, 300, 30000) == 30000
    assert clamp_budget_ms(1100.4, 300, 30000) == 1100
    assert clamp_budget_ms("1100", 300, 30000) is None
    assert clamp_budget_ms(True, 300, 30000) is None
    assert clamp_budget_ms(float("nan"), 300, 30000) is None


def test_check_tx_with_budget_posts_to_rest_and_not_read_is_warn():
    o = Opener(Resp(json.dumps(NOT_READ), headers={"retry-after": "4"}))
    r = Toll(opener=o, toll_key="k_test").check_tx(to=TOKEN, data="0x", from_=FROM, budget_ms=1100)
    req, timeout = o.requests[0]
    assert req.full_url.endswith("/api/tx/check")
    assert o.body()["budgetMs"] == 1100 and o.body()["from"] == FROM
    assert req.get_header("Authorization") == "Bearer k_test"
    assert timeout <= 3.1
    assert r.action == "WARN" and r.pending == {"retry_after_s": 4}
    assert r.text.startswith("WARN: read the warnings before signing.")
    assert "(coin-not-read)" in r.text and "again in 4 s" in r.text


def test_check_tx_without_budget_stays_on_mcp():
    o = Opener(mcp('WARN: x\n\nRiskAssessment (ERC-8265):\n{"action":"WARN","warnings":[]}'))
    r = Toll(opener=o).check_tx(to=TOKEN, data="0x", from_=FROM)
    assert o.requests[0][0].full_url.endswith("/mcp")
    assert "budgetMs" not in o.body()["params"]["arguments"]
    assert r.action == "WARN"


def test_check_tx_budget_errors_raise():
    o = Opener(Resp(json.dumps({"error": "Too many checks"}), status=429, headers={"retry-after": "60"}), Resp(json.dumps({"ok": 1})))
    t = Toll(opener=o)
    with pytest.raises(TollError) as e:
        t.check_tx(to=TOKEN, data="0x", budget_ms=1100)
    assert e.value.status == 429
    with pytest.raises(TollError):
        t.check_tx(to=TOKEN, data="0x", budget_ms=1100)


def test_pre_buy_check_budget_ms_clamped():
    o = Opener(mcp("Decision: WAIT\nask again in 6 s"), mcp("Decision: ALLOW"))
    t = Toll(opener=o)
    r = t.pre_buy_check(TOKEN, budget_ms=1100)
    assert o.body(0)["params"]["arguments"] == {"address": TOKEN, "budget_ms": 1100}
    assert r.decision == "WAIT" and r.pending == {"retry_after_s": 6}
    t.pre_buy_check(TOKEN, budget_ms=99999)
    assert o.body(1)["params"]["arguments"]["budget_ms"] == 25000


def test_check_tx_text_shape():
    t = check_tx_text({"action": "ALLOW", "warnings": []})
    assert "not a promise" in t and "- no warnings" in t and t.endswith('{"action":"ALLOW","warnings":[]}')


# ---------------------------------------------------------------- toll_sdk.langchain

lc = pytest.importorskip("langchain_core")


def test_langchain_tools_names_schema_and_calls():
    from toll_sdk.langchain import TOOL_NAMES, toll_tools

    o = Opener(mcp("Decision: WAIT\nask again in 5 s"), Resp(json.dumps(NOT_READ), headers={"retry-after": "3"}),
               mcp("Agent #20030: card loads"), Resp("down", status=500))
    tools = toll_tools(client=Toll(opener=o), budget_ms=1100)
    by = {t.name: t for t in tools}
    assert [t.name for t in tools] == TOOL_NAMES
    for t in tools:
        assert "Robinhood Chain" in t.description or "ERC-8004" in t.description
        assert not any(w in t.description.lower() for w in (" scam", " safe "))
    assert "from" in by["check_tx"].args
    out = by["pre_buy_check"].invoke({"address": TOKEN})
    assert "Decision: WAIT" in out and "ask again in 5" in out
    assert o.body(0)["params"]["arguments"]["budget_ms"] == 1100
    tx = by["check_tx"].invoke({"to": TOKEN, "data": "0x", "from": FROM})
    assert tx.startswith("WARN") and o.body(1)["budgetMs"] == 1100 and o.body(1)["from"] == FROM
    assert "card loads" in by["check_agent"].invoke({"id": 20030})
    assert by["account_permissions"].args["address"]["pattern"] == "^0x[0-9a-fA-F]{40}$"
    assert by["check_coin"].invoke({"address": TOKEN}).startswith("Toll could not answer")


def test_langchain_prefix_only_and_unknown():
    from toll_sdk.langchain import toll_tools

    t = toll_tools(client=Toll(opener=Opener()), only=["check_coin", "check_tx"], prefix="toll_")
    assert [x.name for x in t] == ["toll_check_coin", "toll_check_tx"]
    with pytest.raises(TollError):
        toll_tools(client=Toll(opener=Opener()), only=["nope"])


@pytest.mark.skipif(os.environ.get("TOLL_LIVE") != "1", reason="live smoke: set TOLL_LIVE=1")
def test_live_smoke_langchain():
    from toll_sdk.langchain import toll_tools

    live_token = "0x2f009d7d6227f7c17d688d60ddc0e581c9c4fc02"
    approve = "0x095ea7b3000000000000000000000000111111125421ca6dc452d289314280a0f8842a65" + "f" * 64
    by = {t.name: t for t in toll_tools(budget_ms=4000)}
    coin = by["check_coin"].invoke({"address": live_token})
    assert not coin.startswith("Toll could not answer"), coin
    pre = by["pre_buy_check"].invoke({"address": live_token})
    assert "Decision:" in pre, pre
    tx = by["check_tx"].invoke({"to": live_token, "data": approve, "from": FROM})
    assert tx.startswith(("WARN", "BLOCK")), tx
    agent = by["check_agent"].invoke({"id": 20030})
    assert not agent.startswith("Toll could not answer"), agent
    appr = by["wallet_approvals"].invoke({"wallet": "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc"})
    print("[live py]", coin.splitlines()[0][:80], "|", [l for l in pre.splitlines() if l.startswith("Decision")], "|", tx.splitlines()[0][:60], "|", agent.splitlines()[0][:60], "|", appr.splitlines()[0][:60])
