// Runs in CI (see .github/workflows/update-stats.yml) on a schedule.
// Fetches public GitHub data for GITHUB_USERNAME and renders it into static,
// theme-aware SVG cards under assets/stats/. The published README only ever
// references those committed files, never a live third-party stats service.
import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = process.env.GITHUB_USERNAME || "MrFa1n";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OUT_DIR = new URL("../assets/stats/", import.meta.url);

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

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...restHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function fetchProfile() {
  return restJson(`/users/${USERNAME}`);
}

async function fetchOwnedRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await restJson(`/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchLanguageTotals(repos) {
  const totals = new Map();
  for (const repo of repos.filter((r) => !r.fork)) {
    const langs = await restJson(`/repos/${USERNAME}/${repo.name}/languages`);
    for (const [lang, bytes] of Object.entries(langs)) {
      totals.set(lang, (totals.get(lang) || 0) + bytes);
    }
  }
  return totals;
}

async function fetchContributionCalendar() {
  const data = await graphql(
    `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`,
    { login: USERNAME }
  );
  const calendar = data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap((w) => w.contributionDays);
  return { total: calendar.totalContributions, days };
}

function computeStreaks(days) {
  // days are in chronological order (oldest first) per the GitHub API.
  let longest = 0;
  let running = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const isToday = i === days.length - 1;
    if (day.contributionCount > 0) {
      current += 1;
    } else if (isToday) {
      continue; // today may not have contributions yet; don't break the streak on it
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

function buildStatsCard({ publicRepos, stars, followers }) {
  const rows = [
    ["Public Repos", publicRepos],
    ["Total Stars", stars],
    ["Followers", followers],
  ];
  const body = [
    `<text x="20" y="30" class="title-stats">GitHub Stats</text>`,
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
    `<text x="20" y="30" class="title-langs">Top Languages</text>`,
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
    ["Total Contributions", total],
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
  const [profile, repos] = await Promise.all([fetchProfile(), fetchOwnedRepos()]);
  const publicOwned = repos.filter((r) => !r.private);
  const stars = publicOwned.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const langTotals = await fetchLanguageTotals(publicOwned);
  const { total, days } = await fetchContributionCalendar();
  const { current, longest } = computeStreaks(days);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL("stats.svg", OUT_DIR), buildStatsCard({
    publicRepos: profile.public_repos,
    stars,
    followers: profile.followers,
  }));
  await writeFile(new URL("langs.svg", OUT_DIR), buildLangsCard(langTotals));
  await writeFile(new URL("streak.svg", OUT_DIR), buildStreakCard({ current, longest, total }));

  console.log(`Updated stats for ${USERNAME}: ${publicOwned.length} public repos, ${stars} stars, streak ${current}/${longest}.`);
}

export { computeStreaks, buildStatsCard, buildLangsCard, buildStreakCard, escapeXml };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
