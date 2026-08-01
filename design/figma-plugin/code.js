/**
 * Frame TV Art — Figma Component Library Plugin
 * Builds two pages:
 *   • Foundations — color swatches, typography, spacing, icon reference
 *   • Components  — all UI components with variants
 *
 * Figma Plugin API v1
 */

figma.showUI(__html__, { width: 320, height: 340, title: "Frame TV Art" });

// ---------------------------------------------------------------------------
// Design tokens (mirrored from design/tokens.json)
// ---------------------------------------------------------------------------
const T = {
  color: {
    bg:          { r: 0.043, g: 0.075, b: 0.169, a: 1 },
    surface:     { r: 0.110, g: 0.145, b: 0.255, a: 1 },
    surface2:    { r: 0.141, g: 0.200, b: 0.329, a: 1 },
    border:      { r: 0.176, g: 0.243, b: 0.361, a: 1 },
    border2:     { r: 0.376, g: 0.498, b: 0.627, a: 1 },
    accent:      { r: 0.122, g: 0.478, b: 0.549, a: 1 },
    accentDark:  { r: 0.082, g: 0.373, b: 0.431, a: 1 },
    accentText:  { r: 0.196, g: 0.690, b: 0.792, a: 1 },
    text:        { r: 0.910, g: 0.929, b: 0.961, a: 1 },
    muted:       { r: 0.545, g: 0.639, b: 0.722, a: 1 },
    success:     { r: 0.239, g: 0.702, b: 0.337, a: 1 },
    error:       { r: 0.973, g: 0.318, b: 0.286, a: 1 },
    warn:        { r: 0.824, g: 0.600, b: 0.133, a: 1 },
  },
  radius: { base: 10, sm: 6, full: 9999 },
  spacing: { 2:2, 3:3, 4:4, 6:6, 8:8, 10:10, 12:12, 14:14, 16:16, 20:20, 24:24, 28:28, 40:40 },
  sizing: {
    switchWidth: 44, switchHeight: 26, switchThumb: 20,
    statusDot: 8, progressBar: 4, sliderThumb: 18,
    iconSm: 13, iconBase: 15, iconTab: 14, iconLogo: 22, iconSend: 18,
    iconUpload: 44, uploadZoneMin: 420, rightPanelWidth: 380,
    maxContentWidth: 1200, bulkThumbW: 58, bulkThumbH: 33, bulkQueueMaxH: 260,
  },
  font: {
    xs: 11, sm: 12, base: 13, md: 14, lg: 16,
    regular: 400, medium: 500, semibold: 600,
    lhTight: 130, lhBase: 150,         // percent — matches tokens.json lineHeight.tight/base
    lsLabel: 0.8, lsLogo: -0.2, lsSend: -0.1, // px — matches tokens.json letterSpacing
  },
};

// ---------------------------------------------------------------------------
// Variable maps — populated by buildVariables(), used by rgb/rgba/bindCornerRadius/bindSpacing
// ---------------------------------------------------------------------------
const colorVarMap = new Map();        // T.color.xxx object → Figma Variable
const radiusVarByValue = new Map();   // radius number value → Figma Variable
const spacingVarByValue = new Map();  // spacing number value → Figma Variable
const textStyleMap = new Map();       // "size/weight" key → Figma TextStyle

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function rgb(c) {
  const paint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a !== undefined ? c.a : 1 };
  const v = colorVarMap.get(c);
  return v ? figma.variables.setBoundVariableForPaint(paint, "color", v) : paint;
}

function rgba(c, a) {
  const paint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: a };
  const v = colorVarMap.get(c);
  return v ? figma.variables.setBoundVariableForPaint(paint, "color", v) : paint;
}

function gradientFill(from, to, angle = 135) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: [
      [cos, -sin, (1 - cos + sin) / 2],
      [sin,  cos, (1 - sin - cos) / 2],
    ],
    gradientStops: [
      { position: 0, color: { r: from.r, g: from.g, b: from.b, a: from.a !== undefined ? from.a : 1 } },
      { position: 1, color: { r: to.r,   g: to.g,   b: to.b,   a: to.a !== undefined ? to.a : 1 } },
    ],
  };
}

function setFills(node, fills) {
  node.fills = Array.isArray(fills) ? fills : [fills];
}

function setStrokes(node, color, weight = 1) {
  node.strokes = [rgb(color)];
  node.strokeWeight = weight;
  node.strokeAlign = "INSIDE";
}

function hstack(gap = 0) {
  const f = figma.createFrame();
  f.layoutMode = "HORIZONTAL";
  bindSpacing(f, "itemSpacing", gap);
  f.counterAxisSizingMode = "AUTO";
  f.primaryAxisSizingMode = "AUTO";
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function vstack(gap = 0) {
  const f = figma.createFrame();
  f.layoutMode = "VERTICAL";
  bindSpacing(f, "itemSpacing", gap);
  f.counterAxisSizingMode = "AUTO";
  f.primaryAxisSizingMode = "AUTO";
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function padFrame(node, top, right, bottom, left) {
  const r = right !== undefined ? right : top;
  const b = bottom !== undefined ? bottom : top;
  const l = left !== undefined ? left : r;
  bindSpacing(node, "paddingTop", top);
  bindSpacing(node, "paddingRight", r);
  bindSpacing(node, "paddingBottom", b);
  bindSpacing(node, "paddingLeft", l);
}

function bindCornerRadius(node, value) {
  node.cornerRadius = value;
  const v = radiusVarByValue.get(value);
  if (v) node.setBoundVariable("cornerRadius", v);
}

function bindSpacing(node, prop, value) {
  node[prop] = value;
  const v = spacingVarByValue.get(value);
  if (v) node.setBoundVariable(prop, v);
}

async function preloadFonts() {
  await Promise.all([
    figma.loadFontAsync({ family: "Inter", style: "Regular" }),
    figma.loadFontAsync({ family: "Inter", style: "Medium" }),
    figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }),
  ]);
}

