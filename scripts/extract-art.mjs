import fs from "node:fs/promises";
const source = await fs.readFile("docs/mockup/openstudy/app.js", "utf8");
let svg = source.match(
  /function illustration\(\)\s*\{\s*return `([\s\S]*?)`;/,
)?.[1];
if (!svg) throw Error("Approved illustration was not found.");
svg = svg
  .replace(/class=/g, "className=")
  .replace(/stroke-opacity/g, "strokeOpacity")
  .replace(/stroke-width/g, "strokeWidth")
  .replace(/fill-opacity/g, "fillOpacity");
await fs.writeFile(
  "src/shared/ui/RoomArt.tsx",
  `// Local SVG from the approved mockup; no external image dependency.\nexport function RoomArt(){return (${svg});}\n`,
);
