#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
AUDIO_DIR = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "ad-machine" / "audio" / "full-service"
VOICE_NAME = "Flo (中文（中国大陆）)"

MODULES = [
    {
        "id": "draw",
        "title": "延保服务金抽奖",
        "desc": "成交后引导客户参与购机抽奖：最高档位可到5年智惠硬件保修服务，最低档位为3年智惠。先给价值锚点，再讲领取方式。",
        "value": "869",
        "valueLabel": "最高服务金",
        "points": [
            ["冲击数字", "先讲最高869，让客户先记住价值上限。"],
            ["成交话术", "今天买机，服务价值直接抽出来，买后维护成本更低。"],
            ["执行口径", "最低档位按你提供的活动规则显示为3年智惠服务。"],
        ],
    },
    {
        "id": "ai",
        "title": "AI天禧智能体",
        "desc": "给客户的第一感受是，不是买裸机：买回去就有AI助手，直接用于学习和办公场景。",
        "value": "999",
        "valueLabel": "海报标注价值",
        "points": [
            ["开场句", "这台机器回去第一天就能用AI，不用再额外配工具。"],
            ["场景展示", "资料整理、写作草稿、内容摘要、日常办公辅助。"],
            ["视觉表达", "神经网络动效加脑图场景图标，和其它模块视觉区分。"],
        ],
    },
    {
        "id": "office",
        "title": "正版Office学生版",
        "desc": "这是家长和学生最能听懂的价值点：不用再单独买基础办公软件，开机就能用。",
        "value": "748",
        "valueLabel": "海报标注价值",
        "points": [
            ["成交语句", "回去做课件、论文、表格，不再额外加预算。"],
            ["客群匹配", "学生、新入职、家庭办公客户都能直接受益。"],
            ["视觉表达", "书本、表格、演示三联图，形成开箱即用印象。"],
        ],
    },
    {
        "id": "clean",
        "title": "深度除尘清灰",
        "desc": "把买后维护可视化：官方认证服务顾问工程师深度清灰，适合打消客户对长期散热衰减的担心。",
        "value": "545",
        "valueLabel": "最高价值",
        "points": [
            ["核心数字", "单次109，最长5年累计545元价值。"],
            ["客户收益", "降低灰尘积累带来的性能与噪音焦虑。"],
            ["导购句", "机器不止卖给你，后面几年我们继续管。"],
        ],
    },
    {
        "id": "system",
        "title": "原厂系统服务",
        "desc": "这块解决的是，用不好怎么办：系统恢复、基础软件支持、长期维护路径都有人接。",
        "value": "5年",
        "valueLabel": "最长服务",
        "points": [
            ["导购句", "买后系统问题不用自己硬扛，原厂服务有路径。"],
            ["价值表达", "最长5年服务期，重点是长期稳定使用体验。"],
            ["客户感受", "从只买硬件升级到买一个持续可用状态。"],
        ],
    },
    {
        "id": "care",
        "title": "Lenovo Care智惠服务",
        "desc": "把客户最关心的后期坏了怎么办讲透：智惠服务把硬件保障周期拉长，是高客单成交的关键保障点。",
        "value": "3到5年",
        "valueLabel": "硬件保修周期",
        "points": [
            ["长期心智", "3年起步，最高到5年，帮助客户做长期预算。"],
            ["官方依据", "Lenovo Care5年服务包有公开官方页面可查。"],
            ["与抽奖关系", "抽奖模块负责触发，智惠服务模块负责解释价值。"],
        ],
    },
    {
        "id": "verify",
        "title": "序列号保修校验",
        "desc": "你要求的YOGA18个月意外校验，我们页面不写死承诺，改成现场序列号真实校验流程：当着客户面核验结果。",
        "value": "18个月",
        "valueLabel": "YOGA意外校验目标",
        "points": [
            ["执行动作", "导购拿客户机器序列号，在联想官方服务页现场查询。"],
            ["结果展示", "查到的保修和意外信息即刻给客户看，避免口头争议。"],
            ["页面角色", "广告机负责引导先查再讲，不是凭印象承诺。"],
        ],
    },
    {
        "id": "network",
        "title": "全国服务网络",
        "desc": "这块解决买后找不到人的焦虑：网点查询、报修、预约、服务政策都可从官方入口直接触达。",
        "value": "2600+",
        "valueLabel": "服务网点资料",
        "points": [
            ["导购句", "不怕找不到售后，官方入口和网点路径都给你。"],
            ["客户动作", "扫码查网点、查保修、在线报修、预约到店。"],
            ["页面策略", "和抽奖模块形成闭环：买前讲价值，买后讲保障。"],
        ],
    },
]