function styleComponentSet(set, gap = 16, padding = 16) {
  set.layoutMode = "HORIZONTAL";
  set.primaryAxisSizingMode = "AUTO";
  set.counterAxisSizingMode = "AUTO";
  bindSpacing(set, "itemSpacing", gap);
  padFrame(set, padding);
}

async function makeText(content, size, weight, color, opts = {}) {
  const t = figma.createText();
  const style = weight >= 600 ? "Semi Bold" : weight >= 500 ? "Medium" : "Regular";
  const key = size + "/" + weight;
  const ts = textStyleMap.get(key);
  if (ts) {
    t.textStyleId = ts.id;
  } else {
    t.fontName = { family: "Inter", style };
    t.fontSize = size;
  }
  t.characters = content;
  t.textAutoResize = "WIDTH_AND_HEIGHT";
  t.fills = [rgb(color)];
  if (opts.letterSpacing) t.letterSpacing = { value: opts.letterSpacing, unit: "PIXELS" };
  if (opts.textCase) t.textCase = opts.textCase;
  if (opts.lineHeight) t.lineHeight = { value: opts.lineHeight, unit: "PERCENT" };
  return t;
}

async function makeSectionLabel(text) {
  return makeText(text, T.font.xs, T.font.semibold, T.color.muted, { letterSpacing: T.font.lsLabel, textCase: "UPPER" });
}

function rect(w, h, color, radius = 0) {
  const r = figma.createRectangle();
  r.resize(w, h);
  bindCornerRadius(r, radius);
  setFills(r, rgb(color));
  return r;
}

function getOrCreatePage(name) {
  let page = figma.root.children.find((p) => p.name === name);
  if (!page) {
    page = figma.createPage();
    page.name = name;
  }
  return page;
}

function sendLog(text, cls) {
  figma.ui.postMessage({ type: "log", text, cls });
}

// ---------------------------------------------------------------------------
// Foundations page
// ---------------------------------------------------------------------------

async function buildFoundations(page) {
  figma.currentPage = page;
  page.children.forEach((c) => c.remove());

  let cursorX = 0;
  const ROW_GAP = 80;

  // --- Color swatches ---
  sendLog("  Drawing color swatches...");
  const swatchSection = await makeSectionLabel("COLORS");
  swatchSection.x = cursorX;
  swatchSection.y = 0;
  page.appendChild(swatchSection);

  const colorEntries = Object.entries(T.color);
  const SWATCH_W = 80, SWATCH_H = 60, SWATCH_GAP = 12;
  let sx = cursorX;
  let swatchY = 24;
  for (const [name, c] of colorEntries) {
    const swatch = vstack(4);
    const box = rect(SWATCH_W, SWATCH_H, c, T.radius.sm);
    setStrokes(box, T.color.border);
    swatch.appendChild(box);
    const label = await makeText(name, T.font.xs, T.font.regular, T.color.muted);
    swatch.appendChild(label);
    swatch.x = sx;
    swatch.y = swatchY;
    page.appendChild(swatch);
    sx += SWATCH_W + SWATCH_GAP;
    if (sx > cursorX + (SWATCH_W + SWATCH_GAP) * 7) { sx = cursorX; swatchY += SWATCH_H + 40; }
  }

  let currentY = swatchY + SWATCH_H + ROW_GAP;

  // --- Typography ---
  sendLog("  Drawing typography specimens...");
  const typoLabel = await makeSectionLabel("TYPOGRAPHY");
  typoLabel.x = cursorX;
  typoLabel.y = currentY;
  page.appendChild(typoLabel);

  const typoRows = [
    { name: "Logo / lg semibold",    size: T.font.lg,   weight: T.font.semibold, text: "Frame TV Art" },
    { name: "Section label / xs",    size: T.font.xs,   weight: T.font.semibold, text: "UPLOAD ARTWORK" },
    { name: "Card header / base",    size: T.font.base, weight: T.font.semibold, text: "TV Connection" },
    { name: "Body / base regular",   size: T.font.base, weight: T.font.regular,  text: "Upload artwork directly to your Samsung Frame TV." },
    { name: "Field label / sm",      size: T.font.sm,   weight: T.font.medium,   text: "TV IP Address" },
    { name: "Hint / xs muted",       size: T.font.xs,   weight: T.font.regular,  text: "e.g. 192.168.1.100" },
    { name: "Send button / md",      size: T.font.md,   weight: T.font.semibold, text: "Send to TV" },
    { name: "Setting name / base",   size: T.font.base, weight: T.font.medium,   text: "Matte finish" },
    { name: "Setting desc / sm",     size: T.font.sm,   weight: T.font.regular,  text: "Simulates a physical art frame" },
  ];

  let tyY = currentY + 24;
  for (const row of typoRows) {
    const rowFrame = hstack(16);
    rowFrame.counterAxisAlignItems = "CENTER";
    const spec = await makeText(row.name, T.font.xs, T.font.regular, T.color.muted);
    spec.resize(200, spec.height);
    rowFrame.appendChild(spec);
    const specimen = await makeText(row.text, row.size, row.weight, T.color.text);
    rowFrame.appendChild(specimen);
    rowFrame.x = cursorX;
    rowFrame.y = tyY;
    page.appendChild(rowFrame);
    tyY += Math.max(row.size + 12, 28);
  }

  currentY = tyY + ROW_GAP;

  // --- Spacing scale ---
  sendLog("  Drawing spacing scale...");
  const spacingLabel = await makeSectionLabel("SPACING");
  spacingLabel.x = cursorX;
  spacingLabel.y = currentY;
  page.appendChild(spacingLabel);

  let spX = cursorX;
  const spY = currentY + 24;
  for (const [name, val] of Object.entries(T.spacing)) {
    const col = vstack(4);
    const bar = rect(Math.max(val, 4), 24, T.color.accent, 2);
    col.appendChild(bar);
    const lbl = await makeText(name + " (" + val + "px)", T.font.xs, T.font.regular, T.color.muted);
    col.appendChild(lbl);
    col.x = spX;
    col.y = spY;
    page.appendChild(col);
    spX += 56;
  }

  currentY = spY + 60 + ROW_GAP;

  // --- Border radius ---
  sendLog("  Drawing border radius...");
  const radLabel = await makeSectionLabel("BORDER RADIUS");
  radLabel.x = cursorX;
  radLabel.y = currentY;
  page.appendChild(radLabel);

  let rX = cursorX;
  const rY = currentY + 24;
  for (const [name, val] of Object.entries(T.radius)) {
    const col = vstack(4);
    const box = rect(60, 40, T.color.surface2, Math.min(val, 20));
    setStrokes(box, T.color.accent);
    col.appendChild(box);
    const lbl = await makeText(name + " / " + val + "px", T.font.xs, T.font.regular, T.color.muted);
    col.appendChild(lbl);
    col.x = rX;
    col.y = rY;
    page.appendChild(col);
    rX += 90;
  }
}

