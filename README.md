# DealRank Pro — Cloudflare Pages + PayPal + D1

This is a production-oriented starter. It uses Cloudflare Pages Functions as the backend and Cloudflare D1 as the database. PayPal credentials stay server-side.

## 1. Create PayPal app
Go to PayPal Developer Dashboard, create an app and copy the Client ID and Secret. Start with Sandbox.
Set PAYPAL_MODE=sandbox.

## 2. Create D1
Cloudflare Dashboard → Workers & Pages → D1 → Create database.
Run `schema.sql` in the D1 SQL console.

## 3. Bind D1
In your Pages project: Settings → Functions → D1 database bindings.
Binding name MUST be `DB`.

## 4. Secrets
Add these as encrypted environment variables:
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_MODE = sandbox

For production change PAYPAL_MODE to `live` and replace the credentials with your live PayPal app credentials.

## 5. PayPal client ID in index.html
Replace YOUR_PAYPAL_CLIENT_ID in the PayPal SDK script with your PayPal Sandbox Client ID. This value is public; the Client Secret must NEVER be put in HTML/JS.

## 6. Deploy
Push this folder to GitHub. Cloudflare → Workers & Pages → Create → Pages → Import existing Git repository.
Build command: `exit 0`
Build output directory: `/`
Production branch: `main`.

## 7. Test
Use PayPal Sandbox buyer credentials to pay. Confirm the deal appears on the board.
Only after successful testing switch to live credentials and PAYPAL_MODE=live.

## Security notes
- The PayPal order amount is created on the server from the submitted listing.
- PayPal capture is performed server-side.
- The listing is inserted only after PayPal reports COMPLETED.
- Never publish PAYPAL_CLIENT_SECRET.
- Before taking real commercial payments, add Terms, Privacy, Refund Policy, contact details, abuse reporting and appropriate tax/legal information.
- This starter does not yet implement merchant login, anti-spam, moderation, refunds, email notifications or rate limiting; those should be added before a public launch.
