# OpenClaw Task: competitor-monitor-scan

## Role

Collect raw JD self-operated competitor evidence for THINK, ASUS, HP, and Huawei notebooks. Do not write formal snapshots.

## Schedule

- Daily at 04:00 Asia/Shanghai.

## Store Library

Read:

```text
apps/inventory-sync/artifacts/manual/competitor-store-favorites.json
apps/inventory-sync/artifacts/latest-competitor-link-repository.json
```

## Collection Order

1. Open stored product links first.
2. If repository is empty for a brand, open the brand's JD self-operated store.
3. Collect up to top 10 notebook products for each brand.
4. For each product, open the detail page and collect visible evidence.

## Fields

- brand
- rank
- product name
- detail URL
- product image URL if visible
- configuration text
- JD pre-subsidy price
- JD subsidy price
- platform activity notes
- education subsidy notes
- sales text only if page explicitly shows sales
- comment count if only comments are visible
- capturedAt

## Output Paths

```text
apps/inventory-sync/artifacts/manual/openclaw/competitor/YYYY-MM-DD/
competitor-monitor-YYYY-MM-DD-HHmm.json
screenshots/*.png
```

Receipt:

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/competitor-monitor-scan-YYYY-MM-DD-HHmm.json
```

## Dedupe Keys

- `competitor|brand|jdItemId`
- if item id is unavailable: `competitor|brand|normalizedTitle|normalizedConfig`

## Blockers

JD login invalid, 403, captcha, security verification, or page unavailable must be recorded as `blocked_page_risk`.

## Forbidden

- Do not use JD whole-site ranking pages as formal source.
- Do not treat comments as sales unless page clearly says sales.
- Do not write `latest-competitor-monitor.json`.
