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

  const onlyEmojiOrSpace = /^[\s\p{Extended_Pictographic}️]*$/u;
  document.querySelectorAll(".md-typeset strong").forEach((el) => {
    const next = el.nextSibling;
    if (!next || next.nodeType !== Node.TEXT_NODE || !/^\s*[：:]/.test(next.textContent)) return;
    let before = "";
    for (let n = el.previousSibling; n; n = n.previousSibling) before = n.textContent + before;
    if (onlyEmojiOrSpace.test(before)) el.classList.add("doc-label");
  });

  // Bold text that fills an entire table cell, e.g. "| **基底層** |", acts as a row title.
  document.querySelectorAll(".md-typeset td > strong").forEach((el) => {
    if (el.parentElement.textContent.trim() === el.textContent.trim()) {
      el.classList.add("doc-cell-title");
    }
  });
});
