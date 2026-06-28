# 已归档：早期 MVP 计划

这份计划曾用于最初搭建本地音乐推荐工作台，里面的旧 mock 方案已经废弃。

当前实现不再使用 mock 网易云 provider 作为运行路径。推荐接口要求后端存在有效网易云 Cookie，只从真实拉取到的网易云歌曲里生成推荐，并返回真实播放地址和分类标签。

请以 `src/lib/appServices.ts`、`src/lib/netease/cloudProvider.ts`、`src/lib/recommendation/songTags.ts` 以及当前测试为准。
