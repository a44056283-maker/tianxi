# systemd timer 部署示例

```bash
sudo cp scripts/systemd/zdt-sync-orders.service /etc/systemd/system/
sudo cp scripts/systemd/zdt-sync-orders.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zdt-sync-orders.timer
systemctl list-timers | grep zdt-sync
```

请先把 `/opt/zdt-sync`、`User=zdt`、`Group=zdt` 改成真实部署环境。
