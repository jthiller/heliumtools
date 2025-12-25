# Helium Tools Worker

This directory contains the Cloudflare Worker code for the Helium Tools API and OUI notifier.

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```

## Development

To run the worker locally:

```bash
npm run dev
```

This will start the worker on `http://localhost:8787` (or another port if 8787 is taken).

## Deployment

To deploy to Cloudflare:

```bash
npm run deploy
```

## Environment Variables

The worker uses the following environment variables (configured in `wrangler.toml` or via secrets):

-   `FROM_EMAIL`: Email address to send alerts from.
-   `APP_BASE_URL`: Base URL for the application.
-   `APP_NAME`: Name of the application.
-   `RESEND_API_KEY`: API key for Resend (email service).
-   `SOLANA_RPC_URL`: URL for Solana RPC node.
-   `COINBASE_CDP_API_KEY`: Coinbase Developer Platform API key.
-   `COINBASE_CDP_API_SECRET`: Coinbase Developer Platform API secret.
-   `COINBASE_ONRAMP_WEBHOOK_SECRET`: Secret for verifying Coinbase webhook signatures.
-   `COINBASE_ONRAMP_REDIRECT_BASE_URL`: Base URL for redirect after Coinbase checkout.
-   `COINBASE_ONRAMP_PROJECT_ID`: Coinbase Onramp project identifier.
-   `TREASURY_PUBLIC_KEY`: Solana address that receives USDC and executes swaps/mints for Data Credit purchases.
-   `DC_PURCHASE_MAX_USD`: Optional cap per order (default 1000) for Coinbase guest checkout creation.
