from zdt_sync.utils import build_record_id, is_dangerous_action_text, record_hash


def test_record_hash_stable():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert record_hash("orders", a) == record_hash("orders", b)


def test_build_record_id_uses_fields():
    r1 = {"order_no": "A", "sku": "S1", "amount": "10"}
    r2 = {"order_no": "A", "sku": "S1", "amount": "20"}
    assert build_record_id("orders", r1, ["order_no", "sku"]) == build_record_id("orders", r2, ["order_no", "sku"])


def test_dangerous_action_text():
    assert is_dangerous_action_text("确认退款")
    assert not is_dangerous_action_text("查询")
