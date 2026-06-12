# Lenovo Smart Retail GitHub Export

This working tree is a GitHub-ready export of the Lenovo Smart Retail project.

Included:
- application source code
- project docs
- automation definitions
- frontend static data needed for understanding the project

Excluded on purpose:
- `.git` history from the original local workspace
- local databases and WAL files
- runtime logs
- local credentials, `.env`, and auth state
- heavy artifact bundles and context package zips
- nested accidental duplicate directories

Target remote:
- `https://github.com/a44056283-maker/tianxi.git`

Current blocker:
- this machine is not authenticated for GitHub push yet

When authentication is ready, run:

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/tianxi-github-upload
git add .
git commit -m "Import Lenovo smart retail project"
git push origin main
```
