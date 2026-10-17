// Mark bold text that acts as a label, e.g. "**原因**：..." or "✅ **包含了**：...",
// so it can be styled differently from inline emphasis. A label must start its
// block (only whitespace or emoji before it) and be directly followed by "：" or ":".
document$.subscribe(() => {
  // Move the page icon (rendered hidden by overrides/main.html) in front of the h1.
  const icon = document.querySelector(".md-content .doc-page-icon");
  const h1 = document.querySelector(".md-content .md-typeset h1");
  if (icon && h1 && !h1.querySelector(".doc-page-icon")) {
    icon.hidden = false;
    h1.prepend(icon);
  }

  // On the home page, give each link to a site page that page's nav icon.
  if (document.querySelector(".md-content [data-link-icons]")) {
    const iconByPath = new Map();
    document.querySelectorAll(".md-nav--primary a.md-nav__link[href]").forEach((a) => {
      const svg = a.querySelector(":scope > svg");
      if (svg) iconByPath.set(new URL(a.href).pathname, svg);
    });
    document.querySelectorAll(".md-content .md-typeset a[href]").forEach((a) => {
      const path = new URL(a.href).pathname;
      if (path === location.pathname) return; // skip ¶ permalinks and other same-page links
      const svg = iconByPath.get(path);
      if (!svg || a.querySelector(".doc-link-icon")) return;
      const icon = document.createElement("span");
      icon.className = "doc-link-icon";
      icon.append(svg.cloneNode(true));
      a.prepend(icon);
    });
  }

  // Show the code block language (from its "language-xxx" class) as a small label,
  // unless the block already has a title bar.
  document.querySelectorAll('.md-typeset div.highlight[class*="language-"]').forEach((block) => {
    const lang = [...block.classList].find((c) => c.startsWith("language-"));
    if (lang && lang !== "language-text" && !block.querySelector(".filename")) {
      block.dataset.lang = lang.slice(9);
    }
  });

  // Shell blocks: Pygments leaves commands as plain text, so color them here.
  // On each line the first word is the command (blue), the rest are arguments
  // (green), stopping at a comment.
  const shellLangs = new Set(["bash", "sh", "shell", "zsh", "console"]);
  document.querySelectorAll(".md-typeset div.highlight[data-lang]").forEach((block) => {
    if (!shellLangs.has(block.dataset.lang) || block.dataset.shColored) return;
    block.dataset.shColored = "true";
    block.querySelectorAll('code > span[id^="__span"]').forEach((line) => {
      let first = true;
      for (const node of [...line.childNodes]) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === "A") continue; // line anchor
          if (/^c/.test(node.className)) break; // comment
        }
        const text = node.textContent;
        if (!text.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of text.split(/(\s+)/)) {
          if (!part) continue;
          if (!part.trim()) {
            frag.append(part);
            continue;
          }
          const span = document.createElement("span");
          span.className = first ? "doc-sh-cmd" : "doc-sh-arg";
          span.textContent = part;
          frag.append(span);
          first = false;
        }
        node.replaceWith(frag);
      }
    });
  });

  const onlyEmojiOrSpace = /^[\s\p{Extended_Pictographic}️]*$/u;
  document.querySelectorAll(".md-typeset strong").forEach((el) => {
    const next = el.nextSibling;
    if (!next || next.nodeType !== Node.TEXT_NODE || !/^\s*[：:]/.test(next.textContent)) return;
    let before = "";
    for (let n = el.previousSibling; n; n = n.previousSibling) before = n.textContent + before;
    if (onlyEmojiOrSpace.test(before)) el.classList.add("doc-label");
  });
});
