# Orderflow Email API

独立的自动拉邮件和订单提取 API 服务。这个目录可以单独复制到服务器或构建 Docker 镜像，不需要 Electron 桌面端。

## 功能

- `GET /health`
- `POST /api/email/messages`：扫描企业微信邮箱候选订单邮件
- `POST /api/email/extract`：按邮件 UID 下载订单 Excel 并提取
- `POST /api/orders/extract`：直接用服务器路径或 base64 上传 Excel，复用同一套提取规则

## 环境变量

复制 `.env.example`，在云端配置：

```bash
EMAIL_API_TOKEN=change-me-long-random-token
EMAIL_ACCOUNT=your-enterprise-email@example.com
EMAIL_AUTH_CODE=your-enterprise-wecom-mail-auth-code
EMAIL_API_HOST=0.0.0.0
EMAIL_API_PORT=8787
EMAIL_IMAP_SERVER=imap.exmail.qq.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_PROXY=
EMAIL_CACHE_DAYS=7
EMAIL_CACHE_REFRESH_SECONDS=120
```

`EMAIL_AUTH_CODE` 不要写进客户端代码，客户端只需要 `EMAIL_API_TOKEN`。

`EMAIL_IMAP_PROXY` 可选，服务器直连 IMAP 端口受限时使用，例如 `socks5://127.0.0.1:7891` 或 `http://127.0.0.1:7890`。

服务启动后会用 `.env` 中的邮箱预拉取邮件列表缓存。`EMAIL_CACHE_DAYS` 控制默认预拉天数，`EMAIL_CACHE_REFRESH_SECONDS` 控制后台刷新间隔；桌面端刷新邮件时优先读取缓存，缓存未命中时才实时连接 IMAP。

## 本地运行

```bash
npm install
npm run build
npm start
```

Python 依赖：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-python-runner.txt
export ORDER_ORGANIZER_PYTHON="$PWD/.venv/bin/python"
```

## Docker 构建

构建镜像：

```bash
docker build -t orderflow-email-api .
```

运行：

```bash
docker run --rm -p 8787:8787 \
  -e EMAIL_API_TOKEN="$EMAIL_API_TOKEN" \
  -e EMAIL_ACCOUNT="$EMAIL_ACCOUNT" \
  -e EMAIL_AUTH_CODE="$EMAIL_AUTH_CODE" \
  -e EMAIL_IMAP_PROXY="$EMAIL_IMAP_PROXY" \
  orderflow-email-api
```

## 调用示例

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

扫描邮件：

```bash
curl -X POST http://127.0.0.1:8787/api/email/messages \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"days":7}'
```

提取邮件订单：

```bash
curl -X POST http://127.0.0.1:8787/api/email/extract \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageUids":["101"],"hours":168}'
```

直接提取服务器文件：

```bash
curl -X POST http://127.0.0.1:8787/api/orders/extract \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paths":["/server/orders/order.xlsx"],"inferManual":true}'
```

上传 base64 文件：

```bash
curl -X POST http://127.0.0.1:8787/api/orders/extract \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"files":[{"filename":"order.xlsx","contentBase64":"BASE64内容"}],"inferManual":true}'
```
