# Web 3D Viewer

一个单文件的 Web 端 OBJ 模型查看器，基于 Three.js。不需要安装任何软件，用浏览器打开就能加载并预览 ZIP 包内的模型与贴图。

## 功能

- 单 HTML 文件，无后端，可本地打开或部署到静态托管
- 加载 `.obj` + `.mtl` + 纹理贴图
- 纹理格式：`jpg` / `jpeg` / `png` / `webp` / `bmp` / `gif` / `tga` / `dds`
- 自动匹配 MTL 中引用的纹理路径，支持精确、去扩展名、模糊三级匹配
- 移动端触控操作，适配高 DPI 屏幕
- 顶点数与三角面数统计
- 贴图匹配日志，便于排查材质丢失

## 使用

1. 打开 `index.html`
2. 把模型资源打包成一个 ZIP
3. 点击「选择 ZIP」，加载完成后即可查看

ZIP 目录结构示例：

```
model.zip
├── model.obj
├── model.mtl
├── texture_diffuse.png
├── texture_bump.png
└── ...
```

## 操作

| 操作 | 功能 |
|---|---|
| 鼠标拖动 / 单指滑动 | 旋转模型 |
| 滚轮 / 双指捏合 | 缩放视角 |
| 旋转按钮 | 自动旋转 |
| 重置按钮 | 恢复初始视角 |
| 贴图按钮 | 展开纹理匹配日志 |

## 技术栈

- Three.js r163（ES Module，通过 importmap 从 unpkg 加载）
- JSZip 3.10.1（cdnjs → unpkg → jsDelivr 依次回退）
- WebGL

## 限制

- 只针对 OBJ 工作流设计，不支持 glTF / GLB
- 不支持骨骼动画与形变动画
- 高面数模型受浏览器与设备性能限制
- 需要联网：Three.js 与 JSZip 都走 CDN，国内网络下首次加载可能较慢
- Three.js 默认从 jsDelivr 加载；若访问不了，在地址后加 `?cdn=unpkg` 或 `?cdn=npmmirror` 切换源（加载失败时页面也会给出可点的切换链接）
- ZIP 上限 300 MB，解压后纹理总量上限 600 MB
- MTL 解析覆盖常见指令（`Kd` / `Ns` / `d` / `map_Kd` / `map_bump` / `map_Ks`），不保证支持全部扩展

## 实现说明

几处和性能、内存相关的处理：

- **按需渲染**：静止状态下不重绘，仅在视角变化、贴图加载完成、窗口缩放时触发渲染。自动旋转与阻尼动画期间持续重绘。
- **资源释放**：切换模型时释放上一轮的 geometry、material 与全部 texture，并 revoke 对应的 blob URL。`material.dispose()` 不会连带释放贴图，这部分是单独处理的。
- **纹理尺寸保护**：贴图尺寸超过设备 `maxTextureSize` 时关闭 mipmap 并记录警告，避免生成 mipmap 时显存溢出。
- **相机适配**：`near` / `far` 与 `maxDistance` 随模型包围盒尺寸调整，大模型不会被远裁剪面切掉。

## 浏览器要求

支持 ES Module 与 importmap 的现代浏览器：

- Chrome / Edge 89+
- Firefox 108+
- Safari 16.4+

## 开发日志

每次版本变更的原因记录在 [CHANGELOG.md](CHANGELOG.md)。

## License

GPL-3.0，见 [LICENSE](LICENSE)。