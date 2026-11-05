import json
import re

from toll_sdk import Toll
from toll_sdk import resolve_client_id

from test_toll import FakeOpener

ID_RE = re.compile(r"^[A-Za-z0-9_-]{22,64}$")
OK = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "ok"}]}})


def header(opener, name="X-toll-client"):
    return opener.requests[0][0].get_header(name)


def test_same_id_across_two_clients_file_persisted(tmp_path):
    a = resolve_client_id(None, home=str(tmp_path))
    b = resolve_client_id(None, home=str(tmp_path))
    assert ID_RE.match(a) and a == b
    assert (tmp_path / ".toll" / "client-id").read_text().strip() == a


def test_explicit_client_id_wins_and_is_sent():
    op = FakeOpener(OK)
    mine = "my-install-id-0123456789ab"
    Toll(opener=op, client_id=mine).chain_pulse()
    assert header(op) == mine


def test_invalid_explicit_id_ignored(tmp_path):
    got = resolve_client_id("bad id!", home=str(tmp_path))
    assert ID_RE.match(got) and got != "bad id!"


def test_no_filesystem_random_still_sent(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    got = resolve_client_id(None, home=str(blocker / "sub"))  # cannot create dir under a file
    assert ID_RE.match(got)
    op = FakeOpener(OK)
    Toll(opener=op).chain_pulse()
    assert ID_RE.match(header(op))


def test_default_client_sends_header():
    op = FakeOpener(OK)
    Toll(opener=op).chain_pulse()
    assert ID_RE.match(header(op))
