// Browser storage keys are prefixed "tasktrail." / "tt-". The app used to be called TaskTrail, so on first load
// any keys saved under the old prefixes ("zotask.", "zt-") are moved across: saved drafts, column choices and
// layout settings carry over. Runs once per browser, when this module is first imported.
const MOVES: [string, string][] = [["zotask.", "tasktrail."], ["zt-", "tt-"]];
if (typeof window !== "undefined") {
  try {
    const ls = window.localStorage;
    if (!ls.getItem("tasktrail.moved")) {
      for (const k of Object.keys(ls)) for (const [a, b] of MOVES) if (k.startsWith(a)) { const n = b + k.slice(a.length); if (ls.getItem(n) === null) ls.setItem(n, ls.getItem(k)!); ls.removeItem(k); }
      ls.setItem("tasktrail.moved", "1");
    }
  } catch { /* storage blocked */ }
  try {
    const ss = window.sessionStorage;
    for (const k of Object.keys(ss)) for (const [a, b] of MOVES) if (k.startsWith(a)) { const n = b + k.slice(a.length); if (ss.getItem(n) === null) ss.setItem(n, ss.getItem(k)!); ss.removeItem(k); }
  } catch { /* storage blocked */ }
}
export {};