// ---------------------------------------------------------------------------
// Component builders
// ---------------------------------------------------------------------------

async function buildButton(label, variant, state) {
  const btn = figma.createComponent();
  btn.name = "Variant=" + variant + ", State=" + state;
  btn.layoutMode = "HORIZONTAL";
  btn.counterAxisAlignItems = "CENTER";
  btn.primaryAxisAlignItems = "CENTER";
  btn.counterAxisSizingMode = "AUTO";
  btn.primaryAxisSizingMode = "AUTO";
  padFrame(btn, 10, 16);

  const disabled = state === "Disabled";
  const isIcon = variant === "Icon";

  if (isIcon) {
    padFrame(btn, 8, 8);
  }

  bindCornerRadius(btn, T.radius.sm);

  if (variant === "Primary") {
    setFills(btn, gradientFill(T.color.accent, T.color.accentDark));
    if (state === "Hover") setFills(btn, [Object.assign({}, gradientFill(T.color.accent, T.color.accentDark), { opacity: 0.88 })]);
  } else if (variant === "Secondary") {
    setFills(btn, rgb(T.color.surface2));
    setStrokes(btn, T.color.border2);
  } else if (variant === "Ratio") {
    setFills(btn, rgb(T.color.surface2));
    setStrokes(btn, state === "Active" ? T.color.accent : T.color.border);
  } else if (variant === "Send") {
    bindCornerRadius(btn, T.radius.sm);
    setFills(btn, gradientFill(T.color.accent, T.color.accentDark));
  } else {
    setFills(btn, [rgba(T.color.surface2, 0)]);
  }

  if (disabled) setFills(btn, [rgba(T.color.surface2, 0.5)]);

  const textColor = disabled ? T.color.muted : (variant === "Primary" || variant === "Send") ? T.color.text : T.color.accentText;
  if (!isIcon) {
    const t = await makeText(label, T.font.base, T.font.medium, textColor);
    btn.appendChild(t);
  } else {
    // Placeholder icon rectangle
    const ico = rect(T.sizing.iconBase, T.sizing.iconBase, T.color.muted, 2);
    btn.appendChild(ico);
  }

  return btn;
}

async function buildSwitch(on) {
  const comp = figma.createComponent();
  comp.name = "State=" + (on ? "On" : "Off");
  comp.resize(T.sizing.switchWidth, T.sizing.switchHeight);
  bindCornerRadius(comp, T.radius.full);
  setFills(comp, rgb(on ? T.color.accent : T.color.surface2));
  setStrokes(comp, on ? T.color.accent : T.color.border);

  const thumb = rect(T.sizing.switchThumb, T.sizing.switchThumb, T.color.text, T.radius.full);
  thumb.x = on ? T.sizing.switchWidth - T.sizing.switchThumb - 3 : 3;
  thumb.y = (T.sizing.switchHeight - T.sizing.switchThumb) / 2;
  comp.appendChild(thumb);
  return comp;
}

async function buildStatusChip(status) {
  const colorMap = { Disconnected: T.color.error, Connecting: T.color.warn, Connected: T.color.success };
  const c = colorMap[status];

  const comp = figma.createComponent();
  comp.name = "Status=" + status;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  bindSpacing(comp, "itemSpacing", 6);
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 4, 8);
  bindCornerRadius(comp, T.radius.full);
  setFills(comp, [rgba(c, 0.12)]);
  setStrokes(comp, c);

  const dot = rect(T.sizing.statusDot, T.sizing.statusDot, c, T.radius.full);
  comp.appendChild(dot);

  const label = await makeText(status, T.font.xs, T.font.medium, c);
  comp.appendChild(label);
  return comp;
}

