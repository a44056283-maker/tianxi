# OpenClaw Task: retail-link-backfill-scan

## Role

Collect raw evidence for retail price link backfill. Codex decides whether to write links and prices.

## Schedule

- Daily at 06:30 Asia/Shanghai.
- May also be run manually when collection plan has urgent invalid links.

## Inputs

Read:

```text
apps/web-cockpit/public/data/latest-collection-operation-plan.json
apps/web-cockpit/public/data/latest-product-url-locks.json
```

## Collection Order

1. Process invalid JD locked links first.
2. JD designated link invalid:
   - open JD whole-site search
   - search by model
   - then model + core config
   - then model + core config + color
3. Lenovo official link invalid:
   - mark old official page as invalid in raw note only
   - search Tmall Lenovo official flagship
   - search Tmall Lecoo official flagship
   - then Taobao
4. Capture only real detail pages with matching category and configuration.

## Output Paths

```text
apps/inventory-sync/artifacts/manual/openclaw/retail-link-backfill/YYYY-MM-DD/
retail-link-backfill-YYYY-MM-DD-HHmm.json
screenshots/*.png
```

Receipt:

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/retail-link-backfill-scan-YYYY-MM-DD-HHmm.json
```

## Dedupe Keys

- `retailLink|skuKey|source|detailUrl`
- fallback candidate: `retailLink|skuKey|source|normalizedTitle|normalizedConfig`

## Forbidden

- Do not search by PN/MTM/internal material number.
- Do not write formal price master.
- Do not write frontend snapshots.
- Do not accept mismatched CPU, memory, disk, GPU, screen size, or category.
