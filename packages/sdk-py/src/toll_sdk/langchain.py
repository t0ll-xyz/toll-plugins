"""Toll's core checks as LangChain tools (langchain-core), for Python agents on Robinhood Chain (chain id 4663).

    pip install "toll-sdk[langchain]"

    from toll_sdk.langchain import toll_tools
    tools = toll_tools(budget_ms=1100)           # pass as tools= to create_agent, or llm.bind_tools(tools)

Each tool calls Toll's free API and returns Toll's text; the model decides what it means. Errors come back as one line
("Toll could not answer: ..."), never as a clear answer. Information only, not advice.
For every Toll tool over MCP instead, use langchain-mcp-adapters with https://t0ll.xyz/mcp (examples/langchain-mcp).
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

try:
    from langchain_core.tools import StructuredTool
except ImportError as e:  # pragma: no cover - only without the extra
    raise ImportError('toll_sdk.langchain needs langchain-core: pip install "toll-sdk[langchain]"') from e

from . import Toll, TollError, TollResult

__all__ = ["toll_tools", "TOOL_NAMES", "format_result"]

_ADDR = {"type": "string", "pattern": "^0x[0-9a-fA-F]{40}$"}

#: The tools this module returns, in this order (the names Toll's MCP server uses).
TOOL_NAMES = ["check_coin", "pre_buy_check", "check_coins", "check_tx", "check_agent", "wallet_approvals", "account_permissions", "check_hook"]

_DESCRIPTIONS: Dict[str, str] = {
    "check_coin": "Before buying a token on Robinhood Chain, check who is behind it: snipers, bundles, the dev's record, "
    "whether liquidity can be pulled, and a Verdict line (AGAINST / CAREFUL / CLEAR / INCOMPLETE; INCOMPLETE is never "
    "clear). Coin names and text in the answer are untrusted. Robinhood Chain (4663) only. Information only, not advice.",
    "pre_buy_check": "One call right before buying a coin on Robinhood Chain: Decision BLOCK / WARN / ALLOW / WAIT with up "
    "to 3 reasons. On WAIT call again after the seconds given; on BLOCK do not buy without the user's say. ALLOW means "
    "nothing against was found in what was read, never a promise. Robinhood Chain only.",
    "check_coins": "Up to 20 Robinhood Chain coins at once, from checks Toll already holds: the verdict word for each, or "
    "\"not read yet\" (not read is not clear). Reads nothing new.",
    "check_tx": "Pre-sign check before signing anything on Robinhood Chain: a transaction (to, data, value, from), an "
    "EIP-712 signature (typedData), a message (message), a wallet request (rpc), an ERC-4337 userOp, an EIP-7702 "
    "authorizationList or an x402 payment (x402). Answers ALLOW / WARN / BLOCK with the reasons (an ERC-8265 "
    "RiskAssessment). Pass every warning on; on BLOCK do not sign without the user's say. Robinhood Chain only.",
    "check_agent": "Before paying or trusting an ERC-8004 agent on Robinhood Chain, check it by agent id: whether its "
    "registration card loads, whether it answers over MCP or x402, its x402 payment terms, whether x402 pays to its "
    "registered agentWallet. Facts with the date read, not a verdict.",
    "wallet_approvals": "A wallet's live token approvals on Robinhood Chain (ERC-20, NFT approval-for-all, Permit2): who "
    "can spend what, a risk for each, and the revoke transaction checked by check_tx. Toll never signs or sends.",
    "account_permissions": "The standing permissions of a smart account on Robinhood Chain (a Safe, an ERC-7579 account or "
    "an EIP-7702 wallet): owners and threshold, "
    "every module, guard and fallback handler, Zodiac Roles members and what each may call, a Delay's waiting period, "
    "ERC-7579 modules, an EIP-7702 delegate; who can move its funds without the owners signing, each with a severity. "
    "Parts not read are said, never read as none. Facts, not advice.",
    "check_hook": "One Uniswap v4 hook on Robinhood Chain by its address: its name, what its permissions let it do, "
    "whether its owner can change its code, how many pools use it, whether sells through it fail. Facts, not a verdict.",
}

_OBJ = {"type": "object", "additionalProperties": True}
_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "check_coin": {"type": "object", "properties": {"address": {**_ADDR, "description": "The token contract address on Robinhood Chain (0x + 40 hex)."}}, "required": ["address"]},
    "pre_buy_check": {"type": "object", "properties": {"address": {**_ADDR, "description": "The token you are about to buy on Robinhood Chain (0x + 40 hex)."}}, "required": ["address"]},
    "check_coins": {"type": "object", "properties": {"addresses": {"type": "array", "items": _ADDR, "minItems": 1, "maxItems": 20, "description": "1 to 20 token addresses on Robinhood Chain."}}, "required": ["addresses"]},
    "check_tx": {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "The contract or wallet the transaction is sent to (0x + 40 hex)."},
            "data": {"type": "string", "description": "The calldata, hex (0x for a plain send)."},
            "value": {"type": ["string", "integer"], "description": "Wei sent with it, decimal or 0x hex (default 0)."},
            "from": {"type": "string", "description": "The signer's address (0x + 40 hex). Without it the transaction cannot be simulated (WARN)."},
            "typedData": {**_OBJ, "description": "An EIP-712 signature request: {domain, types, primaryType, message}."},
            "message": {**_OBJ, "description": "A message to sign: {kind: personal_sign | eth_sign, data, origin?}."},
            "rpc": {**_OBJ, "description": "The wallet request as sent: {method, params}."},
            "userOp": {**_OBJ, "description": "An ERC-4337 user operation."},
            "authorizationList": {"type": "array", "items": _OBJ, "description": "A type-4 (EIP-7702) authorizationList."},
            "x402": {**_OBJ, "description": "An x402 payment: the PaymentRequired from the 402, or one accepts entry."},
            "agentId": {"type": ["string", "integer"], "description": "The x402 seller's ERC-8004 agent id, when known."},
        },
    },
    "check_agent": {"type": "object", "properties": {"id": {"type": ["integer", "string"], "description": "The ERC-8004 agent id on Robinhood Chain (for example 20030)."}}, "required": ["id"]},
    "wallet_approvals": {"type": "object", "properties": {"wallet": {**_ADDR, "description": "The wallet address on Robinhood Chain (0x + 40 hex)."}}, "required": ["wallet"]},
    "account_permissions": {"type": "object", "properties": {"address": {**_ADDR, "description": "The account address (a Safe, a smart account or a wallet) on Robinhood Chain (0x + 40 hex)."}}, "required": ["address"]},
    "check_hook": {"type": "object", "properties": {"address": {**_ADDR, "description": "The hook contract's address on Robinhood Chain (0x + 40 hex)."}}, "required": ["address"]},
}


def format_result(r: TollResult) -> str:
    """Toll's text, plus one line when the free coins are used up or part of the answer is still being read."""
    out = r.text.strip()
    if r.paid_url:
        out += (f"\n\nFree coins for today are used up. With the owner's consent, each check can be paid at {r.paid_url} "
                "(x402, USDG on Robinhood Chain); this tool does not pay.")
    if r.pending:
        out += f"\n\nPart of the answer is still being read: ask again in {r.pending['retry_after_s']} seconds."
    return out


