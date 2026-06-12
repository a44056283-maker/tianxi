"""今日水印相机 OpenAPI 客户端。

按官方文档 `https://docs.xhey.top/docs/open-platform-server/` 的双重 HmacSHA256 + Base64 签名实现：
1. 先对请求 body 原文做一次签名 -> data_sign
2. 再对 `groupKey=<key>&sign=<data_sign>&timestamp=<ts>` 做一次签名 -> Signature
3. Header 使用 `GroupKey` / `Timestamp` / `Signature`
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import ssl
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any

BASE_URL = "https://openapi.xhey.top"
DRY_RUN = os.environ.get("XHEY_DRY_RUN", "true").lower() in ("1", "true", "yes")


def _load_credentials() -> tuple[str, str]:
    env_key = os.environ.get("XHEY_GROUP_KEY", "")
    env_secret = os.environ.get("XHEY_GROUP_SECRET", "")
    if env_key and env_secret:
        return env_key, env_secret
    cred_path = os.path.expanduser("~/.xhey_credentials.json")
    if not os.path.exists(cred_path):
        return "", ""
    try:
        data = json.load(open(cred_path, encoding="utf-8"))
        return data.get("groupKey", "") or "", data.get("groupSecret", "") or ""
    except Exception:
        return "", ""


def _json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _sign_text(source: str, group_secret: str) -> str:
    digest = hmac.new(group_secret.encode("utf-8"), source.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def _build_headers(group_key: str, group_secret: str, body_text: str, timestamp: str) -> dict[str, str]:
    data_sign = _sign_text(body_text, group_secret)
    text_to_sign = f"groupKey={group_key}&sign={data_sign}&timestamp={timestamp}"
    signature = _sign_text(text_to_sign, group_secret)
    return {
        "Content-Type": "application/json",
        "GroupKey": group_key,
        "Timestamp": timestamp,
        "Signature": signature,
    }


@dataclass
class XheyPhoto:
    photo_id: str
    user_id: str
    user_name: str
    taken_at: int
    watermark_text: str
    media_url: str
    extra: dict[str, Any] = field(default_factory=dict)


def _normalize_timestamp(value: Any) -> int:
    if value in (None, ""):
        return 0
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return 0
    if parsed > 10**12:
        return parsed // 1000
    return parsed


def _make_photo(item: dict[str, Any]) -> XheyPhoto:
    return XheyPhoto(
        photo_id=str(item.get("photoId") or item.get("id") or ""),
        user_id=str(item.get("userID") or item.get("userId") or ""),
        user_name=str(item.get("userName") or item.get("name") or ""),
        taken_at=_normalize_timestamp(item.get("time") or item.get("takenAt") or item.get("createdAt")),
        watermark_text=str(item.get("watermarkContent") or item.get("watermark") or ""),
        media_url=str(item.get("mediaUrl") or item.get("url") or ""),
        extra=item,
    )


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _post_call(group_key: str, group_secret: str, endpoint: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = body or {}
    body_text = _json_dumps(payload)
    timestamp = str(int(time.time()))
    headers = _build_headers(group_key, group_secret, body_text, timestamp)
    request = urllib.request.Request(
        BASE_URL + endpoint,
        data=body_text.encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20, context=_ssl_context()) as response:
        return json.loads(response.read().decode("utf-8"))


_MOCK_DATA = [
    ("梁伟", "我是梁伟 教育补凭证 单扫订单 XS26060900012345 客户张三 SN:BH022VR7"),
    ("李建定", "我是李建定 教育补凭证 三件套 SN:BH022VR8 BH022VR9 BH023AA1"),
    ("郭晨臣", "我是郭晨臣 教育补凭证 单扫订单 XS26061000099999 客户李四 SN:BH023AA2"),
]


def _mock_photos(start_time: int) -> list[XheyPhoto]:
    return [
        XheyPhoto(
            photo_id=f"mock-{index:03d}",
            user_id=f"mock-user-{index:03d}",
            user_name=user_name,
            taken_at=start_time + index * 600,
            watermark_text=watermark,
            media_url=f"https://mock.xhey.top/p/mock-{index:03d}.jpg",
            extra={"mock": True},
        )
        for index, (user_name, watermark) in enumerate(_MOCK_DATA)
    ]


def list_user_ids(group_key: str, group_secret: str, dry_run: bool) -> list[str]:
    if dry_run:
        return [f"mock-user-{index:03d}" for index in range(3)]
    payload = _post_call(group_key, group_secret, "/v2/group/user/idList")
    if payload.get("code") != 200:
        raise RuntimeError(f"xhey API error: code={payload.get('code')} msg={payload.get('msg')}")
    return [str(item) for item in payload.get("data", [])]


def search_photos(
    group_key: str,
    group_secret: str,
    dry_run: bool,
    start_time: int,
    end_time: int,
    user_ids: list[str] | None = None,
    watermark_keywords: list[str] | None = None,
    media_type: int = 0,
) -> list[XheyPhoto]:
    if len(watermark_keywords or []) > 3:
        raise ValueError("watermark_keywords 最多 3 个")
    if any(len(keyword) > 15 for keyword in (watermark_keywords or [])):
        raise ValueError("单个关键词不能超过 15 个字符")
    body: dict[str, Any] = {
        "startTime": start_time,
        "endTime": end_time,
        "mediaType": media_type,
    }
    if user_ids:
        body["userIds"] = user_ids
    if watermark_keywords:
        body["watermarkContent"] = watermark_keywords
    if dry_run:
        return _mock_photos(start_time)
    payload = _post_call(group_key, group_secret, "/v2/group/photo/search", body)
    if payload.get("code") != 200:
        raise RuntimeError(f"xhey API error: code={payload.get('code')} msg={payload.get('msg')}")
    data = payload.get("data") or {}
    items = data.get("list") if isinstance(data, dict) else data
    return [_make_photo(item) for item in (items or [])]


def list_photos(
    group_key: str,
    group_secret: str,
    dry_run: bool,
    start_time: int,
    end_time: int,
    user_ids: list[str] | None = None,
    media_type: int = 0,
    page_size: int = 100,
    page_no: int = 1,
) -> list[XheyPhoto]:
    body: dict[str, Any] = {
        "startTime": start_time,
        "endTime": end_time,
        "mediaType": media_type,
        "pageSize": page_size,
        "pageNo": page_no,
    }
    if user_ids:
        body["userID"] = user_ids
        body["userIds"] = user_ids
    if dry_run:
        return _mock_photos(start_time)
    payload = _post_call(group_key, group_secret, "/v2/group/photo", body)
    if payload.get("code") != 200:
        raise RuntimeError(f"xhey API error: code={payload.get('code')} msg={payload.get('msg')}")
    data = payload.get("data") or {}
    items = data.get("list") if isinstance(data, dict) else data
    return [_make_photo(item) for item in (items or [])]


def download_photo(dry_run: bool, url: str, dest_path: str) -> bool:
    if dry_run:
        return False
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url), timeout=30, context=_ssl_context()) as response:
        with open(dest_path, "wb") as target:
            target.write(response.read())
    return True


def healthcheck(group_key: str, group_secret: str, dry_run: bool) -> dict[str, Any]:
    started_at = int(time.time())
    user_ids = list_user_ids(group_key, group_secret, dry_run)
    return {
        "ok": True,
        "checkedAt": started_at,
        "dryRun": dry_run,
        "userCount": len(user_ids),
        "sampleUserIds": user_ids[:5],
    }


def make_client(group_key: str = "", group_secret: str = "", dry_run: bool | None = None):
    loaded_key, loaded_secret = _load_credentials()
    resolved_key = group_key or loaded_key
    resolved_secret = group_secret or loaded_secret
    resolved_dry_run = DRY_RUN if dry_run is None else dry_run
    if not resolved_dry_run and (not resolved_key or not resolved_secret):
        raise ValueError("XHEY_GROUP_KEY / XHEY_GROUP_SECRET 未设置")
    cls = type(
        "XheyClient",
        (),
        {
            "group_key": resolved_key,
            "group_secret": resolved_secret,
            "dry_run": resolved_dry_run,
        },
    )
    return cls()


def _bind_methods(instance):
    instance.healthcheck = lambda: healthcheck(instance.group_key, instance.group_secret, instance.dry_run)
    instance.list_user_ids = lambda: list_user_ids(instance.group_key, instance.group_secret, instance.dry_run)
    instance.search_photos = lambda *a, **kw: search_photos(instance.group_key, instance.group_secret, instance.dry_run, *a, **kw)
    instance.list_photos = lambda *a, **kw: list_photos(instance.group_key, instance.group_secret, instance.dry_run, *a, **kw)
    instance.download_photo = lambda *a, **kw: download_photo(instance.dry_run, *a, **kw)
    return instance


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["healthcheck", "list-users", "search", "list"])
    parser.add_argument("--hours", type=int, default=1, help="search: 拉取最近 N 小时")
    parser.add_argument("--keywords", nargs="+", default=["教育补"], help="search: 水印关键词")
    parser.add_argument("--page-size", type=int, default=100, help="list: 每页数量")
    parser.add_argument("--page-no", type=int, default=1, help="list: 页码")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client = _bind_methods(make_client(dry_run=True if args.dry_run else None))
    if args.command == "healthcheck":
        print(json.dumps(client.healthcheck(), ensure_ascii=False, indent=2))
        return
    if args.command == "list-users":
        print(json.dumps(client.list_user_ids(), ensure_ascii=False, indent=2))
        return

    now = int(time.time())
    start = now - args.hours * 3600
    if args.command == "list":
        photos = client.list_photos(
            start,
            now,
            user_ids=client.list_user_ids(),
            page_size=args.page_size,
            page_no=args.page_no,
        )
    else:
        photos = client.search_photos(start, now, watermark_keywords=args.keywords)
    print(json.dumps([
        {
            "photoId": photo.photo_id,
            "userName": photo.user_name,
            "takenAt": photo.taken_at,
            "watermarkText": photo.watermark_text,
            "mediaUrl": photo.media_url,
        }
        for photo in photos
    ], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
