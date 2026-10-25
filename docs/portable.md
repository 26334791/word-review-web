# 单词日课便携版

Windows x64 / Linux x64 分别提供预构建网页版ZIP。包含程序、Node.js 24.22.1运行环境和16个分册版本、3733个词条，含2024新版小学四上、四下、五上、六上及八上。目标机无需安装Node.js、npm或Python，也无需编译。

按系统选择文件名含windows-x64或linux-x64的包。Windows包适用于Windows 10/Server 2016及更新的x64系统。Linux包面向x86_64、内核4.18+、glibc 2.28+及libstdc++ 6.0.25+的发行版（如Ubuntu 20.04+、Debian 10+、RHEL 8+），不适用于CentOS 7、Alpine/musl、ARM或WSL1；这些是[Node官方平台条件](https://github.com/nodejs/node/blob/v24.22.1/BUILDING.md#platform-list)。浏览器和英语TTS使用目标机已有能力。

## 启动

先完整解压ZIP，进入word-review-web文件夹。

- Windows：双击 `start-windows.cmd`。
- Linux：打开终端，运行 `sh ./start-linux.sh`。脚本会为随包的Node二进制设置执行权限，不调用系统Node。

服务就绪后自动打开默认浏览器。默认地址为 http://127.0.0.1:5173/ ，服务只监听本机。保持启动窗口运行，Ctrl+C停止。不要直接双击dist/index.html。

只启动服务、跳过浏览器（适合Linux无桌面环境）：

```powershell
# Windows
.\start-windows.cmd --no-browser
```

```sh
# Linux
sh ./start-linux.sh --no-browser
```

端口已占用时可加 `--port 5174`。每个浏览器、主机和端口都有独立学习档案；日常尽量保持127.0.0.1:5173，不与localhost或其他端口混用。

## 搬迁学习记录

ZIP包含程序和词库，学习记录保存在浏览器中，不随程序目录复制。

1. 原主机：“设置与备份”导出完整JSON备份。
2. 新主机：启动程序，在“设置与备份”选择备份文件并确认恢复。
3. 恢复会替换目标浏览器现有学习档案；已有记录时先导出目标备份。

发音使用目标机的英语TTS音色。Windows可在系统语言设置安装英语语音；Linux的浏览器/桌面环境须提供可用英语音色。程序和词库可离线使用，发音能否离线取决于本地音色；启动器不安装语音组件。

## 内容状态

2024新版小学四上131、四下97、五上71、六上89词及八上460词的单元与课内释义已对照。版权页版次年月仍待核验；五下、六下新版尚待补齐，其他候选册保留原核验提示。旧版与新版独立保存。

本包用于个人、本机学习，不包含账号服务或跨设备同步。

## 运行环境来源

Node.js来自[官方24.22.1 LTS发行版](https://nodejs.org/en/blog/release/v24.22.1)，原始Windows/Linux压缩包均按官方SHA256核验。runtime/SOURCE.json记录下载地址、原始及二进制哈希；runtime/LICENSE保留Node.js及其依赖的许可声明。启动器固定使用runtime内的二进制，不修改系统PATH或安装软件。
