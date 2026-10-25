# 单词日课

面向教材单词听读、回忆和科学复习的本地网页版。支持 Windows / Linux，学习档案保存在浏览器 IndexedDB，无需注册账号。

## 功能

- 导入 XLSX、CSV、TSV 或粘贴词表，预览字段、错误和重复项后入库。
- 听读新词、看词回忆、听音回忆；两种回忆方向分别保存 FSRS 调度状态。
- 根据真实时间和四档反馈安排复习，到期优先，支持每日新词额度和单元筛选。
- 多版本教材独立管理，重复导入保留已有复习进度。
- JSON 备份与恢复、基础 PWA 和离线学习；发音使用系统英语 TTS 或自备音频。

## 快速开始

开发环境需要 Node.js 24+。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173/>。Windows 也可双击 `启动网页版.cmd`，自动构建、启动生产预览并打开浏览器；附加 `--no-browser` 跳过打开浏览器。

```sh
npm run build
npm run preview
```

浏览器、主机、网址和端口各自保存独立学习档案。请固定使用同一地址，迁移前在“设置与备份”导出完整 JSON，到新设备恢复。恢复会替换目标浏览器的现有档案。

## 教材词库

当前目录包含北师大版小学三年级起点四至六年级及初中七至九年级，共 **16 个分册版本、3733 个词条**。

| 分册                 | 词条数 | 内容核验状态           |
| -------------------- | -----: | ---------------------- |
| 2024 审核新版四上    |    131 | 单元及课内释义已对照   |
| 2024 审核新版四下    |     97 | 单元及课内释义已对照   |
| 2024 审核新版五上    |     71 | 单元及课内释义已对照   |
| 2024 审核新版六上    |     89 | 单元及课内释义已对照   |
| 2024 审核新版八上    |    460 | 六单元主词表已对照     |
| 2013 审定旧四上      |     97 | 六单元及课内释义已对照 |
| 其他 10 个旧候选分册 |   2788 | 单元及课内释义待核验   |

审核年份不等于出版版次。各册版权页年月仍待核验，五下、六下新版尚待补齐。内容核验和再分发授权是独立事项，教材和词典资料不适用本项目自有代码的许可证。

原始路径、Git blob、SHA256 和核验状态见 [catalog.json](public/data/catalog.json)、[raw-sources.json](public/data/raw-sources.json)及[来源与许可说明](docs/ATTRIBUTION.md)。公开仓库保留追溯记录；教材扫描原图和出版社原始 DOCX 仅在本地审校使用，不上传。

```sh
# 从保存的 XLSX 和审校 JSON 重建 CSV 与目录，不联网
node scripts/prepare-catalog.mjs
```

## Windows / Linux 免安装包

在 Windows 构建机执行：

```sh
npm run package
```

首次打包下载已锁定的官方 Node.js 并验证 SHA256，之后复用缓存。产物位于 `releases/`，不进入 Git：

- `word-review-web-0.1.0-windows-x64.zip`：解压后双击 `start-windows.cmd`。
- `word-review-web-0.1.0-linux-x64.zip`：解压后执行 `sh ./start-linux.sh`。

两者内置 Node.js，无需安装环境，支持 `--no-browser`、`--port 5174`，只监听本机 `127.0.0.1`。包内附第三方许可和运行环境来源。系统条件、发音和数据迁移见[便携版说明](docs/portable.md)。

Windows 包已通过解压、排除系统 Node 后启动和离线学习验证。Linux 服务在 WSL1 下通过系统动态加载器验证，标准启动流程尚待符合官方系统条件的 Linux 主机验收。

## 开发与检查

```sh
npm run format:check
npm run build
npm test
```

`npm run format` 使用 Prettier 统一格式。构建前自动生成依赖许可声明，再进行类型检查和生产构建。GitHub Actions 在 Windows 和 Linux 上执行格式、构建和领域/静态服务检查。

浏览器验证另需 Playwright 和 Chromium。可使用已有安装并设置 `PLAYWRIGHT_MODULE_DIR`（node_modules 目录）及 `PLAYWRIGHT_EXECUTABLE`，也可另行安装 Playwright 和浏览器。

- 保持开发服务器运行时执行 `npm run test:ui`。
- 保持生产预览运行时执行 `npm run test:pwa`，检查离线壳、全部词库导入和复习闭环。
- `TEST_BASE_URL` 指定测试地址，默认 `http://127.0.0.1:5173`。

浏览器测试使用独立档案，不修改日常学习记录；截图和报告写入被 Git 忽略的 `artifacts/`。

## 参考项目与来源

| 仓库                                                                                | 本项目的实际使用方式                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 实际依赖：FSRS 复习调度                                                                              |
| [mholt/PapaParse](https://github.com/mholt/PapaParse)                               | 实际依赖：CSV/TSV 导入与导出                                                                         |
| [catamphetamine/read-excel-file](https://github.com/catamphetamine/read-excel-file) | 实际依赖：XLSX 读取；规范源码为 [GitLab 同名项目](https://gitlab.com/catamphetamine/read-excel-file) |
| [lilinji/English](https://github.com/lilinji/English)                               | 候选词表来源，署名 Ringi（lilinji）及社区贡献者；本项目进行了转换、去重及部分审校                    |
| [LinXueyuanStdio/DictionaryData](https://github.com/LinXueyuanStdio/DictionaryData) | 设计参考：教材身份、单元关系和词序组织；未作为已导入词库或代码依赖                                   |
| [zyronon/TypeWords](https://github.com/zyronon/TypeWords)                           | 设计参考：学习交互及 FSRS 接入方式；未作为代码依赖                                                   |
| [nodejs/node](https://github.com/nodejs/node)                                       | 便携包使用的官方 Node.js 运行环境                                                                    |

自有代码采用宽松的 [0BSD](LICENSE)。候选词表遵循上游声明的 **CC BY-NC-SA 4.0** 及底层资料权利，第三方代码保留其 MIT、ISC 等许可；这些资料不因本项目代码采用 0BSD 而变更许可。完整用途、修改范围和未核实授权状态见 [ATTRIBUTION](docs/ATTRIBUTION.md)，依赖许可全文见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。

## 项目结构

```text
src/                 导入、调度、语音、IndexedDB 和网页界面
public/data/         词表、目录与来源元数据
scripts/             词库重建、许可生成、本地服务和便携打包
tests/               领域、浏览器、离线和静态服务检查
docs/                PRD、教材核验和来源许可说明
```

[PRD](docs/PRD.md) · [旧版词库核验](docs/textbook-verification.md) · [小学新版核验](docs/primary-2024-verification.md) · [八上新版核验](docs/grade8-new-edition-verification.md)
