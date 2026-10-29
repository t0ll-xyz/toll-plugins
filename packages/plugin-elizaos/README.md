# @tollxyz/plugin-elizaos

An [elizaOS](https://docs.elizaos.ai) plugin for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Actions: `TOLL_CHECK_COIN`, `TOLL_LARP_CHECK` (Robinhood Chain and Solana; for a message that names BSC it says so and sends nothing), `TOLL_DEV_RECORD` (a deployer wallet). Each one runs when the message holds an address, and answers with Toll's text. A provider adds a one-line hint to the context only when a message contains a token address.

## Install

```sh
npm install @tollxyz/plugin-elizaos
```

`@elizaos/core` (^1.6.0) is a peer dependency. ESM only, Node >= 20.19. Built and typed against `@elizaos/core` 1.7.2. Type-check with `"moduleResolution": "bundler"` (as elizaOS projects do): under `nodenext`, `@elizaos/core` 1.7.2's own type files resolve to nothing and `Character`/`Project` show as missing.

## Example

A character names its plugins by package:

```ts
import type { Character } from "@elizaos/core";

export const character: Character = {
  name: "Trader",
  bio: "Checks who is behind a coin before it trades.",
  plugins: ["@tollxyz/plugin-elizaos"],
};
```

In a project, hand the plugin object to the agent instead:

```ts
import type { Project, ProjectAgent } from "@elizaos/core";
import { tollPlugin } from "@tollxyz/plugin-elizaos";

const agent: ProjectAgent = {
  character: { name: "Trader", bio: "Checks who is behind a coin before it trades." },
  plugins: [tollPlugin],
};
const project: Project = { agents: [agent] };
export default project;
```

With your own client (for example a custom `fetch`): `createTollPlugin({ client: new Toll({ fetch }) })`. `Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base). Holding $TOLL does not lift this limit. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