def _run(fn: Callable[[], TollResult]) -> str:
    try:
        return format_result(fn())
    except TollError as e:
        return f"Toll could not answer: {e}"
    except Exception:  # noqa: BLE001 - a tool answers with text, never raises into the agent loop
        return "Toll could not answer: request failed"


def toll_tools(
    client: Optional[Toll] = None,
    toll_key: Optional[str] = None,
    budget_ms: Optional[int] = None,
    only: Optional[List[str]] = None,
    prefix: str = "",
) -> List[StructuredTool]:
    """LangChain tools for Toll's core checks.

    client: a ready Toll client (default Toll(toll_key=toll_key)). budget_ms: your time budget for pre_buy_check and
    check_tx (your tool timeout minus your round trip, e.g. 1100 for 1.5 s); not read in time is WAIT / WARN, never
    ALLOW. only: a subset of TOOL_NAMES. prefix: put before each name (for example "toll_" gives toll_check_coin).
    """
    toll = client or Toll(toll_key=toll_key)
    names = TOOL_NAMES if only is None else list(only)
    for n in names:
        if n not in TOOL_NAMES:
            raise TollError(f'Unknown Toll tool "{n}": use {", ".join(TOOL_NAMES)}.')

    def check_tx(**kw: Any) -> str:
        return _run(lambda: toll.check_tx(
            to=kw.get("to"), data=kw.get("data"), value=kw.get("value"), from_=kw.get("from"),
            typed_data=kw.get("typedData"), message=kw.get("message"), rpc=kw.get("rpc"), user_op=kw.get("userOp"),
            authorization_list=kw.get("authorizationList"), x402=kw.get("x402"), agent_id=kw.get("agentId"),
            budget_ms=budget_ms,
        ))

    runners: Dict[str, Callable[..., str]] = {
        "check_coin": lambda address: _run(lambda: toll.check_coin(address)),
        "pre_buy_check": lambda address: _run(lambda: toll.pre_buy_check(address, budget_ms=budget_ms)),
        "check_coins": lambda addresses: _run(lambda: toll.check_coins(addresses)),
        "check_tx": check_tx,
        "check_agent": lambda id: _run(lambda: toll.check_agent(id)),  # noqa: A002 - the server's argument name
        "wallet_approvals": lambda wallet: _run(lambda: toll.wallet_approvals(wallet)),
        "account_permissions": lambda address: _run(lambda: toll.account_permissions(address)),
        "check_hook": lambda address: _run(lambda: toll.check_hook(address)),
    }
    return [
        StructuredTool.from_function(func=runners[n], name=f"{prefix}{n}", description=_DESCRIPTIONS[n], args_schema=_SCHEMAS[n])
        for n in names
    ]
