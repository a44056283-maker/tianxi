import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dataDir = path.join(root, 'public', 'data')
const outDir = path.join(root, 'public', 'flyers')

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
}

function formatPrice(value, fallback = '—') {
  if (!Number.isFinite(value) || value <= 0) return fallback
  const rounded = Math.round(value * 100) / 100
  return `¥${rounded.toLocaleString('zh-CN', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/国家补贴/g, '国补')
    .trim()
}

function composeSourceTitle(record) {
  if (!record) return undefined
  const raw = record.raw ?? {}
  const isEvidenceOnlyTitle = (value) => /系列家族页|可见子配置|家族详情页/.test(String(value ?? ''))
  const parts = [
    record.matchTitle,
    raw.mainTitle,
    raw.productTitle,
    raw.searchTitle,
    raw.subTitle,
    raw.subtitle,
    raw.subheading,
    raw.viceTitle,
    raw.sellingPoint,
    raw.configurationTitle,
    raw.specTitle,
    raw.matchedConfig,
  ]
    .map(normalizeTitle)
    .filter(Boolean)
    .filter((part) => !isEvidenceOnlyTitle(part))
    .filter((part) => !/^(undefined|null|待补)$/i.test(part))
  const unique = Array.from(new Set(parts))
  return unique.length ? unique.join(' · ') : undefined
}

function splitTitleAndSubtitle(displayTitle, product) {
  const title = normalizeTitle(displayTitle)
  const clean = (value) => normalizeTitle(value)
  const fallbackSubtitleParts = [clean(product.spec), clean(product.pnMtm)].filter(Boolean)

  if (!title) {
    return {
      mainTitle: clean(product.productName) || '联想门店推荐机型',
      subtitle: fallbackSubtitleParts.join(' · '),
    }
  }

  const dotParts = title.split('·').map((item) => clean(item)).filter(Boolean)
  if (dotParts.length >= 2) {
    return {
      mainTitle: dotParts[0],
      subtitle: [...dotParts.slice(1), ...fallbackSubtitleParts].filter(Boolean).join(' · '),
    }
  }

  const configStartPattern = /(酷睿|锐龙|Ultra\s*\d|U\d{3,4}[A-Z]?|R\d{3,4}[A-Z]?|i[3579]-?\d{4,5}|R[3579]-?\d{3,5}|RTX\s*\d{4}|\d+\s*G(?:B)?\s*[\/+＋]\s*\d+\s*T(?:B)?|\d+\s*T(?:B)?\s*[\/+＋]\s*\d+\s*G(?:B)?|\d+(?:\.\d+)?K\s*\d+Hz|黑色|白色|灰色|深灰色|云影色|碳晶黑|冰魄白|钛晶黑|幻影黑|深空灰|霜雪银)/i
  const match = configStartPattern.exec(title)
  if (match && match.index >= 6) {
    const mainTitle = clean(title.slice(0, match.index))
    const extractedSubtitle = clean(title.slice(match.index))
    return {
      mainTitle: mainTitle || title,
      subtitle: [extractedSubtitle, ...fallbackSubtitleParts].filter(Boolean).join(' · '),
    }
  }

  return {
    mainTitle: title,
    subtitle: fallbackSubtitleParts.join(' · '),
  }
}

function getProductFamily(product) {
  if (isTabletAccessoryUnder500(product)) return 'other'
  const category = String(product.category ?? '').toUpperCase()
  if (/平板|PAD|TAB/.test(category)) return 'tablet'
  if (isPhoneProduct(product)) return 'phone'
  if (/笔记本|台式|主机|一体机/.test(category)) return 'computer'
  const text = `${product.productName ?? ''} ${product.displayTitle ?? ''}`.toUpperCase()
  if (/笔记本|台式|主机|一体机|小新|拯救者|YOGA|来酷|LECOO|LEGION|GEEKPRO|Y7000|Y9000|R7000|R9000/.test(text)) return 'computer'
  if (/平板|PAD|TAB|TB\d+|(?:^|[^A-Z0-9])Y(?:700|900)(?!0)/.test(text)) return 'tablet'
  return 'other'
}

function isAccessoryProduct(product) {
  return /钢化膜|保护膜|保护夹|保护壳|支架|键盘|鼠标|耳机|音箱|套装|服务|延保|贴膜/i.test(`${product.category ?? ''} ${product.productName ?? ''} ${product.displayTitle ?? ''} ${product.spec ?? ''}`)
}

function getTabletAccessoryPriceHint(product) {
  return product.recommendedPreSubsidyPrice
    ?? product.displayPrice
    ?? product.jdPrice
    ?? product.lenovoOfficialPrice
    ?? product.taobaoPrice
    ?? product.graySuggestedRetailPrice
    ?? product.agentPrice
    ?? product.salesCostPrice
}

function isTabletAccessoryUnder500(product) {
  const text = `${product.category ?? ''} ${product.productName ?? ''} ${product.displayTitle ?? ''} ${product.spec ?? ''} ${product.pnMtm ?? ''}`.toUpperCase()
  if (/平板配件/.test(text)) return true
  if (!/平板|\bTAB\b|\bPAD\b|TB\d+|Y700(?!0)|Y900/i.test(text)) return false
  if (!/钢化膜|保护膜|保护夹|保护壳|支架|键盘|手写笔|触控笔|套装|贴膜|底座|散热壳|笔尖/i.test(text)) return false
  const price = getTabletAccessoryPriceHint(product)
  return Number.isFinite(price) && price > 0 && price < 500
}

function isPhoneProduct(product) {
  if (isAccessoryProduct(product)) return false
  const text = `${product.category ?? ''} ${product.productName ?? ''} ${product.displayTitle ?? ''} ${product.pnMtm ?? ''} ${product.spec ?? ''}`.toUpperCase()
  return /(?:^|[^A-Z0-9])PHN(?:[^A-Z0-9]|$)|MOTO|MOTOROLA|摩托|RAZR|EDGE|X70\s*AIR|智能手机/.test(text)
}

function calculateSubsidyPrice(price, product) {
  if (!Number.isFinite(price) || price <= 0) return undefined
  const family = getProductFamily(product)
  if (family === 'other') return undefined
  if ((family === 'tablet' || family === 'phone') && price >= 6000) return undefined
  const subsidy = family === 'computer'
    ? (price >= 10000 ? 1500 : price * 0.15)
    : Math.min(price * 0.15, 500)
  return Math.round((price - subsidy) * 100) / 100
}

function getEffectivePreSubsidyPrice(item) {
  const value = Number(item.recommendedPreSubsidyPrice)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function daysLeft(dateString) {
  if (!dateString) return undefined
  const today = new Date('2026-05-21T00:00:00+08:00')
  const target = new Date(`${dateString}T00:00:00+08:00`)
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86400000)
  return Number.isFinite(diff) ? diff : undefined
}

function getModelSeries(product) {
  const text = `${product.displayTitle ?? ''} ${product.productName ?? ''}`.toUpperCase()
  const ordered = [
    ['Y9000P', /Y9000P/],
    ['Y9000X', /Y9000X/],
    ['Y7000P', /Y7000P/],
    ['Y7000X', /Y7000X/],
    ['Y7000', /Y7000(?![PX])/],
    ['R9000P', /R9000P/],
    ['R7000P', /R7000P/],
    ['斗战者', /斗战者|战7000|N17|N176/],
    ['小新Pro16 GT', /小新\s*PRO\s*16\s*GT|PRO16GT/],
    ['小新Pro16', /小新\s*PRO\s*16|PRO16/],
    ['小新Pro14', /小新\s*PRO\s*14|PRO14/],
    ['小新16', /小新\s*16|XIAOXIN16/],
    ['小新14', /小新\s*14|XIAOXIN14/],
    ['小新Air', /小新\s*AIR|AIR13|AIR14/],
    ['YOGA Air 14 Ultra', /YOGA\s*AIR\s*14\s*ULTRA/],
    ['YOGA Air', /YOGA\s*AIR/],
    ['YOGA', /YOGA/],
    ['拯救者Y900', /Y900(?!0)/],
    ['拯救者Y700', /Y700(?!0)/],
    ['小新Pad Pro13', /PAD\s*PRO\s*13|PADPRO13|PRO13|TB376|TB323/],
    ['小新Pad Pro12.7', /12\.7|TB375/],
    ['小新Pad Pro', /PAD\s*PRO|PRO\s*GT|TB371/],
    ['小新平板12.1', /12\.1|TB370/],
    ['小新平板11', /平板\s*11|PAD\s*11|TB335|TB322|ZAFT/],
    ['moto razr', /RAZR/],
    ['moto edge', /EDGE/],
    ['moto g', /\bG\d{2,3}\b|G100/],
    ['moto S', /S50/],
    ['来酷Air16', /来酷.*AIR16|LECOO.*AIR16/],
    ['来酷Pro14', /来酷.*PRO14|LECOO.*PRO14/],
    ['来酷', /来酷|LECOO/],
  ]
  return ordered.find(([, pattern]) => pattern.test(text))?.[0] ?? '其它型号'
}

function getProductsByPredicate(projection, predicate) {
  return (projection.items ?? [])
    .filter((item) => predicate(item) && item.currentStock > 0)
    .map((item) => {
      const pricing = item.pricing ?? {}
      const effectivePreSubsidyPrice = Number(pricing.storeRetailPrice ?? item.recommendedPreSubsidyPrice ?? 0) || undefined
      const boostAmount = Number(pricing.marketingPoAmount ?? 0) || 0
      const educationDiscountAmount = Number(pricing.educationDiscountAmount ?? 0) || 0
      const staticAdjustedPreSubsidyPrice = Number(pricing.adjustedPreSubsidyPrice ?? 0) || undefined
      const adjustedPreSubsidyPrice = staticAdjustedPreSubsidyPrice
        ?? (Number.isFinite(effectivePreSubsidyPrice)
          ? Math.max(Number(effectivePreSubsidyPrice) - boostAmount - educationDiscountAmount, 0)
          : undefined)
      const validTo = pricing.effectiveTo || item.marketingPoActivity?.validTo || item.educationActivity?.validTo || item.storeManualPromotion?.validTo
      const validFrom = pricing.effectiveFrom || item.marketingPoActivity?.validFrom || item.educationActivity?.validFrom || item.storeManualPromotion?.validFrom
      const storeManualPromotionAmount = Number(pricing.storeManualPromotionAmount ?? 0) || 0
      const product = {
        ...item,
        recommendedPreSubsidyPrice: effectivePreSubsidyPrice,
        displayTitle: item.displayTitle || item.productName,
        boostAmount,
        educationDiscountAmount,
        activityLabels: Array.isArray(item.activityLabels) ? item.activityLabels : [],
        validFrom,
        validTo,
        remainingDays: daysLeft(validTo),
        adjustedPreSubsidyPrice,
        storeManualPromotion: item.storeManualPromotion ?? null,
      }
      const subsidyAfterActivityPrice = calculateSubsidyPrice(adjustedPreSubsidyPrice, product)
      const computedFinalPrice = Number.isFinite(subsidyAfterActivityPrice)
        ? Math.max(Number(subsidyAfterActivityPrice) - storeManualPromotionAmount, 0)
        : undefined
      return {
        ...product,
        fullServiceAfterActivityPrice: computedFinalPrice
          ?? (Number(pricing.finalPrice ?? pricing.nationalSubsidyPrice ?? 0)
            || calculateSubsidyPrice(adjustedPreSubsidyPrice, product)),
        modelSeries: getModelSeries(product),
      }
    })
    .sort((left, right) => {
      const leftActivity = left.boostAmount || left.educationDiscountAmount ? 1 : 0
      const rightActivity = right.boostAmount || right.educationDiscountAmount ? 1 : 0
      return right.currentStock - left.currentStock || rightActivity - leftActivity || (right.recommendedPreSubsidyPrice ?? 0) - (left.recommendedPreSubsidyPrice ?? 0)
    })
}

function getProducts(category, projection) {
  return getProductsByPredicate(projection, (item) => item.category === category)
}

function renderActivity(product) {
  const date = product.validFrom && product.validTo
    ? `<em>${product.validFrom} 至 ${product.validTo}${Number.isFinite(product.remainingDays) ? ` · 剩${Math.max(product.remainingDays, 0)}天` : ''}</em>`
    : ''
  const storePromotion = product.storeManualPromotion
  const storePromotionAmount = Number(product.pricing?.storeManualPromotionAmount ?? 0) || 0
  if (!product.boostAmount && !product.educationDiscountAmount && !storePromotionAmount) {
    return '<span class="muted">暂无本期营销/教育补满减</span>'
  }
  return `
    <div class="activity-badges">
      ${product.boostAmount ? `<span><b>营销PO</b><strong>-${formatPrice(product.boostAmount)}</strong></span>` : ''}
      ${product.educationDiscountAmount ? `<span><b>教育补</b><strong>-${formatPrice(product.educationDiscountAmount)}</strong></span>` : ''}
      ${storePromotionAmount ? `<span><b>${storePromotion?.mode === 'fixed_price' ? '店面活动价' : '店面活动'}</b><strong>-${formatPrice(storePromotionAmount)}</strong></span>` : ''}
    </div>
    ${date}
  `
}

function renderExecutionFormula(product) {
  const basePrice = Number(product.recommendedPreSubsidyPrice ?? 0) || 0
  const adjustedPrice = Number(product.adjustedPreSubsidyPrice ?? 0) || 0
  const boostAmount = Number(product.boostAmount ?? 0) || 0
  const educationDiscountAmount = Number(product.educationDiscountAmount ?? 0) || 0
  const storePromotion = product.storeManualPromotion
  const storePromotionAmount = Number(product.pricing?.storeManualPromotionAmount ?? 0) || 0
  if (!basePrice || !adjustedPrice) return ''
  const parts = [`原门店挂牌价 ${formatPrice(basePrice)}`]
  if (storePromotion?.mode === 'fixed_price' && Number(storePromotion.value ?? 0) > 0) {
    parts.push(`店面活动价 ${formatPrice(Number(storePromotion.value))}`)
    if (boostAmount > 0) parts.push(`营销PO ${formatPrice(boostAmount)}`)
    if (educationDiscountAmount > 0) parts.push(`教育补 ${formatPrice(educationDiscountAmount)}`)
  } else {
    if (boostAmount > 0) parts.push(`营销PO ${formatPrice(boostAmount)}`)
    if (educationDiscountAmount > 0) parts.push(`教育补 ${formatPrice(educationDiscountAmount)}`)
    if (storePromotionAmount > 0) parts.push(`店面活动 ${formatPrice(storePromotionAmount)}`)
  }
  if (parts.length === 1 && Math.abs(basePrice - adjustedPrice) < 0.01) return ''
  return `<em class="execution-formula">活动后国补前执行价 ${formatPrice(adjustedPrice)} = ${parts.join(' - ')}</em>`
}

function renderProductCard(product, index, tone) {
  const activityTotal = product.boostAmount + product.educationDiscountAmount
  const { mainTitle, subtitle } = splitTitleAndSubtitle(product.displayTitle, product)
  return `
    <article
      class="product-card ${tone}"
      data-series="${product.modelSeries}"
      data-sku-key="${product.skuKey}"
      data-base-store-price="${product.recommendedPreSubsidyPrice ?? ''}"
      data-static-adjusted-price="${product.adjustedPreSubsidyPrice ?? ''}"
      data-static-final-price="${product.fullServiceAfterActivityPrice ?? ''}"
      data-boost-amount="${product.boostAmount ?? 0}"
      data-education-amount="${product.educationDiscountAmount ?? 0}"
      data-product-family="${getProductFamily(product)}"
    >
      <div class="product-topline">
        <span class="rank">${String(index + 1).padStart(2, '0')}</span>
        <span class="series-tag">${product.modelSeries}</span>
        <span>SKU ${product.skuKey}</span>
        <span>库存 ${product.currentStock} 台 · 可售 ${product.sellableStock ?? product.currentStock} · SN ${product.serialCount ?? product.currentStock}</span>
      </div>
      <h2 class="product-title-line">
        <span class="product-main-title">${mainTitle}</span>
        <span class="product-subtitle">${subtitle || '参数信息待补齐'}</span>
      </h2>
      <div class="price-track">
        <div class="price-cell store">
          <span>PN/MTM ${product.pnMtm || '待补'} · 原门店挂牌价</span>
          <strong class="store-price-value">${formatPrice(product.recommendedPreSubsidyPrice)}</strong>
        </div>
        <div class="price-cell campaign">
          <span class="campaign-summary">${activityTotal > 0 ? `本期立减 ${formatPrice(activityTotal)}` : '活动满减'}</span>
          <div class="campaign-content">${renderActivity(product)}</div>
        </div>
        <div class="price-cell before-subsidy">
          <span>活动后国补前执行价</span>
          <strong class="before-subsidy-value">${formatPrice(product.adjustedPreSubsidyPrice)}</strong>
          ${renderExecutionFormula(product)}
        </div>
        <div class="price-cell final">
          <span>全量服务国补后</span>
          <strong class="final-price-value">${formatPrice(product.fullServiceAfterActivityPrice)}</strong>
        </div>
      </div>
    </article>
  `
}

function renderFilterButtons(products) {
  const grouped = new Map()
  for (const product of products) grouped.set(product.modelSeries, (grouped.get(product.modelSeries) ?? 0) + 1)
  const series = Array.from(grouped.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
  return [
    `<button type="button" class="active" data-filter="全部">全部 <span>${products.length}</span></button>`,
    ...series.map(([label, count]) => `<button type="button" data-filter="${label}">${label} <span>${count}</span></button>`),
  ].join('')
}

function renderPage(config) {
  const activityCount = config.products.filter((item) => item.boostAmount || item.educationDiscountAmount).length
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      background: ${config.bodyBackground};
      color: ${config.textColor};
      overflow-x: hidden;
    }
    .promo-page {
      width: 100%;
      max-width: 2160px;
      margin: 0 auto;
      padding: clamp(16px, 2vw, 28px);
      overflow-x: hidden;
      background:
        radial-gradient(circle at 10% 6%, ${config.glowOne}, transparent 30%),
        radial-gradient(circle at 88% 10%, ${config.glowTwo}, transparent 34%),
        linear-gradient(145deg, ${config.panelFrom}, ${config.panelTo});
      min-height: max(100vh, calc(min(100vw, 2160px) * 1.758333));
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    .hero-title {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      padding: 24px;
      background: ${config.heroBackground};
      color: ${config.heroText};
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22);
    }
    .hero-title::after {
      content: "618";
      position: absolute;
      right: 22px;
      bottom: -28px;
      font-size: 148px;
      line-height: 1;
      font-weight: 900;
      color: ${config.watermark};
      letter-spacing: 0;
    }
    .eyebrow {
      display: inline-flex;
      padding: 7px 12px;
      border-radius: 999px;
      background: ${config.eyebrowBg};
      color: ${config.eyebrowText};
      font-size: 13px;
      font-weight: 900;
    }
    h1 {
      margin: 18px 0 10px;
      font-size: clamp(34px, 5vw, 64px);
      line-height: 1.02;
      letter-spacing: 0;
    }
    .hero-title p {
      position: relative;
      z-index: 1;
      margin: 0;
      max-width: 860px;
      font-size: 16px;
      line-height: 1.55;
      color: ${config.heroSubText};
    }
    .hero-side {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .side-card {
      border-radius: 14px;
      padding: 16px;
      background: ${config.sideCardBg};
      border: 1px solid ${config.borderColor};
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
    }
    .side-card span {
      display: block;
      color: ${config.subtleText};
      font-size: 12px;
      font-weight: 800;
    }
    .side-card strong {
      display: block;
      margin-top: 8px;
      font-size: 28px;
      line-height: 1;
    }
    .series-filter {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
      padding: 10px;
      border: 1px solid ${config.borderColor};
      border-radius: 14px;
      background: ${config.filterBg};
      backdrop-filter: blur(12px);
    }
    .series-filter button {
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid ${config.filterButtonBorder};
      border-radius: 999px;
      background: ${config.filterButtonBg};
      color: ${config.filterButtonText};
      font-weight: 900;
      cursor: pointer;
    }
    .series-filter button.active {
      background: ${config.filterActiveBg};
      color: ${config.filterActiveText};
    }
    .series-filter span {
      opacity: 0.78;
      margin-left: 4px;
    }
    .product-grid {
      display: grid;
      gap: 12px;
    }
    .product-card {
      padding: 16px;
      border-radius: 18px;
      background: ${config.cardBg};
      border: 1px solid ${config.borderColor};
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.13);
    }
    .product-card[hidden] { display: none; }
    .product-topline {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
      color: ${config.subtleText};
      font-size: 12px;
      font-weight: 800;
    }
    .rank,
    .series-tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      background: ${config.rankBg};
      color: ${config.rankText};
      font-weight: 900;
    }
    .series-tag {
      background: ${config.seriesTagBg};
      color: ${config.seriesTagText};
    }
    .product-card h2 {
      margin: 0 0 14px;
      color: ${config.titleColor};
      font-size: clamp(18px, 2.2vw, 28px);
      line-height: 1.28;
      letter-spacing: 0;
      word-break: normal;
    }
    .product-title-line {
      display: flex;
      align-items: baseline;
      gap: 10px;
      white-space: nowrap;
      overflow: visible;
    }
    .product-main-title,
    .product-subtitle {
      display: inline;
      min-width: 0;
      color: ${config.titleColor};
      font-size: inherit;
      line-height: inherit;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .price-track {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .price-cell {
      min-height: 112px;
      padding: 14px;
      border-radius: 14px;
      background: ${config.priceCellBg};
      border: 1px solid ${config.priceCellBorder};
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
    }
    .price-cell span,
    .price-cell em {
      font-style: normal;
      color: ${config.subtleText};
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
    }
    .price-cell strong {
      color: ${config.priceColor};
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1;
      white-space: nowrap;
    }
    .price-cell.final {
      background: ${config.finalBg};
      border-color: ${config.finalBorder};
    }
    .price-cell.final span,
    .price-cell.final em {
      color: ${config.finalMetaColor};
    }
    .price-cell.final strong {
      color: ${config.finalPriceColor};
    }
    .activity-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .activity-badges span {
      display: inline-grid;
      gap: 3px;
      padding: 6px 8px;
      border-radius: 10px;
      background: ${config.activityTagBg};
      color: ${config.activityTagText};
    }
    .activity-badges b {
      font-size: 11px;
    }
    .activity-badges strong {
      color: ${config.activityPriceColor};
      font-size: 18px;
    }
    .muted {
      color: ${config.subtleText};
      font-size: 12px;
      font-weight: 800;
    }
    .notice {
      margin-top: 16px;
      border-radius: 14px;
      padding: 14px 16px;
      background: ${config.noticeBg};
      border: 2px solid ${config.noticeBorder};
      color: ${config.noticeText};
      font-size: 14px;
      line-height: 1.55;
      font-weight: 900;
    }
    .footer {
      margin-top: 10px;
      color: ${config.subtleText};
      font-size: 12px;
      line-height: 1.5;
    }
    @media (max-width: 860px) {
      .promo-page { padding: 14px; }
      .hero { grid-template-columns: 1fr; }
      .hero-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .price-track { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .price-track { grid-template-columns: 1fr; }
      .hero-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .product-card h2 { font-size: 18px; }
    }
    @media (orientation: portrait) {
      .promo-page {
        width: 100vw;
        max-width: none;
        padding: 20px 16px 30px;
      }
      .hero {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .hero-side {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .series-filter {
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .series-filter button {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .product-grid {
        gap: 14px;
      }
      .product-card {
        padding: 16px;
      }
      .price-track {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (orientation: portrait) and (min-width: 1200px) {
      .promo-page {
        padding: 34px 26px 46px;
      }
      h1 {
        font-size: clamp(52px, 4.8vw, 84px);
      }
      .hero-title p {
        font-size: 26px;
        line-height: 1.5;
      }
      .side-card span {
        font-size: 20px;
      }
      .side-card strong {
        font-size: 48px;
      }
      .series-filter button {
        min-height: 56px;
        padding: 0 20px;
        font-size: 22px;
      }
      .product-topline {
        font-size: 20px;
        gap: 10px;
      }
      .rank,
      .series-tag {
        min-height: 38px;
        padding: 0 14px;
      }
      .product-card h2 {
        font-size: clamp(34px, 3.1vw, 50px);
        line-height: 1.3;
      }
      .product-subtitle {
        font-size: inherit;
        line-height: inherit;
      }
      .price-cell {
        min-height: 170px;
        padding: 18px;
      }
      .price-cell span,
      .price-cell em {
        font-size: 20px;
      }
      .price-cell strong {
        font-size: clamp(36px, 3.2vw, 54px);
      }
      .notice {
        font-size: 24px;
        line-height: 1.6;
      }
      .footer {
        font-size: 18px;
      }
    }
  </style>
</head>
<body>
  <main class="promo-page">
    <section class="hero">
      <div class="hero-title">
        <span class="eyebrow">${config.eyebrow}</span>
        <h1>${config.heading}</h1>
        <p>${config.subheading}</p>
      </div>
      <div class="hero-side">
        <div class="side-card"><span>全部商品</span><strong>${config.products.length}</strong></div>
        <div class="side-card"><span>带营销/教育补</span><strong>${activityCount}</strong></div>
        <div class="side-card"><span>价格口径</span><strong>实时同步</strong></div>
        <div class="side-card"><span>展示模式</span><strong>全量促销</strong></div>
      </div>
    </section>
    <nav class="series-filter" aria-label="产品型号筛选">
      ${renderFilterButtons(config.products)}
    </nav>
    <section class="product-grid">
      ${config.products.map((product, index) => renderProductCard(product, index, config.tone)).join('')}
    </section>
    <div class="notice">醒目备注：教育补需客户具备有效学生证明；如客户无学生证明且需代验证服务，成交核算时必须从教育补优惠中扣除代验证服务费，当前门店代验证费用按 ¥50/次 记录。</div>
    <div class="footer">数据来源：实时零售报价英雄卡、营销/教育补活动库、门店库存快照。生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。价格随前端快照与英雄卡数据更新。</div>
  </main>
  <script>
    const apiBase = (() => {
      if (location.protocol === 'file:') return 'http://127.0.0.1:8000'
      if (['127.0.0.1', 'localhost', '::1'].includes(location.hostname)) return location.protocol + '//' + location.hostname + ':8000'
      return location.origin
    })()
    const formatPrice = (value, fallback = '—') => {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return fallback
      const rounded = Math.round(number * 100) / 100
      return '¥' + rounded.toLocaleString('zh-CN', {
        minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
        maximumFractionDigits: 2,
      })
    }
    const getFamilyCap = (family) => {
      if (family === 'computer') return 1500
      if (family === 'tablet' || family === 'phone') return 500
      return 0
    }
    const calculateSubsidyPrice = (price, family) => {
      const number = Number(price)
      if (!Number.isFinite(number) || number <= 0) return undefined
      if ((family === 'tablet' || family === 'phone') && number >= 6000) return undefined
      if (family !== 'computer' && family !== 'tablet' && family !== 'phone') return undefined
      const cap = getFamilyCap(family)
      const subsidy = family === 'computer'
        ? Math.min(number * 0.15, cap)
        : Math.min(number * 0.15, cap)
      return Math.round((number - subsidy) * 100) / 100
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const renderStorePromotion = (promotion) => {
      const label = promotion.mode === 'fixed_price'
        ? '店面活动价'
        : '店面满减'
      const detail = promotion.mode === 'fixed_price'
        ? formatPrice(promotion.value, '—')
        : '-' + formatPrice(promotion.value, '—')
      const note = promotion.note ? '<em>' + promotion.note + '</em>' : ''
      return '<div class="activity-badges"><span><b>' + label + '</b><strong>' + detail + '</strong></span></div>' + note
    }
    const filterButtons = Array.from(document.querySelectorAll('.series-filter button'))
    const cards = Array.from(document.querySelectorAll('.product-card'))
    const currentFlyerFile = ${JSON.stringify(config.filename)}
    let currentGeneratedAt = ${JSON.stringify(flyersGeneratedAt)}
    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter
        filterButtons.forEach((item) => item.classList.toggle('active', item === button))
        cards.forEach((card) => {
          card.hidden = filter !== '全部' && card.dataset.series !== filter
        })
      })
    })
    async function refreshFlyerFromSqlProjection() {
      try {
        const response = await fetch('/flyers/lenovo-618-flyers-data.json?ts=' + Date.now(), { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json()
        const nextGeneratedAt = String(payload.generatedAt || '')
        const page = Array.isArray(payload.pages) ? payload.pages.find((item) => item && item.filename === currentFlyerFile) : null
        if (!page) return
        if (nextGeneratedAt && nextGeneratedAt !== currentGeneratedAt) {
          currentGeneratedAt = nextGeneratedAt
          window.location.reload()
        }
      } catch (error) {
        console.warn('flyer refresh check failed', error)
      }
    }
    window.setInterval(refreshFlyerFromSqlProjection, 1800000)
  </script>
</body>
</html>`
}

