# 局域网多用户与进度同步

版本 0.2.0，2026-10-25。保留原有 State schema 1、词库和 FSRS 领域函数。

## 部署与账号

一台 Windows/Linux 主机提供服务，默认监听 `0.0.0.0:5173`，控制台输出局域网地址。首次必须在本机终端运行 `node scripts/serve.mjs --init-admin`，交互设置账号和密码，无默认密码。初始化不监听端口；未初始化时普通启动拒绝监听。

管理员在“我的账号”创建账号、停用/启用和重置密码，可创建其他管理员，禁止停用最后一个启用的管理员。新账号及被重置密码的账号首次登录须改密。没有查看他人学习详情的管理接口或看板。

密码使用随机独立盐和 scrypt，数据库不保存明文。Cookie 为 HttpOnly、SameSite=Strict，固定有效七天；服务端仅存会话令牌 SHA256。退出、密码修改/重置、停用会话失效。写请求验证 Origin 和 JSON 类型，无跨域访问；每来源 IP 十五分钟最多十次连续登录尝试，成功后清零。账号身份由会话确定，浏览器账号标识仅用于防止另一标签页切换账号后误提交。

仅使用可信局域网 HTTP，密码与 Cookie 无传输加密；不支持公网部署、开放注册、邮箱找回、离线评分或离线历史合并。

## 持久化与升级

默认 `data/word-review.sqlite` 保存用户、会话、每用户 JSON 档案和去重操作记录，使用 SQLite WAL。`--data-dir 路径` 指定其他目录。数据库和整个 data 目录不进入 Git 或便携包。

升级前停止服务并备份整个 data 目录，覆盖程序时保留此目录。搬迁主机也复制该目录。运行中不要仅复制 SQLite 主文件，WAL 可能尚有数据；勿让两个版本同时写同一目录。个人仍可导出原格式 JSON 备份，恢复仅替换当前账号，需明确确认。

## API 与保存协议

所有 API 响应 `Cache-Control: no-store`，不提供其他账号档案的读取/写入参数。

| 方法与路径                       | 用途                                         |
| -------------------------------- | -------------------------------------------- |
| POST /api/login、/api/logout     | 登录、退出                                   |
| GET /api/me                      | 当前账号和首次改密状态                       |
| POST /api/password               | 校验当前密码后改密，所有旧会话失效           |
| GET /api/admin/users             | 仅管理员，返回账号基本信息                   |
| POST /api/admin/users            | 仅管理员，创建账号                           |
| POST /api/admin/users/:id        | 仅管理员，停用、启用或重置密码               |
| GET /api/state                   | 当前账号 State 和 serverNow                  |
| POST /api/commands               | operationId、expectedRevision、type、payload |
| GET /api/operations/:operationId | 当前账号操作是否 committed，返回最新档案     |
| GET /api/catalog/:id             | 校验目录 SHA256 后返回 CSV，兼容 LAN HTTP    |

指令包括 import、rate、undo、settings、pause、restore、migrate。服务端复用领域函数、按服务器时间计算 FSRS；同一事务保存档案、递增 revision、记录操作。相同请求重试返回已提交结果，不重复计分；同一 operationId 不允许换内容。不同设备携带旧 revision 时返回 409 和最新档案，刷新当前练习，不自动重放到另一题。

浏览器使用服务器时间偏移显示学习日和到期安排。登录、返回页面、可见页面每十五秒检查档案。提交响应带最新档案，只有确认保存成功才推进。超时或网络故障保留题目及原操作，将操作按账号保存在当前标签页 sessionStorage；停止后续评分。重连先查询原操作，已提交就采用服务器结果，未知则重试完全相同的操作，仍受版本保护。关闭整个标签页会失去临时操作草稿，已提交档案始终以服务器为准。

切换账号停止语音、清空练习、导入及恢复草稿；同浏览器标签页若切换账号，旧账号的请求会被拒绝。

## 旧版本迁移与浏览器兼容

用 getRandomValues 生成 UUID，不依赖 LAN HTTP 上不可用的 randomUUID/subtle。教材校验移到服务器。另一设备缺少所选音色时沿用自动选择本机英语音色。

停用 PWA 离线入口；升级注销本应用 `/sw.js`，仅清理 `word-review-shell-` 前缀缓存，保留旧 IndexedDB。旧 worker 控制的页面先重新加载，再访问账号 API，避免读到已缓存的账号数据。

同网址登录后若检测到旧档案且账号尚无写入，明确显示“迁入当前账号”及账号名称，用户勾选确认后校验并上传。服务端再次检查空账号和版本，拒绝覆盖已有档案；成功后保留原浏览器档案。不同网址或端口使用原 JSON 备份迁移。

## 验证

`npm test` 覆盖原有领域与词库回归，以及账号隔离、首次改密、会话失效/到期、管理员约束、Origin、请求去重、并发评分、服务器时间、迁移及异常备份拒绝。

`npm run test:lan` 自建临时账号及服务，通过真实局域网 IP 运行独立浏览器会话，检查全部教材、听读评分、两账号、双设备冲突、响应丢失恢复、断网、迁移、备份及移动布局。可设 TEST_LAN_HOST 指定网卡。`npm run test:upgrade` 在 localhost 安全上下文验证旧 SW 清理及 IndexedDB 保留。

运行产物在忽略的 artifacts/；不使用日常浏览器的学习数据。便携包同时包含 dist、server-dist、启动器、Node 和许可，不需要目标机安装 npm 依赖。
