# 单词日课

面向教材单词听读、回忆和科学复习的本地网页版。支持 Windows / Linux，学习档案保存在浏览器 IndexedDB，无需注册账号。

## 功能

- 导入 XLSX、CSV、TSV 或粘贴词表，预览字段、错误和重复项后入库。
- 听读新词、看词回忆、听音回忆；两种回忆方向分别保存 FSRS 调度状态。
- 根据真实时间和四档反馈安排复习，到期优先，支持每日新词额度和单元筛选。
- 多版本教材独立管理，重复导入保留已有复习进度。
- 管理员创建账号，各账号的词库、进度和设置独立；同账号跨设备同步。
- JSON 备份与恢复；发音使用系统英语 TTS 或自备音频，断网暂停评分。

## 快速开始

源码运行需要 Node.js 24+。一台主机提供服务，其他电脑、手机访问同一局域网地址。

```sh
npm ci
npm run build
# 首次在本机终端交互创建管理员，无默认密码
npm start -- --init-admin
npm start
```

控制台显示本机和局域网地址，例如 `http://192.168.1.12:5173/`。默认监听 `0.0.0.0:5173`；未创建管理员时拒绝监听。管理员在“我的账号”创建学习账号，新账号首次登录必须修改密码。

```sh
npm start -- --no-browser
# 限制仅本机访问，或指定端口和持久化目录
npm start -- --host 127.0.0.1 --port 5174 --data-dir ./data
```

HTTP 无传输加密，仅适用于可信局域网，不用于公网。按需仅向可信局域网放行主机防火墙 5173/TCP。

Windows 源码启动器首次运行 `启动网页版.cmd --init-admin`，以后双击启动；自动构建并打开浏览器，`--no-browser` 跳过。`npm run dev` 同样构建后启动完整服务，修改代码后重新构建、重启。

档案保存在主机 `data/word-review.sqlite`。升级前停止服务并备份整个 `data/`，覆盖程序时保留此目录。原浏览器 IndexedDB 保留，同网址登录空账号后可选择“迁入当前账号”；跨网址使用原 JSON 备份。恢复仅替换当前账号，其他账号不受影响。

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

- `word-review-web-0.2.0-windows-x64.zip`：首次运行 `start-windows.cmd --init-admin`，以后双击启动。
- `word-review-web-0.2.0-linux-x64.zip`：首次运行 `sh ./start-linux.sh --init-admin`，以后运行 `sh ./start-linux.sh`。

两者内置 Node.js、独立服务端产物和 SQLite，无需安装 npm 依赖；支持 `--no-browser`、`--port`、`--host`、`--data-dir`。空白包不含账号和数据库，附第三方许可及运行环境来源。系统条件和升级见[便携版说明](docs/portable.md)，同步协议见[局域网多用户说明](docs/lan-accounts.md)。

Windows 与 Linux 包的验收结果随版本记录；WSL1 不符合随包 Node 的官方平台条件，不能用其动态加载器检查代替标准 Linux 启动验收。

## 开发与检查

```sh
npm run format:check
npm run build
npm test
```

`npm run format` 使用 Prettier 统一格式。构建前自动生成依赖许可声明，再检查类型并构建浏览器和服务端。GitHub Actions 在 Windows 和 Linux 上执行格式、构建、领域及账号 API 检查。

浏览器验证另需 Playwright 和 Chromium。可使用已有安装并设置 `PLAYWRIGHT_MODULE_DIR`（node_modules 目录）及 `PLAYWRIGHT_EXECUTABLE`，也可另行安装 Playwright 和浏览器。

- `npm run test:lan` 自动启动临时服务，验证真实 LAN HTTP、两账号和双设备、全部教材、评分、响应丢失、断网、迁移与备份。
- `TEST_LAN_HOST` 可指定本机实际局域网 IPv4；自动选择网卡不合适时设置该值，拒绝用 localhost 代替 LAN 验收。
- `npm run test:upgrade` 验证旧 Service Worker 注销、仅清理本应用缓存、保留旧 IndexedDB。
- `test:ui` 为 LAN 回归入口；`test:pwa` 保留为旧离线壳升级测试别名。

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
src/                 导入、调度、语音、同步、旧档案读取和网页界面
server/              SQLite、账号、会话和命令 API
data/                运行时档案，不进入 Git 或便携包
public/data/         词表、目录与来源元数据
scripts/             词库重建、许可生成、本地服务和便携打包
tests/               领域、账号、LAN 浏览器、旧版升级和静态服务检查
docs/                PRD、教材核验和来源许可说明
```

[PRD](docs/PRD.md) · [旧版词库核验](docs/textbook-verification.md) · [小学新版核验](docs/primary-2024-verification.md) · [八上新版核验](docs/grade8-new-edition-verification.md)