async function buildInput(variant, state) {
  const isMono = variant === "Monospace";
  const isFocus = state === "Focus";

  const comp = figma.createComponent();
  comp.name = "Variant=" + variant + ", State=" + state;
  comp.layoutMode = "VERTICAL";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  bindSpacing(comp, "itemSpacing", 4);
  comp.fills = [];

  const fieldLabel = await makeText("TV IP Address", T.font.sm, T.font.medium, T.color.text);
  comp.appendChild(fieldLabel);

  const inputBox = figma.createFrame();
  inputBox.layoutMode = "HORIZONTAL";
  inputBox.counterAxisAlignItems = "CENTER";
  inputBox.counterAxisSizingMode = "AUTO";
  inputBox.primaryAxisSizingMode = "AUTO";
  inputBox.layoutAlign = "STRETCH";
  padFrame(inputBox, 8, 10);
  bindCornerRadius(inputBox, T.radius.sm);
  setFills(inputBox, rgb(T.color.surface2));
  setStrokes(inputBox, isFocus ? T.color.accent : T.color.border2);

  const placeholder = await makeText(
    isMono ? "192.168.1.100" : "Enter value...",
    T.font.base,
    T.font.regular,
    isMono ? T.color.text : T.color.muted
  );
  placeholder.layoutGrow = 1;
  inputBox.appendChild(placeholder);
  comp.appendChild(inputBox);

  if (isMono) {
    const hint = await makeText("e.g. 192.168.1.100", T.font.xs, T.font.regular, T.color.muted);
    comp.appendChild(hint);
  }

  return comp;
}

async function buildSelect(state) {
  const isFocus = state === "Focus";
  const comp = figma.createComponent();
  comp.name = "State=" + state;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 8, 10);
  bindCornerRadius(comp, T.radius.sm);
  setFills(comp, rgb(T.color.surface2));
  setStrokes(comp, isFocus ? T.color.accent : T.color.border2);

  const label = await makeText("Natural", T.font.base, T.font.regular, T.color.text);
  label.layoutGrow = 1;
  comp.appendChild(label);

  const chevron = rect(8, 5, T.color.muted, 1);
  comp.appendChild(chevron);
  return comp;
}

async function buildProgressBar(percent) {
  const comp = figma.createComponent();
  comp.name = "Progress=" + percent + "%";
  comp.resize(240, T.sizing.progressBar);
  bindCornerRadius(comp, T.radius.full);
  setFills(comp, rgb(T.color.border));

  const fill = figma.createRectangle();
  fill.resize(Math.max(2, 240 * percent / 100), T.sizing.progressBar);
  bindCornerRadius(fill, T.radius.full);
  setFills(fill, gradientFill(T.color.accent, T.color.accentDark));
  fill.x = 0;
  fill.y = 0;
  comp.appendChild(fill);
  return comp;
}

async function buildCard(hasHeader, hasBody) {
  const label = (hasHeader ? "H" : "") + (hasBody ? "B" : "");
  const comp = figma.createComponent();
  comp.name = "Variant=" + (hasHeader && hasBody ? "Full" : hasHeader ? "Header-Only" : "Body-Only");
  comp.layoutMode = "VERTICAL";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  bindSpacing(comp, "itemSpacing", 0);
  bindCornerRadius(comp, T.radius.base);
  setFills(comp, rgb(T.color.surface));
  setStrokes(comp, T.color.border);

  if (hasHeader) {
    const header = figma.createFrame();
    header.layoutMode = "HORIZONTAL";
    header.counterAxisAlignItems = "CENTER";
    header.counterAxisSizingMode = "AUTO";
    header.primaryAxisSizingMode = "AUTO";
    header.layoutAlign = "STRETCH";
    padFrame(header, 12, 16);
    bindSpacing(header, "itemSpacing", 8);
    setFills(header, rgb(T.color.surface2));

    const title = await makeText("TV Connection", T.font.base, T.font.semibold, T.color.text);
    title.layoutGrow = 1;
    header.appendChild(title);

    const badge = figma.createFrame();
    badge.layoutMode = "HORIZONTAL";
    badge.counterAxisAlignItems = "CENTER";
    bindSpacing(badge, "itemSpacing", 5);
    badge.counterAxisSizingMode = "AUTO";
    badge.primaryAxisSizingMode = "AUTO";
    padFrame(badge, 3, 8);
    bindCornerRadius(badge, T.radius.full);
    setFills(badge, [rgba(T.color.success, 0.12)]);
    const dot = rect(T.sizing.statusDot, T.sizing.statusDot, T.color.success, T.radius.full);
    badge.appendChild(dot);
    const bLabel = await makeText("Connected", T.font.xs, T.font.medium, T.color.success);
    badge.appendChild(bLabel);
    header.appendChild(badge);

    comp.appendChild(header);
  }

  if (hasBody) {
    const body = figma.createFrame();
    body.layoutMode = "VERTICAL";
    body.counterAxisSizingMode = "AUTO";
    body.primaryAxisSizingMode = "AUTO";
    body.layoutAlign = "STRETCH";
    padFrame(body, 16, 16);
    bindSpacing(body, "itemSpacing", 12);
    setFills(body, []);

    const bodyText = await makeText(
      "Upload artwork directly to your Samsung Frame TV.\nSupports JPEG and PNG up to 20 MB.",
      T.font.base, T.font.regular, T.color.muted
    );
    body.appendChild(bodyText);
    comp.appendChild(body);
  }

  return comp;
}

