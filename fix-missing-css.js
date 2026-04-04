const fs = require("fs");
const cssPath = "ui/src/styles/onestop.css";
let css = fs.readFileSync(cssPath, "utf8");

const missingApikeySvg = `
.onestop-apikey__icon svg,
.onestop-apikey__toggle svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
}
`;

const missingLoadingSvg = `
.onestop-custom-loading svg {
  width: 20px;
  height: 20px;
}
`;

const missingArrowHover = `
.onestop-custom-provider-option__arrow,
.onestop-custom-provider-custom__icon {
  color: var(--muted);
  transition: color 0.2s;
}
.onestop-custom-provider-option:hover .onestop-custom-provider-option__arrow,
.onestop-custom-model-item:hover .onestop-custom-provider-custom__icon {
  color: var(--accent);
}
`;

// Insert after related blocks
css = css.replace(
  /\.onestop-apikey__toggle:hover \{[\s\S]*?\}/,
  (match) => match + "\n" + missingApikeySvg,
);

css = css.replace(
  /\.onestop-custom-loading \.onestop-loading__spinner \{[\s\S]*?\}/,
  (match) => match + "\n" + missingLoadingSvg,
);

// We replace the arrow color directly or just append it to the end
css += "\n/* Restored missing SVG sizing & hover effects */\n" + missingArrowHover;

fs.writeFileSync(cssPath, css);
console.log("CSS patched successfully");
