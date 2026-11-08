/**
 * The wallet wrappers. Duck-typed: viem and ethers are optional peer dependencies, never imported at load time.
 * The wrapper is a Proxy: every other method and field of the client passes through unchanged.
 */
import { chainIdOf, isAddress, type CheckInput, type Hex, type TypedDataLike } from "./check.js";
import { enforce, enforceCalls, gateAuthorization, type GuardOptions } from "./policy.js";

type AnyFn = (...args: any[]) => any;
type Obj = Record<string | symbol, any>;

export interface ViemGuardOptions extends GuardOptions {
  /**
   * Encodes writeContract (and contract-call batch) calldata. Default: viem's own encodeFunctionData, loaded on first
   * use (viem is installed wherever a viem client is).
   */
  encodeFunctionData?: (args: { abi: unknown; functionName: string; args?: readonly unknown[] }) => Hex | string;
}

/** wraps an object's methods; everything else passes through, bound to the original */
function proxy<T extends object>(target: T, wrapped: Record<string, AnyFn>): T {
  return new Proxy(target, {
    get(t, p) {
      if (typeof p === "string" && Object.prototype.hasOwnProperty.call(wrapped, p)) return wrapped[p];
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** a transaction that carries an EIP-7702 authorizationList (any entry at all) */
const hasAuthorizations = (tx: Obj | null | undefined): boolean => {
  const l = tx?.authorizationList;
  return l !== undefined && l !== null && (!Array.isArray(l) || l.length > 0);
};

const addrOf = (account: unknown): string | undefined => {
  if (isAddress(account)) return account;
  const a = (account as { address?: unknown } | null | undefined)?.address;
  return isAddress(a) ? a : undefined;
};

/** a chain id as a number when it can be read, else as given (the check then calls it unreadable) */
const chainOut = (v: unknown): CheckInput["chainId"] => (v === undefined || v === null ? undefined : (chainIdOf(v) ?? (v as CheckInput["chainId"])));

const HEXDIGITS = "0123456789abcdef";
const bytesHex = (b: Uint8Array): string => {
  let s = "0x";
  for (const x of b) s += HEXDIGITS[x >> 4] + HEXDIGITS[x & 15];
  return s;
};
/** a text message as the bytes a wallet signs (UTF-8), hex */
const utf8Hex = (s: string): string => bytesHex(new TextEncoder().encode(s));

/** the request without its authorizationList (what is checked when onAuthorization "allow" let the list through) */
const withoutAuths = (i: CheckInput): CheckInput => {
  const { authorizationList: _drop, ...rest } = i;
  return rest;
};

/**
 * One transaction: when it carries an authorizationList, onAuthorization decides first ("check": one Toll check of the
 * whole transaction with its list, fail-closed; "block": refused; "allow": the list is let through and the rest is
 * checked as usual).
 */
async function gateTx(where: string, build: () => CheckInput | Promise<CheckInput>, auths: boolean, o: GuardOptions): Promise<void> {
  if (auths && (await gateAuthorization("transaction", where, build, o))) return;
  await enforce("transaction", async () => withoutAuths(await build()), o);
}

/* ------------------------------------------------------------------ viem */

let viemEncode: ViemGuardOptions["encodeFunctionData"] | null = null;
async function loadViemEncode(): Promise<NonNullable<ViemGuardOptions["encodeFunctionData"]>> {
  if (viemEncode) return viemEncode;
  const name = "viem";
  const m = (await import(name)) as { encodeFunctionData?: ViemGuardOptions["encodeFunctionData"] };
  if (typeof m.encodeFunctionData !== "function") throw new Error("viem's encodeFunctionData was not found");
  viemEncode = m.encodeFunctionData;
  return viemEncode;
}

/** a batch's calls as transactions: {to, data?, value?} or a contract call {to | address, abi, functionName, args} */
async function callsOf(calls: unknown, chainId: unknown, from: string | undefined, o: ViemGuardOptions): Promise<CheckInput[]> {
  if (!Array.isArray(calls)) throw new Error("calls must be an array");
  const out: CheckInput[] = [];
  for (const raw of calls) {
    const k = (raw ?? {}) as Obj;
    let data: string = typeof k.data === "string" ? k.data : "0x";
    if (k.abi !== undefined && typeof k.functionName === "string") {
      const enc = o.encodeFunctionData ?? (await loadViemEncode());
      data = String(enc({ abi: k.abi, functionName: k.functionName, args: k.args }));
      if (typeof k.dataSuffix === "string") data += k.dataSuffix.replace(/^0x/, "");
    }
    out.push({ chainId: chainOut(chainId), from, to: k.to ?? k.address ?? undefined, data, value: k.value ?? 0n });
  }
  return out;
}

/** a viem / EIP-7702 authorization request as Toll reads it: one entry, the signer, the chain */
function authInput(a: Obj, chainId: unknown, from: string | undefined): CheckInput {
  const address = a?.contractAddress ?? a?.address;
  const entry: Record<string, unknown> = { address, chainId: chainOut(a?.chainId ?? chainId) };
  if (a?.nonce !== undefined && a?.nonce !== null) entry.nonce = a.nonce;
  return { ...(chainId !== undefined && chainId !== null ? { chainId: chainOut(chainId) } : {}), from, authorizationList: [entry] };
}

/**
 * Wraps a viem WalletClient. Asks Toll first: sendTransaction, writeContract, signTransaction, signTypedData,
 * signMessage, sendCalls (EIP-5792, each call), signAuthorization, and request() for eth_sendTransaction,
 * eth_signTransaction, personal_sign, eth_sign, eth_signTypedData_v4 and wallet_sendCalls. An EIP-7702 authorization
 * goes to onAuthorization (default "check"). Wrap last: `client.extend(...)` on the wrapped client returns an unguarded
 * client, and the account's own sign methods (client.account.sign*) are not wrapped.
 */
export function guardViem<T extends object>(client: T, opts: ViemGuardOptions = {}): T {
  const c = client as Obj;
  const chainOf = (args: Obj) => (args?.chain === null ? undefined : (args?.chain?.id ?? c.chain?.id));
  const fromOf = (args: Obj) => addrOf(args?.account ?? c.account);
  const txInput = (args: Obj, data: string | undefined): CheckInput => ({
    chainId: chainOf(args),
    from: fromOf(args),
    to: args?.to ?? undefined,
    data: data ?? "0x",
    value: args?.value ?? 0n,
    ...(hasAuthorizations(args) ? { authorizationList: args.authorizationList } : {}),
  });
  const origin = opts.origin !== undefined ? { origin: opts.origin } : {};
  const wrapped: Record<string, AnyFn> = {};
  for (const m of ["sendTransaction", "signTransaction"] as const) {
    if (typeof c[m] !== "function") continue;
    wrapped[m] = async (args: Obj, ...rest: unknown[]) => {
      // a deployment (no `to`) goes to the unsupported policy
      await gateTx(m, () => txInput(args, args?.data), hasAuthorizations(args), opts);
      return c[m](args, ...rest);
    };
  }
  if (typeof c.writeContract === "function") {
    wrapped.writeContract = async (args: Obj, ...rest: unknown[]) => {
      await gateTx("writeContract", async () => {
        const enc = opts.encodeFunctionData ?? (await loadViemEncode());
        let data = String(enc({ abi: args.abi, functionName: args.functionName, args: args.args }));
        if (typeof args.dataSuffix === "string") data += args.dataSuffix.replace(/^0x/, "");
        return txInput({ ...args, to: args.address }, data);
      }, hasAuthorizations(args), opts);
      return c.writeContract(args, ...rest);
    };
  }
  if (typeof c.signTypedData === "function") {
    wrapped.signTypedData = async (args: Obj, ...rest: unknown[]) => {
      const td: TypedDataLike = { domain: args?.domain ?? {}, types: args?.types ?? {}, primaryType: args?.primaryType, message: args?.message ?? {} };
      // the signer (0.3.1): Toll reads what the signature lets someone take from it (a Permit2 message names no owner)
      const from = fromOf(args);
      await enforce("typedData", () => ({ typedData: td, ...(from ? { from } : {}), ...origin }), opts);
      return c.signTypedData(args, ...rest);
    };
  }
  if (typeof c.signMessage === "function") {
    wrapped.signMessage = async (args: Obj, ...rest: unknown[]) => {
      await enforce("message", () => {
        const m = args?.message;
        const raw = m && typeof m === "object" ? m.raw : undefined;
        const data = typeof m === "string" ? utf8Hex(m) : typeof raw === "string" ? raw : raw instanceof Uint8Array ? bytesHex(raw) : null;
        if (data === null) throw new Error("signMessage: message must be a string or {raw}");
        const from = fromOf(args);
        return { message: { kind: "personal_sign", data, ...(from ? { from } : {}) }, ...origin };
      }, opts);
      return c.signMessage(args, ...rest);
    };
  }
  if (typeof c.sendCalls === "function") {
    wrapped.sendCalls = async (args: Obj, ...rest: unknown[]) => {
      await enforceCalls(() => callsOf(args?.calls, chainOf(args), fromOf(args), opts), opts);
      return c.sendCalls(args, ...rest);
    };
  }
  if (typeof c.signAuthorization === "function") {
    wrapped.signAuthorization = async (args: Obj, ...rest: unknown[]) => {
      await gateAuthorization("transaction", "signAuthorization", () => authInput(args, c.chain?.id, fromOf(args)), opts);
      return c.signAuthorization(args, ...rest);
    };
  }
  if (typeof c.request === "function") {
    wrapped.request = async (args: Obj, ...rest: unknown[]) => {
      await checkRequest(args, c, fromOf({}), opts);
      return c.request(args, ...rest);
    };
  }
  return proxy(client, wrapped);
}

/** the wallet RPC methods that sign: each asks Toll first; every other method passes through unchecked */
async function checkRequest(args: Obj, c: Obj, from: string | undefined, o: ViemGuardOptions): Promise<void> {
  const method = args?.method;
  const params: unknown[] = Array.isArray(args?.params) ? args.params : [];
  const origin = o.origin !== undefined ? { origin: o.origin } : {};
  switch (method) {
    case "personal_sign":
    case "eth_sign":
      await enforce("message", () => ({ rpc: { method, params }, ...origin }), o);
      return;
    case "eth_signTypedData_v4":
      await enforce("typedData", () => ({ rpc: { method, params }, ...origin }), o);
      return;
    case "eth_sendTransaction":
    case "eth_signTransaction": {
      const tx = (params[0] ?? {}) as Obj;
      const build = (): CheckInput => ({
        chainId: chainOut(tx.chainId ?? c.chain?.id),
        from: isAddress(tx.from) ? tx.from : from,
        to: tx.to ?? undefined,
        data: typeof tx.data === "string" ? tx.data : typeof tx.input === "string" ? tx.input : "0x",
        value: tx.value ?? 0,
        ...(hasAuthorizations(tx) ? { authorizationList: tx.authorizationList } : {}),
      });
      await gateTx(method, build, hasAuthorizations(tx), o);
      return;
    }
    case "wallet_sendCalls": {
      const p = (params[0] ?? {}) as Obj;
      await enforceCalls(() => callsOf(p.calls, p.chainId ?? c.chain?.id, isAddress(p.from) ? p.from : from, o), o);
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ ERC-4337 smart accounts (viem account abstraction) */

/** the user-operation fields passed on to Toll as given (bigints become decimal strings) */
const USEROP_FIELDS = [
  "factory",
  "factoryData",
  "initCode",
  "paymaster",
  "paymasterData",
  "paymasterAndData",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "signature",
] as const;

/**
 * Wraps a viem bundler client (account abstraction): sendUserOperation and prepareUserOperation ask Toll first.
 * `calls` are checked one by one as transactions from the smart account's address; a ready `callData` is sent as a
 * user operation with the account's EntryPoint. An EIP-7702 `authorization` goes to onAuthorization.
 */
export function guardSmartAccount<T extends object>(client: T, opts: ViemGuardOptions = {}): T {
  const c = client as Obj;
  const check = async (where: string, args: Obj) => {
    const acct = args?.account ?? c.account;
    const sender = addrOf(acct);
    const chainId = args?.chain?.id ?? c.chain?.id;
    if (args?.authorization) await gateAuthorization("userOp", where, () => authInput(args.authorization, chainId, sender), opts);
    if (Array.isArray(args?.calls)) {
      await enforceCalls(() => callsOf(args.calls, chainId, sender, opts), opts);
      return;
    }
    await enforce("userOp", async () => {
      if (typeof args?.callData !== "string") return {};
      let nonce = args.nonce;
      if ((nonce === undefined || nonce === null) && typeof acct?.getNonce === "function") nonce = await acct.getNonce();
      const op: Record<string, unknown> = { sender: isAddress(args.sender) ? args.sender : sender, nonce: nonce ?? 0n, callData: args.callData };
      for (const k of USEROP_FIELDS) if (args[k] !== undefined && args[k] !== null) op[k] = args[k];
      const ep = acct?.entryPoint?.address ?? args.entryPointAddress;
      return { userOp: op, ...(isAddress(ep) ? { entryPoint: ep } : {}) };
    }, opts);
  };
  const wrapped: Record<string, AnyFn> = {};
  for (const m of ["sendUserOperation", "prepareUserOperation"] as const) {
    if (typeof c[m] !== "function") continue;
    wrapped[m] = async (args: Obj, ...rest: unknown[]) => {
      await check(m, args);
      return c[m](args, ...rest);
    };
  }
  return proxy(client, wrapped);
}

/* ------------------------------------------------------------------ ethers v6 */

/** the EIP-712 primary type: the one type no other type refers to (as ethers' TypedDataEncoder.getPrimaryType) */
export function primaryTypeOf(types: Record<string, Array<{ name: string; type: string }>>): string {
  const names = Object.keys(types).filter((n) => n !== "EIP712Domain");
  const used = new Set<string>();
  for (const n of names) for (const f of types[n] ?? []) used.add(String(f.type).replace(/(\[\d*\])+$/, ""));
  const roots = names.filter((n) => !used.has(n));
  if (roots.length !== 1) throw new Error(roots.length ? `ambiguous primary type: ${roots.join(", ")}` : "no primary type");
  return roots[0];
}

async function ethersChainId(signer: Obj): Promise<unknown> {
  const net = typeof signer.provider?.getNetwork === "function" ? await signer.provider.getNetwork() : null;
  return net?.chainId ?? undefined;
}

async function ethersTx(signer: Obj, tx: Obj): Promise<CheckInput> {
  let to: unknown = tx?.to;
  if (to && typeof to === "object" && typeof (to as Obj).getAddress === "function") to = await (to as Obj).getAddress();
  if (typeof to === "string" && !isAddress(to)) {
    // an ENS name: resolved the way the signer would
    const r = typeof signer.resolveName === "function" ? await signer.resolveName(to) : null;
    if (!isAddress(r)) throw new Error(`could not resolve ${to}`);
    to = r;
  }
  let chainId: unknown = tx?.chainId;
  if (chainId === undefined || chainId === null) chainId = await ethersChainId(signer);
  let from: unknown = tx?.from;
  if (from && typeof from === "object" && typeof (from as Obj).getAddress === "function") from = await (from as Obj).getAddress();
  if (!isAddress(from) && typeof signer.getAddress === "function") from = await signer.getAddress();
  return {
    chainId: (chainId ?? undefined) as CheckInput["chainId"],
    from: isAddress(from) ? from : undefined,
    to: (to ?? undefined) as string | undefined,
    data: typeof tx?.data === "string" ? tx.data : "0x",
    value: tx?.value ?? 0n,
    ...(hasAuthorizations(tx) ? { authorizationList: tx.authorizationList } : {}),
  };
}

/**
 * Wraps an ethers v6 Signer: sendTransaction, signTransaction, signTypedData, signMessage and authorize() ask Toll
 * first. An EIP-7702 authorization (a transaction's authorizationList, or authorize()) goes to onAuthorization
 * (default "check"). `signer.connect(provider)` returns an unguarded signer: wrap the connected one.
 */
export function guardEthers<T extends object>(signer: T, opts: GuardOptions = {}): T {
  const s = signer as Obj;
  const origin = opts.origin !== undefined ? { origin: opts.origin } : {};
  const wrapped: Record<string, AnyFn> = {};
  for (const m of ["sendTransaction", "signTransaction"] as const) {
    if (typeof s[m] !== "function") continue;
    wrapped[m] = async (tx: Obj, ...rest: unknown[]) => {
      await gateTx(m, () => ethersTx(s, tx), hasAuthorizations(tx), opts);
      return s[m](tx, ...rest);
    };
  }
  if (typeof s.signTypedData === "function") {
    wrapped.signTypedData = async (domain: Obj, types: Obj, value: Obj, ...rest: unknown[]) => {
      await enforce("typedData", async () => {
        // the signer (0.3.1): Toll reads what the signature lets someone take from it (a Permit2 message names no owner)
        const from = typeof s.getAddress === "function" ? await s.getAddress() : undefined;
        return { typedData: { domain: domain ?? {}, types: types ?? {}, primaryType: primaryTypeOf(types ?? {}), message: value ?? {} }, ...(isAddress(from) ? { from } : {}), ...origin };
      }, opts);
      return s.signTypedData(domain, types, value, ...rest);
    };
  }
  if (typeof s.signMessage === "function") {
    wrapped.signMessage = async (message: unknown, ...rest: unknown[]) => {
      await enforce("message", async () => {
        // ethers signs a string as its UTF-8 bytes, even one that looks like hex
        const data = typeof message === "string" ? utf8Hex(message) : message instanceof Uint8Array ? bytesHex(message) : null;
        if (data === null) throw new Error("signMessage: message must be a string or bytes");
        const from = typeof s.getAddress === "function" ? await s.getAddress() : undefined;
        return { message: { kind: "personal_sign", data, ...(isAddress(from) ? { from } : {}) }, ...origin };
      }, opts);
      return s.signMessage(message, ...rest);
    };
  }
  if (typeof s.authorize === "function") {
    wrapped.authorize = async (auth: Obj, ...rest: unknown[]) => {
      await gateAuthorization("transaction", "authorize", async () => {
        const chainId = chainOut(await ethersChainId(s));
        const from = typeof s.getAddress === "function" ? await s.getAddress() : undefined;
        return authInput(auth ?? {}, chainId, isAddress(from) ? from : undefined);
      }, opts);
      return s.authorize(auth, ...rest);
    };
  }
  return proxy(signer, wrapped);
}

/* ------------------------------------------------------------------ any */

/** true for a viem WalletClient (has `extend` and `request`), false for an ethers Signer */
export const isViemClient = (x: unknown): boolean => !!x && typeof (x as Obj).extend === "function" && typeof (x as Obj).request === "function";

/** true for a viem bundler client (account abstraction): it has sendUserOperation */
export const isBundlerClient = (x: unknown): boolean => !!x && typeof (x as Obj).sendUserOperation === "function";

/**
 * Puts Toll's pre-sign check in front of a wallet: a viem bundler client (smart account), a viem WalletClient or an
 * ethers v6 Signer; the wrapped wallet has the same type and methods.
 */
export function guard<T extends object>(wallet: T, opts: ViemGuardOptions = {}): T {
  // a bundler client is also a viem client: it is detected first
  if (isBundlerClient(wallet)) return guardSmartAccount(wallet, opts);
  if (isViemClient(wallet)) return guardViem(wallet, opts);
  if (typeof (wallet as Obj).getAddress === "function" && (typeof (wallet as Obj).sendTransaction === "function" || typeof (wallet as Obj).signTypedData === "function")) {
    return guardEthers(wallet, opts);
  }
  throw new TypeError("guard(): pass a viem WalletClient, a viem bundler client or an ethers v6 Signer (or use guardViem / guardSmartAccount / guardEthers).");
}
