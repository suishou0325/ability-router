// 照抄 dsh-ops/lib/discovery/ranking.js 的 ranked() 骨架，不自己发明打分。
// 最小增强（解决中文 query 命中问题）：
//   英文/数字：保留原版整词精确匹配（query 每个词须 == candidate 某个词）。
//     中英边界先插空格再分词，让 "转PDF""docx转pdf" 里的英文词独立成词可命中。
//   中文：query 无空格是整串，candidate 的中文关键词（≥2 字）若与 query 串互为子串
//     → 按匹配中文字符数加权计分（长匹配 > 短匹配，天然把"分析"这种短词噪声压下去）。
//     单字不参与，避免"做/查/看"等虚词误命中。
// 参数：query=用户意图短语; pool=候选数组; name=取名字的函数; text=取检索文本的函数; maximum=最多返回条数。
export function ranked(query, pool, name, text, maximum) {
  if (query.startsWith('select:')) {
    const exact = query.slice(7).trim().toLowerCase();
    return pool.filter((item) => name(item).toLowerCase() === exact).slice(0, maximum);
  }
  const q = query.toLowerCase();
  const asciiTerms = [...new Set(q.match(/[a-z0-9_]+/g) ?? [])];
  const zhRuns = [...new Set(q.match(/[\u4e00-\u9fff]+/g) ?? [])];

  // 中英边界加空格，使粘连词可分（"转PDF" → "转 PDF"）。
  const splitForWords = (s) =>
    s
      .toLowerCase()
      .replace(/([\u4e00-\u9fff])([a-z0-9])/g, '$1 $2')
      .replace(/([a-z0-9])([\u4e00-\u9fff])/g, '$1 $2')
      .split(/[\s_.-]+/u);

  return pool
    .map((item, order) => {
      const words = splitForWords(`${name(item)} ${text(item)}`);

      const enScore = asciiTerms.reduce((sum, term) => sum + Number(words.includes(term)), 0);

      let zhScore = 0;
      if (zhRuns.length > 0) {
        const seen = new Set();
        for (const w of words) {
          const cjk = w.match(/[\u4e00-\u9fff]{2,}/g);
          if (!cjk) continue;
          for (const c of cjk) {
            if (seen.has(c)) continue;
            for (const run of zhRuns) {
              if (run.includes(c)) { seen.add(c); zhScore += c.length; break; }
              if (c.includes(run)) { seen.add(c); zhScore += run.length; break; }
            }
          }
        }
      }

      return { item, order, score: enScore + zhScore };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, maximum)
    .map((row) => row.item);
}
