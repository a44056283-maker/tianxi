# automation-9 memory

## 2026-05-23 08:36:27 CST

- Ran `cd apps/inventory-sync && npm run send:daily-inventory-price-broadcast`.
- Feishu feedback file reported `ok=true`, `statusCode=200`, `feishuCode=0`, `feishuMessage=success`, `messageType=daily_inventory_price_broadcast`.
- Broadcast source was `apps/inventory-sync/artifacts/latest-retail-zone-snapshot.json`, generated at `2026-05-22T17:06:59.381Z`.
- Exact broadcast filter in `feishuTaskFeedback.ts` found 34 in-stock computer SKUs, total stock 109, sellable 109.
- Frontend audit opened `http://127.0.0.1:5174/` and entered `实时报价专区`.
- Visible text evidence for `20007936 / 83QF0002CD`: category `游戏笔记本`, stock `12`, sellable `12`, store price `￥14,399`, visible subsidy label `全量国补 ￥10,399.00`.
- Important closure note: Feishu broadcast uses `regularChannelSubsidyPrice` first, so `20007936` broadcast subsidy price is `￥12,899`; this exact regular subsidy value was not visible in the audited frontend card. Report as Feishu send success but frontend visible-audit `executed_not_closed` for exact broadcast subsidy parity.
- Screenshot saved at `/Users/luxiangnan/.codex/automations/automation-9/frontend-audit-2026-05-23T0034Z.png`.
