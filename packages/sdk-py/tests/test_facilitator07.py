import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from toll_sdk import (
    BUDGET_DOMAIN,
    RECEIPT_DOMAIN,
    TOLL_FACILITATOR,
    Toll,
    TollError,
    budget_typed_data,
    receipt_typed_data,
    revoke_typed_data,
    toll_offer_receipt_of,
)
from test_rest import Opener, j

FX = Path(__file__).parent / "fixtures"
PAYER = "0x1111111111111111111111111111111111111111"
PAYTO = "0x3954ff905bdb481ad5814d5be3cc32c3166122ac"
OTHER = "0x2222222222222222222222222222222222222222"
SIG = "0x" + "ab" * 65
TX = "0x" + "cd" * 32

# the facilitator's own definitions (lib/fac/budget.ts, lib/fac/offerreceipt.ts), copied: the SDK must hash the same
FAC_BUDGET_TYPES = {
    "Budget": [
        {"name": "payer", "type": "address"}, {"name": "perPayment", "type": "uint256"}, {"name": "perDay", "type": "uint256"},
        {"name": "perPayTo", "type": "uint256"}, {"name": "payToCaps", "type": "PayToCap[]"}, {"name": "allowedPayTos", "type": "address[]"},
        {"name": "validUntil", "type": "uint64"}, {"name": "nonce", "type": "uint256"},
    ],
    "PayToCap": [{"name": "payTo", "type": "address"}, {"name": "perDay", "type": "uint256"}],
}
FAC_RECEIPT_TYPES = {
    "Receipt": [
        {"name": "version", "type": "uint256"}, {"name": "network", "type": "string"}, {"name": "resourceUrl", "type": "string"},
        {"name": "payer", "type": "string"}, {"name": "issuedAt", "type": "uint256"}, {"name": "transaction", "type": "string"},
    ],
}
DOMAIN_TYPE = [{"name": "name", "type": "string"}, {"name": "version", "type": "string"}, {"name": "chainId", "type": "uint256"}]


def fx(name: str) -> str:
    return (FX / f"{name}.json").read_text(encoding="utf-8")


def qs(url: str):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


# -- paid_before --------------------------------------------------------------
def test_paid_before_reads_paid_on_the_facilitator():
    op = Opener((fx("paid"), 200, {}))
    r = Toll(opener=op, client_id="c" * 22).paid_before(PAYER.replace("0x11", "0x1A"), PAYTO.upper().replace("0X", "0x"))
    req = op.requests[0]
    assert req.full_url.split("?")[0] == f"{TOLL_FACILITATOR}/paid" and req.get_method() == "GET"
    assert qs(req.full_url) == {"payer": PAYER.replace("0x11", "0x1a"), "payTo": PAYTO}
    assert req.get_header("X-toll-client") == "c" * 22
    assert r["paid"] is True and r["count"] == 2 and r["last"]["via"] == "settlement"
    assert r["sources"] == {"settlements": 2, "escrow": 0, "batch": "not-read"}


def test_paid_before_resource_and_since():
    op = Opener((fx("paid"), 200, {}), (fx("paid"), 200, {}))
    t = Toll(opener=op)
    t.paid_before(PAYER, PAYTO, resource="https://api.example/quote?x=1", since=1_794_000_000)
    assert qs(op.requests[0].full_url) == {"payer": PAYER, "payTo": PAYTO, "resource": "https://api.example/quote?x=1", "since": "1794000000"}
    t.paid_before(PAYER, PAYTO, since=datetime.fromtimestamp(1_794_000_000, tz=timezone.utc))
    assert qs(op.requests[1].full_url)["since"] == "1794000000"


def test_paid_before_errors():
    none = {"paid": False, "count": 0, "last": None, "network": "eip155:4663", "sources": {"settlements": 0, "escrow": "not-read", "batch": "not-applicable"}}
    op = Opener(j(none), j({"error": "The settlement record could not be read right now."}, 503))
    t = Toll(opener=op, facilitator_url="https://fac.example/")
    assert t.paid_before(PAYER, PAYTO) == none
    assert op.requests[0].full_url.startswith("https://fac.example/paid?")
    for bad in [dict(payer="0x12", pay_to=PAYTO), dict(payer=PAYER, pay_to="x"), dict(payer=PAYER, pay_to=PAYTO, resource="ftp://x"),
                dict(payer=PAYER, pay_to=PAYTO, since=1.5), dict(payer=PAYER, pay_to=PAYTO, since=1_794_000_000_000)]:
        with pytest.raises(TollError):
            t.paid_before(**bad)
    assert len(op.requests) == 1
    with pytest.raises(TollError) as e:
        t.paid_before(PAYER, PAYTO)
    assert e.value.status == 503 and "could not be read" in str(e.value)


