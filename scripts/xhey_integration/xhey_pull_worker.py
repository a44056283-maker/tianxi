"""今日水印相机 pull worker.

主链:
今日相机 OpenAPI -> 按教育补代扫规则路由 -> bridge API -> SQL -> 前端静态快照

备用链:
网页端 CLI 脚本统一产出同一份 JSON 结构。
"""
import json, mimetypes, os, sys, tempfile, time, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path

# Add sibling modules to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xhey_client import make_client, _bind_methods # noqa: E402
from watermark_classifier import classify # noqa: E402
from education_agent_routing import route_record, build_bundle_groups, TARGET_STAFF # noqa: E402

BRIDGE_BASE = os.environ.get("BRIDGE_API_BASE", "http://127.0.0.1:8000")
BRIDGE_TOKEN = os.environ.get("COLLECTION_BRIDGE_API_KEY", "")
SCAN_INTERVAL = int(os.environ.get("XHEY_SCAN_INTERVAL", "300")) #5 min
PHOTO_BASE_DIR = os.environ.get("XHEY_PHOTO_DIR", "/Volumes/TianLu_Storage/Shared/今日水印相机/processed")
TARGET_USER_IDS = [item for item in os.environ.get("XHEY_TARGET_USER_IDS", "").split(",") if item]

CATEGORY_TO_SCAN_TYPE = {
 "education_subsidy": "single_scan",
 "inventory_movement": "multi_scan",
 "sales_order": "single_scan",
 "purchase_order": "multi_scan",
 "unknown": "single_scan",
}


def _post_json(endpoint, payload):
 url = BRIDGE_BASE + endpoint
 headers = {"Content-Type": "application/json"}
 if BRIDGE_TOKEN: headers["X-Bridge-Token"] = BRIDGE_TOKEN
 print(f"[bridge] POST {url}")
 print(f" payload: {json.dumps(payload, ensure_ascii=False)[:300]}")
 if os.environ.get("XHEY_DRY_RUN", "true").lower() in ("1","true","yes"): print("[bridge DRY-RUN] 不真发请求"); return {"record_id": f"DRY-{int(time.time())}", "matched": True}
 data = json.dumps(payload).encode()
 req = urllib.request.Request(url, data=data, headers=headers, method="POST")
 try: resp = urllib.request.urlopen(req, timeout=10); return json.loads(resp.read().decode())
 except urllib.error.HTTPError as e: return {"error": e.code, "body": e.read().decode()[:200]}


def _build_multipart_body(fields, file_field, file_name, file_bytes, content_type):
 boundary = f"----XheyBridge{int(time.time() * 1000)}"
 lines = []
 for key, value in fields.items():
  lines.append(f"--{boundary}\r\n".encode())
  lines.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
  lines.append(str(value).encode("utf-8"))
  lines.append(b"\r\n")
 lines.append(f"--{boundary}\r\n".encode())
 lines.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"\r\n'.encode())
 lines.append(f"Content-Type: {content_type}\r\n\r\n".encode())
 lines.append(file_bytes)
 lines.append(b"\r\n")
 lines.append(f"--{boundary}--\r\n".encode())
 body = b"".join(lines)
 return boundary, body


def _post_bridge_file(endpoint, metadata, file_path):
 url = BRIDGE_BASE + endpoint
 headers = {}
 if BRIDGE_TOKEN:
  headers["X-Bridge-Token"] = BRIDGE_TOKEN
 with open(file_path, "rb") as handle:
  file_bytes = handle.read()
 file_name = os.path.basename(file_path)
 content_type = mimetypes.guess_type(file_name)[0] or "image/jpeg"
 boundary, body = _build_multipart_body(
  {"metadata": json.dumps(metadata, ensure_ascii=False)},
  "file",
  file_name,
  file_bytes,
  content_type,
 )
 headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
 print(f"[bridge] POST {url}")
 print(f" metadata: {json.dumps(metadata, ensure_ascii=False)[:300]}")
 if os.environ.get("XHEY_DRY_RUN", "true").lower() in ("1", "true", "yes"):
  print("[bridge DRY-RUN] 不真发请求")
  return {"record_id": f"DRY-{int(time.time())}", "matched": True, "status": "success"}
 req = urllib.request.Request(url, data=body, headers=headers, method="POST")
 try:
  resp = urllib.request.urlopen(req, timeout=30)
  return json.loads(resp.read().decode())
 except urllib.error.HTTPError as e:
  return {"error": e.code, "body": e.read().decode()[:400]}


def _download_temp_image(client, photo):
 if os.environ.get("XHEY_DRY_RUN", "true").lower() in ("1", "true", "yes"):
  temp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
  temp.write(b"\xff\xd8\xff\xd9")
  temp.close()
  return temp.name
 suffix = Path(photo.media_url.split("?")[0]).suffix or ".jpg"
 temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
 temp.close()
 client.download_photo(photo.media_url, temp.name)
 return temp.name


