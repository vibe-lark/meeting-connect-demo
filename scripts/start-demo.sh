#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PORT="${PORT:-3107}"
echo "Meeting Connect demo starting on 0.0.0.0:${PORT}"
echo "Public URL: https://meeting-connect.dev.solutionsuite.cn"
echo "Feishu event URL: https://meeting-connect.dev.solutionsuite.cn/api/feishu/events"

npm start
