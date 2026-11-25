import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ranked } from "./ranking.js";

export const name = "ability-router";

// skills 用于动态取全量清单 + 长尾按需取回全文；workingDirectory 用于构造 lookup。
// 不 inject agents：本工具只在 agent 执行时被调用，exec.agent 已由宿主传入。
export const inject = ["tools", "skills", "workingDirectory"];

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  maxResults: Schema.number().default(5),
});

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data", "abilities.json");
// 本机私有清单（不提交到 git）：存在则与通用清单合并，让每台机器各自登记自己的软件栈。
const DATA_LOCAL = join(HERE, "..", "data", "abilities.local.json");

const JSON_TEXT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

let abilitiesCache = null;
let abilitiesCacheMtime = 0;
let abilitiesCacheLocalMtime = 0;
async function loadAbilities() {
  const [mtime, localMtime] = await Promise.all([
    stat(DATA).then((s) => s.mtimeMs, () => 0),
    stat(DATA_LOCAL).then((s) => s.mtimeMs, () => 0),
  ]);
  if (abilitiesCache && mtime === abilitiesCacheMtime && localMtime === abilitiesCacheLocalMtime) {
    return abilitiesCache;
  }
  abilitiesCacheMtime = mtime;
  abilitiesCacheLocalMtime = localMtime;
  const raw = await readFile(DATA, "utf8");
  const base = JSON.parse(raw);
  // 私有清单可选：缺文件属正常（开源用户没有自己的清单）。
  if (localMtime !== 0) {
    try {
      const local = JSON.parse(await readFile(DATA_LOCAL, "utf8"));
      return (abilitiesCache = {
        version: base.version,
        skills: [...(base.skills ?? []), ...(local.skills ?? [])],
        tools: [...(base.tools ?? []), ...(local.tools ?? [])],
        exe: [...(base.exe ?? []), ...(local.exe ?? [])],
      });
    } catch {
      // 私有清单坏了就只用通用清单，不阻断路由。
    }
  }
  return (abilitiesCache = base);
}

/** 判断一条 skill summary 是否允许模型调用（= 是否还在目录里）。 */
function isModelInvocable(summary) {
  return summary?.invocation?.modelInvocable === true;
}

/**
 * 检索文本 = 官方 name/description/whenToUse + abilities.json 里的中文增强(title/what/when/keywords)。
 * 官方 description 可能是英文或块标量污染，中文增强补上中文命中面。
 */
function skillSearchText(summary, enhanced) {
  const base = [summary.name, summary.description ?? "", summary.whenToUse ?? ""].join(" ");
  if (enhanced) {
    return [
      base,
      enhanced.title ?? "",
      enhanced.what ?? "",
      enhanced.when ?? "",
      (enhanced.keywords ?? "").split(/\s+/).join(" "),
    ].join(" ");
  }
  return base;
}

function pick(entry) {
  return {
    name: entry.name,
    title: entry.title ?? "",
    what: entry.what ?? "",
    when: entry.when ?? "",
    risk: entry.risk ?? "none",
    ...(entry.command !== undefined ? { command: entry.command } : {}),
  };
}

