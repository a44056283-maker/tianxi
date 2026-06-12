-- ============================================================
-- 智店通零售后台 · 完整业务数据库设计
-- 
-- 设计原则：
-- 1. 真实门店运营系统，以订单为主线
-- 2. staging → 正式表的 ETL 路径清晰
-- 3. 幂等 upsert，基于 record_id 做唯一约束
-- 4. 支持增量同步（sync_state.cursor_value）
-- ============================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 维度表
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 门店维度
CREATE TABLE IF NOT EXISTS dim_store (
    id              BIGINT PRIMARY KEY,
    code            VARCHAR(64)  NOT NULL UNIQUE,   -- 智店通内部编码
    name            VARCHAR(256) NOT NULL,           -- 联想体验店（新野县书院路）
    company_id      BIGINT,                          -- 所属公司ID
    company_name    VARCHAR(256),                    -- 联想消费
    address         VARCHAR(512),
    status          SMALLINT DEFAULT 1,              -- 1=正常 2=停用
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_dim_store_code ON dim_store(code);

-- 商品SKU维度（门店级别）
CREATE TABLE IF NOT EXISTS dim_product (
    id              BIGINT PRIMARY KEY,             -- spuId 或 skuId
    sku_no          VARCHAR(64)  NOT NULL UNIQUE,   -- 货号/商品编码 10007231
    barcode         VARCHAR(64),                     -- 条码 6936282592961
    mtm_code        VARCHAR(64),                     -- MTM/PN QXB1T18370
    name            VARCHAR(512),                    -- Legion Y7000P IAX10BKEU716G1TB11C
    category        VARCHAR(128),                    -- 产品分类
    unit            VARCHAR(32),                     -- 台/个/件
    spec            VARCHAR(256),                    -- 规格 U716G1T
    status          SMALLINT DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_dim_product_sku_no ON dim_product(sku_no);
CREATE INDEX IF NOT EXISTS ix_dim_product_barcode ON dim_product(barcode);

-- 日期维度（自动生成）
CREATE TABLE IF NOT EXISTS dim_date (
    date_val        DATE PRIMARY KEY,
    year            SMALLINT NOT NULL,
    month           SMALLINT NOT NULL,
    day             SMALLINT NOT NULL,
    day_of_week     SMALLINT NOT NULL,              -- 1=周一
    week_of_year    SMALLINT,
    quarter         SMALLINT,
    is_weekend      BOOLEAN
);

-- 支付渠道维度
CREATE TABLE IF NOT EXISTS dim_payment_channel (
    channel_id      BIGINT PRIMARY KEY,
    name            VARCHAR(128),                   -- 现金/微信/支付宝/银行卡
    category        VARCHAR(64),                     -- online/offline
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 事实表
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. 销售订单主表
CREATE TABLE IF NOT EXISTS fact_orders (
    order_id            VARCHAR(128) PRIMARY KEY,   -- 智店通 order.id
    order_no            VARCHAR(64)  NOT NULL,       -- 业务订单号 XS26052830962598298
    outer_order_no      VARCHAR(128),                 -- 外部订单号（电商平台）
    
    -- 门店
    store_id            BIGINT,                      -- dim_store.id
    store_code          VARCHAR(64),
    store_name          VARCHAR(256),
    
    -- 时间
    created_time        TIMESTAMPTZ,                 -- 下单时间
    pay_time            TIMESTAMPTZ,                 -- 支付时间
    delivery_date       DATE,                        -- 配送日期
    
    -- 金额（元）
    total_amount        DECIMAL(14,2),               -- 标价总额
    pay_amount          DECIMAL(14,2),               -- 实付金额
    discount_amount     DECIMAL(14,2),               -- 优惠金额
    
    -- 订单属性
    status              SMALLINT,                    -- 60=已完成等
    status_name         VARCHAR(64),
    order_type          SMALLINT,                    -- 1=线上订单
    order_type_name     VARCHAR(64),
    channel_type        SMALLINT,                    -- 渠道类型
    channel_type_name   VARCHAR(64),                 -- 有赞/门店收银
    source              SMALLINT,                    -- 订单来源 2
    source_name         VARCHAR(64),
    
    -- 配送
    delivery_type       SMALLINT,                    -- 1=自提
    delivery_type_name   VARCHAR(64),
    
    -- 客户
    buyer_phone         VARCHAR(64),
    buyer_nick          VARCHAR(128),
    receiver_name       VARCHAR(128),
    receiver_phone      VARCHAR(64),
    receiver_address    VARCHAR(512),
    
    -- 收银
    cashier_id          BIGINT,
    cashier_name        VARCHAR(128),
    
    -- 汇总数量
    total_quantity      INTEGER DEFAULT 0,
    
    -- 元数据
    raw_payload         JSONB,                        -- 原始 API 响应
    collected_at        TIMESTAMPTZ DEFAULT now(),
    source_name         VARCHAR(64) DEFAULT 'zhidiantong'
);

CREATE INDEX IF NOT EXISTS ix_fact_orders_store ON fact_orders(store_id);
CREATE INDEX IF NOT EXISTS ix_fact_orders_created ON fact_orders(created_time);
CREATE INDEX IF NOT EXISTS ix_fact_orders_pay_time ON fact_orders(pay_time);
CREATE INDEX IF NOT EXISTS ix_fact_orders_status ON fact_orders(status);

-- 2. 订单明细（商品行）
CREATE TABLE IF NOT EXISTS fact_order_items (
    id              BIGINT PRIMARY KEY,              -- 智店通 orderItem.id
    order_id        VARCHAR(128) NOT NULL REFERENCES fact_orders(order_id),
    product_id      BIGINT,                          -- dim_product.id
    
    product_name    VARCHAR(512),
    product_no      VARCHAR(64),                     -- 商品编码 10007231
    sku_no          VARCHAR(64),                     -- SKU编码 10007231_20007931
    barcode         VARCHAR(64),
    mtm_code        VARCHAR(64),
    spec            VARCHAR(256),                    -- 规格 U716G1T
    
    quantity        INTEGER,
    unit_price      DECIMAL(14,2),                   -- 单价（分→元）
    total_amount    DECIMAL(14,2),                   -- 行总额
    pay_amount      DECIMAL(14,2),                   -- 实付行金额
    discount_amount DECIMAL(14,2),
    
    unit            VARCHAR(32),
    serial_number   VARCHAR(256),                    -- 序列号 SN
    category_type   BIGINT,
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fact_order_items_order ON fact_order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_fact_order_items_product ON fact_order_items(product_id);

-- 3. 订单支付记录
CREATE TABLE IF NOT EXISTS fact_order_payments (
    id              BIGINT PRIMARY KEY,
    order_id        VARCHAR(128) NOT NULL REFERENCES fact_orders(order_id),
    
    pay_type        SMALLINT,                        -- 5=现金
    pay_type_name   VARCHAR(64),                     -- 现金支付
    pay_channel     VARCHAR(64),                     -- 现金
    transaction     VARCHAR(128),                     -- 支付流水号 RFPP2026052817234775527458
    outer_transaction VARCHAR(128),
    
    pay_amount      DECIMAL(14,2),                   -- 支付金额
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fact_order_payments_order ON fact_order_payments(order_id);

-- 4. 库存快照（每日）
CREATE TABLE IF NOT EXISTS fact_inventory (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    
    store_id        BIGINT,                          -- dim_store.id
    store_code      VARCHAR(64),
    store_name      VARCHAR(256),
    
    product_id      BIGINT,                          -- dim_product.id
    sku_no          VARCHAR(64),
    barcode         VARCHAR(64),
    product_name    VARCHAR(512),
    
    warehouse_code  VARCHAR(64),
    warehouse_name  VARCHAR(256),
    
    available_qty   INTEGER DEFAULT 0,               -- 可用库存
    locked_qty      INTEGER DEFAULT 0,               -- 锁定库存
    in_transit_qty  INTEGER DEFAULT 0,               -- 在途库存
    total_qty       INTEGER GENERATED ALWAYS AS (available_qty + locked_qty + in_transit_qty) STORED,
    
    unit_cost       DECIMAL(14,2),                   -- 成本价
    retail_price    DECIMAL(14,2),                   -- 零售价
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_fact_inventory_snap 
    ON fact_inventory(snapshot_date, store_id, product_id, COALESCE(warehouse_code,''));
CREATE INDEX IF NOT EXISTS ix_fact_inventory_product ON fact_inventory(product_id);
CREATE INDEX IF NOT EXISTS ix_fact_inventory_store ON fact_inventory(store_id);

-- 5. 库存单据（入库/出库）
CREATE TABLE IF NOT EXISTS fact_stock_orders (
    stock_order_id  VARCHAR(128) PRIMARY KEY,       -- 入库单号/出库单号
    order_no        VARCHAR(128),
    
    order_type      SMALLINT,                       -- 1=采购入库 2=销售出库 3=其他出库
    order_type_name VARCHAR(64),
    
    store_id        BIGINT,
    store_code      VARCHAR(64),
    store_name      VARCHAR(256),
    
    from_store_id   BIGINT,
    from_store_name VARCHAR(256),
    to_store_id     BIGINT,
    to_store_name   VARCHAR(256),
    
    status          SMALLINT,
    status_name     VARCHAR(64),
    
    create_user_id  BIGINT,
    create_user_name VARCHAR(128),
    
    created_time    TIMESTAMPTZ,
    confirm_time    TIMESTAMPTZ,
    
    remark          VARCHAR(1024),
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now(),
    source_name     VARCHAR(64) DEFAULT 'zhidiantong'
);

CREATE INDEX IF NOT EXISTS ix_fact_stock_orders_store ON fact_stock_orders(store_id);
CREATE INDEX IF NOT EXISTS ix_fact_stock_orders_type ON fact_stock_orders(order_type);
CREATE INDEX IF NOT EXISTS ix_fact_stock_orders_created ON fact_stock_orders(created_time);

-- 6. 库存单据明细
CREATE TABLE IF NOT EXISTS fact_stock_order_items (
    id              BIGINT PRIMARY KEY,
    stock_order_id  VARCHAR(128) NOT NULL REFERENCES fact_stock_orders(stock_order_id),
    product_id      BIGINT,
    
    product_name    VARCHAR(512),
    sku_no          VARCHAR(64),
    barcode         VARCHAR(64),
    mtm_code        VARCHAR(64),
    
    quantity        INTEGER,
    unit_cost       DECIMAL(14,2),
    total_amount    DECIMAL(14,2),
    
    serial_number   VARCHAR(256),                   -- 出库商品序列号
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fact_stock_order_items_stock ON fact_stock_order_items(stock_order_id);

-- 7. 商品档案
CREATE TABLE IF NOT EXISTS fact_products (
    product_id      BIGINT PRIMARY KEY,              -- spuId
    sku_id          BIGINT,                          -- skuId
    
    sku_no          VARCHAR(64) NOT NULL,            -- 商品编码 10007231
    product_no      VARCHAR(64),                     -- 同 sku_no
    barcode         VARCHAR(64),
    mtm_code        VARCHAR(64),
    
    name            VARCHAR(512),
    category        VARCHAR(128),
    spec            VARCHAR(256),
    
    store_id        BIGINT,
    store_code      VARCHAR(64),
    store_name      VARCHAR(256),
    
    retail_price    DECIMAL(14,2),                   -- 实际零售价
    cost_price      DECIMAL(14,2),                   -- 成本价
    channel_price   DECIMAL(14,2),                  -- 渠道价
    
    status          SMALLINT,                        -- 1=上架 0=下架
    status_name     VARCHAR(64),
    
    unit            VARCHAR(32),
    
    pic_url         VARCHAR(512),
    
    raw_payload     JSONB,
    collected_at    TIMESTAMPTZ DEFAULT now(),
    source_name     VARCHAR(64) DEFAULT 'zhidiantong'
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_fact_products_store_sku 
    ON fact_products(store_id, sku_id);
CREATE INDEX IF NOT EXISTS ix_fact_products_barcode ON fact_products(barcode);
CREATE INDEX IF NOT EXISTS ix_fact_products_mtm ON fact_products(mtm_code);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ETL staging 表（从 raw_records ETL 到正式表）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 订单 ETL 暂存
CREATE TABLE IF NOT EXISTS staging_orders (
    like fact_orders INCLUDING ALL
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 同步状态表（已在用）
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS sync_state (
    id                  SERIAL PRIMARY KEY,
    source_name         VARCHAR(64)  NOT NULL,
    entity_name         VARCHAR(64)  NOT NULL,
    cursor_value        TEXT,
    last_sync_time      TIMESTAMPTZ,
    last_success_time    TIMESTAMPTZ,
    last_error          TEXT,
    status              VARCHAR(32) DEFAULT 'new',
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_name, entity_name)
);

CREATE TABLE IF NOT EXISTS sync_job (
    id                  SERIAL PRIMARY KEY,
    source_name         VARCHAR(64)  NOT NULL DEFAULT 'zhidiantong',
    entity_name         VARCHAR(64)  NOT NULL,
    job_type            VARCHAR(64)  NOT NULL DEFAULT 'collect',
    parameters          JSONB,
    started_at          TIMESTAMPTZ DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              VARCHAR(32) DEFAULT 'running',
    row_count           INTEGER DEFAULT 0,
    error_message       TEXT,
    trace_path          TEXT,
    screenshot_path     TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sync_job_entity_status ON sync_job(entity_name, status);

CREATE TABLE IF NOT EXISTS raw_records (
    id                  SERIAL PRIMARY KEY,
    source_name         VARCHAR(64)  NOT NULL DEFAULT 'zhidiantong',
    entity_name         VARCHAR(64)  NOT NULL,
    record_id           VARCHAR(128) NOT NULL,
    record_hash         VARCHAR(128) NOT NULL,
    store_code          VARCHAR(64),
    payload             JSONB NOT NULL,
    collected_at        TIMESTAMPTZ DEFAULT now(),
    job_id              INTEGER,
    is_deleted          BOOLEAN DEFAULT false,
    UNIQUE (source_name, entity_name, record_id)
);

CREATE INDEX IF NOT EXISTS ix_raw_records_entity_collected 
    ON raw_records(entity_name, collected_at);
