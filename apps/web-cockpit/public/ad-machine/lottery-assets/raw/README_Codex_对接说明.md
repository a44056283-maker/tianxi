# 联想智惠幸运大转盘素材包

本包用于广告机大屏「购机抽奖」页面，对接 Codex / 前端抽奖规则。

## 目录

```text
images/
  wheel_frames/
    01_idle_ready_click.png          # 初始态：点击抽奖
    02_spinning_motion_blur.png      # 旋转态：抽奖进行中
    03_reveal_soon_suspense.png      # 降速态：即将揭晓
    04_reward_popup_card_back.png    # 弹窗态：恭喜获得 / 点击翻卡
  reward_cards/
    reward_rare_lenovo_care_3_years.png       # 稀有奖励：智惠三年
    reward_epic_lenovo_care_4_years.png       # 史诗奖励：智惠四年
    reward_legendary_lenovo_care_5_years.png  # 传说奖励：智惠五年
manifest.json
SHA256SUMS.txt
```

## 推荐前端状态机

1. `idle`：展示 `01_idle_ready_click.png`，中心按钮「点击抽奖」。
2. `spinning`：展示/叠加 `02_spinning_motion_blur.png`，同时让真实转盘元素执行 CSS 旋转。
3. `reveal_soon`：展示 `03_reveal_soon_suspense.png`，转速降低，指针增强发光。
4. `popup`：展示 `04_reward_popup_card_back.png`，遮罩背景，提示「点击翻开英雄卡」。
5. `reward_card`：根据抽奖结果弹出对应卡片：
   - 稀有奖励：`reward_rare_lenovo_care_3_years.png`
   - 史诗奖励：`reward_epic_lenovo_care_4_years.png`
   - 传说奖励：`reward_legendary_lenovo_care_5_years.png`

## 三档奖励口径

| 奖励等级 | 奖励名称 | 展示主题 | 卡片重点 |
|---|---|---|---|
| 稀有奖励 | 智惠三年 | Lenovo Care 智惠服务·三年 | 三年总保修期、7×24 技术支持、每年1次外观清洁、操作系统支持 |
| 史诗奖励 | 智惠四年 | Lenovo Care 智惠服务·四年 | 四年总保修期、7×24 技术支持、每年1次外观清洁、操作系统支持 |
| 传说奖励 | 智惠五年 | Lenovo Care 智惠服务·五年 | 五年总保修期、7×24 技术支持、每年1次清洁保养、预装软件 / 操作系统支持 |

补充展示口径：`20000+ 专业工程师 · 2600+ 服务网点`。

## 动效建议

- 转盘主体：`transform: rotate(...)`，前 1.5 秒快速加速，中段匀速，最后 1.2 秒使用 `cubic-bezier(.12,.8,.18,1)` 减速。
- 指针：揭晓前 0.3 秒做 2-3 次轻微抖动，叠加金色外发光。
- 翻卡：弹窗卡背出现后，点击触发 `rotateY(0deg -> 180deg)`，中点切换为对应奖励卡。
- 粒子：抽奖进行中使用金色环形粒子；中奖后增加少量红金碎片，不要遮挡卡面文字。

## 注意

- 素材为视觉展示用，抽奖概率、奖品库存、活动有效期、核销规则请在前端/后端规则中单独维护。
- 服务权益文案最终以联想官方当期页面和门店活动规则为准。
