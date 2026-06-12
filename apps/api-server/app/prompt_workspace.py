from __future__ import annotations

import json
import re
import ssl
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from app import retail_core


MINIMAX_SSL_CONTEXT = ssl._create_unverified_context()
DEFAULT_PROJECT_BACKGROUND = {
    "projectName": "联想智慧零售系统",
    "systemPurpose": "完成整个店面的智能化经营",
    "existingContext": "已经有完善的运行逻辑和商业化规则化",
}
DEFAULT_PRIMARY_CATEGORY = "主提问内容"
DEFAULT_SECONDARY_CATEGORY = "默认流程"
DEFAULT_SEQUENCE_NO = 10
SYSTEM_KNOWLEDGE_ENTRY_ID = "prompt-workspace-system-root"
RULE_SCENE_CATALOG = [
    {"key": "ui_layout", "label": "界面布局", "keywords": ["ui", "界面", "布局", "样式", "颜色", "卡片", "移动端", "平板", "手机", "自适应"]},
    {"key": "data_sync", "label": "数据同步", "keywords": ["同步", "sql", "sqlite", "数据库", "映射", "接口", "api", "快照", "前端数据"]},
    {"key": "collection_flow", "label": "采集流程", "keywords": ["采集", "微信", "群报价", "公众号", "智店通", "导出", "导入", "手工采集"]},
    {"key": "audit_fix", "label": "审计修复", "keywords": ["审计", "核对", "排查", "修复", "bug", "错位", "缺失", "校验"]},
    {"key": "scheduler", "label": "定时任务", "keywords": ["定时", "自动化", "任务", "heartbeat", "cron", "执行", "看板", "回执"]},
    {"key": "prompt_engineering", "label": "提示词工程", "keywords": ["提示词", "提问", "模板", "知识库", "规则库", "场景", "minimax", "openclaw"]},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_lines(values: list[str] | tuple[str, ...] | None) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = normalize_text(value)
        if not text or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return normalized


def init_db() -> None:
    with retail_core.connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS prompt_workspace_entry (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT '通用任务',
              primary_category TEXT NOT NULL DEFAULT '主提问内容',
              secondary_category TEXT NOT NULL DEFAULT '默认流程',
              sequence_no INTEGER NOT NULL DEFAULT 10,
              is_favorite INTEGER NOT NULL DEFAULT 0,
              project_name TEXT NOT NULL DEFAULT '',
              system_purpose TEXT NOT NULL DEFAULT '',
              existing_context TEXT NOT NULL DEFAULT '',
              current_problem TEXT NOT NULL DEFAULT '',
              target_outcome TEXT NOT NULL DEFAULT '',
              raw_notes TEXT NOT NULL DEFAULT '',
              generated_prompt TEXT NOT NULL DEFAULT '',
              optimized_prompt TEXT NOT NULL DEFAULT '',
              generated_summary TEXT NOT NULL DEFAULT '',
              blueprint_json TEXT NOT NULL DEFAULT '{}',
              audit_json TEXT NOT NULL DEFAULT '{}',
              source_payload_json TEXT NOT NULL DEFAULT '{}',
              minimax_status TEXT NOT NULL DEFAULT 'not_requested',
              minimax_payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prompt_workspace_revision (
              id TEXT PRIMARY KEY,
              entry_id TEXT NOT NULL,
              revision_no INTEGER NOT NULL,
              action_type TEXT NOT NULL DEFAULT 'create',
              generated_prompt TEXT NOT NULL DEFAULT '',
              optimized_prompt TEXT NOT NULL DEFAULT '',
              generated_summary TEXT NOT NULL DEFAULT '',
              blueprint_json TEXT NOT NULL DEFAULT '{}',
              audit_json TEXT NOT NULL DEFAULT '{}',
              minimax_status TEXT NOT NULL DEFAULT 'not_requested',
              minimax_payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              FOREIGN KEY(entry_id) REFERENCES prompt_workspace_entry(id)
            );

            CREATE TABLE IF NOT EXISTS prompt_workspace_keyword (
              id TEXT PRIMARY KEY,
              entry_id TEXT NOT NULL,
              keyword TEXT NOT NULL,
              normalized_keyword TEXT NOT NULL,
              weight INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              FOREIGN KEY(entry_id) REFERENCES prompt_workspace_entry(id)
            );

            CREATE TABLE IF NOT EXISTS prompt_workspace_knowledge (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              keyword TEXT NOT NULL DEFAULT '',
              normalized_keyword TEXT NOT NULL DEFAULT '',
              content TEXT NOT NULL DEFAULT '',
              tags_json TEXT NOT NULL DEFAULT '[]',
              knowledge_type TEXT NOT NULL DEFAULT 'general',
              placement_key TEXT NOT NULL DEFAULT 'knowledge',
              scene_key TEXT NOT NULL DEFAULT '',
              scene_label TEXT NOT NULL DEFAULT '',
              source_entry_id TEXT NOT NULL DEFAULT '',
              source_kind TEXT NOT NULL DEFAULT 'manual',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(source_entry_id) REFERENCES prompt_workspace_entry(id)
            );

            CREATE INDEX IF NOT EXISTS idx_prompt_workspace_entry_updated_at
              ON prompt_workspace_entry(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_prompt_workspace_keyword_keyword
              ON prompt_workspace_keyword(normalized_keyword);
            CREATE INDEX IF NOT EXISTS idx_prompt_workspace_knowledge_keyword
              ON prompt_workspace_knowledge(normalized_keyword);
            """
        )
        entry_columns = {
            str(row["name"]): row
            for row in conn.execute("PRAGMA table_info(prompt_workspace_entry)").fetchall()
        }
        if "category" not in entry_columns:
            conn.execute("ALTER TABLE prompt_workspace_entry ADD COLUMN category TEXT NOT NULL DEFAULT '通用任务'")
        if "primary_category" not in entry_columns:
            conn.execute(
                f"ALTER TABLE prompt_workspace_entry ADD COLUMN primary_category TEXT NOT NULL DEFAULT '{DEFAULT_PRIMARY_CATEGORY}'"
            )
        if "secondary_category" not in entry_columns:
            conn.execute(
                f"ALTER TABLE prompt_workspace_entry ADD COLUMN secondary_category TEXT NOT NULL DEFAULT '{DEFAULT_SECONDARY_CATEGORY}'"
            )
        if "sequence_no" not in entry_columns:
            conn.execute(
                f"ALTER TABLE prompt_workspace_entry ADD COLUMN sequence_no INTEGER NOT NULL DEFAULT {DEFAULT_SEQUENCE_NO}"
            )
        if "is_favorite" not in entry_columns:
            conn.execute("ALTER TABLE prompt_workspace_entry ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0")
        knowledge_columns = {
            str(row["name"]): row
            for row in conn.execute("PRAGMA table_info(prompt_workspace_knowledge)").fetchall()
        }
        if "knowledge_type" not in knowledge_columns:
            conn.execute("ALTER TABLE prompt_workspace_knowledge ADD COLUMN knowledge_type TEXT NOT NULL DEFAULT 'general'")
        if "placement_key" not in knowledge_columns:
            conn.execute("ALTER TABLE prompt_workspace_knowledge ADD COLUMN placement_key TEXT NOT NULL DEFAULT 'knowledge'")
        if "scene_key" not in knowledge_columns:
            conn.execute("ALTER TABLE prompt_workspace_knowledge ADD COLUMN scene_key TEXT NOT NULL DEFAULT ''")
        if "scene_label" not in knowledge_columns:
            conn.execute("ALTER TABLE prompt_workspace_knowledge ADD COLUMN scene_label TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            UPDATE prompt_workspace_entry
               SET primary_category = CASE
                    WHEN trim(COALESCE(primary_category, '')) = '' THEN COALESCE(NULLIF(trim(category), ''), ?)
                    ELSE primary_category
                  END,
                   secondary_category = CASE
                    WHEN trim(COALESCE(secondary_category, '')) = '' THEN ?
                    ELSE secondary_category
                  END,
                   sequence_no = CASE
                    WHEN sequence_no IS NULL OR sequence_no <= 0 THEN ?
                    ELSE sequence_no
                  END
            """,
            (DEFAULT_PRIMARY_CATEGORY, DEFAULT_SECONDARY_CATEGORY, DEFAULT_SEQUENCE_NO),
        )
        conn.commit()


def normalize_primary_category(value: Any) -> str:
    return normalize_text(value) or DEFAULT_PRIMARY_CATEGORY


def normalize_secondary_category(value: Any) -> str:
    return normalize_text(value) or DEFAULT_SECONDARY_CATEGORY


def normalize_sequence_no(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SEQUENCE_NO
    return number if number > 0 else DEFAULT_SEQUENCE_NO


def normalize_knowledge_type(value: Any) -> str:
    normalized = normalize_text(value).lower()
    allowed = {"general", "rule_prompt", "acceptance_prompt", "audit_prompt"}
    return normalized if normalized in allowed else "general"


def normalize_placement_key(value: Any) -> str:
    normalized = normalize_text(value).lower()
    allowed = {"knowledge", "rules", "acceptance", "audit"}
    return normalized if normalized in allowed else "knowledge"


def normalize_scene_key(value: Any) -> str:
    normalized = normalize_text(value).lower()
    if not normalized:
        return ""
    return re.sub(r"[^a-z0-9_:-]+", "_", normalized)


def resolve_scene_label(scene_key: str) -> str:
    for item in RULE_SCENE_CATALOG:
        if item["key"] == scene_key:
            return item["label"]
    return ""


def build_category_label(primary_category: str, secondary_category: str) -> str:
    primary = normalize_primary_category(primary_category)
    secondary = normalize_secondary_category(secondary_category)
    return f"{primary} / {secondary}" if secondary else primary


def resolve_category_payload(payload: dict[str, Any]) -> tuple[str, str, int, str]:
    fallback_category = normalize_text(payload.get("category"))
    explicit_primary = normalize_text(payload.get("primaryCategory"))
    explicit_secondary = normalize_text(payload.get("secondaryCategory"))

    if fallback_category and (
        not explicit_primary
        or (explicit_primary == DEFAULT_PRIMARY_CATEGORY and explicit_secondary in {"", DEFAULT_SECONDARY_CATEGORY})
    ):
        if "/" in fallback_category:
            left, right = [part.strip() for part in fallback_category.split("/", 1)]
            primary_category = normalize_primary_category(left)
            secondary_category = normalize_secondary_category(right)
        else:
            primary_category = normalize_primary_category(fallback_category)
            secondary_category = DEFAULT_SECONDARY_CATEGORY
    else:
        primary_category = normalize_primary_category(explicit_primary or fallback_category)
        secondary_category = normalize_secondary_category(explicit_secondary)

    sequence_no = normalize_sequence_no(payload.get("sequenceNo"))
    return primary_category, secondary_category, sequence_no, build_category_label(primary_category, secondary_category)


def normalize_keyword(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value).lower())


def collect_candidate_keywords(payload: dict[str, Any]) -> list[str]:
    explicit = normalize_lines(payload.get("keywords") or [])
    text_parts = [
        payload.get("title"),
        payload.get("projectName"),
        payload.get("systemPurpose"),
        payload.get("existingContext"),
        payload.get("currentProblem"),
        payload.get("targetOutcome"),
        payload.get("rawNotes"),
    ]
    for key in ("problemDetails", "targetChecklist", "rules", "deliverables", "acceptanceCriteria"):
        text_parts.extend(payload.get(key) or [])
    raw_text = "\n".join(normalize_text(item) for item in text_parts if normalize_text(item))
    phrases = re.findall(r"[\u4e00-\u9fffA-Za-z0-9._/-]{2,24}", raw_text)
    preferred = explicit + phrases
    result: list[str] = []
    seen: set[str] = set()
    stop_words = {"当前项目", "系统主要用于", "已有内容", "具体表现为", "必须做到", "执行时必须遵守", "最终必须交付", "验收标准"}
    for item in preferred:
        normalized = normalize_text(item)
        if not normalized or normalized in stop_words:
            continue
        key = normalize_keyword(normalized)
        if not key or key in seen:
            continue
        if len(key) < 2:
            continue
        seen.add(key)
        result.append(normalized)
        if len(result) >= 24:
            break
    return result


def heuristic_scene_classification(text: str) -> dict[str, Any]:
    normalized = normalize_keyword(text)
    if not normalized:
        return {
            "sceneKey": "",
            "sceneLabel": "",
            "reason": "未提供足够文本，无法识别使用场景。",
            "searchTerms": [],
            "engine": "heuristic",
        }
    best_score = 0
    best_item: dict[str, Any] | None = None
    matched_terms: list[str] = []
    for item in RULE_SCENE_CATALOG:
        score = 0
        terms: list[str] = []
        for keyword in item["keywords"]:
            normalized_keyword = normalize_keyword(keyword)
            if normalized_keyword and normalized_keyword in normalized:
                score += 1
                terms.append(keyword)
        if score > best_score:
            best_score = score
            best_item = item
            matched_terms = terms
    if not best_item:
        return {
            "sceneKey": "general",
            "sceneLabel": "通用场景",
            "reason": "未命中特定场景关键词，归为通用场景。",
            "searchTerms": [],
            "engine": "heuristic",
        }
    return {
        "sceneKey": best_item["key"],
        "sceneLabel": best_item["label"],
        "reason": f"命中关键词：{'、'.join(matched_terms[:6]) or '无'}",
        "searchTerms": matched_terms[:8],
        "engine": "heuristic",
    }


def standard_rules(payload: dict[str, Any]) -> list[str]:
    base_rules = [
        "先分析需求，再执行",
        "先生成任务理解和功能蓝图",
        "不允许直接套模板",
        "不允许破坏原有项目",
        "遇到无法完成的地方必须说明原因",
    ]
    return normalize_lines(base_rules + list(payload.get("rules") or []))


def standard_acceptance(payload: dict[str, Any]) -> list[str]:
    base_acceptance = [
        "不能有占位内容",
        "不能有空页面",
        "不能缺字段、流程、状态、异常",
        "不能把未完成说成已完成",
        "不合格必须自动返工",
    ]
    return normalize_lines(base_acceptance + list(payload.get("acceptanceCriteria") or []))


def merge_background_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    merged = dict(payload)
    for key, value in DEFAULT_PROJECT_BACKGROUND.items():
        if not normalize_text(merged.get(key)):
            merged[key] = value
    return merged


def build_template_payload(payload: dict[str, Any]) -> dict[str, Any]:
    payload = merge_background_defaults(payload)
    return {
        "title": normalize_text(payload.get("title")) or "高精度任务提问",
        "projectName": normalize_text(payload.get("projectName")),
        "systemPurpose": normalize_text(payload.get("systemPurpose")),
        "existingContext": normalize_text(payload.get("existingContext")),
        "currentProblem": normalize_text(payload.get("currentProblem")),
        "problemDetails": normalize_lines(payload.get("problemDetails") or []),
        "targetOutcome": normalize_text(payload.get("targetOutcome")),
        "targetChecklist": normalize_lines(payload.get("targetChecklist") or []),
        "rules": standard_rules(payload),
        "deliverables": normalize_lines(payload.get("deliverables") or []),
        "acceptanceCriteria": standard_acceptance(payload),
        "rawNotes": normalize_text(payload.get("rawNotes")),
        "keywords": collect_candidate_keywords(payload),
    }


def build_standard_prompt(payload: dict[str, Any]) -> str:
    data = build_template_payload(payload)

    def section_lines(title: str, items: list[str]) -> str:
        if not items:
            return f"{title}\n- 暂未补充"
        return f"{title}\n" + "\n".join(f"- {item}" for item in items)

    return (
        "高精度任务提问模板\n\n"
        "1. 背景\n\n"
        f"当前项目是：{data['projectName'] or '待补充'}\n"
        f"这个系统主要用于：{data['systemPurpose'] or '待补充'}\n"
        f"当前已有内容：{data['existingContext'] or '待补充'}\n\n"
        "2. 问题\n\n"
        f"现在的问题是：{data['currentProblem'] or '待补充'}\n"
        "具体表现为：\n\n"
        + "\n".join(f"- {item}" for item in (data["problemDetails"] or ["待补充"])) + "\n\n"
        + "3. 目标\n\n"
        + f"本次要达到的结果是：{data['targetOutcome'] or '待补充'}\n"
        + "必须做到：\n\n"
        + "\n".join(f"- {item}" for item in (data["targetChecklist"] or ["待补充"])) + "\n\n"
        + section_lines("4. 规则", data["rules"]) + "\n\n"
        + "5. 交付与验收\n\n"
        + section_lines("最终必须交付：", data["deliverables"] or ["待补充"]) + "\n\n"
        + section_lines("验收标准：", data["acceptanceCriteria"]) + "\n\n"
        + "最简单记法就是：\n\n背景 → 问题 → 目标 → 规则 → 验收"
        + (f"\n\n补充原始备注：\n{data['rawNotes']}" if data["rawNotes"] else "")
    )


def build_blueprint(payload: dict[str, Any]) -> dict[str, Any]:
    data = build_template_payload(payload)
    missing_fields: list[str] = []
    if not data["projectName"]:
        missing_fields.append("项目名称")
    if not data["systemPurpose"]:
        missing_fields.append("系统用途")
    if not data["currentProblem"]:
        missing_fields.append("核心问题")
    if not data["targetOutcome"]:
        missing_fields.append("最终结果")
    if not data["deliverables"]:
        missing_fields.append("交付物")

    return {
        "taskUnderstanding": {
            "title": data["title"],
            "projectName": data["projectName"],
            "coreProblem": data["currentProblem"],
            "targetOutcome": data["targetOutcome"],
        },
        "functionalBlueprint": [
            "输入结构化背景、问题、目标、规则、验收信息",
            "自动汇总成标准提问模板",
            "保存提问历史并支持版本追溯",
            "按关键词检索历史与知识条目",
            "调用 MiniMax 做优化纠错和逻辑审计",
        ],
        "keywordSuggestions": data["keywords"],
        "missingFields": missing_fields,
    }


def build_first_principles_audit(payload: dict[str, Any]) -> dict[str, Any]:
    data = build_template_payload(payload)
    audit_items = [
        {
            "key": "problem_clarity",
            "label": "问题是否具体",
            "status": "pass" if data["currentProblem"] and data["problemDetails"] else "warn",
            "advice": "问题必须同时写清核心问题和至少一条具体现象。",
        },
        {
            "key": "goal_measurable",
            "label": "目标是否可验收",
            "status": "pass" if data["targetOutcome"] and data["targetChecklist"] else "warn",
            "advice": "目标不能只写愿景，需要列出必须做到的结果。",
        },
        {
            "key": "delivery_explicit",
            "label": "交付是否明确",
            "status": "pass" if data["deliverables"] else "warn",
            "advice": "必须明确最终交付物，否则执行方容易偏题。",
        },
        {
            "key": "constraint_sufficient",
            "label": "规则边界是否完整",
            "status": "pass" if len(data["rules"]) >= 5 else "warn",
            "advice": "至少要覆盖先分析、先蓝图、不套模板、不破坏原项目、失败说明原因。",
        },
        {
            "key": "acceptance_closed_loop",
            "label": "验收是否闭环",
            "status": "pass" if len(data["acceptanceCriteria"]) >= 5 else "warn",
            "advice": "验收必须覆盖字段、流程、状态、异常和完成口径。",
        },
    ]
    risk_alerts: list[str] = []
    if not data["existingContext"]:
        risk_alerts.append("已有页面/代码/文件/设计未写清，执行方可能误伤现有项目。")
    if not data["problemDetails"]:
        risk_alerts.append("缺少具体表现，后续排错口径会发散。")
    if not data["keywords"]:
        risk_alerts.append("没有可检索关键词，后续历史追溯和知识复用会变差。")
    return {
        "firstPrinciplesReview": audit_items,
        "logicSuggestions": [
            "先界定输入，再界定问题，再定义结果和验收，不要倒置顺序。",
            "每个目标都要能映射到至少一个交付物和一个验收标准。",
            "规则写成硬边界，避免执行方自己补脑。",
        ],
        "riskAlerts": risk_alerts,
    }


def build_summary(payload: dict[str, Any]) -> str:
    data = build_template_payload(payload)
    fragments = [
        data["projectName"] or "未命名项目",
        data["currentProblem"] or "未写核心问题",
        data["targetOutcome"] or "未写目标",
    ]
    return " | ".join(fragment for fragment in fragments if fragment)


def get_last_background() -> dict[str, str]:
    init_db()
    with retail_core.connect() as conn:
        row = conn.execute(
            """
            SELECT project_name, system_purpose, existing_context
              FROM prompt_workspace_entry
             ORDER BY updated_at DESC
             LIMIT 1
            """
        ).fetchone()
        if not row:
            return dict(DEFAULT_PROJECT_BACKGROUND)
        return {
            "projectName": normalize_text(row["project_name"]) or DEFAULT_PROJECT_BACKGROUND["projectName"],
            "systemPurpose": normalize_text(row["system_purpose"]) or DEFAULT_PROJECT_BACKGROUND["systemPurpose"],
            "existingContext": normalize_text(row["existing_context"]) or DEFAULT_PROJECT_BACKGROUND["existingContext"],
        }


def row_to_entry(row: sqlite3.Row) -> dict[str, Any]:
    def load_json(text: str, default: Any) -> Any:
        try:
            parsed = json.loads(text or "")
        except json.JSONDecodeError:
            return default
        return parsed if isinstance(parsed, type(default)) else default

    return {
        "id": row["id"],
        "title": row["title"],
        "category": build_category_label(
            row["primary_category"] if "primary_category" in row.keys() else row["category"],
            row["secondary_category"] if "secondary_category" in row.keys() else DEFAULT_SECONDARY_CATEGORY,
        ),
        "primaryCategory": normalize_primary_category(
            row["primary_category"] if "primary_category" in row.keys() else row["category"]
        ),
        "secondaryCategory": normalize_secondary_category(
            row["secondary_category"] if "secondary_category" in row.keys() else DEFAULT_SECONDARY_CATEGORY
        ),
        "sequenceNo": normalize_sequence_no(row["sequence_no"] if "sequence_no" in row.keys() else DEFAULT_SEQUENCE_NO),
        "isFavorite": bool(row["is_favorite"]) if "is_favorite" in row.keys() else False,
        "projectName": row["project_name"],
        "systemPurpose": row["system_purpose"],
        "existingContext": row["existing_context"],
        "currentProblem": row["current_problem"],
        "targetOutcome": row["target_outcome"],
        "rawNotes": row["raw_notes"],
        "generatedPrompt": row["generated_prompt"],
        "optimizedPrompt": row["optimized_prompt"],
        "generatedSummary": row["generated_summary"],
        "blueprint": load_json(row["blueprint_json"], {}),
        "audit": load_json(row["audit_json"], {}),
        "sourcePayload": load_json(row["source_payload_json"], {}),
        "minimaxStatus": row["minimax_status"],
        "minimaxPayload": load_json(row["minimax_payload_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def fetch_keywords(conn: sqlite3.Connection, entry_id: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT keyword
          FROM prompt_workspace_keyword
         WHERE entry_id = ?
         ORDER BY weight DESC, keyword ASC
        """,
        (entry_id,),
    ).fetchall()
    return [str(row["keyword"]) for row in rows]


def ensure_system_knowledge_entry(conn: sqlite3.Connection) -> str:
    existing = conn.execute(
        "SELECT id FROM prompt_workspace_entry WHERE id = ?",
        (SYSTEM_KNOWLEDGE_ENTRY_ID,),
    ).fetchone()
    if existing:
        return SYSTEM_KNOWLEDGE_ENTRY_ID
    timestamp = now_iso()
    normalized = build_template_payload(
        {
            "title": "系统规则知识库根节点",
            "projectName": DEFAULT_PROJECT_BACKGROUND["projectName"],
            "systemPurpose": DEFAULT_PROJECT_BACKGROUND["systemPurpose"],
            "existingContext": DEFAULT_PROJECT_BACKGROUND["existingContext"],
            "currentProblem": "系统规则知识库挂载根节点",
            "targetOutcome": "提供手工知识条目稳定外键",
        }
    )
    generated_prompt = build_standard_prompt(normalized)
    blueprint = build_blueprint(normalized)
    audit = build_first_principles_audit(normalized)
    summary = build_summary(normalized)
    conn.execute(
        """
        INSERT INTO prompt_workspace_entry (
          id, title, category, primary_category, secondary_category, sequence_no, is_favorite, project_name, system_purpose, existing_context, current_problem,
          target_outcome, raw_notes, generated_prompt, optimized_prompt, generated_summary,
          blueprint_json, audit_json, source_payload_json, minimax_status, minimax_payload_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            SYSTEM_KNOWLEDGE_ENTRY_ID,
            normalized["title"],
            build_category_label("系统知识库", "根节点"),
            "系统知识库",
            "根节点",
            9999,
            0,
            normalized["projectName"],
            normalized["systemPurpose"],
            normalized["existingContext"],
            normalized["currentProblem"],
            normalized["targetOutcome"],
            "",
            generated_prompt,
            "",
            summary,
            json.dumps(blueprint, ensure_ascii=False),
            json.dumps(audit, ensure_ascii=False),
            json.dumps(normalized, ensure_ascii=False),
            "not_requested",
            "{}",
            timestamp,
            timestamp,
        ),
    )
    save_entry_keywords(conn, SYSTEM_KNOWLEDGE_ENTRY_ID, ["系统知识库", "规则根节点"])
    return SYSTEM_KNOWLEDGE_ENTRY_ID


def fetch_revisions(conn: sqlite3.Connection, entry_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, revision_no, action_type, generated_prompt, optimized_prompt,
               generated_summary, blueprint_json, audit_json, minimax_status,
               minimax_payload_json, created_at
          FROM prompt_workspace_revision
         WHERE entry_id = ?
         ORDER BY revision_no DESC
        """,
        (entry_id,),
    ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                "id": row["id"],
                "revisionNo": row["revision_no"],
                "actionType": row["action_type"],
                "generatedPrompt": row["generated_prompt"],
                "optimizedPrompt": row["optimized_prompt"],
                "generatedSummary": row["generated_summary"],
                "blueprint": json.loads(row["blueprint_json"] or "{}"),
                "audit": json.loads(row["audit_json"] or "{}"),
                "minimaxStatus": row["minimax_status"],
                "minimaxPayload": json.loads(row["minimax_payload_json"] or "{}"),
                "createdAt": row["created_at"],
            }
        )
    return items


def next_revision_no(conn: sqlite3.Connection, entry_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(revision_no), 0) AS current_max FROM prompt_workspace_revision WHERE entry_id = ?",
        (entry_id,),
    ).fetchone()
    return int((row["current_max"] if row else 0) or 0) + 1


def save_entry_keywords(conn: sqlite3.Connection, entry_id: str, keywords: list[str]) -> None:
    conn.execute("DELETE FROM prompt_workspace_keyword WHERE entry_id = ?", (entry_id,))
    timestamp = now_iso()
    for index, keyword in enumerate(keywords, start=1):
        conn.execute(
            """
            INSERT INTO prompt_workspace_keyword (id, entry_id, keyword, normalized_keyword, weight, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                f"{entry_id}-kw-{index}",
                entry_id,
                keyword,
                normalize_keyword(keyword),
                max(1, len(keywords) - index + 1),
                timestamp,
            ),
        )


def create_entry(payload: dict[str, Any], *, auto_optimize: bool = False, minimax_api_key: str | None = None) -> dict[str, Any]:
    init_db()
    normalized = build_template_payload(payload)
    entry_id = normalize_text(payload.get("id")) or f"prompt-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    timestamp = now_iso()
    generated_prompt = build_standard_prompt(normalized)
    blueprint = build_blueprint(normalized)
    audit = build_first_principles_audit(normalized)
    summary = build_summary(normalized)
    minimax_status = "requested" if auto_optimize else "not_requested"
    minimax_payload: dict[str, Any] = {}
    optimized_prompt = ""
    primary_category, secondary_category, sequence_no, category = resolve_category_payload(payload)
    is_favorite = 1 if bool(payload.get("isFavorite")) else 0

    with retail_core.connect() as conn:
        conn.execute(
            """
            INSERT INTO prompt_workspace_entry (
              id, title, category, primary_category, secondary_category, sequence_no, is_favorite, project_name, system_purpose, existing_context, current_problem,
              target_outcome, raw_notes, generated_prompt, optimized_prompt, generated_summary,
              blueprint_json, audit_json, source_payload_json, minimax_status, minimax_payload_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                normalized["title"],
                category,
                primary_category,
                secondary_category,
                sequence_no,
                is_favorite,
                normalized["projectName"],
                normalized["systemPurpose"],
                normalized["existingContext"],
                normalized["currentProblem"],
                normalized["targetOutcome"],
                normalized["rawNotes"],
                generated_prompt,
                optimized_prompt,
                summary,
                json.dumps(blueprint, ensure_ascii=False),
                json.dumps(audit, ensure_ascii=False),
                json.dumps(normalized, ensure_ascii=False),
                minimax_status,
                json.dumps(minimax_payload, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
        save_entry_keywords(conn, entry_id, normalized["keywords"])
        conn.execute(
            """
            INSERT INTO prompt_workspace_revision (
              id, entry_id, revision_no, action_type, generated_prompt, optimized_prompt,
              generated_summary, blueprint_json, audit_json, minimax_status, minimax_payload_json, created_at
            ) VALUES (?, ?, 1, 'create', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{entry_id}-rev-1",
                entry_id,
                generated_prompt,
                optimized_prompt,
                summary,
                json.dumps(blueprint, ensure_ascii=False),
                json.dumps(audit, ensure_ascii=False),
                minimax_status,
                json.dumps(minimax_payload, ensure_ascii=False),
                timestamp,
            ),
        )
        conn.commit()

    entry = get_entry(entry_id)
    if auto_optimize and minimax_api_key:
        optimized = optimize_entry(entry_id, minimax_api_key=minimax_api_key)
        if optimized.get("ok"):
            entry = optimized["entry"]
    return entry


def list_entries(query: str = "", limit: int = 30) -> dict[str, Any]:
    init_db()
    normalized_query = normalize_keyword(query)
    with retail_core.connect() as conn:
        if normalized_query:
            pattern = f"%{normalized_query}%"
            rows = conn.execute(
                """
                SELECT DISTINCT e.*
                  FROM prompt_workspace_entry e
                  LEFT JOIN prompt_workspace_keyword k ON k.entry_id = e.id
                 WHERE lower(replace(e.title, ' ', '')) LIKE ?
                    OR lower(replace(e.project_name, ' ', '')) LIKE ?
                    OR lower(replace(e.current_problem, ' ', '')) LIKE ?
                    OR lower(replace(e.target_outcome, ' ', '')) LIKE ?
                    OR k.normalized_keyword LIKE ?
                 ORDER BY e.sequence_no ASC, e.updated_at DESC
                 LIMIT ?
                """,
                (pattern, pattern, pattern, pattern, pattern, max(1, min(limit, 200))),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT *
                  FROM prompt_workspace_entry
                 ORDER BY sequence_no ASC, updated_at DESC
                 LIMIT ?
                """,
                (max(1, min(limit, 200)),),
            ).fetchall()

        items = []
        for row in rows:
            entry = row_to_entry(row)
            entry["keywords"] = fetch_keywords(conn, entry["id"])
            items.append(entry)
        return {"items": items, "count": len(items), "query": query}


def update_entry_meta(
    entry_id: str,
    *,
    category: str | None = None,
    primary_category: str | None = None,
    secondary_category: str | None = None,
    sequence_no: int | None = None,
    is_favorite: bool | None = None,
) -> dict[str, Any]:
    init_db()
    changes: list[str] = []
    values: list[Any] = []
    resolved_primary = normalize_primary_category(primary_category or category) if primary_category is not None or category is not None else None
    resolved_secondary = normalize_secondary_category(secondary_category) if secondary_category is not None else None
    if resolved_primary is not None:
        changes.append("primary_category = ?")
        values.append(resolved_primary)
    if resolved_secondary is not None:
        changes.append("secondary_category = ?")
        values.append(resolved_secondary)
    if sequence_no is not None:
        changes.append("sequence_no = ?")
        values.append(normalize_sequence_no(sequence_no))
    if category is not None or resolved_primary is not None or resolved_secondary is not None:
        changes.append("category = ?")
        primary_for_label = resolved_primary if resolved_primary is not None else None
        secondary_for_label = resolved_secondary if resolved_secondary is not None else None
        if primary_for_label is None or secondary_for_label is None:
            current = get_entry(entry_id)
            primary_for_label = primary_for_label or current.get("primaryCategory") or DEFAULT_PRIMARY_CATEGORY
            secondary_for_label = secondary_for_label or current.get("secondaryCategory") or DEFAULT_SECONDARY_CATEGORY
        values.append(build_category_label(str(primary_for_label), str(secondary_for_label)))
    if is_favorite is not None:
        changes.append("is_favorite = ?")
        values.append(1 if is_favorite else 0)
    if not changes:
        return get_entry(entry_id)
    changes.append("updated_at = ?")
    values.append(now_iso())
    values.append(entry_id)
    with retail_core.connect() as conn:
        result = conn.execute(
            f"UPDATE prompt_workspace_entry SET {', '.join(changes)} WHERE id = ?",
            tuple(values),
        )
        if result.rowcount <= 0:
            raise KeyError(entry_id)
        conn.commit()
    return get_entry(entry_id)


def get_entry(entry_id: str) -> dict[str, Any]:
    init_db()
    with retail_core.connect() as conn:
        row = conn.execute("SELECT * FROM prompt_workspace_entry WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            raise KeyError(entry_id)
        entry = row_to_entry(row)
        entry["keywords"] = fetch_keywords(conn, entry_id)
        entry["revisions"] = fetch_revisions(conn, entry_id)
        return entry


def upsert_knowledge(payload: dict[str, Any]) -> dict[str, Any]:
    init_db()
    knowledge_id = normalize_text(payload.get("id")) or f"knowledge-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    title = normalize_text(payload.get("title"))
    keyword = normalize_text(payload.get("keyword"))
    content = normalize_text(payload.get("content"))
    tags = normalize_lines(payload.get("tags") or [])
    knowledge_type = normalize_knowledge_type(payload.get("knowledgeType"))
    placement_key = normalize_placement_key(payload.get("placementKey"))
    scene_key = normalize_scene_key(payload.get("sceneKey"))
    scene_label = normalize_text(payload.get("sceneLabel"))
    source_entry_id = normalize_text(payload.get("sourceEntryId"))
    if not title or not content:
        raise ValueError("knowledge_title_or_content_missing")
    if not scene_key and placement_key == "rules":
        detected_scene = heuristic_scene_classification("\n".join([title, keyword, content, *tags]))
        scene_key = detected_scene.get("sceneKey") or ""
        scene_label = detected_scene.get("sceneLabel") or ""
    if scene_key and not scene_label:
        scene_label = resolve_scene_label(scene_key) or scene_key
    timestamp = now_iso()
    with retail_core.connect() as conn:
        if not source_entry_id:
            source_entry_id = ensure_system_knowledge_entry(conn)
        existing = conn.execute(
            "SELECT id FROM prompt_workspace_knowledge WHERE id = ?",
            (knowledge_id,),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO prompt_workspace_knowledge (
              id, title, keyword, normalized_keyword, content, tags_json,
              knowledge_type, placement_key, scene_key, scene_label, source_entry_id, source_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              keyword = excluded.keyword,
              normalized_keyword = excluded.normalized_keyword,
              content = excluded.content,
              tags_json = excluded.tags_json,
              knowledge_type = excluded.knowledge_type,
              placement_key = excluded.placement_key,
              scene_key = excluded.scene_key,
              scene_label = excluded.scene_label,
              source_entry_id = excluded.source_entry_id,
              source_kind = excluded.source_kind,
              updated_at = excluded.updated_at
            """,
            (
                knowledge_id,
                title,
                keyword,
                normalize_keyword(keyword or title),
                content,
                json.dumps(tags, ensure_ascii=False),
                knowledge_type,
                placement_key,
                scene_key,
                scene_label,
                source_entry_id,
                "manual" if not source_entry_id else "entry",
                timestamp if not existing else timestamp,
                timestamp,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM prompt_workspace_knowledge WHERE id = ?", (knowledge_id,)).fetchone()
        return row_to_knowledge(row) if row else {}


def row_to_knowledge(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {}
    try:
        tags = json.loads(row["tags_json"] or "[]")
    except json.JSONDecodeError:
        tags = []
    return {
        "id": row["id"],
        "title": row["title"],
        "keyword": row["keyword"],
        "content": row["content"],
        "tags": tags if isinstance(tags, list) else [],
        "knowledgeType": row["knowledge_type"] if "knowledge_type" in row.keys() else "general",
        "placementKey": row["placement_key"] if "placement_key" in row.keys() else "knowledge",
        "sceneKey": row["scene_key"] if "scene_key" in row.keys() else "",
        "sceneLabel": row["scene_label"] if "scene_label" in row.keys() else "",
        "sourceEntryId": "" if row["source_entry_id"] == SYSTEM_KNOWLEDGE_ENTRY_ID else row["source_entry_id"],
        "sourceKind": row["source_kind"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def search_knowledge(query: str, limit: int = 20) -> dict[str, Any]:
    init_db()
    normalized_query = normalize_keyword(query)
    pattern = f"%{normalized_query}%"
    with retail_core.connect() as conn:
        rows = conn.execute(
            """
            SELECT *
              FROM prompt_workspace_knowledge
             WHERE normalized_keyword LIKE ?
                OR lower(replace(title, ' ', '')) LIKE ?
                OR lower(replace(content, ' ', '')) LIKE ?
             ORDER BY updated_at DESC
             LIMIT ?
            """,
            (pattern, pattern, pattern, max(1, min(limit, 200))),
        ).fetchall()
        items = [row_to_knowledge(row) for row in rows]
        return {"items": items, "count": len(items), "query": query}


def recommend_knowledge(payload: dict[str, Any], limit: int = 6, minimax_api_key: str | None = None) -> dict[str, Any]:
    init_db()
    query_parts = [
        payload.get("title"),
        payload.get("primaryCategory"),
        payload.get("secondaryCategory"),
        payload.get("projectName"),
        payload.get("systemPurpose"),
        payload.get("existingContext"),
        payload.get("currentProblem"),
        payload.get("targetOutcome"),
    ]
    for key in ("problemDetails", "targetChecklist", "keywords"):
        values = payload.get(key) or []
        if isinstance(values, (list, tuple)):
            query_parts.extend(values)
    query = "\n".join(normalize_text(item) for item in query_parts if normalize_text(item))
    normalized_query = normalize_keyword(query)
    if not normalized_query:
        return {"items": [], "count": 0, "query": "", "scene": {"sceneKey": "", "sceneLabel": "", "reason": "空查询", "searchTerms": [], "engine": "none"}}
    raw_terms = collect_candidate_keywords({"keywords": [], "rawNotes": query, "title": payload.get("title")})
    search_terms = [normalize_keyword(term) for term in raw_terms if normalize_keyword(term)]
    target_placement = normalize_placement_key(payload.get("placementKey"))
    target_knowledge_type = normalize_knowledge_type(payload.get("knowledgeType"))
    scene = classify_rule_scene(payload, minimax_api_key=minimax_api_key)
    with retail_core.connect() as conn:
        rows = conn.execute("SELECT * FROM prompt_workspace_knowledge ORDER BY updated_at DESC").fetchall()

    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        item = row_to_knowledge(row)
        placement_key = item.get("placementKey") or "knowledge"
        knowledge_type = item.get("knowledgeType") or "general"
        if target_placement != "knowledge" and placement_key != target_placement:
            continue
        if target_knowledge_type != "general" and knowledge_type != target_knowledge_type:
            continue
        haystack = " ".join(
            [
                normalize_keyword(item.get("title")),
                normalize_keyword(item.get("keyword")),
                normalize_keyword(item.get("content")),
                *[normalize_keyword(tag) for tag in item.get("tags", [])],
            ]
        )
        score = 0
        for term in search_terms:
            if term and term in haystack:
                score += 3
        keyword = normalize_keyword(item.get("keyword"))
        if keyword and keyword in normalized_query:
            score += 5
        if placement_key == target_placement:
            score += 2
        if knowledge_type == target_knowledge_type:
            score += 2
        if scene.get("sceneKey") and item.get("sceneKey") == scene.get("sceneKey"):
            score += 4
        if score <= 0:
            continue
        item["recommendedPrompt"] = item.get("content", "")
        item["matchScore"] = score
        scored.append((score, item))

    scored.sort(key=lambda pair: (-pair[0], pair[1].get("updatedAt", "")), reverse=False)
    items = [item for _, item in scored[: max(1, min(limit, 20))]]
    return {"items": items, "count": len(items), "query": query, "scene": scene}


def search_workspace(query: str, limit: int = 12) -> dict[str, Any]:
    return {
        "entries": list_entries(query=query, limit=limit).get("items", []),
        "knowledge": search_knowledge(query=query, limit=limit).get("items", []),
        "query": query,
    }


def template_schema() -> dict[str, Any]:
    base_payload = build_template_payload({})
    last_background = get_last_background()
    return {
        "preset": "high_precision_task_question",
        "sections": [
            {"key": "background", "label": "背景"},
            {"key": "problem", "label": "问题"},
            {"key": "goal", "label": "目标"},
            {"key": "rules", "label": "规则"},
            {"key": "acceptance", "label": "交付与验收"},
        ],
        "defaultRules": base_payload["rules"],
        "defaultAcceptanceCriteria": base_payload["acceptanceCriteria"],
        "defaultBackground": dict(DEFAULT_PROJECT_BACKGROUND),
        "lastBackground": last_background,
        "templateExample": build_standard_prompt(base_payload),
        "defaultCategoryDraft": {
            "primaryCategory": DEFAULT_PRIMARY_CATEGORY,
            "secondaryCategory": DEFAULT_SECONDARY_CATEGORY,
            "sequenceNo": DEFAULT_SEQUENCE_NO,
        },
        "ruleSceneCatalog": RULE_SCENE_CATALOG,
    }


def load_minimax_api_key(config_file: Path | None = None) -> str:
    candidates = [
        "MINIMAX_API_KEY",
        "MINIMAX_TOKEN",
        "MINIMAX_GROUP_API_KEY",
    ]
    import os

    for key in candidates:
        value = normalize_text(os.environ.get(key))
        if value:
            return value
    if config_file and config_file.exists():
        try:
            content = config_file.read_text(encoding="utf-8")
        except OSError:
            return ""
        matched = re.search(r"minimaxApiKey\s*:\s*['\"]([^'\"]+)['\"]", content)
        if matched:
            return normalize_text(matched.group(1))
    return ""


def request_minimax_optimization(entry: dict[str, Any], api_key: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    if not api_key:
        return None, {"status": "missing_key", "message": "未配置 MiniMax API Key。"}
    payload = {
        "model": "MiniMax-M3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是严谨的任务提问优化器。"
                    "你必须对输入做结构化优化、第一性原理审查、逻辑一致性检查。"
                    "只返回 JSON，不要额外解释。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "请基于以下任务提问内容输出 JSON。"
                    "字段固定为："
                    '{"optimizedPrompt":"","firstPrinciplesReview":[""],"logicIssues":[""],'
                    '"rewriteSuggestions":[""],"acceptanceRisks":[""],"qualityVerdict":"pass|warn|fail"}'
                    "\n\n原始内容：\n"
                    + entry.get("generatedPrompt", "")
                ),
            },
        ],
        "temperature": 0.2,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    endpoints = [
        "https://api.minimaxi.com/v1/chat/completions",
    ]
    last_error = {"status": "failed", "message": "MiniMax 未返回可用内容。"}
    for endpoint in endpoints:
        req = urllib_request.Request(
            endpoint,
            data=body,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=60, context=MINIMAX_SSL_CONTEXT) as response:
                raw = response.read()
        except urllib_error.HTTPError as exc:
            raw = exc.read()
        except Exception as exc:  # noqa: BLE001
            last_error = {"status": "network_error", "message": str(exc), "endpoint": endpoint}
            continue
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            last_error = {"status": "invalid_response", "message": "MiniMax 返回内容不可解析。", "endpoint": endpoint}
            continue
        choices = parsed.get("choices")
        if not isinstance(choices, list) or not choices:
            last_error = {"status": "empty_choices", "message": "MiniMax 未返回 choices。", "endpoint": endpoint}
            continue
        content = str((((choices[0] or {}).get("message") or {}).get("content") or "")).strip()
        if not content:
            last_error = {"status": "empty_content", "message": "MiniMax 未返回文本。", "endpoint": endpoint}
            continue
        fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", content)
        candidate = fenced.group(1) if fenced else content
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start < 0 or end < start:
            last_error = {"status": "invalid_json", "message": "MiniMax 结果不含 JSON 对象。", "endpoint": endpoint}
            continue
        try:
            result = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            last_error = {"status": "invalid_json", "message": "MiniMax 结果不是合法 JSON。", "endpoint": endpoint}
            continue
        if not isinstance(result, dict):
            last_error = {"status": "invalid_payload", "message": "MiniMax 返回结构错误。", "endpoint": endpoint}
            continue
        return result, {"status": "ok", "endpoint": endpoint}
    return None, last_error


def request_minimax_scene_classification(payload: dict[str, Any], api_key: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    if not api_key:
        return None, {"status": "missing_key", "message": "未配置 MiniMax API Key。"}
    text = "\n".join(
        [
            normalize_text(payload.get("title")),
            normalize_text(payload.get("primaryCategory")),
            normalize_text(payload.get("secondaryCategory")),
            normalize_text(payload.get("currentProblem")),
            "\n".join(normalize_lines(payload.get("problemDetails") or [])),
            normalize_text(payload.get("targetOutcome")),
            "\n".join(normalize_lines(payload.get("keywords") or [])),
        ]
    ).strip()
    if not text:
        return None, {"status": "empty_payload", "message": "缺少可识别文本。"}
    payload_json = {
        "model": "MiniMax-M3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是规则库场景分类器。"
                    "只返回 JSON。"
                    '字段固定为 {"sceneKey":"","sceneLabel":"","reason":"","searchTerms":[""]}。'
                    "sceneKey 只能使用英文下划线风格。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "请根据下面的提问内容识别最合适的规则库使用场景，并给出可用于检索规则库的关键词。\n\n"
                    + text
                ),
            },
        ],
        "temperature": 0.1,
    }
    body = json.dumps(payload_json, ensure_ascii=False).encode("utf-8")
    endpoints = [
        "https://api.minimaxi.com/v1/chat/completions",
    ]
    last_error = {"status": "failed", "message": "MiniMax 未返回可用场景分类。"}
    for endpoint in endpoints:
        req = urllib_request.Request(
            endpoint,
            data=body,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=60, context=MINIMAX_SSL_CONTEXT) as response:
                raw = response.read()
        except urllib_error.HTTPError as exc:
            raw = exc.read()
        except Exception as exc:  # noqa: BLE001
            last_error = {"status": "network_error", "message": str(exc), "endpoint": endpoint}
            continue
        try:
            parsed = json.loads(raw.decode("utf-8"))
            choices = parsed.get("choices") or []
            content = str((((choices[0] or {}).get("message") or {}).get("content") or "")).strip()
            fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", content)
            candidate = fenced.group(1) if fenced else content
            start = candidate.find("{")
            end = candidate.rfind("}")
            result = json.loads(candidate[start : end + 1])
        except Exception:  # noqa: BLE001
            last_error = {"status": "invalid_response", "message": "MiniMax 场景分类返回不可解析。", "endpoint": endpoint}
            continue
        if not isinstance(result, dict):
            last_error = {"status": "invalid_payload", "message": "MiniMax 场景分类返回结构错误。", "endpoint": endpoint}
            continue
        return result, {"status": "ok", "endpoint": endpoint}
    return None, last_error


def classify_rule_scene(payload: dict[str, Any], minimax_api_key: str | None = None) -> dict[str, Any]:
    heuristic_input = "\n".join(
        [
            normalize_text(payload.get("title")),
            normalize_text(payload.get("primaryCategory")),
            normalize_text(payload.get("secondaryCategory")),
            normalize_text(payload.get("currentProblem")),
            normalize_text(payload.get("targetOutcome")),
            "\n".join(normalize_lines(payload.get("problemDetails") or [])),
            "\n".join(normalize_lines(payload.get("keywords") or [])),
        ]
    )
    heuristic_result = heuristic_scene_classification(heuristic_input)
    if not minimax_api_key:
        return heuristic_result
    result, meta = request_minimax_scene_classification(payload, minimax_api_key)
    if not result:
        heuristic_result["fallbackMeta"] = meta
        return heuristic_result
    scene_key = normalize_scene_key(result.get("sceneKey"))
    scene_label = normalize_text(result.get("sceneLabel")) or resolve_scene_label(scene_key) or heuristic_result.get("sceneLabel") or "通用场景"
    return {
        "sceneKey": scene_key or heuristic_result.get("sceneKey") or "general",
        "sceneLabel": scene_label,
        "reason": normalize_text(result.get("reason")) or "MiniMax 已完成场景识别。",
        "searchTerms": normalize_lines(result.get("searchTerms") or []) or heuristic_result.get("searchTerms") or [],
        "engine": "minimax",
        "meta": meta,
    }


def update_entry_content(entry_id: str, payload: dict[str, Any], *, auto_optimize: bool = False, minimax_api_key: str | None = None) -> dict[str, Any]:
    init_db()
    existing = get_entry(entry_id)
    normalized = build_template_payload(payload)
    generated_prompt = build_standard_prompt(normalized)
    blueprint = build_blueprint(normalized)
    audit = build_first_principles_audit(normalized)
    summary = build_summary(normalized)
    primary_category, secondary_category, sequence_no, category = resolve_category_payload(payload)
    is_favorite = 1 if bool(payload.get("isFavorite")) else 0
    timestamp = now_iso()
    with retail_core.connect() as conn:
        revision_no = next_revision_no(conn, entry_id)
        result = conn.execute(
            """
            UPDATE prompt_workspace_entry
               SET title = ?, category = ?, primary_category = ?, secondary_category = ?, sequence_no = ?, is_favorite = ?,
                   project_name = ?, system_purpose = ?, existing_context = ?, current_problem = ?, target_outcome = ?,
                   raw_notes = ?, generated_prompt = ?, generated_summary = ?, blueprint_json = ?, audit_json = ?,
                   source_payload_json = ?, updated_at = ?
             WHERE id = ?
            """,
            (
                normalized["title"],
                category,
                primary_category,
                secondary_category,
                sequence_no,
                is_favorite,
                normalized["projectName"],
                normalized["systemPurpose"],
                normalized["existingContext"],
                normalized["currentProblem"],
                normalized["targetOutcome"],
                normalized["rawNotes"],
                generated_prompt,
                summary,
                json.dumps(blueprint, ensure_ascii=False),
                json.dumps(audit, ensure_ascii=False),
                json.dumps(normalized, ensure_ascii=False),
                timestamp,
                entry_id,
            ),
        )
        if result.rowcount <= 0:
            raise KeyError(entry_id)
        conn.execute("DELETE FROM prompt_workspace_keyword WHERE entry_id = ?", (entry_id,))
        save_entry_keywords(conn, entry_id, normalized["keywords"])
        conn.execute(
            """
            INSERT INTO prompt_workspace_revision (
              id, entry_id, revision_no, action_type, generated_prompt, optimized_prompt,
              generated_summary, blueprint_json, audit_json, minimax_status, minimax_payload_json, created_at
            ) VALUES (?, ?, ?, 'edit', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{entry_id}-rev-{revision_no}",
                entry_id,
                revision_no,
                generated_prompt,
                existing.get("optimizedPrompt", ""),
                summary,
                json.dumps(blueprint, ensure_ascii=False),
                json.dumps(audit, ensure_ascii=False),
                existing.get("minimaxStatus", "not_requested"),
                json.dumps(existing.get("minimaxPayload", {}), ensure_ascii=False),
                timestamp,
            ),
        )
        conn.commit()
    entry = get_entry(entry_id)
    if auto_optimize and minimax_api_key:
        optimized = optimize_entry(entry_id, minimax_api_key=minimax_api_key)
        if optimized.get("ok"):
            entry = optimized["entry"]
    return entry


def optimize_entry(entry_id: str, *, minimax_api_key: str) -> dict[str, Any]:
    init_db()
    entry = get_entry(entry_id)
    result, meta = request_minimax_optimization(entry, minimax_api_key)
    timestamp = now_iso()
    with retail_core.connect() as conn:
        if not result:
            conn.execute(
                """
                UPDATE prompt_workspace_entry
                   SET minimax_status = ?, minimax_payload_json = ?, updated_at = ?
                 WHERE id = ?
                """,
                (str(meta.get("status") or "failed"), json.dumps(meta, ensure_ascii=False), timestamp, entry_id),
            )
            conn.execute(
                """
                INSERT INTO prompt_workspace_revision (
                  id, entry_id, revision_no, action_type, generated_prompt, optimized_prompt,
                  generated_summary, blueprint_json, audit_json, minimax_status, minimax_payload_json, created_at
                ) VALUES (?, ?, ?, 'minimax_failed', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{entry_id}-rev-{next_revision_no(conn, entry_id)}",
                    entry_id,
                    entry["generatedPrompt"],
                    "",
                    entry["generatedSummary"],
                    json.dumps(entry["blueprint"], ensure_ascii=False),
                    json.dumps(entry["audit"], ensure_ascii=False),
                    str(meta.get("status") or "failed"),
                    json.dumps(meta, ensure_ascii=False),
                    timestamp,
                ),
            )
            conn.commit()
            return {"ok": False, "entry": get_entry(entry_id), "meta": meta}

        optimized_prompt = normalize_text(result.get("optimizedPrompt"))
        merged_audit = dict(entry["audit"])
        merged_audit["minimaxReview"] = {
            "qualityVerdict": result.get("qualityVerdict") or "warn",
            "firstPrinciplesReview": result.get("firstPrinciplesReview") or [],
            "logicIssues": result.get("logicIssues") or [],
            "rewriteSuggestions": result.get("rewriteSuggestions") or [],
            "acceptanceRisks": result.get("acceptanceRisks") or [],
        }
        conn.execute(
            """
            UPDATE prompt_workspace_entry
               SET optimized_prompt = ?, audit_json = ?, minimax_status = ?, minimax_payload_json = ?, updated_at = ?
             WHERE id = ?
            """,
            (
                optimized_prompt,
                json.dumps(merged_audit, ensure_ascii=False),
                "optimized",
                json.dumps({"result": result, "meta": meta}, ensure_ascii=False),
                timestamp,
                entry_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO prompt_workspace_revision (
              id, entry_id, revision_no, action_type, generated_prompt, optimized_prompt,
              generated_summary, blueprint_json, audit_json, minimax_status, minimax_payload_json, created_at
            ) VALUES (?, ?, ?, 'minimax_optimize', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{entry_id}-rev-{next_revision_no(conn, entry_id)}",
                entry_id,
                entry["generatedPrompt"],
                optimized_prompt,
                entry["generatedSummary"],
                json.dumps(entry["blueprint"], ensure_ascii=False),
                json.dumps(merged_audit, ensure_ascii=False),
                "optimized",
                json.dumps({"result": result, "meta": meta}, ensure_ascii=False),
                timestamp,
            ),
        )
        conn.commit()
    return {"ok": True, "entry": get_entry(entry_id), "meta": meta}
