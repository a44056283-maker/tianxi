export type ZdtTopMenuKey =
  | 'organization'
  | 'product'
  | 'order'
  | 'inventory'
  | 'account'
  | 'device'
  | 'finance'
  | 'report'

export type ZdtSubmenuItem = {
  key: string
  label: string
  url: string
  summary: string
  targetDomain: string
}

export type ZdtSubmenuGroup = {
  key: string
  label: string
  items: ZdtSubmenuItem[]
}

export type ZdtTopMenu = {
  key: ZdtTopMenuKey
  label: string
  pageTitle: string
  url: string
  breadcrumb: string[]
  summary: string
  buildStatus: string
  targetScope: string
  groups: ZdtSubmenuGroup[]
}

export const zdtTopMenus: ZdtTopMenu[] = [
  {
    key: 'organization',
    label: '组织',
    pageTitle: '店铺列表 - 智慧零售云平台',
    url: '/company/shop',
    breadcrumb: ['组织', '店铺列表'],
    summary: '承接门店、仓库等组织对象，后续为库存、订单、财务、人员菜单提供统一组织边界。',
    buildStatus: '页面框架已建，待接门店/仓库主数据',
    targetScope: '门店、仓库、组织资料、组织切换',
    groups: [
      {
        key: 'organization-base',
        label: '基础组织',
        items: [
          {
            key: 'organization-shop',
            label: '店铺列表',
            url: '/company/shop',
            summary: '门店基础档案、地址、状态、组织编码与经营属性入口。',
            targetDomain: 'store_profile / retail organization',
          },
          {
            key: 'organization-warehouse',
            label: '仓库列表',
            url: '/company/warehouse',
            summary: '仓库主档、仓库状态和库存归属边界入口。',
            targetDomain: 'warehouse_profile / stock organization',
          },
        ],
      },
    ],
  },
  {
    key: 'product',
    label: '商品',
    pageTitle: '创建自有商品 - 智慧零售云平台',
    url: '/product/list-city',
    breadcrumb: ['商品', '经销商商品'],
    summary: '承接产品主档、上下架发布态、供应商与收银热卖配置，是后续价格链、库存链、销售链的主档入口。',
    buildStatus: '页面框架已建，待接产品主档与发布态字段',
    targetScope: '产品主档、发布态、热卖商品、供应商',
    groups: [
      {
        key: 'product-catalog',
        label: '商品档案',
        items: [
          {
            key: 'product-city',
            label: '经销商商品',
            url: '/product/list-city',
            summary: '经销商维度产品总表与基础创建入口。',
            targetDomain: 'product_master / dealer products',
          },
          {
            key: 'product-store',
            label: '门店商品',
            url: '/product/list-store',
            summary: '门店发布商品、门店展示状态、门店在售清单入口。',
            targetDomain: 'products_store_publish / store assortment',
          },
          {
            key: 'product-depot',
            label: '仓库商品',
            url: '/product/list-depot',
            summary: '仓库维度商品发布态和仓配可售对象入口。',
            targetDomain: 'products_depot_publish / depot assortment',
          },
        ],
      },
      {
        key: 'product-ops',
        label: '经营配置',
        items: [
          {
            key: 'product-hot-sale',
            label: '收银热卖商品',
            url: '/product/hot-sale',
            summary: 'POS 收银热卖商品和推荐位配置入口。',
            targetDomain: 'products_hot_sale / pos favorite products',
          },
          {
            key: 'product-supplier',
            label: '供应商管理',
            url: '/product/supplier',
            summary: '供应商主档、对账主体和采购归属入口。',
            targetDomain: 'suppliers / supplier profile',
          },
        ],
      },
    ],
  },
  {
    key: 'order',
    label: '订单',
    pageTitle: '订单列表 - 智慧零售云平台',
    url: '/order/order-list',
    breadcrumb: ['订单', '线下门店订单'],
    summary: '承接线下与线上订单、退单和订单详情，是销售出库与价保入池的核心订单层。',
    buildStatus: '页面框架已建，待接订单头行与退单数据',
    targetScope: '线下订单、线上订单、退单、订单详情',
    groups: [
      {
        key: 'order-sales',
        label: '订单中心',
        items: [
          {
            key: 'order-offline',
            label: '线下门店订单',
            url: '/order/order-list',
            summary: '门店线下销售订单主入口，目标承接销售订单与收银事实。',
            targetDomain: 'fact_orders / fact_order_items / sales_order',
          },
          {
            key: 'order-offline-refund',
            label: '线下门店退单',
            url: '/order/offline-refund-list',
            summary: '线下退货、冲销和门店退单明细入口。',
            targetDomain: 'order_refunds_offline / refund detail',
          },
          {
            key: 'order-online',
            label: '线上订单',
            url: '/order/online-order-list',
            summary: '线上渠道订单入口，后续区分平台来源与履约状态。',
            targetDomain: 'online orders / ecommerce sales',
          },
          {
            key: 'order-online-refund',
            label: '线上退单',
            url: '/order/online-refund-list',
            summary: '线上退货与逆向订单入口。',
            targetDomain: 'order_refunds_online / online refund detail',
          },
        ],
      },
    ],
  },
  {
    key: 'inventory',
    label: '库存',
    pageTitle: '商品库存查询 - 智慧零售云平台',
    url: '/stock/stock/stock-panel',
    breadcrumb: ['库存', '库存查看', '商品库存'],
    summary: '承接库存快照、SN 台账、库存流水和出入库全链路，是当前零售系统主闭环的核心菜单。',
    buildStatus: '页面框架已建，后续逐页替换为 SQL 主链数据',
    targetScope: '库存快照、SN 台账、采购入库、销售出库、调拨和其他出入库',
    groups: [
      {
        key: 'inventory-view',
        label: '库存查看',
        items: [
          {
            key: 'inventory-stock',
            label: '商品库存',
            url: '/stock/stock/stock-panel',
            summary: '商品级库存、可售数量、在库汇总入口。',
            targetDomain: 'inventory snapshot / sku stock',
          },
          {
            key: 'inventory-location',
            label: '库位库存',
            url: '/stock/stock/location-panel',
            summary: '库位级库存与仓位分布入口。',
            targetDomain: 'inventory_location_snapshot',
          },
          {
            key: 'inventory-overview',
            label: '库存总览',
            url: '/stock/stock/overview',
            summary: '库存结构看板与库存总览入口。',
            targetDomain: 'inventory overview / dashboard',
          },
          {
            key: 'inventory-movement',
            label: '库存流水',
            url: '/stock/stock/movement',
            summary: '库存增减流水、业务类型和时间序列入口。',
            targetDomain: 'inventory_movement / fact_stock_orders',
          },
          {
            key: 'inventory-stock-order',
            label: '库存订单',
            url: '/stock/stock/order',
            summary: '按单据维度查看库存业务订单入口。',
            targetDomain: 'stock orders / movement documents',
          },
          {
            key: 'inventory-sn-order',
            label: 'SN库存订单',
            url: '/stock/stock/sn-order',
            summary: '按 SN 维度查看库存业务单据入口。',
            targetDomain: 'fact_sn_records / serial ledger',
          },
          {
            key: 'inventory-cost-price',
            label: '销售成本价维护',
            url: '/stock/stock/sales-cost-price',
            summary: '销售成本价查看与维护入口。',
            targetDomain: 'sales_cost_price / selling cost',
          },
        ],
      },
      {
        key: 'inventory-io',
        label: '出入库',
        items: [
          {
            key: 'inventory-transfer-out',
            label: '调拨出库',
            url: '/stock/out/transfer',
            summary: '调拨出库单据、数量和 SN 明细入口。',
            targetDomain: 'transfer_outbound / transfer_out_lines',
          },
          {
            key: 'inventory-transfer-in',
            label: '调拨入库',
            url: '/stock/in/transfer',
            summary: '调拨入库单据、数量和 SN 明细入口。',
            targetDomain: 'transfer_inbound / transfer_in_lines',
          },
          {
            key: 'inventory-purchase-in',
            label: '商品入库',
            url: '/stock/in/purchase',
            summary: '采购入库、成本和整单 SN 明细入口。',
            targetDomain: 'fact_purchase_orders / fact_purchase_order_details / serial inbound',
          },
          {
            key: 'inventory-other-io',
            label: '其他出入库',
            url: '/stock/inout/other',
            summary: '其他出入库及原因分类入口。',
            targetDomain: 'other_inout_documents / other_inout_lines',
          },
          {
            key: 'inventory-location-move',
            label: '同店换库位',
            url: '/stock/location/change',
            summary: '同店换库位和库位迁移记录入口。',
            targetDomain: 'same_store_location_change / same_store_location_change_lines',
          },
        ],
      },
      {
        key: 'inventory-config',
        label: '其它',
        items: [
          {
            key: 'inventory-config-center',
            label: '库存配置',
            url: '/stock/config',
            summary: '库存参数、库存规则与库存配置入口。',
            targetDomain: 'inventory config / stock rules',
          },
        ],
      },
    ],
  },
  {
    key: 'account',
    label: '账号',
    pageTitle: '账号管理 - 智慧零售云平台',
    url: '/uc/user',
    breadcrumb: ['账号', '员工账号'],
    summary: '承接员工账号、权限和业绩目标，后续用于人员维度分析、账号留痕与任务归属。',
    buildStatus: '页面框架已建，待接账号与业绩目标数据',
    targetScope: '员工账号、权限、业绩目标',
    groups: [
      {
        key: 'account-user',
        label: '账号管理',
        items: [
          {
            key: 'account-employee',
            label: '员工账号',
            url: '/uc/user',
            summary: '员工账号、角色、启停状态入口。',
            targetDomain: 'staff accounts / roles',
          },
          {
            key: 'account-target',
            label: '业绩目标',
            url: '/uc/target',
            summary: '门店与员工业绩目标配置入口。',
            targetDomain: 'performance target / staff target',
          },
        ],
      },
    ],
  },
  {
    key: 'device',
    label: '设备',
    pageTitle: 'POS终端 - 智慧零售云平台',
    url: '/device/pos',
    breadcrumb: ['设备', 'POS管理'],
    summary: '承接 POS 终端、收银设备与门店设备管理，后续用于设备状态、收银端关联和设备审计。',
    buildStatus: '页面框架已建，待接 POS 终端与设备台账',
    targetScope: 'POS终端、设备台账、设备状态',
    groups: [
      {
        key: 'device-pos',
        label: '设备中心',
        items: [
          {
            key: 'device-pos-manage',
            label: 'POS管理',
            url: '/device/pos',
            summary: 'POS 终端列表、设备绑定和设备状态入口。',
            targetDomain: 'pos devices / terminal management',
          },
        ],
      },
    ],
  },
  {
    key: 'finance',
    label: '财务',
    pageTitle: '自助签约 - 智慧零售云平台',
    url: '/finance/payment/selfsigning',
    breadcrumb: ['财务', '支付管理', '自助签约'],
    summary: '承接支付管理、自助签约与可用金额，后续用于支付渠道、对账与财务状态。',
    buildStatus: '页面框架已建，待接支付和财务状态数据',
    targetScope: '支付管理、自助签约、可用金',
    groups: [
      {
        key: 'finance-payment',
        label: '支付中心',
        items: [
          {
            key: 'finance-pay-manage',
            label: '支付管理',
            url: '/finance/payment',
            summary: '支付渠道、支付主体与支付状态入口。',
            targetDomain: 'payments / payment channels',
          },
          {
            key: 'finance-self-signing',
            label: '自助签约',
            url: '/finance/payment/selfsigning',
            summary: '签约主体、自助签约和开通状态入口。',
            targetDomain: 'self signing / contract status',
          },
          {
            key: 'finance-balance',
            label: '可用金',
            url: '/finance/payment/balance',
            summary: '可用金额、预付金和财务余额入口。',
            targetDomain: 'balance / usable cash',
          },
        ],
      },
    ],
  },
  {
    key: 'report',
    label: '数据',
    pageTitle: '支付统计 - 智慧零售云平台',
    url: '/report/payment',
    breadcrumb: ['数据', '支付统计报表'],
    summary: '承接销售分析、商品统计、支付统计和 SN 有效销量等报表，是经营复盘与对账分析入口。',
    buildStatus: '页面框架已建，待接统计报表与分析视图',
    targetScope: '支付报表、商品统计、销售分析、日报、SN有效销量',
    groups: [
      {
        key: 'report-core',
        label: '数据报表',
        items: [
          {
            key: 'report-payment',
            label: '支付统计报表',
            url: '/report/payment',
            summary: '支付维度经营统计入口。',
            targetDomain: 'payment report / payment summary',
          },
          {
            key: 'report-product',
            label: '商品统计',
            url: '/report/product',
            summary: '商品销量、库存和分类分析入口。',
            targetDomain: 'product report / product analytics',
          },
          {
            key: 'report-sales-analysis',
            label: '销售分析报表',
            url: '/report/sales-analysis',
            summary: '销售分析、结构和趋势入口。',
            targetDomain: 'sales analysis / trend',
          },
          {
            key: 'report-sales-daily',
            label: '销售日报表',
            url: '/report/sales-daily',
            summary: '门店日销售快照与日报入口。',
            targetDomain: 'daily sales report / day summary',
          },
          {
            key: 'report-sn-valid',
            label: '门店SN有效销量报表',
            url: '/report/sn-valid-sales',
            summary: 'SN 有效销量统计和门店有效销量入口。',
            targetDomain: 'sn valid sales / serial performance',
          },
        ],
      },
    ],
  },
]