async function buildTabBar() {
  const comp = figma.createComponent();
  comp.name = "TabBar/Default";
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  bindSpacing(comp, "itemSpacing", 2);
  padFrame(comp, 4, 4);
  bindCornerRadius(comp, T.radius.sm);
  setFills(comp, rgb(T.color.surface2));

  const tabs = [
    { label: "Upload", active: true },
    { label: "Bulk Upload", active: false },
    { label: "Settings", active: false },
  ];

  for (const tab of tabs) {
    const tabItem = figma.createFrame();
    tabItem.layoutMode = "HORIZONTAL";
    tabItem.counterAxisAlignItems = "CENTER";
    tabItem.counterAxisSizingMode = "AUTO";
    tabItem.primaryAxisSizingMode = "AUTO";
    padFrame(tabItem, 8, 12);
    bindSpacing(tabItem, "itemSpacing", 6);
    tabItem.cornerRadius = T.radius.sm - 2;
    setFills(tabItem, tab.active ? rgb(T.color.surface) : [rgba(T.color.surface2, 0)]);

    const ico = rect(T.sizing.iconTab, T.sizing.iconTab, tab.active ? T.color.accentText : T.color.muted, 2);
    tabItem.appendChild(ico);

    const lbl = await makeText(tab.label, T.font.base, tab.active ? T.font.medium : T.font.regular,
      tab.active ? T.color.text : T.color.muted);
    tabItem.appendChild(lbl);
    comp.appendChild(tabItem);
  }

  return comp;
}

async function buildUploadZone(state) {
  const comp = figma.createComponent();
  comp.name = "State=" + state;
  comp.layoutMode = "VERTICAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.primaryAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 32, 24);
  bindSpacing(comp, "itemSpacing", 12);
  bindCornerRadius(comp, T.radius.base);

  const isDragOver = state === "Drag-over";
  const isHover = state === "Hover";

  setFills(comp, [rgba(T.color.surface2, isDragOver ? 0.6 : 0.3)]);
  setStrokes(comp, isDragOver ? T.color.accent : T.color.border2, isDragOver ? 2 : 1);
  comp.dashPattern = isDragOver ? [] : [6, 4];

  const iconBox = rect(T.sizing.iconUpload, T.sizing.iconUpload, isDragOver ? T.color.accent : T.color.muted, T.radius.sm);
  comp.appendChild(iconBox);

  const title = await makeText(
    isDragOver ? "Drop to upload" : "Upload Artwork",
    T.font.lg, T.font.semibold, isDragOver ? T.color.accentText : T.color.text
  );
  comp.appendChild(title);

  const hint = await makeText(
    "JPEG or PNG · Up to 20 MB",
    T.font.sm, T.font.regular, T.color.muted
  );
  comp.appendChild(hint);

  return comp;
}

async function buildToast(type) {
  const colorMap = { Success: T.color.success, Error: T.color.error };
  const c = colorMap[type];
  const msgMap = { Success: "Artwork sent successfully!", Error: "Upload failed. Please retry." };

  const comp = figma.createComponent();
  comp.name = "Type=" + type;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 10, 14);
  bindSpacing(comp, "itemSpacing", 10);
  bindCornerRadius(comp, T.radius.sm);
  setFills(comp, rgb(T.color.surface));
  setStrokes(comp, c);

  const dot = rect(T.sizing.statusDot, T.sizing.statusDot, c, T.radius.full);
  comp.appendChild(dot);

  const msg = await makeText(msgMap[type], T.font.base, T.font.medium, T.color.text);
  comp.appendChild(msg);

  return comp;
}

async function buildSettingRow(controlType) {
  const comp = figma.createComponent();
  comp.name = "Control=" + controlType;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 10, 16);
  bindSpacing(comp, "itemSpacing", 12);
  setFills(comp, []);

  const labels = vstack(2);
  const name = await makeText("Matte finish", T.font.base, T.font.medium, T.color.text);
  labels.appendChild(name);
  const desc = await makeText("Simulates a physical art frame", T.font.sm, T.font.regular, T.color.muted);
  labels.appendChild(desc);
  labels.layoutGrow = 1;
  comp.appendChild(labels);

  if (controlType === "Switch") {
    const sw = await buildSwitch(true);
    const swInst = sw.createInstance();
    comp.appendChild(swInst);
  } else if (controlType === "Select") {
    const sel = await buildSelect("Default");
    const selInst = sel.createInstance();
    comp.appendChild(selInst);
  } else {
    const btnGrp = hstack(4);
    for (const lbl of ["Portrait", "Landscape"]) {
      const btn = figma.createFrame();
      btn.layoutMode = "HORIZONTAL";
      btn.counterAxisAlignItems = "CENTER";
      btn.counterAxisSizingMode = "AUTO";
      btn.primaryAxisSizingMode = "AUTO";
      padFrame(btn, 6, 10);
      bindCornerRadius(btn, T.radius.sm);
      setFills(btn, rgb(T.color.surface2));
      setStrokes(btn, T.color.border);
      const t = await makeText(lbl, T.font.sm, T.font.medium, T.color.muted);
      btn.appendChild(t);
      btnGrp.appendChild(btn);
    }
    comp.appendChild(btnGrp);
  }

  return comp;
}