def full_pitch_text() -> str:
    return "".join(
        [
            "欢迎来到联想门店全量服务讲解。",
            "先记住核心数字，抽奖服务价值最高869元，最高档位为5年智惠硬件保修，最低档位为3年智惠。",
            "购买当天可拿到AI天禧和Office学生版权益，回去马上能用。",
            "买后服务方面，原厂系统服务和深度清灰，帮助客户降低三到五年维护成本。",
            "YOGA十八个月意外校验采用序列号实机核验，现场以联想官网查询结果为准。",
            "售后入口统一在联想官方服务平台，支持查网点、查保修、在线报修与预约。",
        ]
    )


def module_pitch_text(item: dict[str, object]) -> str:
    points = item["points"]
    return f"{item['title']}。{item['desc']}。重点一，{points[0][1]}。重点二，{points[1][1]}。重点三，{points[2][1]}。"


def module_sales_pitch_text(item: dict[str, object]) -> str:
    points = item["points"]
    return "".join(
        [
            f"这是{item['title']}模块。",
            f"核心价值是{item['value']}{item['valueLabel']}。",
            "给客户只讲三件事。",
            f"第一，{points[0][1]}",
            f"第二，{points[1][1]}",
            f"第三，{points[2][1]}",
            "确认客户理解后，再引导看最终到手总价值。",
        ]
    )


def build_entries() -> list[dict[str, str]]:
    entries = [{"key": "full-pitch", "text": full_pitch_text(), "filename": "full-pitch.m4a", "label": "整页AI讲解"}]
    for item in MODULES:
        entries.append(
            {
                "key": f"module:{item['id']}:pitch",
                "text": module_pitch_text(item),
                "filename": f"{item['id']}-pitch.m4a",
                "label": f"{item['title']}本模块讲解",
            }
        )
        entries.append(
            {
                "key": f"module:{item['id']}:sales",
                "text": module_sales_pitch_text(item),
                "filename": f"{item['id']}-sales.m4a",
                "label": f"{item['title']}成交快讲",
            }
        )
    return entries


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def synthesize_to_m4a(text: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_aiff = Path(tmp_dir) / "speech.aiff"
        run(["say", "-v", VOICE_NAME, "-o", str(tmp_aiff), text])
        run(["afconvert", "-f", "m4af", "-d", "aac", str(tmp_aiff), str(output_path)])


def main() -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest_entries = []
    for entry in build_entries():
        output_path = AUDIO_DIR / entry["filename"]
        synthesize_to_m4a(entry["text"], output_path)
        manifest_entries.append(
            {
                "key": entry["key"],
                "label": entry["label"],
                "src": f"./audio/full-service/{entry['filename']}",
                "voice": VOICE_NAME,
                "provider": "macos_say",
            }
        )
    manifest = {
        "generatedAt": datetime.now().isoformat(),
        "voice": VOICE_NAME,
        "provider": "macos_say",
        "itemCount": len(manifest_entries),
        "items": manifest_entries,
    }
    (AUDIO_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (AUDIO_DIR / "manifest.js").write_text(
        "window.__FULL_SERVICE_AUDIO_MANIFEST__ = "
        + json.dumps(manifest, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"generated {len(manifest_entries)} audio files -> {AUDIO_DIR}")


if __name__ == "__main__":
    main()
