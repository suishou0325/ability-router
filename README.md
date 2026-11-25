# dsh-ability-router

Native DeepSeek Harness（dsh）插件：**三合一能力路由器**。

把「技能 skill / DSH 内置工具 tool / 本机可执行程序 exe」三类能力做成一张轻量清单，
常驻只留精选，长尾按需取回。注册一个工具 `ability_find`。

## 它解决什么

dsh 默认把全部技能的名字+描述塞进每次请求。我机器上 56 条进目录，13213 字符 ≈ 4404 tokens —— 这是每轮的固定开销。本插件改为：

- **精选常驻 17 条**（3682 字符 ≈ 1227 tokens，**省 72%** 目录开销）；
- **39 条长尾**从目录撤下，但 `ability_find` 命中时能绕过 skill 工具限制、直接取全文内联返回 —— 能力没丢，只是不常驻；
- 仍常驻但不常用的，`ability_find` 只给名字，让模型走官方 `skill` 工具加载（不重复占 token）；
- 工具与本机 exe 一并登记，一个 query 同时给三类答案，分类不混排。

## 目录结构

```
ability-router/
├── package.json        插件声明（peer deps + dsh.bundle.patch）
├── cordis.patch.yml    服务端插件注入行（id + name）
├── lib/
│   ├── index.js        插件主体：注册 ability_find 工具
│   └── ranking.js      打分函数（照抄 dsh-ops/lib/discovery/ranking.js，中文 regex 增强）
├── data/
│   ├── abilities.json             三合一能力清单（示例：tools 21 / exe 17，提交）
│   ├── abilities.local.json       你的机器私有清单（不提交）
│   ├── curated.json               你的精选/长尾名单（不提交）
│   └── *.example.json             上面两个的模板
├── scripts/
│   ├── park-skills.mjs      把长尾技能加 disable-model-invocation: true（撤目录）
│   ├── unpark-skills.mjs    回退：删掉该键，恢复常驻（--except 可保留对话型技能）
│   └── prepublish-check.mjs 开源前隐私自检（零依赖）
├── install-ability-router.cmd    一键安装（Windows）
├── uninstall-ability-router.cmd  一键卸载
├── LICENSE              MIT
└── README.md
```

## 安装

**推荐：双击 `install-ability-router.cmd`**（Windows 一键安装，日志写 %TEMP%）。

或手动执行：

1. 完全退出 DeepSeek Harness 桌面端（命令行装 desktop profile 必须先退干净）。
2. 把本仓库放到一个**纯 ASCII 路径**下（例如 `D:/ability-router`），避免中文路径编码问题。
3. 命令行执行：

```
dsh plugin --profile desktop add link:<你的仓库路径>
```

4. 重启桌面端。工具 `ability_find` 即注册成功。

> 改 `data/abilities.json` 热加载生效（按文件 mtime 检测，无需重启，无需重装）。

## 用法

用户说 `/ability-router`（或问「我该用什么能力 / 有什么工具 / 能做什么」、或一个任务拿不准
该调哪个技能/命令）时，模型调用 `ability_find(query)`，返回结构化 JSON：

```json
{
  "intent": "把这个 docx 转成 pdf",
  "skills": [ { "name": "local-toolbox", "type": "skill", "load": "skill-tool", ... } ],
  "tools":  [ { "type": "tool", "name": "office", ... } ],
  "exe":    [ { "type": "exe",  "name": "lo2pdf.cmd", "command": "lo2pdf.cmd {input}", ... } ],
  "fallback": "",
  "note": "..."
}
```

- `skill.load=skill-tool`：技能还在目录里，让模型走官方 `skill` 工具加载（省 token）。
- `skill.load=inline`：长尾技能全文已内联返回，直接用。
- `risk=danger`（目前仅 `ops_remove`、`winget`）：**必须先向用户确认再执行**。

## 加新能力

手改 `data/abilities.json`，加一条到对应数组即可。字段：

```json
{
  "name": "英文短名（skill 必须等于 frontmatter name）",
  "title": "中文名",
  "what": "一句话：做什么",
  "when": "什么时候用",
  "keywords": "空格分隔的检索词（中文词可整段写）",
  "risk": "none | danger",
  "command": "exe 专用，{input}{output} 占位；GUI 软件写 'GUI: 打开 X 手动操作'"
}
```

下次调用 `ability_find` 即生效（热加载：读清单时按 mtime 检测文件变化）。

## 配置文件：哪些进 git，哪些不进

插件读三个数据文件，其中两个是**你这台机器私有的**，已在 `.gitignore` 里：

| 文件 | 是否提交 | 内容 |
|------|---------|------|
| `data/abilities.json` | ✅ 提交 | 通用能力清单示例（常见 CLI + DSH 内置工具） |
| `data/abilities.local.json` | ❌ 不提交 | **你的**软件栈、私有路径、个人常用 GUI 软件 |
| `data/curated.json` | ❌ 不提交 | **你的**技能精选/长尾名单（park 脚本用它） |

首次使用：

```
cp data/abilities.example.local.json data/abilities.local.json
cp data/curated.example.json data/curated.json
# 然后按你机器实际情况编辑这两个文件
```

运行时把 `abilities.json` 和 `abilities.local.json` 合并（通用在前，私有在后），改任一个都按
mtime 热加载生效。

> 为什么这么分：这两个文件本质是「这台机器装了什么、怎么用」的画像。随包发布会让每个
> clone 的人看到你的软件栈，所以默认不进 git —— 你的机器配置是你自己的事。

## 开源前自检

如果你要 fork 这个仓库、或改完后想推公开仓库，先跑：

```
node scripts/prepublish-check.mjs
```

零依赖，扫绝对用户路径、邮箱、密钥前缀、手机号、内网地址、agent 会话遗留文件、
.gitignore 覆盖度、私有配置是否被误提交。**退出码 0 = 干净，1 = 有阻塞项。**

## 稳定性与回退

- 照抄官方 dsh-ops 打分函数与 dsh-tool-skill 工具骨架，不自行发明机制。
- `abilities.json` 读失败 → 返回 error 提示，让模型直接按常识答，**不中断任务**。
- 撤目录只改 `SKILL.md` frontmatter，不删文件；回退脚本一键还原全部常驻技能（撤下的 39 条全部恢复）。
- 更新 dsh 后若行为异常：先卸载插件（`dsh plugin remove`），再看是否仍复现；插件改动可见、可回退。

## 回退

```
node scripts/unpark-skills.mjs
dsh plugin --profile desktop remove dsh-ability-router
```
