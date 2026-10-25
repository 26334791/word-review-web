# 来源、参考项目与许可范围

核对日期：2026-10-25。此处区分实际使用的依赖、原始数据和设计参考，不将它们统称为自有代码。根目录 LICENSE 中的 0BSD 仅适用于本项目自有代码，不替代以下第三方许可，也不覆盖教材内容、候选词表或第三方代码。

## 实际代码依赖

| 项目                                                                                                                                                    | 锁定版本 | 用途                                                                              | 上游许可                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)                                                                     | 5.4.2    | src/review.ts 的 FSRS 复习调度；看词与听音分别保存卡片状态                        | MIT；Copyright (c) 2026 Open Spaced Repetition    |
| [mholt/PapaParse](https://github.com/mholt/PapaParse)                                                                                                   | 5.7.0    | src/imports.ts 的 CSV/TSV 解析、导出，以及本地词库生成脚本                        | MIT；Copyright (c) 2015 Matthew Holt              |
| [catamphetamine/read-excel-file](https://gitlab.com/catamphetamine/read-excel-file)（[GitHub 镜像](https://github.com/catamphetamine/read-excel-file)） | 9.3.12   | 浏览器 XLSX 导入与 Node 端原始词表读取；以 npm 包声明的 GitLab 地址为规范源码来源 | MIT；Copyright (c) 2018 gitlab.com/catamphetamine |

完整生产依赖树及已安装包内的许可正文见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。该文件由 [prepare-notices.mjs](../scripts/prepare-notices.mjs) 根据 package-lock.json 和 node_modules 生成，并复制到 public/THIRD_PARTY_NOTICES.txt，供构建后的网页版及便携包携带。Node 端读取/构建使用的依赖也包含在清单中，不表示所有依赖均进入浏览器 bundle。

worker-f 0.1.20 是 read-excel-file 的生产依赖，上游 package.json 声明 MIT，但安装包及 canonical v0.1.20 源码均没有独立 LICENSE 或完整版权 notice。已核实版本、commit、author 元数据、缺口以及明确标作参考的 MIT 标准文本见 [worker-f.txt](../scripts/licenses/worker-f.txt)；没有补造版权人或年份。

## 候选原始词表与派生数据

候选原始词表来自 **Ringi（[lilinji](https://github.com/lilinji)）及社区贡献者**维护的 [lilinji/English](https://github.com/lilinji/English)。采用其北师大目录中的 11 个原始 XLSX 分册，覆盖小学三年级起点四至六年级及初中七至九年级。原始路径、Git blob、SHA256 和导入文件哈希保留在 public/data/source.json、raw-sources.json 和 catalog.json 中。

本项目进行了格式转换、完全重复项去除和部分教材内容审校。旧四上课内释义已对照扫描词汇页调整，音标沿用候选词表；其他旧候选册尚未完成单元及课内释义核验。修改内容和范围见 [词库核验记录](textbook-verification.md)。这些数据及派生 CSV/JSON 不适用本项目自有代码的 0BSD 许可。

上游 README 第 23 行标示 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)，第 276–278 行说明非商业个人学习、学术研究用途，并保留原作者、出版社等权利人的权利。核验依据为 [README.md](https://github.com/lilinji/English/blob/main/README.md) 的 Git blob d23c17a1676a8b97215663666eba3507c27a46bd；根目录没有独立 LICENSE 文件。对该上游汇编及其改编数据，应保留上述署名、来源、许可链接和修改说明，遵守其非商业及相同方式共享要求。上游 README 声明不替代原教材、词典等权利人的授权；本项目不将此表述为已取得所有底层资料的再分发授权。

## 教材内容与非 GitHub 来源

| 内容                                | 来源与核对范围                                                                                                                                                                                                                                                                                                                                           | 归属及当前状态                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 旧四上 2013 审定系列                | [扫描课本入口](https://keben.szxuexiao.com/html/9494.html)及 public/data/bnu-grade4-upper-review.json 中记录的词汇页                                                                                                                                                                                                                                     | 按单元核对课内释义；教材相关权利归各自权利人，具体版次年月及再分发授权未核实                        |
| 2024 审核小学四上、四下、五上、六上 | [北京师范大学出版社同步教材资源](https://www.100875.com.cn/)，各分册永久资源链接、词汇页码及星号在 public/data/bnu-primary-2024-reviewed.json；合计 388 条                                                                                                                                                                                               | 对照各册 Word bank 75–77 页。内容核验不等于授权核验，词表不适用 0BSD                                |
| 2024 审核初中八上                   | 出版社[在线教材](https://www.100875.com.cn/show/resourceDetail_eBookAndTeacher.html?resId=bcaea735884649bdad5d81eb2b6f652b&type=SYN&contributeId=dabd044b4c5146b79e544fe2d3e31ce9&tp=Ebook)和[八上 A–Z 词表资源](https://www.100875.com.cn/show/resourceDetail_integral.html?resId=7500dde11a0600392c2EA1FA3657A71E5F11CCC29BDFE23B070&type=SYN)；460 条 | 对照 Vocabulary in Each Unit 166–179 页，保留课内释义；教材及词表权利归各自权利人，再分发授权未核实 |

公开源码快照不包含原始出版社 DOCX 或教材封面、目录、整页词汇扫描图片；保留来源、范围、内容核对记录及原文件哈希用于追溯。个人学习使用的数据包与公开源码许可范围应分别判断。版权页年月和 ISBN 核验缺口见 [小学新版记录](primary-2024-verification.md)及[八上新版记录](grade8-new-edition-verification.md)。

## 设计参考

以下两个仓库在 [PRD 参考资料](PRD.md#参考资料)中明确列为设计参考。本项目现有依赖、词表来源和实现记录中未发现复制其源码或数据的证据；不能将它们列为已导入词库，也不能据设计参考直接推定本项目整体采用其许可证。

| 项目                                                                                | 参考范围                     | 核实的上游许可                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| [LinXueyuanStdio/DictionaryData](https://github.com/LinXueyuanStdio/DictionaryData) | 教材身份、单元关系、词序组织 | [Apache-2.0](https://github.com/LinXueyuanStdio/DictionaryData/blob/master/LICENSE) |
| [zyronon/TypeWords](https://github.com/zyronon/TypeWords)                           | 学习交互及 FSRS 接入方式     | [GPL-3.0](https://github.com/zyronon/TypeWords/blob/master/LICENSE)                 |

## 便携运行环境及开发工具

Windows/Linux 便携包使用 [nodejs/node](https://github.com/nodejs/node) 的官方 Node.js 24.22.1 二进制，版本、官方下载地址和原压缩包 SHA256 锁定在 scripts/node-runtime.json。分发包中的 runtime/LICENSE 保留 Node.js 及其内含第三方许可，runtime/SOURCE.json 记录来源和二进制哈希，不受本项目自有代码的 0BSD 许可覆盖。

Vite、TypeScript、Prettier、类型定义和浏览器验证工具的版本由 package.json/package-lock.json 记录，属于开发工具，不列为本项目设计来源或教材词库来源；其各自许可保留在相应安装包中。
