# @asin402/n8n-nodes-asin402

n8n community nodes for two pay-per-call data APIs. There's no account, API key or subscription: each call is paid automatically in USDC on Base via the [x402](https://x402.org) protocol, from a small wallet you control.

- **ASIN402**: live Amazon data across 11 marketplaces: deal verdicts against 30/90/180-day price history, FBA profit, 0-100 selling-opportunity scores, product snapshots, marketplace comparison, barcode lookup, keyword search and best sellers. [asin402.com](https://asin402.com)
- **Geo402**: web pages and Google results as they appear from 190+ countries via residential IPs, as clean markdown. Fetch a page, compare it across countries, search from a country, or search and read the top results. [geo402.com](https://geo402.com)

Both nodes can be used as **AI Agent tools** in n8n.

## Install

In n8n: **Settings → Community Nodes → Install** and enter `@asin402/n8n-nodes-asin402`.

## Credential: x402 Wallet (USDC on Base)

1. Create a **dedicated** wallet (MetaMask, Rabby, Coinbase Wallet) and send it a few dollars of **USDC on Base**. Never use your main wallet.
2. Export its private key and paste it into the **x402 Wallet** credential.
3. Set **Max Price per Call** (default $0.25). Any call priced above it is refused before anything is paid.

The key stays in n8n's encrypted credential store and is only used to sign the USDC payment for each call.

## Operations and prices

| Node | Operation | Typical price |
|---|---|---|
| ASIN402 | Deal Check | $0.02 |
| ASIN402 | Product Snapshot | $0.01 |
| ASIN402 | FBA Profit | $0.05 |
| ASIN402 | Sell Score | $0.10 |
| ASIN402 | Compare Marketplaces, Lookup Barcode, Search Products, Best Sellers | a few cents |
| ASIN402 | Custom Request | any endpoint in [openapi.json](https://asin402.com/openapi.json) |
| Geo402 | Fetch Page | ~$0.005 |
| Geo402 | Compare Page Across Countries | ~$0.005 per country |
| Geo402 | Search, Compare Search, Search and Read | a few cents |

Every paid result includes a `_payment` field with the amount and the on-chain transaction. Failed calls are never charged.

## Example workflows

- **Daily deal alert**: Schedule → Google Sheets (your ASINs) → ASIN402 *Deal Check* → IF `verdict = buy_now` → Slack/Email.
- **Sourcing check**: Webhook with a barcode → ASIN402 *Lookup Barcode* → *FBA Profit* with your unit cost → reply with margin and ROI.
- **Price monitoring abroad**: Schedule → Geo402 *Compare Page Across Countries* on a product page → store prices per country.
- **AI agent**: add ASIN402 and Geo402 as tools to an n8n AI Agent so it can look up Amazon prices or read localized pages on its own.

## Also available

- MCP servers: [`asin402-mcp`](https://www.npmjs.com/package/asin402-mcp), [`geo402-mcp`](https://www.npmjs.com/package/geo402-mcp), or hosted at `https://asin402.com/mcp` and `https://geo402.com/mcp`
- Plain HTTP with any x402 client: [asin402.com/llms.txt](https://asin402.com/llms.txt), [geo402.com/llms.txt](https://geo402.com/llms.txt)

## License

MIT
