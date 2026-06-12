export function getLenovoWarrantyLookupUrl(serialNumber: string) {
  const sn = serialNumber.trim()
  return `https://newsupport.lenovo.com.cn/deviceGuarantee.html?fromsource=deviceGuarantee&selname=${encodeURIComponent(sn)}`
}
