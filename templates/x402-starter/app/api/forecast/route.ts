import { paywall } from "@tollxyz/x402-seller";

// Every call costs PRICE USDG on Robinhood Chain, paid to PAY_TO and settled by Toll's facilitator (x402.t0ll.xyz).
// Your handler runs only for a verified payment; the payment settles only if your handler answers below 400.
export const dynamic = "force-dynamic";

async function forecast(req: Request): Promise<Response> {
  const city = new URL(req.url).searchParams.get("city") ?? "Dubai";
  // replace this with what you sell: data, an API call, a model answer, a file
  return Response.json({ city, tomorrow: "sunny", high_c: 31, low_c: 24 });
}

// built on the first request, so `next build` works before PAY_TO is set
let handler: ((req: Request) => Promise<Response>) | null = null;

export async function GET(req: Request): Promise<Response> {
  handler ??= paywall(
    {
      payTo: process.env.PAY_TO ?? "",
      price: process.env.PRICE ?? "0.01",
      agentId: process.env.AGENT_ID || undefined,
      description: "Tomorrow's forecast for a city",
      onSettled: (s) => console.log("[x402] paid", s.transaction, "by", s.payer ?? "?"),
    },
    forecast,
  );
  return handler(req);
}