# -- budgets --------------------------------------------------------------------
BUDGET = {"payer": PAYER, "perPayment": 100_000, "perDay": "1000000", "payToCaps": [{"payTo": PAYTO, "perDay": 250_000}, {"payTo": OTHER, "perDay": "0"}],
          "allowedPayTos": [PAYTO, OTHER], "nonce": 1_794_312_000_000}


def test_budget_typed_data_matches_the_facilitator():
    td = budget_typed_data(BUDGET)
    assert td["domain"] == {"name": "Toll Facilitator Budget", "version": "1", "chainId": 4663} == BUDGET_DOMAIN
    assert "verifyingContract" not in td["domain"]
    assert td["types"] == {"EIP712Domain": DOMAIN_TYPE, **FAC_BUDGET_TYPES}
    assert td["primaryType"] == "Budget"
    assert td["message"] == {"payer": PAYER, "perPayment": 100_000, "perDay": 1_000_000, "perPayTo": 0,
                             "payToCaps": [{"payTo": PAYTO, "perDay": 250_000}, {"payTo": OTHER, "perDay": 0}],
                             "allowedPayTos": [PAYTO, OTHER], "validUntil": 0, "nonce": 1_794_312_000_000}
    # snake_case keys work too
    snake = {"payer": PAYER, "per_payment": 1, "per_day": 2, "pay_to_caps": [{"pay_to": PAYTO, "per_day": 3}], "valid_until": 9, "nonce": 4}
    assert budget_typed_data(snake)["message"]["payToCaps"] == [{"payTo": PAYTO, "perDay": 3}]
    json.dumps(td)  # plain JSON (ints), ready for eth_signTypedData_v4


def test_budget_typed_data_refuses_bad_input():
    for bad in [{**BUDGET, "payer": "0x12"}, {**BUDGET, "perDay": -1}, {**BUDGET, "perDay": 1.5}, {**BUDGET, "perDay": True},
                {**BUDGET, "validUntil": 1 << 64}, {k: v for k, v in BUDGET.items() if k != "nonce"},
                {**BUDGET, "payToCaps": [{"payTo": PAYTO, "perDay": 1}, {"payTo": PAYTO.upper().replace("0X", "0x"), "perDay": 2}]},
                {**BUDGET, "allowedPayTos": [PAYTO] * 51}, {**BUDGET, "allowedPayTos": ["x"]}]:
        with pytest.raises(TollError):
            budget_typed_data(bad)
    r = revoke_typed_data(PAYER, "7")
    assert r["message"] == {"payer": PAYER, "nonce": 7} and r["primaryType"] == "Revoke"
    assert r["types"]["Revoke"] == [{"name": "payer", "type": "address"}, {"name": "nonce", "type": "uint256"}]
    with pytest.raises(TollError):
        revoke_typed_data(PAYER, -1)


def test_budget_signature_recovers_with_eth_account():
    eth = pytest.importorskip("eth_account")
    from eth_account.messages import encode_typed_data

    acct = eth.Account.from_key("0x" + "42" * 32)
    td = budget_typed_data({**BUDGET, "payer": acct.address})
    sig = acct.sign_message(encode_typed_data(full_message=td)).signature.hex()
    assert eth.Account.recover_message(encode_typed_data(full_message=td), signature=sig) == acct.address
    # the same signature as @tollxyz/sdk's budgetTypedData signed by viem with this key (both hash the facilitator's types)
    td2 = budget_typed_data({"payer": PAYER, "perPayment": 100000, "perDay": 1000000, "payToCaps": [{"payTo": PAYTO, "perDay": 250000}],
                             "allowedPayTos": [OTHER], "nonce": 5})
    assert acct.sign_message(encode_typed_data(full_message=td2)).signature.hex().removeprefix("0x") == (
        "55bd30a77dfa93656da268faba906975e123f19256770ae375eeaff46d30cb145d2babecaecbcbb1f538c537a1cdc336fb8f77a8da29c0effebfe2fe75bccf261c")
    op = Opener(j({"ok": True, "payer": acct.address.lower(), "nonce": "1794312000000", "revoked": False}))
    Toll(opener=op).set_budget(td["message"], acct.sign_message(encode_typed_data(full_message=td)).signature)  # bytes accepted
    assert op.body(0)["signature"] == "0x" + sig.removeprefix("0x")


def test_receipt_signature_matches_the_js_sdk():
    eth = pytest.importorskip("eth_account")
    from eth_account.messages import encode_typed_data

    acct = eth.Account.from_key("0x" + "42" * 32)
    td = receipt_typed_data({**PAYLOAD, "transaction": ""})
    assert acct.sign_message(encode_typed_data(full_message=td)).signature.hex().removeprefix("0x") == (
        "c58b81c7ccad27e090b230c53c7a4c30574c768e432f9d9961b88a2b100cd1bb29ad021c7795092b580b00433eb78e43da4a0941ee59e994af690222f631dfac1b")


