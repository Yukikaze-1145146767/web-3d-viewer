# Web 3D Viewer

一个单文件的 Web 端 OBJ 模型查看器，基于 Three.js。不需要安装任何软件，用浏览器打开就能加载并预览 ZIP 包内的模型与贴图。

**在线演示**：<https://yukikaze-1145146767.github.io/web-3d-viewer/> — 托管在 GitHub Pages，与仓库内 `index.html` 同步，打开即可使用。

## 功能

- 单 HTML 文件，无后端，可本地打开或部署到静态托管
- 加载 `.obj` + `.mtl` + 纹理贴图
- 纹理格式：`jpg` / `jpeg` / `png` / `webp` / `bmp` / `gif` / `tga` / `dds`
- 按 OBJ 的 `mtllib` 和 MTL 相对路径加载资源，同名贴图有歧义时明确报错
- 支持多材质分组、多条 `mtllib` 声明；ZIP 包含多个 OBJ 时可选择模型
- OBJ 在内嵌 Worker 中解析，解压、解析和贴图加载期间可取消并保留旧模型
- 移动端触控操作，适配高 DPI 屏幕
- 顶点数与三角面数统计
- 贴图匹配日志，便于排查材质丢失

## 使用

1. 打开 `index.html`
2. 把模型资源打包成一个 ZIP
3. 点击「打开 ZIP」，加载完成后即可查看

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

也可以把 ZIP 直接拖进窗口。快捷键：`G` 网格、`W` 线框、空格 自动旋转、`R` 重置、`S` 截图、`F` 全屏、`L` 贴图日志。

## 技术栈

- Three.js r163（ES Module，通过 importmap 从 jsDelivr 加载）
- JSZip 3.10.1（cdnjs → unpkg → jsDelivr 依次回退）
- WebGL

## 限制

- 只针对 OBJ 工作流设计，不支持 glTF / GLB
- 不支持骨骼动画与形变动画
- 高面数模型受浏览器与设备性能限制
- 需要联网：Three.js 与 JSZip 都走 CDN，国内网络下首次加载可能较慢
- Three.js 默认从 jsDelivr 加载；若访问不了，在地址后加 `?cdn=unpkg` 或 `?cdn=npmmirror` 切换源（加载失败时页面也会给出可点的切换链接）
- ZIP 上限 300 MiB、10000 个文件；实际读取资源单文件上限 128 MiB，总量上限 600 MiB，涵盖 OBJ、MTL 和贴图
- 唯一纹理的基础像素总量上限 32 MiPixels；纹理任一维度不得超过设备 `maxTextureSize`。这些限制不能保证任意设备不会内存不足：图片解码、OBJ 解析和 GPU 分配仍可能产生额外峰值
- OBJ 在 Worker 中解析，限制 300 万渲染顶点、10000 个对象、20000 个材质分组和 256 MiB 几何缓冲区。几何预算在官方解析器返回后检查，不能消除解析阶段的内存峰值；GPU 上传和场景重建仍可能短暂占用主线程
- MTL 使用官方 `MTLLoader` 与 `MeshPhongMaterial`，支持 `Kd` / `Ks` / `Ns` / `d` / `Tr`、颜色/高光/法线/凹凸/透明/自发光贴图及 `-s` / `-o` / `-bm`。`-s`、`-o` 请提供三个分量；不保证支持全部扩展
- 多个材质库请分别使用一条 `mtllib` 声明；引用的材质名称应唯一
- DDS 依赖设备支持相应压缩纹理格式

## 实现说明

几处和性能、内存相关的处理：

- **按需渲染**：静止时停止动画帧调度，交互与窗口变化时重新唤醒。自动旋转使用实际帧间隔，页面隐藏时暂停。
- **资源释放**：切换模型时释放上一轮的 geometry、material 与全部 texture，并 revoke 对应的 blob URL。`material.dispose()` 不会连带释放贴图，这部分是单独处理的。
- **按引用读取**：只解压选中 OBJ、引用的 MTL 和使用中的贴图；图片顺序解码，同源图片共用 Source，保留各材质独立的 UV 参数和色彩空间。
- **失败清理**：贴图解码完成后才提交模型；路径冲突、超限或损坏资源会中止加载并保留旧模型。
- **纹理尺寸保护**：超出设备尺寸或像素预算时明确拒绝；不通过关闭 mipmap 掩盖无效尺寸。
- **相机适配**：按模型包围球和水平/垂直视角计算距离，裁剪面与缩放范围随模型尺度调整。
- **截图**：导出前即时渲染并使用 `toBlob()`，无需常驻保留绘制缓冲区。
- **后台解析**：Worker 使用锁定版本官方 OBJLoader；输入 ArrayBuffer 和输出 TypedArray 缓冲区通过 transfer list 转移。包围盒、包围球和坐标有效性检查也在 Worker 中完成。
- **取消任务**：解析中止会终止 Worker；解压流暂停并释放本轮资源；无法立即中断的浏览器图片解码在迟到回调中清理，不再提交模型。

## 浏览器要求

支持 ES Module 与 importmap 的现代浏览器：

- Chrome / Edge 94+
- Firefox 108+
- Safari 16.4+

还需要设备支持 WebGL 2。当前自动化回归在 Windows Edge 上执行，其他浏览器和移动设备尚未实测。

## 开发与验证

用户打开仓库中的 `index.html` 即可使用，无需安装或构建。开发源码位于 `src/viewer.html` 和 `src/obj-worker.js`，需要 Node.js 22+：

```sh
npm ci
npm run build
npm test
npm run check:build
```

默认使用本机 Edge。其他环境可安装 Playwright Chrome 并设置 `BROWSER_CHANNEL=chrome`。测试使用锁定版本的官方 Three.js、JSZip 包响应 CDN 请求，实际运行 WebGL、加载器和 ZIP 解压，不依赖外部 CDN 可用性。

`npm run build` 用 esbuild 把 Worker 及其官方依赖内嵌到根目录 `index.html`，并保留 Three.js 许可文本。请编辑 `src/` 中的源码并提交构建产物；`check:build` 检查产物是否与源码一致。内嵌 Worker 无需独立网络请求，本地 file:// 和静态托管均可使用。

浏览器控制台执行 `web3d.getDiagnostics()` 可读取 GPU 资源计数、绘制帧数、材质分组、纹理参数和相机信息；`workerRunning` 与 `lastParse` 提供 Worker 状态、解析耗时、重建耗时和几何大小。返回的是诊断快照。

测试覆盖多材质、相对路径、UV 参数、纹理共享、失败清理、多模型选择、取消、静止调度、连续加载、截图内容、超限 OBJ、Worker 解析响应性与本地单文件打开。后续研究记录见 [REVIEW.md](REVIEW.md)。

## 开发日志

每次版本变更的原因记录在 [CHANGELOG.md](CHANGELOG.md)。

## License

GPL-3.0，见 [LICENSE](LICENSE)。
