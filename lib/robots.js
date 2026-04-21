export async function fetchRobots(origin, userAgent) {
  try {
    const res = await fetch(new URL('/robots.txt', origin), {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function parseRobots(text, userAgent) {
  if (!text) return { disallow: [], allow: [] };
  const ua = userAgent.toLowerCase();
  const groups = [];
  let current = null;
  let expectingAgent = true;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !expectingAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgent = true;
    } else if (current && (key === 'disallow' || key === 'allow')) {
      current.rules.push({ type: key, value });
      expectingAgent = false;
    }
  }

  let matched = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  if (!matched) matched = groups.find((g) => g.agents.includes('*'));
  if (!matched) return { disallow: [], allow: [] };

  const disallow = [];
  const allow = [];
  for (const rule of matched.rules) {
    if (rule.value === '') continue;
    (rule.type === 'disallow' ? disallow : allow).push(rule.value);
  }
  return { disallow, allow };
}

export function isAllowed(pathname, rules) {
  const a = longestMatch(rules.allow, pathname);
  const d = longestMatch(rules.disallow, pathname);
  if (d === null) return true;
  if (a === null) return false;
  return a.length >= d.length;
}

function longestMatch(patterns, path) {
  let best = null;
  for (const p of patterns) {
    if (compilePattern(p).test(path)) {
      if (best === null || p.length > best.length) best = p;
    }
  }
  return best;
}

function compilePattern(pattern) {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '$' && i === pattern.length - 1) re += '$';
    else if (/[.+?^${}()|[\]\\]/.test(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(re);
}
