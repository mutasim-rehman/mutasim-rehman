import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "mutasim-rehman";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const output = process.env.OUTPUT_PATH || "assets/contribution-spectrum.svg";
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "contribution-spectrum",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const today = new Date();
today.setUTCHours(23, 59, 59, 999);
const start = new Date(today);
start.setUTCDate(start.getUTCDate() - 370);

async function github(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function paged(url, maxPages = 20) {
  const items = [];
  let next = url;
  for (let page = 0; next && page < maxPages; page += 1) {
    const response = await github(next);
    items.push(...(await response.json()));
    const link = response.headers.get("link") || "";
    next = link.match(/<([^>]+)>; rel="next"/)?.[1] || "";
  }
  return items;
}

const publicRepos = await paged(`https://api.github.com/users/${username}/repos?type=owner&per_page=100`);
let privateRepos = [];
let privateAccess = false;

if (token) {
  try {
    const viewer = await (await github("https://api.github.com/user")).json();
    if (viewer.login?.toLowerCase() === username.toLowerCase()) {
      privateRepos = (await paged("https://api.github.com/user/repos?visibility=private&affiliation=owner&per_page=100"))
        .filter((repo) => repo.owner?.login?.toLowerCase() === username.toLowerCase());
      privateAccess = true;
    }
  } catch (error) {
    console.warn(`Private repository access unavailable: ${error.message}`);
  }
}

const repos = [...publicRepos, ...privateRepos].filter((repo, index, all) =>
  all.findIndex((candidate) => candidate.full_name === repo.full_name) === index,
);
const counts = new Map();

async function collect(repo) {
  const url = new URL(`https://api.github.com/repos/${repo.full_name}/commits`);
  url.searchParams.set("author", username);
  url.searchParams.set("since", start.toISOString());
  url.searchParams.set("until", today.toISOString());
  url.searchParams.set("per_page", "100");
  try {
    const commits = await paged(url.toString(), 30);
    for (const commit of commits) {
      const iso = commit.commit?.author?.date || commit.commit?.committer?.date;
      if (!iso) continue;
      const day = iso.slice(0, 10);
      const entry = counts.get(day) || { public: 0, private: 0 };
      entry[repo.private ? "private" : "public"] += 1;
      counts.set(day, entry);
    }
  } catch (error) {
    console.warn(`Skipped ${repo.full_name}: ${error.message}`);
  }
}

for (let i = 0; i < repos.length; i += 5) {
  await Promise.all(repos.slice(i, i + 5).map(collect));
}

const graphStart = new Date(today);
graphStart.setUTCHours(0, 0, 0, 0);
graphStart.setUTCDate(graphStart.getUTCDate() - graphStart.getUTCDay() - (52 * 7));
const visibleDays = [];
for (let cursor = new Date(graphStart); cursor <= today; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const key = cursor.toISOString().slice(0, 10);
  visibleDays.push({ date: key, ...(counts.get(key) || { public: 0, private: 0 }) });
}
const publicTotal = visibleDays.reduce((sum, day) => sum + day.public, 0);
const privateTotal = visibleDays.reduce((sum, day) => sum + day.private, 0);
const publicMax = Math.max(1, ...visibleDays.map((day) => day.public));
const privateMax = Math.max(1, ...visibleDays.map((day) => day.private));
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const alpha = (count, max) => count ? (0.35 + 0.65 * Math.sqrt(count / max)).toFixed(2) : 0;
const x0 = 62;
const y0 = 78;
const step = 15;
const size = 11;
let cells = "";
let labels = "";
let lastMonth = "";

visibleDays.forEach((day, index) => {
  const date = new Date(`${day.date}T00:00:00Z`);
  const week = Math.floor((date - graphStart) / 604800000);
  const weekday = date.getUTCDay();
  const x = x0 + week * step;
  const y = y0 + weekday * step;
  const month = date.toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (date.getUTCDate() <= 7 && month !== lastMonth) {
    labels += `<text x="${x}" y="64" class="axis">${month}</text>`;
    lastMonth = month;
  }
  const title = `${day.date}: ${day.public} public commit${day.public === 1 ? "" : "s"}, ${day.private} private/work commit${day.private === 1 ? "" : "s"}`;
  cells += `<g><title>${esc(title)}</title><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="#17202B"/>`;
  if (day.public && day.private) {
    cells += `<path d="M${x},${y}h${size}L${x},${y + size}Z" fill="#22C55E" opacity="${alpha(day.public, publicMax)}"/>`;
    cells += `<path d="M${x + size},${y}v${size}H${x}Z" fill="#38BDF8" opacity="${alpha(day.private, privateMax)}"/>`;
  } else if (day.public) {
    cells += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="#22C55E" opacity="${alpha(day.public, publicMax)}"/>`;
  } else if (day.private) {
    cells += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="#38BDF8" opacity="${alpha(day.private, privateMax)}"/>`;
  }
  cells += "</g>";
});

const privateStatus = privateAccess ? `${privateTotal} private/work commits` : "private/work: add PROFILE_TOKEN";
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="900" height="225" viewBox="0 0 900 225" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${esc(username)} commit spectrum</title>
  <desc id="desc">Daily commit calendar. Green represents public repositories; blue represents private or work repositories.</desc>
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="900" y2="225"><stop stop-color="#07140D"/><stop offset=".5" stop-color="#0D1117"/><stop offset="1" stop-color="#07182A"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>.title{font:700 18px 'Segoe UI',Arial,sans-serif;fill:#E6EDF3}.meta{font:500 11px 'Segoe UI',Arial,sans-serif;fill:#8B949E}.axis{font:500 10px 'Segoe UI',Arial,sans-serif;fill:#7D8590}.legend{font:600 11px 'Segoe UI',Arial,sans-serif}</style>
  </defs>
  <rect x="1" y="1" width="898" height="223" rx="18" fill="url(#panel)" stroke="#30363D"/>
  <circle cx="37" cy="31" r="5" fill="#22C55E" filter="url(#glow)"/><circle cx="53" cy="31" r="5" fill="#38BDF8" filter="url(#glow)"/>
  <text x="69" y="37" class="title">COMMIT SPECTRUM</text>
  <text x="838" y="34" text-anchor="end" class="meta">${publicTotal} public commits · ${esc(privateStatus)}</text>
  ${labels}
  <text x="30" y="100" class="axis">Mon</text><text x="30" y="130" class="axis">Wed</text><text x="30" y="160" class="axis">Fri</text>
  ${cells}
  <g transform="translate(62 202)"><rect width="10" height="10" rx="2" fill="#22C55E"/><text x="17" y="9" class="legend" fill="#7EE787">PUBLIC / OPEN SOURCE</text><rect x="170" width="10" height="10" rx="2" fill="#38BDF8"/><text x="187" y="9" class="legend" fill="#79C0FF">PRIVATE / WORK</text><rect x="318" width="10" height="10" rx="2" fill="#17202B"/><text x="335" y="9" class="legend" fill="#7D8590">NO COMMITS</text><text x="775" y="9" text-anchor="end" class="meta">daily · default branches</text></g>
</svg>`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, svg, "utf8");
console.log(`Wrote ${output} from ${repos.length} repositories (${publicTotal} public, ${privateTotal} private/work commits).`);
