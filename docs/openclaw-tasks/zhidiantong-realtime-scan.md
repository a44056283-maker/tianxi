# OpenClaw Task: zhidiantong-realtime-scan

## Role

You are the collection assistant for Lenovo smart retail. Your current job is limited to evidence patrol and downloaded-file detection for Zhidiantong. Do not assume stable macOS UI control is available.

## Schedule

- Business-hour scan: every 30 minutes from 10:00 to 20:00 Asia/Shanghai.
- Codex still performs formal imports at 12:00, 15:00, and 19:00.

## Inputs

- Visible Zhidiantong session in Chrome.
- Store scope: current Lenovo store account only.

## Collection Scope

Collect only records updated today if they are available through an already opened web page, exported file, or visible downloadable evidence. If the task would require complex macOS UI clicking, write a blocked receipt instead of guessing.

1. Sales outbound
   - order number
   - outbound time
   - product name
   - skuKey / internal code if visible
   - PN/MTM if visible
   - spec
   - quantity
   - SN list if visible
   - operator
   - store/warehouse
2. Purchase inbound
   - document number
   - inbound time
   - product name
   - skuKey / internal code if visible
   - PN/MTM if visible
   - spec
   - quantity
   - SN list if visible
   - cost if visible
   - operator
3. Other outbound
   - document number
   - business time
   - outbound reason/type
   - product name
   - skuKey / PN/MTM / spec
   - quantity
   - SN list if visible
   - operator

## Output Paths

Write raw and structured files under:

```text
apps/inventory-sync/artifacts/manual/openclaw/zhidiantong/YYYY-MM-DD/
```

Allowed files:

```text
sales-outbound-YYYY-MM-DD-HHmm.json
purchase-inbound-YYYY-MM-DD-HHmm.json
other-outbound-YYYY-MM-DD-HHmm.json
screenshots/*.png
raw-notes.md
```

Write one receipt JSON under:

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/zhidiantong-realtime-scan-YYYY-MM-DD-HHmm.json
```

## Dedupe Keys

- Sales line with SN: `sales|orderNo|skuKey|serialNumber`
- Sales line without SN: `sales|orderNo|lineIndex|skuKey|quantity`
- Purchase line with SN: `purchase|documentNo|skuKey|serialNumber`
- Purchase line without SN: `purchase|documentNo|lineIndex|skuKey|quantity`
- Other outbound with SN: `otherOutbound|documentNo|skuKey|serialNumber`
- Other outbound without SN: `otherOutbound|documentNo|lineIndex|skuKey|quantity`

## Receipt Schema

```json
{
  "receiptId": "zhidiantong-realtime-scan-YYYY-MM-DD-HHmm",
  "taskName": "zhidiantong-realtime-scan",
  "taskCategory": "zhidiantong",
  "status": "completed",
  "capturedAt": "ISO time",
  "sourceSystem": "zhidiantong",
  "sourceWindow": "10:00-20:00",
  "rawEvidencePaths": [],
  "structuredOutputPaths": [],
  "dedupeKeys": [],
  "recordCount": 0,
  "manualActionRequired": false,
  "notes": []
}
```

## Blockers

If login is invalid, page is blank, captcha appears, or security verification appears:

- Stop immediately.
- Do not continue scanning.
- Write receipt with:
  - `status = blocked_page_risk`
  - `manualActionRequired = true`
  - `blockingReason` with the exact visible blocker.

## Forbidden

- Do not write any `latest-*.json`.
- Do not modify SQLite.
- Do not change inventory counts.
- Do not infer SN values that are not visible.
- Do not claim UI collection succeeded unless the fields were actually visible or exported.
