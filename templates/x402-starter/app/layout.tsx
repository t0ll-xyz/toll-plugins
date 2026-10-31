export const metadata = { title: "x402 starter", description: "An API sold over x402 on Robinhood Chain" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
