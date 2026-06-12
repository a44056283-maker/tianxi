from zdt_sync.parsers.json_path import extract_json_path


def test_extract_json_path():
    payload = {"data": {"records": [{"id": 1}]}}
    assert extract_json_path(payload, "data.records") == [{"id": 1}]
    assert extract_json_path(payload, "data.missing") is None
