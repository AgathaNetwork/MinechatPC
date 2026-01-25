# Agatha Front (Electron)

这是一个 **Electron 壳应用**：启动后会在本机启动一个内置静态服务器，并从打包的 `public/` 目录加载前端页面（所有 UI 资源本地加载）。

前端需要通过 `/config` 获取后端 API 基址，请在运行时通过环境变量配置：

- 默认后端：`https://back-dev.agatha.org.cn`
- `MINECHAT_API_BASE`：后端基址（例如 `https://api.example.com`）
- （可选）`MINECHAT_API_PROXY_BASE`：如需代理/CORS 兼容，可单独指定

## 运行（开发/本地）

在项目根目录执行：

- `npm install`
- `npm start`

## 打包（Windows 安装包）

- `npm run dist`

产物会输出到 `dist/`。

## 应用图标（Windows）

- 把你提供的图片保存为 `assets/icon.png`
- 执行 `npm install`（会自动生成 `assets/icon.ico`）
- 重新运行 `npm start` 或 `npm run dist`

## 说明

- 默认只允许应用内导航到本机内置站点（`127.0.0.1/localhost`）与微软登录相关域名；跳转到其它域名会在新 Electron 窗口中打开。

## PC 端相册导入（模组 -> Minechat）

PC 端会在本机启动一个 HTTP 监听，用于接收“图片已保存到电脑后的路径”，并自动跳转到相册页打开上传弹窗、预选该文件。

- 监听地址：`http://127.0.0.1:28188/pc/gallery/import`
- `GET` 示例：`/pc/gallery/import?path=C%3A%5Cimages%5Cshot.png`
- `POST` 示例：请求体 `{"path":"C:\\images\\shot.png"}`（也支持直接传纯文本路径）

注意：相册上传当前优先支持 PNG；建议模组保存为 `.png`。
