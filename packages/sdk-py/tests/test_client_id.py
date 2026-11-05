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


def test_valid_file_written_between_read_and_write_wins(tmp_path, monkeypatch):
    import toll_sdk

    winner = "winner-written-by-a-racer-0123"
    real_makedirs = toll_sdk.os.makedirs

    def racing_makedirs(path, **kw):
        real_makedirs(path, **kw)
        (tmp_path / ".toll" / "client-id").write_text(winner + "\n")  # the other process wins here

    monkeypatch.setattr(toll_sdk.os, "makedirs", racing_makedirs)
    assert resolve_client_id(None, home=str(tmp_path)) == winner
    assert (tmp_path / ".toll" / "client-id").read_text().strip() == winner


def test_two_resolvers_racing_on_a_junk_file_end_with_same_id(tmp_path, monkeypatch):
    import toll_sdk

    (tmp_path / ".toll").mkdir()
    path = tmp_path / ".toll" / "client-id"
    path.write_text("")  # empty/junk
    monkeypatch.setattr(toll_sdk.time, "sleep", lambda s: None)
    out = {}
    calls = {"n": 0}
    real_open = open

    def racing_open(file, *a, **kw):
        if str(file) == str(path) and (not a or a[0] == "r"):
            calls["n"] += 1
            if calls["n"] == 3 and "b" not in out:
                out["b"] = resolve_client_id(None, home=str(tmp_path))  # B runs during A's retries
        return real_open(file, *a, **kw)

    monkeypatch.setattr("builtins.open", racing_open)
    a = resolve_client_id(None, home=str(tmp_path))
    assert ID_RE.match(a) and a == out["b"]
    assert path.read_text().strip() == a
    assert [p.name for p in (tmp_path / ".toll").iterdir()] == ["client-id"]


def test_empty_file_filled_during_retries_is_used(tmp_path, monkeypatch):
    import toll_sdk

    (tmp_path / ".toll").mkdir()
    path = tmp_path / ".toll" / "client-id"
    path.write_text("")
    winner = "winner-written-by-a-racer-0123"
    monkeypatch.setattr(toll_sdk.time, "sleep", lambda s: path.write_text(winner + "\n"))
    assert resolve_client_id(None, home=str(tmp_path)) == winner
