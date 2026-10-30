/**
 * The wallet wrappers. Duck-typed: viem and ethers are optional peer dependencies, never imported at load time.
 * The wrapper is a Proxy: every other method and field of the client passes through unchanged.
 */
import { isAddress, type CheckInput, type Hex, type TypedDataLike } from "./check.js";
import { enforce, type GuardOptions } from "./policy.js";

type AnyFn = (...args: any[]) => any;
type Obj = Record<string | symbol, any>;

export interface ViemGuardOptions extends GuardOptions {
  /**
   * Encodes writeContract calldata. Default: viem's own encodeFunctionData, loaded on first use (viem is installed
   * wherever a viem WalletClient is).
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

const addrOf = (account: unknown): string | undefined => {
  if (isAddress(account)) return account;
  const a = (account as { address?: unknown } | null | undefined)?.address;
  return isAddress(a) ? a : undefined;
};

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

/**
 * Wraps a viem WalletClient: sendTransaction, writeContract, signTransaction and signTypedData ask Toll first.
 * Wrap last: `client.extend(...)` on the wrapped client returns an unguarded client.
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
  });
  const wrapped: Record<string, AnyFn> = {};
  if (typeof c.sendTransaction === "function") {
    wrapped.sendTransaction = async (args: Obj, ...rest: unknown[]) => {
      // a deployment (no `to`) goes to the unsupported policy
      await enforce("transaction", () => txInput(args, args?.data), opts);
      return c.sendTransaction(args, ...rest);
    };
  }
  if (typeof c.signTransaction === "function") {
    wrapped.signTransaction = async (args: Obj, ...rest: unknown[]) => {
      await enforce("transaction", () => txInput(args, args?.data), opts);
      return c.signTransaction(args, ...rest);
    };
  }
  if (typeof c.writeContract === "function") {
    wrapped.writeContract = async (args: Obj, ...rest: unknown[]) => {
      await enforce("transaction", async () => {
        const enc = opts.encodeFunctionData ?? (await loadViemEncode());
        let data = String(enc({ abi: args.abi, functionName: args.functionName, args: args.args }));
        if (typeof args.dataSuffix === "string") data += args.dataSuffix.replace(/^0x/, "");
        return txInput({ ...args, to: args.address }, data);
      }, opts);
      return c.writeContract(args, ...rest);
    };
  }
  if (typeof c.signTypedData === "function") {
    wrapped.signTypedData = async (args: Obj, ...rest: unknown[]) => {
      const td: TypedDataLike = { domain: args?.domain ?? {}, types: args?.types ?? {}, primaryType: args?.primaryType, message: args?.message ?? {} };
      await enforce("typedData", () => ({ typedData: td }), opts);
      return c.signTypedData(args, ...rest);
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
  if (chainId === undefined || chainId === null) {
    const net = typeof signer.provider?.getNetwork === "function" ? await signer.provider.getNetwork() : null;
    chainId = net?.chainId ?? undefined;
  }
  let from: unknown = tx?.from;
  if (from && typeof from === "object" && typeof (from as Obj).getAddress === "function") from = await (from as Obj).getAddress();
  if (!isAddress(from) && typeof signer.getAddress === "function") from = await signer.getAddress();
  return {
    chainId: (chainId ?? undefined) as CheckInput["chainId"],
    from: isAddress(from) ? from : undefined,
    to: (to ?? undefined) as string | undefined,
    data: typeof tx?.data === "string" ? tx.data : "0x",
    value: tx?.value ?? 0n,
  };
}

/**
 * Wraps an ethers v6 Signer: sendTransaction, signTransaction and signTypedData ask Toll first.
 * `signer.connect(provider)` returns an unguarded signer: wrap the connected one.
 */
export function guardEthers<T extends object>(signer: T, opts: GuardOptions = {}): T {
  const s = signer as Obj;
  const wrapped: Record<string, AnyFn> = {};
  if (typeof s.sendTransaction === "function") {
    wrapped.sendTransaction = async (tx: Obj, ...rest: unknown[]) => {
      await enforce("transaction", () => ethersTx(s, tx), opts);
      return s.sendTransaction(tx, ...rest);
    };
  }
  if (typeof s.signTransaction === "function") {
    wrapped.signTransaction = async (tx: Obj, ...rest: unknown[]) => {
      await enforce("transaction", () => ethersTx(s, tx), opts);
      return s.signTransaction(tx, ...rest);
    };
  }
  if (typeof s.signTypedData === "function") {
    wrapped.signTypedData = async (domain: Obj, types: Obj, value: Obj, ...rest: unknown[]) => {
      await enforce("typedData", () => ({ typedData: { domain: domain ?? {}, types: types ?? {}, primaryType: primaryTypeOf(types ?? {}), message: value ?? {} } }), opts);
      return s.signTypedData(domain, types, value, ...rest);
    };
  }
  return proxy(signer, wrapped);
}

/* ------------------------------------------------------------------ either */

/** true for a viem WalletClient (has `extend` and `request`), false for an ethers Signer */
export const isViemClient = (x: unknown): boolean => !!x && typeof (x as Obj).extend === "function" && typeof (x as Obj).request === "function";

/**
 * Puts Toll's pre-sign check in front of a wallet. A viem WalletClient or an ethers v6 Signer; the wrapped wallet has
 * the same type and methods.
 */
export function guard<T extends object>(wallet: T, opts: ViemGuardOptions = {}): T {
  if (isViemClient(wallet)) return guardViem(wallet, opts);
  if (typeof (wallet as Obj).getAddress === "function" && (typeof (wallet as Obj).sendTransaction === "function" || typeof (wallet as Obj).signTypedData === "function")) {
    return guardEthers(wallet, opts);
  }
  throw new TypeError("guard(): pass a viem WalletClient or an ethers v6 Signer (or use guardViem / guardEthers).");
}