def submit_to_bridge(client, photo, classification):
 routed = route_record(photo.user_name, photo.watermark_text, classification.extracted)
 if not routed:
  return {"skipped": True, "reason": "未命中目标员工或教育补代扫规则"}
 payload = {
  "staff_id": routed.staff_id,
  "staff_name": routed.staff_name,
  "scan_type": routed.scan_type,
  "source_group": routed.source_group_name,
  "customer_phone": routed.customer_phone,
  "serial_number": routed.serial_numbers[0] if routed.serial_numbers else "",
  "order_number": routed.order_number,
  "notes": routed.route_reason,
  "captured_at": datetime.fromtimestamp(photo.taken_at).isoformat() if photo.taken_at else "",
  "client_tag": "xhey-openapi-worker",
  "source_type": "xhey_api_manual",
  "collection_source": "xhey_api",
  "photo_id": photo.photo_id,
  "media_url": photo.media_url,
  "watermark": photo.watermark_text,
  "taken_at": str(photo.taken_at or ""),
  "extracted": classification.extracted,
 }
 temp_path = _download_temp_image(client, photo)
 try:
  return _post_bridge_file("/api/collection/v1/submit", payload, temp_path)
 finally:
  try:
   os.unlink(temp_path)
  except OSError:
   pass


def _staff_id_from_name(user_name):
 uname = user_name or ""
 matches = [emp_id for name, emp_id in TARGET_STAFF.items() if name in uname]
 return matches[0] if matches else ""


def save_photo_locally(photo, classification, base_dir=PHOTO_BASE_DIR):
 routed = route_record(photo.user_name, photo.watermark_text, classification.extracted)
 if not routed:
  return None
 emp_id = routed.staff_id or "unknown"
 date_str = datetime.fromtimestamp(photo.taken_at).strftime("%Y-%m-%d")
 target_dir = Path(base_dir) / date_str / routed.source_group_name / emp_id
 target_dir.mkdir(parents=True, exist_ok=True)
 target = target_dir / f"xhey-{photo.photo_id}.json"
 payload = {
  "photo_id": photo.photo_id,
  "user_id": photo.user_id,
  "user_name": photo.user_name,
  "taken_at": photo.taken_at,
  "watermark_text": photo.watermark_text,
  "category": classification.category,
  "extracted": classification.extracted,
  "media_url": photo.media_url,
  "source_group_name": routed.source_group_name,
  "route_reason": routed.route_reason,
  "customer_phone": routed.customer_phone,
  "serial_numbers": routed.serial_numbers,
  "order_number": routed.order_number,
  "bundle_size": routed.bundle_size,
  "scan_type": routed.scan_type,
 }
 target.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
 return str(target)


def _fetch_candidate_photos(client, start, end):
 user_ids = TARGET_USER_IDS or None
 keywords = ["教育补", "代扫", "教育补贴群"]
 photos = []
 try:
  photos = client.search_photos(start, end, user_ids=user_ids, watermark_keywords=keywords)
  if photos:
   print(f"[xhey] search_photos 命中 {len(photos)} 张")
   return photos
  print("[xhey] search_photos 返回 0 张，切换到 /v2/group/photo 全量分页拉取")
 except Exception as exc:
  print(f"[xhey] search_photos 异常，切换到 /v2/group/photo：{exc}")

 if not user_ids:
  try:
   user_ids = client.list_user_ids()
  except Exception as exc:
   print(f"[xhey] list_user_ids 失败：{exc}")
   user_ids = None

 aggregated = []
 seen = set()
 for page_no in range(1, 6):
  page_photos = client.list_photos(start, end, user_ids=user_ids, page_size=100, page_no=page_no)
  print(f"[xhey] list_photos page={page_no} 返回 {len(page_photos)} 张")
  if not page_photos:
   break
  for photo in page_photos:
   if photo.photo_id and photo.photo_id in seen:
    continue
   if photo.photo_id:
    seen.add(photo.photo_id)
   aggregated.append(photo)
  if len(page_photos) < 100:
   break
 return aggregated


def run_once(client):
 now = int(time.time())
 start = now - SCAN_INTERVAL
 photos = _fetch_candidate_photos(client, start, now)
 results = []
 routed_records = []
 for photo in photos:
  classification = classify(photo.watermark_text)
  if classification.category != "education_subsidy":
   continue
  routed = route_record(photo.user_name, photo.watermark_text, classification.extracted)
  if routed:
   routed_records.append(routed)
  results.append({
   "photo_id": photo.photo_id,
   "category": classification.category,
   "confidence": classification.confidence,
   "extracted": classification.extracted,
   "saved_path": save_photo_locally(photo, classification),
   "bridge_resp": submit_to_bridge(client, photo, classification),
   "routed_group": routed.source_group_name if routed else "",
   "route_reason": routed.route_reason if routed else "未命中路由",
  })
 build_bundle_groups(routed_records)
 if results and os.environ.get("XHEY_DRY_RUN", "true").lower() not in ("1", "true", "yes"):
  _post_json("/api/education-scan/v2/sync-to-projection", {})
 return results


def main():
 import argparse
 ap = argparse.ArgumentParser()
 ap.add_argument("--once", action="store_true", help="只跑一次")
 ap.add_argument("--interval", type=int, default=SCAN_INTERVAL, help="扫描间隔(秒)")
 args = ap.parse_args()
 client = _bind_methods(make_client())
 if args.once: [print(json.dumps(r, ensure_ascii=False, indent=2)) for r in run_once(client)]; return
 while True: results = run_once(client); print(f"\n[{datetime.now().isoformat()}] 本轮扫描到 {len(results)} 张照片"); time.sleep(args.interval)


if __name__ == "__main__":
 main()
