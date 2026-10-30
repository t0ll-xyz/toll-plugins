// One live call to Toll's free pre-sign check with a harmless request (a 0-value transfer to the dead address).
// Run after `npm run build`: node scripts/smoke.mjs. Do not loop it: the free route is rate limited per IP.
import { checkTx } from "../dist/index.js";

const a = await checkTx({ chainId: 4663, to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 0n });
console.log(JSON.stringify(a, null, 2));
