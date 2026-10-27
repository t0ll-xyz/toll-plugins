// Compiled by `npm test` (tsconfig.readme.json): the README examples, as written there.
import type { Project, ProjectAgent } from "@elizaos/core";
import { tollPlugin } from "@tollxyz/plugin-elizaos";

const agent: ProjectAgent = {
  character: { name: "Trader", bio: "Checks who is behind a coin before it trades." },
  plugins: [tollPlugin],
};
const project: Project = { agents: [agent] };
export default project;
