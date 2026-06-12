import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeTmpArtifactDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gray-channel-fixtures-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function fakeVisitEvidence(articleDate: string) {
  return [
    '# 灰渠公众号入口访问证据',
    `# 访问时间: ${new Date().toISOString()}`,
    `# 可见文章日期: ${articleDate}`,
    '# 入口: 文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
    '',
  ].join('\n')
}

export function fakeRawText(quoteDate: string) {
  return [
    `报价日期 ${quoteDate}`,
    '拯救者 Y9000P 2024 9499',
    '小新 Pro 16 5699',
    '来酷 Pro 16 i5 4899',
  ].join('\n')
}
