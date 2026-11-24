#!/bin/sh
# 更新を公開する前に実行:index.html と version.json のバージョンをそろえて上げる
V=$(date -u +%Y%m%d%H%M)
sed -i "s/const APP_VERSION = '[0-9]*'/const APP_VERSION = '$V'/" index.html
echo "{\"version\":\"$V\"}" > version.json
echo "version: $V"