async function buildArtworkItem(state) {
  const comp = figma.createComponent();
  comp.name = "State=" + state;
  comp.layoutMode = "VERTICAL";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  bindSpacing(comp, "itemSpacing", 0);
  bindCornerRadius(comp, T.radius.sm);
  comp.clipsContent = true;
  setFills(comp, rgb(T.color.surface2));
  setStrokes(comp, state === "Hover" ? T.color.accent : T.color.border);

  const thumb = figma.createRectangle();
  thumb.resize(120, 68);
  setFills(thumb, [gradientFill(T.color.surface2, T.color.border)]);
  comp.appendChild(thumb);

  if (state === "Hover") {
    const overlay = figma.createRectangle();
    overlay.resize(120, 68);
    setFills(overlay, [rgba(T.color.bg, 0.4)]);
    overlay.x = 0;
    overlay.y = 0;
    comp.appendChild(overlay);
    overlay.layoutPositioning = "ABSOLUTE";

    const sendBtn = figma.createFrame();
    sendBtn.layoutMode = "HORIZONTAL";
    sendBtn.counterAxisAlignItems = "CENTER";
    sendBtn.counterAxisSizingMode = "AUTO";
    sendBtn.primaryAxisSizingMode = "AUTO";
    padFrame(sendBtn, 6, 10);
    bindSpacing(sendBtn, "itemSpacing", 6);
    bindCornerRadius(sendBtn, T.radius.sm);
    setFills(sendBtn, gradientFill(T.color.accent, T.color.accentDark));
    sendBtn.x = 8;
    sendBtn.y = 20;
    const ico = rect(T.sizing.iconSend, T.sizing.iconSend, T.color.text, 2);
    sendBtn.appendChild(ico);
    const btnLabel = await makeText("Send", T.font.sm, T.font.medium, T.color.text);
    sendBtn.appendChild(btnLabel);
    comp.appendChild(sendBtn);
    sendBtn.layoutPositioning = "ABSOLUTE";
  }

  const footer = figma.createFrame();
  footer.layoutMode = "HORIZONTAL";
  footer.counterAxisAlignItems = "CENTER";
  footer.counterAxisSizingMode = "AUTO";
  footer.primaryAxisSizingMode = "AUTO";
  footer.layoutAlign = "STRETCH";
  padFrame(footer, 6, 8);
  setFills(footer, []);

  const name = await makeText("artwork-01.jpg", T.font.xs, T.font.regular, T.color.muted);
  name.layoutGrow = 1;
  footer.appendChild(name);
  comp.appendChild(footer);

  return comp;
}

async function buildBulkQueueItem(state) {
  const colorMap = {
    Pending:   T.color.muted,
    Uploading: T.color.accentText,
    Done:      T.color.success,
    Error:     T.color.error,
  };
  const c = colorMap[state];

  const comp = figma.createComponent();
  comp.name = "State=" + state;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.resize(240, 10);
  padFrame(comp, 8, 12);
  bindSpacing(comp, "itemSpacing", 10);
  bindCornerRadius(comp, T.radius.sm);
  setFills(comp, rgb(T.color.surface));
  setStrokes(comp, T.color.border);

  const thumb = rect(T.sizing.bulkThumbW, T.sizing.bulkThumbH, T.color.surface2, T.radius.sm - 2);
  comp.appendChild(thumb);

  const info = vstack(3);
  info.layoutGrow = 1;
  const filename = await makeText("photo-landscape.jpg", T.font.sm, T.font.medium, T.color.text);
  info.appendChild(filename);

  if (state === "Uploading") {
    const bar = figma.createFrame();
    bar.resize(1, T.sizing.progressBar);
    bar.layoutAlign = "STRETCH";
    bindCornerRadius(bar, T.radius.full);
    setFills(bar, rgb(T.color.border));
    const fill = figma.createRectangle();
    fill.resize(80, T.sizing.progressBar);
    bindCornerRadius(fill, T.radius.full);
    setFills(fill, gradientFill(T.color.accent, T.color.accentDark));
    bar.appendChild(fill);
    info.appendChild(bar);
  } else {
    const statusText = await makeText(state, T.font.xs, T.font.regular, c);
    info.appendChild(statusText);
  }
  comp.appendChild(info);

  const stateDot = rect(T.sizing.statusDot, T.sizing.statusDot, c, T.radius.full);
  comp.appendChild(stateDot);

  return comp;
}

async function buildAlert() {
  const comp = figma.createComponent();
  comp.name = "Alert/Info";
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "MIN";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 12, 14);
  bindSpacing(comp, "itemSpacing", 10);
  bindCornerRadius(comp, T.radius.sm);
  setFills(comp, [rgba(T.color.warn, 0.08)]);
  setStrokes(comp, T.color.warn);

  const dot = rect(T.sizing.statusDot, T.sizing.statusDot, T.color.warn, T.radius.full);
  comp.appendChild(dot);

  const msg = await makeText(
    "Art mode is currently off. Enable it in your TV settings to display uploaded artwork.",
    T.font.sm, T.font.regular, T.color.text
  );
  msg.layoutGrow = 1;
  comp.appendChild(msg);
  return comp;
}

