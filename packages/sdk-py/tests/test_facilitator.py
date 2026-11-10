import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from toll_sdk import TOLL_FACILITATOR, TOOL_NAMES, Toll, TollError, screen_of
from test_rest import Opener, j

FX = Path(__file__).parent / "fixtures"
PAYTO = "0x3954ff905bdb481ad5814d5be3cc32c3166122ac"


def fx(name: str) -> str:
    return (FX / f"{name}.json").read_text(encoding="utf-8")


def raw(name: str, status: int = 200, headers=None):
    return (fx(name), status, headers or {})


def qs(url: str):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def test_find_paid_api_in_tool_names():
    assert len(TOOL_NAMES) == 28
    assert TOOL_NAMES[TOOL_NAMES.index("check_agent") + 1] == "find_paid_api"


def test_find_paid_api_calls_the_tool():
    op = Opener(raw("find_paid_api"), raw("find_paid_api"))
    t = Toll(opener=op)
    r = t.find_paid_api(query="  stock ", limit=2)
    assert op.body(0)["params"] == {"name": "find_paid_api", "arguments": {"query": "stock", "limit": 2}}
    assert r.text.startswith('Paid APIs on Robinhood Chain for "stock"')
    t.find_paid_api()
    assert op.body(1)["params"]["arguments"] == {}
    with pytest.raises(TollError):
        t.find_paid_api(limit=21)
    with pytest.raises(TollError):
        t.find_paid_api(query="x" * 201)


def test_find_paid_apis_list_live_shape():
    op = Opener(raw("discovery_resources"))
    r = Toll(opener=op, client_id="c" * 22).find_paid_apis(limit=2, offset=0, type="http", operator="agent:7622")
    req = op.requests[0]
    assert req.full_url.split("?")[0] == f"{TOLL_FACILITATOR}/discovery/resources"
    assert qs(req.full_url) == {"type": "http", "operator": "agent:7622", "limit": "2", "offset": "0"}
    assert req.get_header("X-toll-client") == "c" * 22
    assert r["x402Version"] == 2 and len(r["items"]) == 2
    assert r["items"][0]["verified"] is True and isinstance(r["items"][0]["settledViaToll"], int)
    assert set(r["pagination"]) == {"limit", "offset", "total"} and "partialResults" not in r


def test_find_paid_apis_search():
    op = Opener(raw("discovery_search"))
    r = Toll(opener=op).find_paid_apis(query="stock", pay_to=PAYTO.upper().replace("0X", "0x"), limit=1)
    url = op.requests[0].full_url
    assert urlparse(url).path == "/discovery/search"
    assert qs(url) == {"query": "stock", "payTo": PAYTO, "limit": "1"}
    assert r["items"][0]["price"] == "0.05 USDG" and r["pagination"] is None and r["partialResults"] is True


def test_find_paid_apis_urls():
    op = Opener(raw("discovery_resources"), raw("discovery_resources"))
    Toll(opener=op, base_url="https://staging.example/").find_paid_apis()
    assert op.requests[0].full_url == "https://staging.example/api/facilitator/discovery/resources"
    Toll(opener=op, facilitator_url="https://fac.example/").find_paid_apis()
    assert op.requests[1].full_url == "https://fac.example/discovery/resources"


def test_find_paid_apis_errors():
    op = Opener(j({"error": "Too many requests"}, 429, {"retry-after": "30"}), j({}))
    t = Toll(opener=op)
    for kw in ({"pay_to": "0x12"}, {"type": "ws"}, {"limit": 0}, {"offset": -1}, {"query": "a", "offset": 5}, {"operator": "has space"}):
        with pytest.raises(TollError):
            t.find_paid_apis(**kw)
    assert op.requests == []
    with pytest.raises(TollError) as e:
        t.find_paid_apis()
    assert e.value.status == 429 and e.value.retry_after_s == 30
    with pytest.raises(TollError):
        t.find_paid_apis()


def test_screen_of():
    settled = {"success": True, "transaction": "0x" + "ab" * 32, "network": "eip155:4663",
               "extensions": {"erc8478": {"outcome": "verified"}, "receipt": None, "screen": {"outcome": "warn", "codes": ["unverified_payee"]}}}
    assert screen_of(settled) == {"outcome": "warn", "codes": ["unverified_payee"]}
    assert screen_of({"isValid": True, "extensions": {"screen": {"outcome": "not-read"}}}) == {"outcome": "not-read", "codes": []}
    assert screen_of({"extensions": {"screen": {"outcome": "block", "codes": ["x", 1]}}}) == {"outcome": "block", "codes": ["x"]}
    assert screen_of({"extensions": {"screen": {"outcome": "maybe"}}}) is None
    assert screen_of(json.loads("null")) is None
