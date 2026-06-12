const modules = [
  { id: "today", index: "01", label: "今日经营", count: "12" },
  { id: "retail", index: "02", label: "商品零售", count: "52" },
  { id: "stock", index: "03", label: "库存台账", count: "86" },
  { id: "sn", index: "04", label: "SN保修", count: "163" },
  { id: "protection", index: "05", label: "产品价保", count: "9" },
  { id: "quotes", index: "06", label: "报价来源", count: "5" },
  { id: "movements", index: "07", label: "入库出库", count: "984" },
  { id: "pos", index: "08", label: "收银台", count: "3" },
  { id: "master", index: "09", label: "商品主档", count: "2k" },
  { id: "admin", index: "10", label: "系统管理", count: "6" }
];

const flows = [
  { id: "overview", index: "01", label: "概览" },
  { id: "search", index: "02", label: "检索" },
  { id: "list", index: "03", label: "列表" },
  { id: "detail", index: "04", label: "详情" },
  { id: "risk", index: "05", label: "异常" },
  { id: "sync", index: "06", label: "同步" }
];

const products = [
  {
    title: "联想拯救者 Y7000X 2026 15.3英寸电竞游戏本",
    spec: "Ultra 7 251HX / 16GB / 1TB SSD / RTX5060 8G / 碳晶黑",
    sku: "20007932",
    pn: "83VK0048CD",
    stock: 11,
    sn: 11,
    jd: 11499,
    official: 12699,
    store: 13599,
    status: "证据完整"
  },
  {
    title: "联想拯救者 Y9000P 2026 16英寸电竞游戏本",
    spec: "i9-14900HX / 16GB / 1TB SSD / RTX5060 / 碳晶黑",
    sku: "20007936",
    pn: "83QF0002CD",
    stock: 9,
    sn: 9,
    jd: 12999,
    official: 13999,
    store: 14899,
    status: "需复核"
  }
];

const money = value => `￥${Number(value).toLocaleString("zh-CN")}`;

let currentModule = "retail";
let currentFlow = "overview";

function renderNav() {
  const nav = document.querySelector("[data-nav]");
  nav.innerHTML = "";
  modules.forEach(item => {
    const button = document.createElement("button");
    button.className = `nav-item ${item.id === currentModule ? "active" : ""}`;
    button.type = "button";
    button.dataset.module = item.id;
    button.innerHTML = `<span class="nav-index">${item.index}</span><span>${item.label}</span><span class="nav-count">${item.count}</span>`;
    button.addEventListener("click", () => {
      currentModule = item.id;
      currentFlow = "overview";
      render();
    });
    nav.appendChild(button);
  });
}