async function buildBadge(variant) {
  const comp = figma.createComponent();
  comp.name = "Variant=" + variant;
  comp.layoutMode = "HORIZONTAL";
  comp.counterAxisAlignItems = "CENTER";
  comp.counterAxisSizingMode = "AUTO";
  comp.primaryAxisSizingMode = "AUTO";
  padFrame(comp, 3, 8);
  bindSpacing(comp, "itemSpacing", 5);
  bindCornerRadius(comp, T.radius.full);

  if (variant === "Header") {
    setFills(comp, [rgba(T.color.accent, 0.15)]);
    const lbl = await makeText("v1.0", T.font.xs, T.font.medium, T.color.accentText);
    comp.appendChild(lbl);
  } else {
    const on = variant === "Art Mode On";
    setFills(comp, [rgba(on ? T.color.success : T.color.muted, 0.12)]);
    const dot = rect(6, 6, on ? T.color.success : T.color.muted, T.radius.full);
    comp.appendChild(dot);
    const lbl = await makeText(variant, T.font.xs, T.font.medium, on ? T.color.success : T.color.muted);
    comp.appendChild(lbl);
  }
  return comp;
}

// ---------------------------------------------------------------------------
// Components page
// ---------------------------------------------------------------------------

async function buildComponents(page) {
  figma.currentPage = page;
  page.children.forEach((c) => c.remove());

  let cursorX = 0;
  let cursorY = 0;
  const SECTION_GAP = 80;
  const ITEM_GAP = 16;

  async function section(title, builder) {
    sendLog("  " + title + "...");
    const label = await makeSectionLabel(title.toUpperCase());
    label.x = cursorX;
    label.y = cursorY;
    page.appendChild(label);

    let itemX = cursorX;
    const itemY = cursorY + 24;
    let maxH = 0;

    const items = await builder();
    for (const item of items) {
      item.x = itemX;
      item.y = itemY;
      page.appendChild(item);
      itemX += item.width + ITEM_GAP;
      maxH = Math.max(maxH, item.height);
    }

    cursorY = itemY + maxH + SECTION_GAP;
    return items;
  }

  // Buttons
  await section("Buttons", async () => {
    const variants = [];
    for (const variant of ["Primary", "Secondary", "Send"]) {
      for (const state of ["Default", "Hover", "Disabled"]) {
        variants.push(await buildButton(variant, variant, state));
      }
    }
    for (const state of ["Default", "Active"]) {
      variants.push(await buildButton("Portrait", "Ratio", state));
    }
    variants.push(await buildButton("", "Icon", "Default"));
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Button";
    styleComponentSet(set);
    return [set];
  });

  // Switches
  await section("Switch", async () => {
    const variants = [await buildSwitch(false), await buildSwitch(true)];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Switch";
    styleComponentSet(set);
    return [set];
  });

  // Status Chips
  await section("Status Chips", async () => {
    const variants = [
      await buildStatusChip("Disconnected"),
      await buildStatusChip("Connecting"),
      await buildStatusChip("Connected"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "StatusChip";
    styleComponentSet(set);
    return [set];
  });

  // Inputs
  await section("Inputs", async () => {
    const variants = [
      await buildInput("Default", "Default"),
      await buildInput("Default", "Focus"),
      await buildInput("Monospace", "Default"),
      await buildInput("Monospace", "Focus"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Input";
    styleComponentSet(set);
    return [set];
  });

  // Select
  await section("Select", async () => {
    const variants = [await buildSelect("Default"), await buildSelect("Focus")];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Select";
    styleComponentSet(set);
    return [set];
  });

  // Progress Bars
  await section("Progress Bars", async () => {
    const variants = [
      await buildProgressBar(0),
      await buildProgressBar(50),
      await buildProgressBar(100),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "ProgressBar";
    styleComponentSet(set);
    return [set];
  });

  // Cards
  await section("Cards", async () => {
    const variants = [
      await buildCard(true, false),
      await buildCard(false, true),
      await buildCard(true, true),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Card";
    styleComponentSet(set);
    return [set];
  });

  // Tab Bar — single component, no variants needed
  await section("Tab Bar", async () => [await buildTabBar()]);

  // Upload Zone
  await section("Upload Zone", async () => {
    const variants = [
      await buildUploadZone("Empty"),
      await buildUploadZone("Hover"),
      await buildUploadZone("Drag-over"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "UploadZone";
    styleComponentSet(set);
    return [set];
  });

  // Toasts
  await section("Toasts", async () => {
    const variants = [await buildToast("Success"), await buildToast("Error")];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Toast";
    styleComponentSet(set);
    return [set];
  });

  // Setting Rows
  await section("Setting Rows", async () => {
    const variants = [
      await buildSettingRow("Switch"),
      await buildSettingRow("Select"),
      await buildSettingRow("ButtonGroup"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "SettingRow";
    styleComponentSet(set);
    return [set];
  });

  // Artwork Items
  await section("Artwork Items", async () => {
    const variants = [await buildArtworkItem("Default"), await buildArtworkItem("Hover")];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "ArtworkItem";
    styleComponentSet(set);
    return [set];
  });

  // Bulk Queue Items
  await section("Bulk Queue Items", async () => {
    const variants = [
      await buildBulkQueueItem("Pending"),
      await buildBulkQueueItem("Uploading"),
      await buildBulkQueueItem("Done"),
      await buildBulkQueueItem("Error"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "BulkQueueItem";
    styleComponentSet(set);
    return [set];
  });

  // Alert — single component
  await section("Alert", async () => [await buildAlert()]);

  // Badges
  await section("Badges", async () => {
    const variants = [
      await buildBadge("Header"),
      await buildBadge("Art Mode Off"),
      await buildBadge("Art Mode On"),
    ];
    variants.forEach(v => page.appendChild(v));
    const set = figma.combineAsVariants(variants, page);
    set.name = "Badge";
    styleComponentSet(set);
    return [set];
  });
}


// ---------------------------------------------------------------------------
// Text Styles
// ---------------------------------------------------------------------------

async function buildTextStyles() {
  // Remove previously created styles to avoid duplicates on re-run
  for (const s of figma.getLocalTextStyles()) {
    if (s.name.startsWith("Frame TV/")) s.remove();
  }
  textStyleMap.clear();

  const sizes = [
    { key: "xs",   size: T.font.xs,   label: "XSmall" },
    { key: "sm",   size: T.font.sm,   label: "Small"  },
    { key: "base", size: T.font.base, label: "Base"   },
    { key: "md",   size: T.font.md,   label: "Medium" },
    { key: "lg",   size: T.font.lg,   label: "Large"  },
  ];
  const weights = [
    { key: "regular",  weight: T.font.regular,  style: "Regular",   label: "Regular"  },
    { key: "medium",   weight: T.font.medium,   style: "Medium",    label: "Medium"   },
    { key: "semibold", weight: T.font.semibold, style: "Semi Bold", label: "Semibold" },
  ];

  for (const sz of sizes) {
    for (const wt of weights) {
      const ts = figma.createTextStyle();
      ts.name = "Frame TV/" + sz.label + "/" + wt.label;
      ts.fontName = { family: "Inter", style: wt.style };
      ts.fontSize = sz.size;
      textStyleMap.set(sz.size + "/" + wt.weight, ts);
    }
  }
}

// ---------------------------------------------------------------------------
// Variables (Plugin API — works on Professional+)
// ---------------------------------------------------------------------------

async function buildVariables() {
  // Delete existing collections we own to avoid duplicates on re-run
  const existing = figma.variables.getLocalVariableCollections();
  const managed = ["Colors", "Spacing", "Border Radius", "Sizing"];
  for (const col of existing) {
    if (managed.includes(col.name)) col.remove();
  }

  function makeCollection(name) {
    const col = figma.variables.createVariableCollection(name);
    col.renameMode(col.modes[0].modeId, "Default");
    return { col, modeId: col.modes[0].modeId };
  }

  function addFloat(col, modeId, name, value) {
    const v = figma.variables.createVariable(name, col, "FLOAT");
    v.setValueForMode(modeId, value);
    return v;
  }

  function addColor(col, modeId, name, c) {
    const v = figma.variables.createVariable(name, col, "COLOR");
    v.setValueForMode(modeId, { r: c.r, g: c.g, b: c.b, a: c.a !== undefined ? c.a : 1 });
    return v;
  }

  // Colors
  const { col: colorCol, modeId: colorMode } = makeCollection("Colors");
  colorVarMap.clear();
  for (const [name, c] of Object.entries(T.color)) {
    colorVarMap.set(c, addColor(colorCol, colorMode, name, c));
  }

  // Spacing
  const { col: spacingCol, modeId: spacingMode } = makeCollection("Spacing");
  spacingVarByValue.clear();
  for (const [name, val] of Object.entries(T.spacing)) {
    spacingVarByValue.set(val, addFloat(spacingCol, spacingMode, "spacing/" + name, val));
  }

  // Border Radius
  const { col: radiiCol, modeId: radiiMode } = makeCollection("Border Radius");
  radiusVarByValue.clear();
  for (const [name, val] of Object.entries(T.radius)) {
    radiusVarByValue.set(val, addFloat(radiiCol, radiiMode, name, val));
  }

  // Sizing
  const { col: sizingCol, modeId: sizingMode } = makeCollection("Sizing");
  for (const [name, val] of Object.entries(T.sizing)) {
    addFloat(sizingCol, sizingMode, name, val);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  if (msg.type === "build") {
    try {
      await preloadFonts();
      sendLog("Creating variables and text styles...");
      await Promise.all([buildVariables(), buildTextStyles()]);
      figma.ui.postMessage({ type: "log", text: "  Variables and text styles complete.", cls: "done" });

      sendLog("Building Foundations page...");
      const foundationsPage = getOrCreatePage("Foundations");
      await buildFoundations(foundationsPage);
      figma.ui.postMessage({ type: "log", text: "  Foundations complete.", cls: "done" });

      sendLog("Building Components page...");
      const componentsPage = getOrCreatePage("Components");
      await buildComponents(componentsPage);
      figma.ui.postMessage({ type: "log", text: "  Components complete.", cls: "done" });

      figma.currentPage = foundationsPage;
      figma.viewport.scrollAndZoomIntoView(foundationsPage.children);

      figma.ui.postMessage({
        type: "done",
        text: "Library built! Variables, Foundations, and Components pages created.",
      });
    } catch (err) {
      figma.ui.postMessage({ type: "error", text: err && err.message ? err.message : String(err) });
    }
  } else if (msg.type === "clear") {
    const names = ["Foundations", "Components"];
    for (const name of names) {
      const page = figma.root.children.find((p) => p.name === name);
      if (page && figma.root.children.length > 1) {
        page.remove();
      }
    }
    figma.ui.postMessage({ type: "cleared" });
  }
};
