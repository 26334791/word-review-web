# 单词日课便携版

Windows x64 / Linux x64 分别提供预构建网页版ZIP。包含程序、Node.js 24.22.1运行环境和16个分册版本、3733个词条，含2024新版小学四上、四下、五上、六上及八上。目标机无需安装Node.js、npm或Python，也无需编译。

按系统选择文件名含windows-x64或linux-x64的包。Windows包适用于Windows 10/Server 2016及更新的x64系统。Linux包面向x86_64、内核4.18+、glibc 2.28+及libstdc++ 6.0.25+的发行版（如Ubuntu 20.04+、Debian 10+、RHEL 8+），不适用于CentOS 7、Alpine/musl、ARM或WSL1；这些是[Node官方平台条件](https://github.com/nodejs/node/blob/v24.22.1/BUILDING.md#platform-list)。浏览器和英语TTS使用目标机已有能力。

## 启动

先完整解压ZIP，进入word-review-web文件夹。

- Windows：先在本机终端运行 `start-windows.cmd --init-admin`，交互创建管理员，无默认密码；以后双击 `start-windows.cmd`。
- Linux：先运行 `sh ./start-linux.sh --init-admin`，以后运行 `sh ./start-linux.sh`。脚本会为随包的 Node 设置执行权限，不调用系统 Node。

服务默认监听 `0.0.0.0:5173`，未创建管理员时拒绝监听。就绪后自动打开默认浏览器，控制台打印本机和局域网地址。其他设备访问 `http://主机局域网IP:5173/`，在管理员创建账号后登录，首次登录必须修改初始密码。保持启动窗口运行，Ctrl+C 停止。不要直接打开 dist/index.html。

HTTP 无传输加密，仅用于可信局域网，不用于公网。按需向可信局域网放行主机防火墙 5173/TCP。每人导入选择、暂停状态、评分、FSRS 和设置独立，同账号可跨设备接续。

只启动服务、跳过浏览器（适合Linux无桌面环境）：

```powershell
# Windows
.\start-windows.cmd --no-browser
```

```sh
# Linux
sh ./start-linux.sh --no-browser
```

端口已占用可加 `--port 5174`。`--host 127.0.0.1` 限制本机访问，`--data-dir 路径` 指定持久化目录，每次启动应使用相同路径。

## 备份、搬迁与升级

ZIP 包含程序、词库和运行环境，不包含用户数据库。账号及档案保存在程序旁的 `data/word-review.sqlite`。升级前停止服务并备份整个 data 目录，覆盖程序文件时保留此目录；勿让不同版本同时写入。SQLite 可能存在 WAL/SHM 文件，运行中不要仅复制主数据库。

搬迁主机时，停止服务后将整个 data 目录复制到新主机程序目录，账号和进度都会保留。数据库备份包含敏感账号资料，应限制访问，且不进入 Git 或便携包。个人也可使用原格式 JSON：

1. 原主机：“设置与备份”导出完整JSON备份。
2. 新主机：启动程序，在“设置与备份”选择备份文件并确认恢复。
3. 恢复仅替换当前账号档案；已有记录时先导出目标备份。

旧浏览器档案保留。同网址登录尚无写入的空账号后，可勾选“迁入当前账号”；服务端校验并拒绝覆盖已有账号档案。不同网址或端口使用 JSON 备份迁移。账号模式停用 PWA 离线入口，升级仅注销本应用旧 Service Worker、清理其缓存，保留 IndexedDB。

账号模式需要连接主机，断网或结果不明时保留题目、暂停评分，重连先确认原操作。发音使用当前设备的英语 TTS 或词表 HTTPS 音频；音色在另一设备不存在时自动选择本机英语音色。Windows 可在语言设置安装英语语音，Linux 浏览器/桌面需提供英语音色；启动器不安装语音组件。

## 内容状态

2024新版小学四上131、四下97、五上71、六上89词及八上460词的单元与课内释义已对照。版权页版次年月仍待核验；五下、六下新版尚待补齐，其他候选册保留原核验提示。旧版与新版独立保存。

本包包含局域网账号服务及同步，不包含开放注册、邮箱找回或离线历史合并。详细协议见源码仓库的 docs/lan-accounts.md。

## 运行环境来源

Node.js来自[官方24.22.1 LTS发行版](https://nodejs.org/en/blog/release/v24.22.1)，原始Windows/Linux压缩包均按官方SHA256核验。runtime/SOURCE.json记录下载地址、原始及二进制哈希；runtime/LICENSE保留Node.js及其依赖的许可声明。启动器固定使用runtime内的二进制，不修改系统PATH或安装软件。