const publishedProjection = readJson('latest-published-product-projection.json')

const gamingProducts = getProducts('游戏笔记本', publishedProjection)
const thinLightProducts = getProducts('轻薄笔记本', publishedProjection)
const tabletProducts = getProductsByPredicate(publishedProjection, (item) => item.category === '平板电脑' && !isAccessoryProduct(item) && !isTabletAccessoryUnder500(item))
const phoneProducts = getProductsByPredicate(publishedProjection, isPhoneProduct)

const pages = [
  {
    filename: 'lenovo-618-gaming.html',
    title: '联想618游戏本门店促销页',
    tone: 'gaming',
    products: gamingProducts,
    eyebrow: '张凌赫同款 · 联想618门店焕新季',
    heading: '拯救者 / 斗战者 游戏本专场',
    subheading: '完整展示全部库存游戏本：商品标题完整展开，按 Y7000 / Y7000X / Y9000P 等小系列快速筛选，同步展示原门店挂牌价、营销/教育补、活动后国补前执行价、全量服务国补后价。',
    bodyBackground: '#160708',
    panelFrom: '#2b0709',
    panelTo: '#09090d',
    glowOne: 'rgba(255, 35, 46, 0.34)',
    glowTwo: 'rgba(255, 181, 71, 0.22)',
    textColor: '#fff6ef',
    heroBackground: 'linear-gradient(135deg, #ed1c24 0%, #7e1116 52%, #101014 100%)',
    heroText: '#fff7ed',
    heroSubText: 'rgba(255, 247, 237, 0.82)',
    watermark: 'rgba(255, 255, 255, 0.13)',
    eyebrowBg: 'rgba(255,255,255,0.16)',
    eyebrowText: '#fff',
    sideCardBg: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
    subtleText: 'rgba(255,246,239,0.66)',
    filterBg: 'rgba(20, 5, 9, 0.86)',
    filterButtonBg: 'rgba(255,255,255,0.08)',
    filterButtonBorder: 'rgba(255,255,255,0.22)',
    filterButtonText: '#ffe7d2',
    filterActiveBg: '#ffde7a',
    filterActiveText: '#310b0b',
    cardBg: 'rgba(255,255,255,0.08)',
    rankBg: 'linear-gradient(160deg, #ffde7a, #ff2d2d)',
    rankText: '#1d0906',
    seriesTagBg: 'rgba(255, 222, 122, 0.16)',
    seriesTagText: '#ffdf8e',
    titleColor: '#fff',
    priceCellBg: 'rgba(10,10,16,0.58)',
    priceCellBorder: 'rgba(255,255,255,0.12)',
    priceColor: '#fff1d6',
    finalBg: 'linear-gradient(160deg, #3b0a0c, #ed1c24)',
    finalBorder: 'rgba(255,255,255,0.4)',
    finalMetaColor: 'rgba(255,255,255,0.82)',
    finalPriceColor: '#ffffff',
    activityTagBg: 'rgba(255, 222, 122, 0.16)',
    activityTagText: '#ffe6a3',
    activityPriceColor: '#ffdc72',
    noticeBg: 'rgba(255, 222, 122, 0.16)',
    noticeBorder: '#ffde7a',
    noticeText: '#fff4d8',
  },
  {
    filename: 'lenovo-618-thin-light.html',
    title: '联想618轻薄本门店促销页',
    tone: 'thin-light',
    products: thinLightProducts,
    eyebrow: '张凌赫同款 · 联想618 AI轻薄焕新',
    heading: '小新 / YOGA / 来酷 轻薄本专场',
    subheading: '完整展示全部库存轻薄本：顶部按小新、YOGA、来酷等小系列筛选；每个商品完整显示标题，并同步原门店挂牌价、营销/教育补、活动后国补前执行价和全量服务国补后价。',
    bodyBackground: '#f7f4ef',
    panelFrom: '#fff8f0',
    panelTo: '#f5f7fb',
    glowOne: 'rgba(237, 28, 36, 0.2)',
    glowTwo: 'rgba(0, 129, 255, 0.14)',
    textColor: '#1f2430',
    heroBackground: 'linear-gradient(135deg, #ffffff 0%, #ffe4df 48%, #ff2a2f 100%)',
    heroText: '#1f2430',
    heroSubText: 'rgba(31,36,48,0.72)',
    watermark: 'rgba(237, 28, 36, 0.16)',
    eyebrowBg: '#ed1c24',
    eyebrowText: '#fff',
    sideCardBg: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(237,28,36,0.18)',
    subtleText: 'rgba(31,36,48,0.62)',
    filterBg: 'rgba(255,255,255,0.86)',
    filterButtonBg: '#fff',
    filterButtonBorder: 'rgba(237,28,36,0.22)',
    filterButtonText: '#b9151a',
    filterActiveBg: '#ed1c24',
    filterActiveText: '#fff',
    cardBg: 'rgba(255,255,255,0.9)',
    rankBg: 'linear-gradient(160deg, #ed1c24, #ff9066)',
    rankText: '#fff',
    seriesTagBg: '#fff0ec',
    seriesTagText: '#c31318',
    titleColor: '#1f2430',
    priceCellBg: '#fff7f2',
    priceCellBorder: 'rgba(237,28,36,0.14)',
    priceColor: '#c31318',
    finalBg: 'linear-gradient(160deg, #151b2b, #ed1c24)',
    finalBorder: 'rgba(237,28,36,0.32)',
    finalMetaColor: 'rgba(255,255,255,0.82)',
    finalPriceColor: '#fff',
    activityTagBg: '#fff0ec',
    activityTagText: '#a70f14',
    activityPriceColor: '#cf1318',
    noticeBg: '#fff2d8',
    noticeBorder: '#ff9f1c',
    noticeText: '#7a3c00',
  },
  {
    filename: 'lenovo-618-tablet.html',
    title: '联想618平板门店促销页',
    tone: 'tablet',
    products: tabletProducts,
    eyebrow: '联想618 · 平板学习娱乐焕新',
    heading: '小新平板 / 拯救者平板专场',
    subheading: '完整展示全部库存平板：按 Y700 / Y900 / 小新 Pad Pro / 小新平板等小系列快速筛选，同步展示原门店挂牌价、营销/教育补、活动后国补前执行价和全量服务国补后价。',
    bodyBackground: '#f2fbff',
    panelFrom: '#effbff',
    panelTo: '#ffffff',
    glowOne: 'rgba(8, 145, 178, 0.22)',
    glowTwo: 'rgba(237, 28, 36, 0.12)',
    textColor: '#102033',
    heroBackground: 'linear-gradient(135deg, #e0f7ff 0%, #ffffff 46%, #0ea5e9 100%)',
    heroText: '#102033',
    heroSubText: 'rgba(16,32,51,0.72)',
    watermark: 'rgba(14, 165, 233, 0.18)',
    eyebrowBg: '#0ea5e9',
    eyebrowText: '#fff',
    sideCardBg: 'rgba(255,255,255,0.82)',
    borderColor: 'rgba(14,165,233,0.2)',
    subtleText: 'rgba(16,32,51,0.62)',
    filterBg: 'rgba(255,255,255,0.9)',
    filterButtonBg: '#fff',
    filterButtonBorder: 'rgba(14,165,233,0.28)',
    filterButtonText: '#0369a1',
    filterActiveBg: '#0ea5e9',
    filterActiveText: '#fff',
    cardBg: 'rgba(255,255,255,0.92)',
    rankBg: 'linear-gradient(160deg, #0ea5e9, #67e8f9)',
    rankText: '#042f4a',
    seriesTagBg: '#e0f7ff',
    seriesTagText: '#0369a1',
    titleColor: '#102033',
    priceCellBg: '#f4fbff',
    priceCellBorder: 'rgba(14,165,233,0.16)',
    priceColor: '#0369a1',
    finalBg: 'linear-gradient(160deg, #075985, #0ea5e9)',
    finalBorder: 'rgba(14,165,233,0.34)',
    finalMetaColor: 'rgba(255,255,255,0.84)',
    finalPriceColor: '#fff',
    activityTagBg: '#e0f7ff',
    activityTagText: '#075985',
    activityPriceColor: '#0369a1',
    noticeBg: '#fff7d6',
    noticeBorder: '#f59e0b',
    noticeText: '#7a3c00',
  },
  {
    filename: 'lenovo-618-phone.html',
    title: '联想618手机门店促销页',
    tone: 'phone',
    products: phoneProducts,
    eyebrow: '联想618 · MOTO 手机焕新',
    heading: 'moto razr / edge / g 系列专场',
    subheading: '完整展示全部库存 MOTO 手机：按 razr、edge、g、S 系列快速筛选，同步展示原门店挂牌价、营销/教育补、活动后国补前执行价和全量服务国补后价。',
    bodyBackground: '#12091f',
    panelFrom: '#24113f',
    panelTo: '#0b1020',
    glowOne: 'rgba(147, 51, 234, 0.3)',
    glowTwo: 'rgba(236, 72, 153, 0.18)',
    textColor: '#fff7ff',
    heroBackground: 'linear-gradient(135deg, #7c3aed 0%, #db2777 48%, #111827 100%)',
    heroText: '#fff7ff',
    heroSubText: 'rgba(255,247,255,0.8)',
    watermark: 'rgba(255,255,255,0.12)',
    eyebrowBg: 'rgba(255,255,255,0.16)',
    eyebrowText: '#fff',
    sideCardBg: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
    subtleText: 'rgba(255,247,255,0.66)',
    filterBg: 'rgba(18,9,31,0.86)',
    filterButtonBg: 'rgba(255,255,255,0.08)',
    filterButtonBorder: 'rgba(255,255,255,0.22)',
    filterButtonText: '#f5d0fe',
    filterActiveBg: '#f0abfc',
    filterActiveText: '#2e1065',
    cardBg: 'rgba(255,255,255,0.08)',
    rankBg: 'linear-gradient(160deg, #f0abfc, #ec4899)',
    rankText: '#2e1065',
    seriesTagBg: 'rgba(240,171,252,0.16)',
    seriesTagText: '#f5d0fe',
    titleColor: '#fff',
    priceCellBg: 'rgba(10,10,20,0.58)',
    priceCellBorder: 'rgba(255,255,255,0.12)',
    priceColor: '#fce7f3',
    finalBg: 'linear-gradient(160deg, #581c87, #db2777)',
    finalBorder: 'rgba(255,255,255,0.34)',
    finalMetaColor: 'rgba(255,255,255,0.84)',
    finalPriceColor: '#fff',
    activityTagBg: 'rgba(240,171,252,0.16)',
    activityTagText: '#f5d0fe',
    activityPriceColor: '#f0abfc',
    noticeBg: 'rgba(240,171,252,0.14)',
    noticeBorder: '#f0abfc',
    noticeText: '#fff1ff',
  },
]