function renderFlows() {
  const tabs = document.querySelector("[data-flows]");
  tabs.innerHTML = "";
  flows.forEach(flow => {
    const button = document.createElement("button");
    button.className = `workflow-tab ${flow.id === currentFlow ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `<b>${flow.index}</b>${flow.label}`;
    button.addEventListener("click", () => {
      currentFlow = flow.id;
      renderContent();
      renderFlows();
    });
    tabs.appendChild(button);
  });
}

function productCard(product) {
  return `
    <article class="product-card">
      <div>
        <h3>${product.title}</h3>
        <div class="product-meta">
          <span>SKU ${product.sku}</span>
          <span>PN ${product.pn}</span>
        </div>
      </div>
      <div>${product.spec}</div>
      <div class="product-meta">
        <span class="badge success">库存 ${product.stock}</span>
        <span class="badge success">SN ${product.sn}</span>
        <span class="badge ${product.status === "需复核" ? "warning" : "success"}">${product.status}</span>
      </div>
      <div class="price-row">
        <div class="price-cell"><span>京东</span><strong>${money(product.jd)}</strong></div>
        <div class="price-cell"><span>官旗</span><strong>${money(product.official)}</strong></div>
        <div class="price-cell"><span>门店</span><strong>${money(product.store)}</strong></div>
      </div>
    </article>
  `;
}

function renderMainPanel() {
  if (currentModule === "pos") {
    return `
      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">收银工作台</h2>
          <span class="badge success">SQL 映射</span>
        </div>
        <div class="pos-layout">
          <div>
            <div class="category-pills">
              <button>游戏本</button><button>轻薄本</button><button>台式机</button><button>平板</button><button>配件</button>
            </div>
            <div class="product-grid" style="margin-top:10px">${products.map(productCard).join("")}</div>
          </div>
          <aside class="cart-box">
            <strong>当前单据</strong>
            <p class="muted">挂单、提单、退货、会员、交班对账固定在右侧。</p>
            <div class="price-row" style="grid-template-columns: 1fr">
              <div class="price-cell"><span>应收</span><strong>${money(13599)}</strong></div>
              <div class="price-cell"><span>活动权益</span><strong>- ${money(2500)}</strong></div>
            </div>
            <button class="btn primary" style="width:100%;margin-top:12px">确认结算</button>
          </aside>
        </div>
      </section>
    `;
  }

  if (currentFlow === "list") {
    return `
      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">${moduleLabel()}台账</h2>
          <span class="badge">分页 1 / 6</span>
        </div>
        <table class="ledger">
          <thead>
            <tr><th>单号/SKU</th><th>类型</th><th>状态</th><th class="num">数量</th><th class="num">金额</th></tr>
          </thead>
          <tbody>
            <tr><td>XS260605001</td><td>零售出库</td><td><span class="badge success">已同步</span></td><td class="num">1</td><td class="num">${money(13599)}</td></tr>
            <tr><td>CGR260605088</td><td>采购入库</td><td><span class="badge warning">待复核</span></td><td class="num">5</td><td class="num">${money(67195)}</td></tr>
            <tr><td>SN-YX0K7Q</td><td>保修</td><td><span class="badge">已入库</span></td><td class="num">1</td><td class="num">-</td></tr>
          </tbody>
        </table>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">${moduleLabel()}概览</h2>
        <span class="badge success">API + 静态快照兜底</span>
      </div>
      <div class="kpi-strip">
        <div class="kpi"><span>有库存 SKU</span><strong>52</strong></div>
        <div class="kpi"><span>待复核价格</span><strong>56</strong></div>
        <div class="kpi"><span>价保风险</span><strong>9</strong></div>
        <div class="kpi"><span>今日出库</span><strong>23</strong></div>
      </div>
      <div class="product-grid">${products.map(productCard).join("")}</div>
    </section>
  `;
}

function renderSidePanel() {
  return `
    <aside class="panel">
      <div class="panel-header">
        <h2 class="panel-title">证据链</h2>
        <span class="badge success">可追溯</span>
      </div>
      <table class="ledger">
        <tbody>
          <tr><td>SQL</td><td><span class="badge success">已映射</span></td></tr>
          <tr><td>API</td><td><span class="badge success">同源</span></td></tr>
          <tr><td>静态快照</td><td><span class="badge">兜底</span></td></tr>
          <tr><td>前端验收</td><td><span class="badge warning">待截图</span></td></tr>
        </tbody>
      </table>
      <div class="empty-state" style="margin-top:12px">详情、异常、导出等长内容进入这里的抽屉或分页，不再拖长主页面。</div>
    </aside>
  `;
}

function moduleLabel() {
  return modules.find(item => item.id === currentModule)?.label ?? "商品零售";
}

function renderContent() {
  document.querySelector("[data-module-title]").textContent = moduleLabel();
  document.querySelector("[data-module-subtitle]").textContent = `${moduleLabel()} / ${flows.find(item => item.id === currentFlow).label}`;
  document.querySelector("[data-content]").innerHTML = `${renderMainPanel()}${renderSidePanel()}`;
}

function render() {
  renderNav();
  renderFlows();
  renderContent();
}

render();
