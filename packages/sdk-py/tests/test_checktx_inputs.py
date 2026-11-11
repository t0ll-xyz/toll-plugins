"""0.7.1 (audit 2026-11-11, PUB-2): every kind of request the live check_tx reads can be sent from Python.

The server reads an EIP-7702 authorization list, a message to sign (personal_sign / eth_sign, Sign-In with Ethereum),
the wallet request as sent ({method, params}), an ERC-4337 user operation and an intent. check_tx() had no argument for
any of them and refused a request that carried none of to / typed_data / x402, so an agent checking through the SDK got
a narrower check than one calling the MCP tool. The arguments are sent under the live tool's own names."""
import json

import pytest

from toll_sdk import Toll, TollError

A = "0x" + "1" * 40
B = "0x" + "2" * 40
OK = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": json.dumps({"action": "ALLOW", "warnings": []})}]}})


class _Resp:
    def read(self):
        return OK.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Opener:
    def __init__(self):
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append(req)
        return _Resp()


def _sent(**kw):
    op = _Opener()
    Toll(opener=op).check_tx(**kw)
    assert len(op.requests) == 1
    body = json.loads(op.requests[0].data)
    assert body["params"]["name"] == "check_tx"
    return body["params"]["arguments"]


def test_a_type4_transaction_keeps_its_authorization_list():
    lst = [{"chainId": 4663, "address": B, "nonce": 0, "yParity": 0, "r": "0x1", "s": "0x2"}]
    assert _sent(from_=A, to=B, data="0x", authorization_list=lst) == {"from": A, "to": B, "data": "0x", "authorizationList": lst}


def test_a_sign_authorization_alone_is_a_request():
    lst = [{"chainId": 4663, "address": B, "nonce": 7}]
    assert _sent(from_=A, authorization_list=lst) == {"from": A, "authorizationList": lst}


def test_a_message_to_sign_with_the_site_asking():
    msg = {"kind": "personal_sign", "data": "example.com wants you to sign in with your Ethereum account"}
    assert _sent(from_=A, message=msg, origin="https://example.com") == {"from": A, "message": msg, "origin": "https://example.com"}


def test_the_wallet_request_as_sent():
    rpc = {"method": "eth_sign", "params": [A, "0x" + "ab" * 32]}
    assert _sent(rpc=rpc) == {"rpc": rpc}


def test_a_user_operation_with_its_entry_point():
    op = {"sender": A, "nonce": "0x0", "callData": "0x", "signature": "0x"}
    assert _sent(user_op=op, entry_point=B) == {"userOp": op, "entryPoint": B}


def test_an_intent_rides_along_with_a_transaction():
    intent = {"action": "swap", "recipient": A}
    assert _sent(from_=A, to=B, data="0x12", intent=intent) == {"from": A, "to": B, "data": "0x12", "intent": intent}


@pytest.mark.parametrize("kw", [{}, {"from_": A}, {"authorization_list": []}, {"origin": "https://x.example"}, {"entry_point": B}])
def test_nothing_to_check_is_still_refused_before_any_request(kw):
    op = _Opener()
    with pytest.raises(TollError):
        Toll(opener=op).check_tx(**kw)
    assert op.requests == []