export function apply(ctx, config) {
  if (!config.enabled) return;

  const maxResults = config.maxResults ?? 5;

  ctx.tools.register(defineTool({
    name: "ability_find",
    description:
      "三合一能力路由：给定用户意图，从「技能 skill / DSH 内置工具 tool / 本机可执行程序 exe」三类里找出最匹配的能力并返回结构化清单。当用户说『/ability-router』、问『我该用什么能力/有什么工具/能做什么』、或一个任务拿不准该调用哪个技能或命令时调用。结果分类排序：skill 先（可直接加载），exe 与 tool 并行列出；危险操作（删除/装软件等）带 risk=danger 标记，必须向用户确认后再执行。无匹配时返回 fallback 降级建议。",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "用户意图短语，例如『把这个docx转成pdf』『分析化学实验备考』『找重复文件』",
      },
      maxResults: {
        type: "number",
        description: "每类最多返回条数，默认取插件配置 maxResults",
      },
    },
    output: JSON_TEXT,
    async execute(args, exec) {
      let ab;
      try {
        ab = await loadAbilities();
      } catch (error) {
        return JSON.stringify({
          intent: args.query,
          error: "abilities.json 读取失败，请直接按常识回答，不要中断任务。",
          detail: String(error),
        });
      }

      const limit = args.maxResults ?? maxResults;

      const lookup = {
        cwd: exec.agent === void 0 ? void 0 : await ctx.workingDirectory.ensure(exec.agent, exec.signal),
        signal: exec.signal,
        scope: exec.agent,
      };

      // 动态全量技能清单（invocation-neutral，含撤下目录的长尾技能）。
      let summaries = [];
      try {
        summaries = await ctx.skills.list(lookup);
      } catch (error) {
        summaries = [];
      }

      const enhancedByName = new Map();
      for (const s of ab.skills ?? []) enhancedByName.set(s.name, s);

      const skillPool = summaries.map((s) => ({
        summary: s,
        name: s.name,
        text: skillSearchText(s, enhancedByName.get(s.name)),
      }));

      const toolPool = (ab.tools ?? []).map((t) => ({
        entry: t,
        type: "tool",
        name: t.name,
        text: [t.name, t.title, t.what, t.when, t.keywords].filter(Boolean).join(" "),
      }));

      const exePool = (ab.exe ?? []).map((e) => ({
        entry: e,
        type: "exe",
        name: e.name,
        text: [e.name, e.title, e.what, e.when, e.keywords].filter(Boolean).join(" "),
      }));

      const q = String(args.query ?? "");

      const skillHits = ranked(q, skillPool, (i) => i.name, (i) => i.text, limit);
      const toolHits = ranked(q, toolPool, (i) => i.name, (i) => i.text, limit);
      const exeHits = ranked(q, exePool, (i) => i.name, (i) => i.text, limit);

      const skills = [];
      for (const hit of skillHits) {
        const enhanced = enhancedByName.get(hit.summary.name);
        if (isModelInvocable(hit.summary)) {
          // 还在目录里：给名字，让模型走官方 skill 工具加载（省 token）。
          skills.push({
            name: hit.summary.name,
            type: "skill",
            load: "skill-tool",
            title: enhanced?.title ?? hit.summary.name,
            what: enhanced?.what ?? hit.summary.description ?? "",
            risk: "none",
          });
        } else {
          // 撤下目录的长尾技能：绕过 skill 工具限制，直接取全文返回。
          try {
            const full = await ctx.skills.get(hit.summary.name, lookup);
            if (full) {
              skills.push({
                name: full.name,
                type: "skill",
                load: "inline",
                title: enhanced?.title ?? full.name,
                content: full.content ?? "",
                risk: "none",
              });
            }
          } catch (_) {
            // 取全文失败就降级为只给名字。
            skills.push({
              name: hit.summary.name,
              type: "skill",
              load: "skill-tool",
              title: enhanced?.title ?? hit.summary.name,
              risk: "none",
            });
          }
        }
      }

      const tools = toolHits.map((hit) => ({ type: "tool", ...pick(hit.entry) }));
      const exes = exeHits.map((hit) => ({ type: "exe", ...pick(hit.entry) }));

      const fallback =
        skills.length === 0 && tools.length === 0 && exes.length === 0
          ? "没有匹配到已登记的能力。请直接按常识回答，或说明本机/本会话目前不具备该能力，并给出可替代的通用做法。"
          : "";

      return JSON.stringify({
        intent: q,
        skills,
        tools,
        exe: exes,
        fallback,
        note: "skill 类：load=skill-tool 表示调 skill 工具加载全文；load=inline 表示全文已内联返回。exe/tool 类 risk=danger 的必须先向用户确认再执行。",
      });
    },
  }));
}
