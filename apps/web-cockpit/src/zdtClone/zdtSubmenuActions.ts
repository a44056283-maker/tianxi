export type ZdtSubmenuActionScan = {
  topMenu: string
  rowActions: Array<{ rowIndex: number; actions: string[] }>
  detailEntrances: string[]
  error: string | null
}

export const zdtSubmenuActions: Record<string, ZdtSubmenuActionScan> = {
  "店铺列表": {
    "topMenu": "组织",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "查看"
        ]
      }
    ],
    "detailEntrances": [
      "查看"
    ],
    "error": null
  },
  "仓库列表": {
    "topMenu": "组织",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "查看"
        ]
      }
    ],
    "detailEntrances": [
      "查看"
    ],
    "error": null
  },
  "经销商商品": {
    "topMenu": "商品",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "发布商品",
          "查看",
          "编辑"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "发布商品",
          "查看",
          "编辑"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "发布商品",
          "查看",
          "编辑"
        ]
      }
    ],
    "detailEntrances": [
      "查看",
      "编辑"
    ],
    "error": null
  },
  "门店商品": {
    "topMenu": "商品",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "查看",
          "编辑"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "查看",
          "编辑"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "查看",
          "编辑"
        ]
      }
    ],
    "detailEntrances": [
      "导出",
      "查看",
      "编辑"
    ],
    "error": null
  },
  "仓库商品": {
    "topMenu": "商品",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "查看"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "查看"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "查看"
        ]
      }
    ],
    "detailEntrances": [
      "导出",
      "查看"
    ],
    "error": null
  },
  "收银热卖商品": {
    "topMenu": "商品",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "删除",
          "下移"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "删除",
          "置顶",
          "上移",
          "下移"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "删除",
          "置顶",
          "上移",
          "下移"
        ]
      }
    ],
    "detailEntrances": [
      "选择商品"
    ],
    "error": null
  },
  "供应商管理": {
    "topMenu": "商品",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "禁用",
          "删除",
          "编辑"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "禁用",
          "删除",
          "编辑"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "禁用",
          "删除",
          "编辑"
        ]
      }
    ],
    "detailEntrances": [
      "新建",
      "编辑"
    ],
    "error": null
  },
  "线下门店订单": {
    "topMenu": "订单",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "XS26053131554072229",
          "查看详情",
          "订单备注"
        ]
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "导出",
      "导出明细",
      "查看详情"
    ],
    "error": null
  },
  "线下门店退单": {
    "topMenu": "订单",
    "rowActions": [],
    "detailEntrances": [
      "导出",
      "导出明细"
    ],
    "error": null
  },
  "线上订单": {
    "topMenu": "订单",
    "rowActions": [],
    "detailEntrances": [
      "导出",
      "导出明细"
    ],
    "error": null
  },
  "线上退单": {
    "topMenu": "订单",
    "rowActions": [],
    "detailEntrances": [
      "导出",
      "导出明细"
    ],
    "error": null
  },
  "商品库存": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出库存数量",
      "导出库存SN",
      "查看序列号"
    ],
    "error": null
  },
  "库位库存": {
    "topMenu": "库存",
    "rowActions": [],
    "detailEntrances": [
      "商品入库",
      "库存查看"
    ],
    "error": null
  },
  "库存总览": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "0"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "0"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "0"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出库存数量",
      "导出库存SN"
    ],
    "error": null
  },
  "库存流水": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "XS26053131554072229"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "XS26053131554072229"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "XS26053131554072229"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出"
    ],
    "error": null
  },
  "库存订单": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出"
    ],
    "error": null
  },
  "SN库存订单": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出"
    ],
    "error": null
  },
  "销售成本价维护": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "销售成本记录"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出销售成本价"
    ],
    "error": null
  },
  "调拨出库": {
    "topMenu": "库存",
    "rowActions": [],
    "detailEntrances": [
      "商品入库"
    ],
    "error": null
  },
  "调拨入库": {
    "topMenu": "库存",
    "rowActions": [],
    "detailEntrances": [
      "商品入库",
      "调拨申请"
    ],
    "error": null
  },
  "商品入库": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "CGR260531422330"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "CGR260531422299"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "CGR260531422229"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库"
    ],
    "error": null
  },
  "其他出入库": {
    "topMenu": "库存",
    "rowActions": [],
    "detailEntrances": [
      "商品入库",
      "新建出库单"
    ],
    "error": null
  },
  "同店换库位": {
    "topMenu": "库存",
    "rowActions": [],
    "detailEntrances": [
      "商品入库"
    ],
    "error": null
  },
  "库存配置": {
    "topMenu": "库存",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "0",
          "库存流水",
          "查看序列号",
          "销售成本记录"
        ]
      }
    ],
    "detailEntrances": [
      "商品入库",
      "库存查看",
      "导出库存数量",
      "导出库存SN",
      "查看序列号"
    ],
    "error": null
  },
  "员工账号": {
    "topMenu": "账号",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "重置账号密码"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "重置账号密码"
        ]
      },
      {
        "rowIndex": 2,
        "actions": [
          "重置账号密码"
        ]
      }
    ],
    "detailEntrances": [],
    "error": null
  },
  "业绩目标": {
    "topMenu": "账号",
    "rowActions": [],
    "detailEntrances": [
      "导出目标"
    ],
    "error": null
  },
  "POS管理": {
    "topMenu": "设备",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "详情",
          "编辑",
          "重置",
          "删除"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "详情",
          "编辑",
          "重置",
          "删除"
        ]
      }
    ],
    "detailEntrances": [
      "添加POS终端",
      "详情",
      "编辑"
    ],
    "error": null
  },
  "支付管理": {
    "topMenu": "财务",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "变更协议"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "变更协议"
        ]
      }
    ],
    "detailEntrances": [
      "签署新协议"
    ],
    "error": null
  },
  "自助签约": {
    "topMenu": "财务",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "变更协议"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "变更协议"
        ]
      }
    ],
    "detailEntrances": [
      "签署新协议"
    ],
    "error": null
  },
  "可用金": {
    "topMenu": "财务",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": [
          "变更协议"
        ]
      },
      {
        "rowIndex": 1,
        "actions": [
          "变更协议"
        ]
      }
    ],
    "detailEntrances": [
      "签署新协议"
    ],
    "error": null
  },
  "支付统计报表": {
    "topMenu": "数据",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      }
    ],
    "detailEntrances": [],
    "error": null
  },
  "商品统计": {
    "topMenu": "数据",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "导出"
    ],
    "error": null
  },
  "销售分析报表": {
    "topMenu": "数据",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "导出"
    ],
    "error": null
  },
  "销售日报表": {
    "topMenu": "数据",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "导出"
    ],
    "error": null
  },
  "门店SN有效销量报表": {
    "topMenu": "数据",
    "rowActions": [
      {
        "rowIndex": 0,
        "actions": []
      },
      {
        "rowIndex": 1,
        "actions": []
      },
      {
        "rowIndex": 2,
        "actions": []
      }
    ],
    "detailEntrances": [
      "导出"
    ],
    "error": null
  }
}
