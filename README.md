# MAI MATCH Tournament Studio

面向 maimai 两队赛制直播的本地导播控制台。Vue 控制台、REST API、Socket.IO 实时播出和 SQLite 数据库由同一个 Node 项目提供。

控制台只有两个可自定义名称与颜色的队伍。导播可以从玩家池自由增减双方队员、逐行选择 1P/2P、添加普通行或加赛行，并指定当前对战行。进入下一轮时，导播自行从两队移除淘汰玩家并重新编排；系统不会猜测晋级关系。单行总分相同会记为平局且不增加队伍胜场，由导播另建加赛行并重新选择双方出战玩家。

## 运行

要求 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

开发控制台默认位于 `http://localhost:5173/control`。生产运行方式：

```bash
npm run build
npm start
```

生产控制台默认位于 `http://localhost:8787/control`，OBS 浏览器源为：

- `http://localhost:8787/obs/match`
- `http://localhost:8787/obs/songs`
- `http://localhost:8787/obs/results`
- `http://localhost:8787/obs/bracket`（两队名单、总比分与对战行战况）

OBS 浏览器源建议设置为 1920 × 1080。局域网中的另一台设备使用运行服务器的局域网 IP 替换 `localhost`。

## 数据与配置

数据库、玩家头像与曲绘缓存默认保存在 `data/`。可复制 `.env.example` 中的变量，通过运行环境修改监听地址、端口、数据目录以及落雪 API 地址。

比赛内容先在控制台更新预览，再点击“推送到直播”；OBS 页面只读取已经发布的快照。

比赛主界面使用 `public/obs-assets/match-background.png`，页面只会在底图上叠加双方头像与玩家名。曲目、成绩和队伍战况页面统一使用 `public/obs-assets/main-background.png`。

## 检查

```bash
npm test
npm run build
```
