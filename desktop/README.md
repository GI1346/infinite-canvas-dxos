# Windows 桌面版

包含多维表格、并发节点、开源画布格式的中转站自定义协议，以及图片/历史/日志清理工具。

## 下载与使用

从本仓库 Releases 下载 `Infinite-Canvas-DXOS-Setup-0.20.1-x64.exe`，安装后启动。
中转站：配置 → 协议中心，使用 `canvas-call/v1`，不是 DXOS 协议。
清理：画布右上角「清理」，选择范围后先下载 ZIP 备份，再确认执行；同一入口可以导入恢复。
保留 API 地址、密钥、渠道、协议、模型选择、节点连线和表格内容；素材图片默认不删。

数据保存在本机。清理不会删除电脑原图或远程中转站、WebDAV、外部 Agent 上的记录。
安装程序未附加商业代码签名证书。

## 从源码打包

在 `web` 目录执行 `npm install --legacy-peer-deps`、`npm run test:cleanup`、`npm run build`。
将 `web/dist` 的内容复制到 `desktop/web`；在 `desktop` 执行 `npm install`、`npm run build -- --publish never`。
输出在 `desktop/release`。开源许可证保留在项目根目录。
