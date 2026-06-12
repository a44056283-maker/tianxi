# OpenClaw Task: quote-evidence-scan

## Role

Collect evidence for distributor group quotes and gray-channel public-account quotes. Do not parse or write final quote snapshots.

## Schedule

- Distributor quote first check: 11:30.
- Gray-channel public account first check: 11:50.
- Distributor quote fallback: 13:45.
- Gray-channel fallback: 13:50.

## Collection Scope

1. Distributor group quote
   - today's original Excel file if already downloaded or visible
   - otherwise today's valid screenshots already captured by Codex/user
2. Gray-channel public-account quote
   - today's article text if already saved
   - otherwise screenshots and OCR source files already captured by Codex/user

## Output Paths

```text
apps/inventory-sync/artifacts/manual/openclaw/quotes/YYYY-MM-DD/
distributor-quote-YYYY-MM-DD-HHmm.*
gray-wholesale-YYYY-MM-DD-HHmm.*
screenshots/*.png
ocr/*.txt
```

Receipt:

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/quote-evidence-scan-YYYY-MM-DD-HHmm.json
```

## Dedupe Keys

- `distributorQuote|quoteDate|sourceFileName|fileHash`
- `grayQuote|quoteDate|articleTitle|articleTime`
- screenshot-only: `quoteEvidence|source|quoteDate|imageHash`

## Blockers

WeChat logout, blank page, login screen, public account article unavailable, or masked price that cannot form a real number must be recorded as blocked.

## Forbidden

- Do not fabricate masked prices.
- Do not write `latest-distributor-quotes.json`.
- Do not write `latest-gray-wholesale-quotes.json`.
- Do not claim direct WeChat UI operation unless the required desktop-control dependency is installed and verified.
