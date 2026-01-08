# Agatha Front (Electron)

这是一个 **Electron 壳应用**：启动后直接加载在线站点：

- https://front-dev.agatha.org.cn

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

- 默认只允许应用内导航到 `front-dev.agatha.org.cn`；跳转到其它域名会在系统默认浏览器中打开。
- `preload.js` 目前不暴露任何 API，保持最小权限。