def test_set_budget_posts_the_body():
    op = Opener(j({"ok": True, "payer": PAYER, "nonce": "1794312000000", "revoked": False}))
    r = Toll(opener=op).set_budget(BUDGET, SIG)
    req = op.requests[0]
    assert req.full_url == f"{TOLL_FACILITATOR}/budget" and req.get_method() == "POST"
    assert req.get_header("Content-type") == "application/json"
    assert op.body(0) == {"budget": {"payer": PAYER, "perPayment": "100000", "perDay": "1000000", "perPayTo": "0",
                                     "payToCaps": [{"payTo": PAYTO, "perDay": "250000"}, {"payTo": OTHER, "perDay": "0"}],
                                     "allowedPayTos": [PAYTO, OTHER], "validUntil": "0", "nonce": "1794312000000"}, "signature": SIG}
    assert r["ok"] is True


def test_set_budget_takes_the_typed_message():
    op = Opener(j({"ok": True, "payer": PAYER, "nonce": "1794312000000", "revoked": False}))
    Toll(opener=op).set_budget(budget_typed_data(BUDGET)["message"], SIG)
    assert op.body(0)["budget"]["payToCaps"][0] == {"payTo": PAYTO, "perDay": "250000"}


def test_revoke_and_get_budget():
    op = Opener(j({"ok": True, "payer": PAYER, "nonce": "8", "revoked": True}), (fx("budget_get"), 200, {}))
    t = Toll(opener=op)
    assert t.revoke_budget(PAYER, 8, SIG)["revoked"] is True
    assert op.body(0) == {"revoke": {"payer": PAYER, "nonce": "8"}, "signature": SIG}
    g = t.get_budget(PAYER.upper().replace("0X", "0x"))
    assert op.requests[1].full_url == f"{TOLL_FACILITATOR}/budget?payer={PAYER}"
    assert g["budget"]["perDay"] == "1000000" and g["remainingToday"] == "850000"


def test_budget_errors():
    op = Opener(j({"error": "budgets_off", "message": "Per-payer budgets are not switched on here."}, 404),
                j({"error": "budget_nonce_stale", "message": "sign with a higher nonce"}, 409),
                j({"error": "invalid_budget_signature", "message": "not the payer's own"}, 403))
    t = Toll(opener=op)
    for f in [lambda: t.set_budget(BUDGET, "0x12"), lambda: t.set_budget({**BUDGET, "payer": "x"}, SIG),
              lambda: t.revoke_budget(PAYER, "x", SIG), lambda: t.get_budget("0x12")]:
        with pytest.raises(TollError):
            f()
    assert op.requests == []
    with pytest.raises(TollError) as e:
        t.get_budget(PAYER)
    assert e.value.status == 404 and "budgets_off" in str(e.value) and "not switched on" in str(e.value)
    with pytest.raises(TollError) as e:
        t.set_budget(BUDGET, SIG)
    assert e.value.status == 409 and "budget_nonce_stale" in str(e.value)
    with pytest.raises(TollError) as e:
        t.revoke_budget(PAYER, 1, SIG)
    assert e.value.status == 403


# -- offer-receipt --------------------------------------------------------------
PAYLOAD = {"version": 1, "network": "eip155:4663", "resourceUrl": "https://s.example/a", "payer": PAYER, "issuedAt": 1_800_000_100, "transaction": TX}


def test_toll_offer_receipt_of():
    settled = {"success": True, "transaction": TX, "network": "eip155:4663", "payer": PAYER,
               "extensions": {"toll-offer-receipt": {"offer": {"read": "none"}, "receiptPayload": PAYLOAD}}}
    assert toll_offer_receipt_of(settled) == {"offer": {"read": "none"}, "receiptPayload": PAYLOAD}
    assert toll_offer_receipt_of({"extensions": {"toll-offer-receipt": {"offer": {"read": "invalid"}, "receiptPayload": None}}})["receiptPayload"] is None
    assert toll_offer_receipt_of({"extensions": {"toll-offer-receipt": {"offer": {"read": "none"}, "receiptPayload": {**PAYLOAD, "issuedAt": "x"}}}})["receiptPayload"] is None
    assert toll_offer_receipt_of({"extensions": {}}) is None
    assert toll_offer_receipt_of(None) is None


def test_receipt_typed_data():
    td = receipt_typed_data(PAYLOAD)
    assert td["domain"] == {"name": "x402 receipt", "version": "1", "chainId": 1} == RECEIPT_DOMAIN
    assert td["types"] == {"EIP712Domain": DOMAIN_TYPE, **FAC_RECEIPT_TYPES}
    assert td["primaryType"] == "Receipt" and td["message"] == PAYLOAD
    assert receipt_typed_data({k: v for k, v in PAYLOAD.items() if k != "transaction"})["message"]["transaction"] == ""
    with pytest.raises(TollError):
        receipt_typed_data({**PAYLOAD, "issuedAt": -1})
    with pytest.raises(TollError):
        receipt_typed_data({**PAYLOAD, "payer": 1})