const flyersGeneratedAt = new Date().toISOString()

fs.mkdirSync(outDir, { recursive: true })
for (const page of pages) {
  fs.writeFileSync(path.join(outDir, page.filename), renderPage(page), 'utf8')
}

for (const file of fs.readdirSync(outDir)) {
  if (/^lenovo-618-.*-page-\d+\.(html|png)$/.test(file) || /^lenovo-618-(gaming|thin-light)\.png$/.test(file)) {
    fs.rmSync(path.join(outDir, file), { force: true })
  }
}

fs.writeFileSync(path.join(outDir, 'lenovo-618-flyers-data.json'), JSON.stringify({
  generatedAt: flyersGeneratedAt,
  mode: 'full_category_promotion_pages',
  sourceFiles: [
    'latest-published-product-projection.json',
  ],
  pages: pages.map((page) => ({
    filename: page.filename,
    title: page.title,
    heading: page.heading,
    subheading: page.subheading,
    eyebrow: page.eyebrow,
    tone: page.tone,
    skuCount: page.products.length,
    series: Array.from(new Set(page.products.map((item) => item.modelSeries))),
    skuKeys: page.products.map((item) => item.skuKey),
    products: page.products.map((product, index) => {
      const { mainTitle, subtitle } = splitTitleAndSubtitle(product.displayTitle, product)
      return {
        rank: index + 1,
        skuKey: product.skuKey,
        pnMtm: product.pnMtm ?? '',
        modelSeries: product.modelSeries,
        title: `${mainTitle} ${subtitle || ''}`.trim(),
        mainTitle,
        subtitle,
        currentStock: product.currentStock ?? 0,
        sellableStock: product.sellableStock ?? product.currentStock ?? 0,
        serialCount: product.serialCount ?? product.currentStock ?? 0,
        storePrice: product.recommendedPreSubsidyPrice,
        adjustedPreSubsidyPrice: product.adjustedPreSubsidyPrice,
        finalPrice: product.fullServiceAfterActivityPrice,
        boostAmount: product.boostAmount ?? 0,
        educationDiscountAmount: product.educationDiscountAmount ?? 0,
        validFrom: product.validFrom,
        validTo: product.validTo,
        remainingDays: product.remainingDays,
      }
    }),
  })),
}, null, 2), 'utf8')

console.log(`generated ${pages.length} promotion pages in ${outDir}`)
