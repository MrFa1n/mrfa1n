// One-off local generator: produces static, self-hosted badge SVGs so the
// published README never calls out to img.shields.io at view time.
// Run with: npm run badges
import { mkdir, writeFile } from "node:fs/promises";
import { makeBadge } from "badge-maker";
import * as simpleIcons from "simple-icons";

const OUT_DIR = new URL("../assets/badges/", import.meta.url);

function iconDataUri(icon, logoColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 24 24" fill="${logoColor}"><path d="${icon.path}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// Big "for-the-badge" pills for the Technical Toolkit / Connect sections.
const brandBadges = [
  { file: "javascript", message: "JavaScript", icon: simpleIcons.siJavascript, logoColor: "black" },
  { file: "react", message: "React", icon: simpleIcons.siReact, color: "20232A", logoColor: "61DAFB" },
  { file: "html5", message: "HTML5", icon: simpleIcons.siHtml5, logoColor: "white" },
  { file: "css3", message: "CSS3", icon: simpleIcons.siCss3, logoColor: "white" },
  { file: "nodejs", message: "Node.js", icon: simpleIcons.siNodedotjs, logoColor: "white" },
  { file: "python", message: "Python", icon: simpleIcons.siPython, logoColor: "white" },
  { file: "django", message: "Django", icon: simpleIcons.siDjango, logoColor: "white" },
  { file: "php", message: "PHP", icon: simpleIcons.siPhp, logoColor: "white" },
  { file: "github", message: "GitHub", icon: simpleIcons.siGithub, color: "181717", logoColor: "white" },
];

// Small flat-square tags for the Featured Projects table. Branded ones reuse
// the same simple-icons logo; conceptual tags get a neutral chip.
const projectBadges = [
  { file: "tag-python", message: "Python", icon: simpleIcons.siPython, logoColor: "white", style: "flat-square" },
  { file: "tag-javascript", message: "JavaScript", icon: simpleIcons.siJavascript, logoColor: "black", style: "flat-square" },
  { file: "tag-css3", message: "CSS3", icon: simpleIcons.siCss3, logoColor: "white", style: "flat-square" },
  { file: "tag-cli", message: "CLI", color: "30363D", style: "flat-square" },
  { file: "tag-data-parsing", message: "Data Parsing", color: "30363D", style: "flat-square" },
  { file: "tag-realtime", message: "Realtime", color: "30363D", style: "flat-square" },
  { file: "tag-ui-ux", message: "UI/UX", color: "30363D", style: "flat-square" },
  { file: "tag-design-tokens", message: "Design Tokens", color: "30363D", style: "flat-square" },
];

async function build(spec) {
  const color = spec.color ?? spec.icon?.hex;
  const logoBase64 = spec.icon ? iconDataUri(spec.icon, spec.logoColor ?? "white") : undefined;
  const svg = makeBadge({
    label: "",
    message: spec.message,
    color,
    style: spec.style ?? "for-the-badge",
    ...(logoBase64 ? { logoBase64 } : {}),
  });
  await writeFile(new URL(`${spec.file}.svg`, OUT_DIR), svg);
  console.log(`wrote assets/badges/${spec.file}.svg`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const spec of [...brandBadges, ...projectBadges]) {
  await build(spec);
}
