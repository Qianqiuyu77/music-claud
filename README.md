# AI 私人歌单

基于真实网易云音乐曲库的本地推荐工作台。推荐、播放地址和分类标签都来自后端拉取到的真实歌曲数据，不返回假歌单。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

生成推荐前需要在 `.env.local` 中配置真实网易云 Cookie：`NETEASE_COOKIE`。缺少 Cookie 时，推荐接口会返回明确错误，不会编造歌曲数据。DeepSeek 兼容后端会读取 `.env.local` 中的 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL`。
