export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "48px auto", padding: "0 16px", lineHeight: 1.5 }}>
      <h1>x402 starter</h1>
      <p>
        <code>GET /api/forecast?city=Dubai</code> costs {process.env.PRICE ?? "0.01"} USDG on Robinhood Chain. Without a
        payment it answers <b>402</b> with the payment terms; an x402 client pays and gets the answer.
      </p>
      <p>
        Settled by <a href="https://x402.t0ll.xyz">Toll&apos;s facilitator</a>: keyless and free, it checks your payTo
        against your ERC-8004 identity (ERC-8478) and signs a receipt for every payment.
      </p>
    </main>
  );
}
