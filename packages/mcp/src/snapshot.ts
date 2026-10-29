// Snapshot of https://t0ll.xyz/mcp tools/list (read 2026-10-29). Used only when Toll cannot be reached for the live list.
// Regenerate: npm run snapshot -w @tollxyz/mcp
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const SNAPSHOT_TOOLS: Tool[] = [
  {
    "name": "check_coin",
    "title": "Check a coin",
    "description": "Check one token on Robinhood Chain, Arc, BSC or Solana from the chain itself: who is behind it and how it launched. On Robinhood Chain: where and when it launched, the maker (dev) and its launch record, snipers in the first 3 seconds, wallets the launch made exempt from tax (bundles), flagged wallets, what the maker holds and sold, burned supply, the curve or pool. On Arc, BSC: the launch, the dev's record, the first buyers, wallets that moved together, who holds the liquidity and whether it can be pulled, and the market. On BSC (four.meme and flap.sh coins): also how far along its curve it is and the tax the token declares. On Solana (pump.fun coins): mint and freeze authority, metadata, Token-2022 extensions, the creation slot and first 3 seconds, the dev's launch buy and whether it sold, its other pump.fun coins, the curve or graduation, the top holders and who first funded them. Toll's findings are tallied as against / careful / clear. The answer's first line names the chain. Reads Robinhood Chain (4663), Arc (5042), BSC (56) and Solana.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "address": {
          "type": "string",
          "pattern": "^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$",
          "description": "The token contract address (a Solana mint address works too): 0x followed by 40 hex characters, or a Solana mint address (base58, case-sensitive)"
        },
        "chain": {
          "type": "string",
          "enum": [
            "rh",
            "arc",
            "bsc",
            "sol"
          ],
          "description": "Which chain: rh = Robinhood Chain (4663), arc = Arc (5042), bsc = BSC (56), sol = Solana. Leave it out and Toll finds which chain the token is on."
        }
      },
      "required": [
        "address"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Check a coin",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    }
  },
  {
    "name": "larp_check",
    "title": "LARP check",
    "description": "LARP check: is there a real product behind a coin on Robinhood Chain or Solana? Toll reads the coin's own site, launch post and code README, lists each thing it says it offers, and checks every claim against the chain and against its working parts that Toll tries itself (app page, API, MCP server, x402 payments, Chrome extension, Telegram bot, public code). Answers the label (product found / partly found / not found / not read: what we could check, never a verdict), each claim with found / partly / not found and the line that shows it, and the working parts that answered. A coin nobody asked about yet is queued and read within minutes: the answer says how many seconds to wait before calling again. Free: 10 new coins a day per caller, coins already read are always free.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$",
          "description": "The coin: its token contract on Robinhood Chain, or its Solana mint: 0x followed by 40 hex characters, or a Solana mint address (base58, case-sensitive)"
        },
        "chain": {
          "type": "string",
          "enum": [
            "rh",
            "sol"
          ],
          "description": "Which chain: rh = Robinhood Chain, sol = Solana. Leave it out and Toll tells them apart by the address (0x is Robinhood Chain, base58 is Solana)."
        }
      },
      "required": [
        "token"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "LARP check",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    }
  },
  {
    "name": "dev_record",
    "title": "Deployer record",
    "description": "Every coin one wallet launched on Robinhood Chain, Arc or BSC. On Robinhood Chain (Pons and Long launchpads): how many, how many graduated from the bonding curve, whether the dev sold, and the latest launches with how each ended. On Arc, BSC: how many it launched through the launchpads we know and which of them it still holds. Reads Robinhood Chain unless chain names another.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "wallet": {
          "type": "string",
          "pattern": "^0x[0-9a-fA-F]{40}$",
          "description": "The deployer (dev) wallet address: 0x followed by 40 hex characters"
        },
        "chain": {
          "type": "string",
          "enum": [
            "rh",
            "arc",
            "bsc"
          ],
          "description": "Which chain: rh = Robinhood Chain (4663), arc = Arc (5042), bsc = BSC (56). Leave it out for Robinhood Chain."
        }
      },
      "required": [
        "wallet"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Deployer record",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    }
  },
  {
    "name": "wallet_privacy",
    "title": "Wallet privacy check",
    "description": "What anyone can learn about a wallet from Robinhood Chain alone: a privacy grade (A to F), a score out of 100, and each leak found (who funded it, linked wallets, holdings, active hours, launches, trading record, linked accounts) with tips. The grade measures what anyone can see, not whether the wallet is good or bad. Robinhood Chain only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "wallet": {
          "type": "string",
          "pattern": "^0x[0-9a-fA-F]{40}$",
          "description": "The wallet address on Robinhood Chain: 0x followed by 40 hex characters"
        }
      },
      "required": [
        "wallet"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Wallet privacy check",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    }
  },
  {
    "name": "fresh_launches",
    "title": "Newest coins",
    "description": "The newest coins launched on Robinhood Chain, newest first, from Toll's live engine: launchpad, age, pair, and the engine's short notes on each (dev record, first buyers, buyers, curve), with a link to the full check. At most 20. Robinhood Chain only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "description": "How many coins, 1 to 20 (default 10)"
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Newest coins",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    }
  },
  {
    "name": "chain_pulse",
    "title": "Chain pulse",
    "description": "How busy Robinhood Chain is right now, as Toll's live engine counts it: launches in the last 5 minutes and hour, graduations, launches by launchpad, new pools, trades a minute and volume. Robinhood Chain only.",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {}
    },
    "annotations": {
      "title": "Chain pulse",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    }
  },
  {
    "name": "launch_record",
    "title": "Call at launch",
    "description": "The call Toll made a few minutes after a Robinhood Chain coin launched, frozen and never edited: against / careful / clear (or launch facts only), the findings tallied, why, the dev's and funder's other coins of the week, and how it ended 24 hours later. Not the coin now: use check_coin for that. Robinhood Chain only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "address": {
          "type": "string",
          "pattern": "^0x[0-9a-fA-F]{40}$",
          "description": "The token contract address on Robinhood Chain: 0x followed by 40 hex characters"
        }
      },
      "required": [
        "address"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Call at launch",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    }
  },
  {
    "name": "check_agent",
    "title": "Check an agent",
    "description": "One ERC-8004 agent registered on Robinhood Chain (identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432), by its agent id: whether its registration card loads and from which host, its class (real service / site only / card only / broken card), whether its MCP server answered an initialize call, whether its x402 endpoint answered 402 with payment terms and who it pays, whether that payTo is the registered agentWallet, whether the agent's wallet has sent a transaction, when it was last checked and what changed. Plain facts from Toll's agent census, with the date and the source they were read from (the live census, or the 2026-10-28 snapshot), never a verdict. Robinhood Chain only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000000000,
          "description": "The agent id: its ERC-8004 token id in the Robinhood Chain identity registry (for example 20030)"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "title": "Check an agent",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    }
  }
];
