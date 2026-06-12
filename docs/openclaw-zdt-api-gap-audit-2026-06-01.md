# ZDT API覆盖审计（2026-06-01）

- 菜单总数: 35
- 已映射CLI实体: 20
- 未覆盖/待补: 15

## 已覆盖
- 商品/经销商商品 -> `products` -> `/prd/backend/shop/product/findPageShopProduct`
- 商品/门店商品 -> `products_store_publish` -> `/prd/backend/shop/product/findPageShopProduct`
- 商品/仓库商品 -> `products_depot_publish` -> `/prd/backend/shop/product/findPageShopProduct`
- 商品/收银热卖商品 -> `products_hot_sale` -> `/prd/backend/pos/shop/posHotProduct/findList`
- 商品/供应商管理 -> `suppliers` -> `/prd/backend/supplier/findPage`
- 订单/线下门店订单 -> `order` -> `/trade/backend/order/findPage`
- 订单/线下门店退单 -> `order_refunds_offline` -> `/trade/backend/orderRefund/findPage`
- 库存/商品库存 -> `inventory` -> `/backend/shop/product/stock/batchBoardFindPage`
- 库存/库位库存 -> `inventory_location_snapshot` -> `/prd/backend/shop/product/stock/batchBoardLocationFindPage`
- 库存/库存总览 -> `inventory_overview_snapshot` -> `/prd/backend/shop/product/stock/overviewBoardFindPage`
- 库存/库存订单 -> `stock_order` -> `/backend/storeProductStockDeal/v1.0.1/findPage`
- 库存/SN库存订单 -> `sn_stock_order` -> `/backend/shop/serialNumber/findPage`
- 库存/销售成本价维护 -> `sales_cost_price` -> `/prd/backend/shop/product/stock/batchBoardFindPage`
- 库存/调拨出库 -> `transfer_out` -> `/backend/storeStockTransferRecord/findPage`
- 库存/调拨入库 -> `transfer_in` -> `/backend/shopStockTransferRecord/findPage`
- 账号/员工账号 -> `staff_accounts` -> `/uc/backend/admin/user/findByPage`
- 设备/POS管理 -> `pos_terminals` -> `/pos/backend/posTerminal/findPage`
- 财务/支付管理 -> `payment_contracts` -> `/pos/backend/merchant/contract/page`
- 财务/自助签约 -> `payment_contracts` -> `/pos/backend/merchant/contract/page`
- 财务/可用金 -> `shop_spare_gold_summary` -> `/shop/backend/shop/spareGold/summary/page`

## 待补清单
- 组织/店铺列表 (https://retail-pos.lenovo.com/lenovo/web/company/shop)
- 组织/仓库列表 (https://retail-pos.lenovo.com/lenovo/web/company/depot)
- 订单/线上订单 (https://retail-pos.lenovo.com/lenovo/web/order/online-order-list)
- 订单/线上退单 (https://retail-pos.lenovo.com/lenovo/web/order/online-order-refund)
- 库存/库存流水 (https://retail-pos.lenovo.com/lenovo/web/stock/stock/stock-stream)
- 库存/商品入库 (https://retail-pos.lenovo.com/lenovo/web/stock/in-out/purchasing-manage)
- 库存/其他出入库 (https://retail-pos.lenovo.com/lenovo/web/stock/in-out/other-in-out-storage)
- 库存/同店换库位 (https://retail-pos.lenovo.com/lenovo/web/stock/in-out/same-store-change-location)
- 库存/库存配置 (https://retail-pos.lenovo.com/lenovo/web/stock/stock/stock-panel)
- 账号/业绩目标 (https://retail-pos.lenovo.com/lenovo/web/uc/performance-goal)
- 数据/支付统计报表 (https://retail-pos.lenovo.com/lenovo/web/report/payment)
- 数据/商品统计 (https://retail-pos.lenovo.com/lenovo/web/report/product)
- 数据/销售分析报表 (https://retail-pos.lenovo.com/lenovo/web/report/sales-analysis)
- 数据/销售日报表 (https://retail-pos.lenovo.com/lenovo/web/report/sales-daily)
- 数据/门店SN有效销量报表 (https://retail-pos.lenovo.com/lenovo/web/report/sn-valid-sales-company)