// Runs in CI (see .github/workflows/update-stats.yml) on a schedule.
// Fetches public data for THIS repo only (REPO_OWNER/REPO_NAME) and renders
// it into static, theme-aware SVG cards under assets/stats/. The published
// README only ever references those committed files, never a live
// third-party stats service, and this script never queries any other repo
// or account-wide data — only repo.MrFa1n/mrfa1n itself.
import { mkdir, writeFile } from "node:fs/promises";

const REPO_OWNER = process.env.REPO_OWNER || "MrFa1n";
const REPO_NAME = process.env.REPO_NAME || "mrfa1n";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OUT_DIR = new URL("../assets/stats/", import.meta.url);

// How far back to look for commit activity when computing the streak.
const STREAK_WINDOW_DAYS = 400;
const MAX_COMMIT_PAGES = 10; // caps at 1000 commits, plenty for this repo

const restHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function restJson(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: restHeaders });
  if (!res.ok) throw new Error(`GitHub REST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchRepo() {
  return restJson(`/repos/${REPO_OWNER}/${REPO_NAME}`);
}

async function fetchLanguages() {
  const langs = await restJson(`/repos/${REPO_OWNER}/${REPO_NAME}/languages`);
  return new Map(Object.entries(langs));
}

async function fetchCommitDays() {
  const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 86400000).toISOString();
  const days = new Set();
  let total = 0;
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const batch = await restJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=100&page=${page}&since=${since}`
    );
    for (const commit of batch) {
      const iso = commit.commit?.author?.date || commit.commit?.committer?.date;
      if (iso) days.add(iso.slice(0, 10)); // YYYY-MM-DD (UTC)
    }
    total += batch.length;
    if (batch.length < 100) break;
  }
  return { days, total };
}

function computeDayStreaks(daySet) {
  if (daySet.size === 0) return { current: 0, longest: 0 };
  const sorted = [...daySet].sort();
  let longest = 1;
  let running = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`);
    const curr = new Date(`${sorted[i]}T00:00:00Z`);
    const diffDays = Math.round((curr - prev) / 86400000);
    running = diffDays === 1 ? running + 1 : 1;
    longest = Math.max(longest, running);
  }

  let current = 0;
  const today = new Date();
  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (daySet.has(key)) {
      current += 1;
    } else if (i === 0) {
      continue; // today may have no commit yet; don't break the streak on it
    } else {
      break;
    }
  }
  return { current, longest };
}

const LANG_COLORS = {
  JavaScript: "F7DF1E",
  TypeScript: "3178C6",
  Python: "3776AB",
  HTML: "E34F26",
  CSS: "1572B6",
  PHP: "777BB4",
  Blade: "F7523F",
  Shell: "89E051",
  Dockerfile: "384D54",
};

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function cardShell(id, width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .card-${id} { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
    .bg-${id} { fill: #f6f8fa; stroke: #d0d7de; }
    .title-${id} { fill: #24292f; font-weight: 700; font-size: 15px; }
    .label-${id} { fill: #57606a; font-size: 12px; }
    .value-${id} { fill: #24292f; font-weight: 700; font-size: 20px; }
    .track-${id} { fill: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .bg-${id} { fill: #0d1117; stroke: #30363d; }
      .title-${id} { fill: #e6edf3; }
      .label-${id} { fill: #8b949e; }
      .value-${id} { fill: #e6edf3; }
      .track-${id} { fill: #30363d; }
    }
  </style>
  <rect class="bg-${id}" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" stroke-width="1"/>
  <g class="card-${id}">${body}</g>
</svg>
`;
}

function buildStatsCard({ stars, forks, openIssues }) {
  const rows = [
    ["Stars", stars],
    ["Forks", forks],
    ["Open Issues", openIssues],
  ];
  const body = [
    `<text x="20" y="30" class="title-stats">Repo Stats</text>`,
    ...rows.map(
      ([label, value], i) =>
        `<text x="20" y="${64 + i * 32}" class="label-stats">${escapeXml(label)}</text>` +
        `<text x="280" y="${66 + i * 32}" text-anchor="end" class="value-stats">${escapeXml(value)}</text>`
    ),
  ].join("\n    ");
  return cardShell("stats", 300, 170, body);
}

function buildLangsCard(totals) {
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  const body = [
    `<text x="20" y="30" class="title-langs">Languages</text>`,
    ...entries.map(([lang, bytes], i) => {
      const pct = bytes / total;
      const y = 56 + i * 24;
      const barWidth = Math.max(2, Math.round(pct * 180));
      const color = LANG_COLORS[lang] ? `#${LANG_COLORS[lang]}` : "#8b949e";
      return (
        `<text x="20" y="${y}" class="label-langs">${escapeXml(lang)}</text>` +
        `<rect x="90" y="${y - 10}" width="180" height="8" rx="4" class="track-langs"/>` +
        `<rect x="90" y="${y - 10}" width="${barWidth}" height="8" rx="4" fill="${color}"/>` +
        `<text x="280" y="${y}" text-anchor="end" class="label-langs">${(pct * 100).toFixed(1)}%</text>`
      );
    }),
  ].join("\n    ");
  return cardShell("langs", 300, 70 + entries.length * 24, body);
}

function buildStreakCard({ current, longest, total }) {
  const cols = [
    ["Commits (last 400d)", total],
    ["Current Streak", current],
    ["Longest Streak", longest],
  ];
  const colWidth = 200;
  const body = cols
    .map(
      ([label, value], i) =>
        `<text x="${i * colWidth + colWidth / 2}" y="90" text-anchor="middle" class="value-streak">${escapeXml(value)}</text>` +
        `<text x="${i * colWidth + colWidth / 2}" y="115" text-anchor="middle" class="label-streak">${escapeXml(label)}</text>`
    )
    .join("\n    ");
  return cardShell("streak", colWidth * cols.length, 150, body);
}

async function main() {
  const [repo, langTotals, { days, total }] = await Promise.all([
    fetchRepo(),
    fetchLanguages(),
    fetchCommitDays(),
  ]);
  const { current, longest } = computeDayStreaks(days);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL("stats.svg", OUT_DIR), buildStatsCard({
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
  }));
  await writeFile(new URL("langs.svg", OUT_DIR), buildLangsCard(langTotals));
  await writeFile(new URL("streak.svg", OUT_DIR), buildStreakCard({ current, longest, total }));

  console.log(
    `Updated stats for ${REPO_OWNER}/${REPO_NAME}: ${repo.stargazers_count} stars, ${total} commits (last ${STREAK_WINDOW_DAYS}d), streak ${current}/${longest}.`
  );
}

export { computeDayStreaks, buildStatsCard, buildLangsCard, buildStreakCard, escapeXml };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
