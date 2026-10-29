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

  // C / C++: Pygments leaves calls, parameters and #define parts uncategorized.
  // Split "#define NAME value" (directive purple, macro blue, numbers teal),
  // mark names followed by "(" as calls, and names in a function definition's
  // parameter list (followed by "," or ")") as parameters.
  const cLangs = new Set(["c", "cpp", "c++", "h", "hpp"]);
  const isBlank = (n) => n && n.nodeType === Node.ELEMENT_NODE ? n.classList.contains("w") : n && !n.textContent.trim();
  const nextToken = (n) => {
    let s = n.nextSibling;
    while (s && isBlank(s)) s = s.nextSibling;
    return s;
  };
  document.querySelectorAll(".md-typeset div.highlight[data-lang]").forEach((block) => {
    if (!cLangs.has(block.dataset.lang) || block.dataset.cColored) return;
    block.dataset.cColored = "true";

    block.querySelectorAll(".cp").forEach((cp) => {
      const m = cp.textContent.match(/^(#\s*define)(\s+)(\w+)(.*)$/s);
      if (!m) return;
      const [, directive, gap, macro, rest] = m;
      const macroSpan = document.createElement("span");
      macroSpan.className = "doc-hl-macro";
      macroSpan.textContent = macro;
      const restFrag = document.createDocumentFragment();
      for (const part of rest.split(/(\b\d+\b)/)) {
        if (!part) continue;
        if (/^\d+$/.test(part)) {
          const num = document.createElement("span");
          num.className = "mi";
          num.textContent = part;
          restFrag.append(num);
        } else {
          restFrag.append(part);
        }
      }
      cp.textContent = directive;
      cp.after(gap, macroSpan, restFrag);
    });

    block.querySelectorAll(".n").forEach((name) => {
      const next = nextToken(name);
      if (next && next.textContent.trimStart().startsWith("(")) name.classList.add("doc-hl-call");
    });

    block.querySelectorAll(".nf").forEach((fn) => {
      let tok = nextToken(fn);
      if (!tok || !tok.textContent.trimStart().startsWith("(")) return;
      let depth = 0;
      for (; tok; tok = tok.nextSibling) {
        for (const ch of tok.textContent) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
        }
        if (tok.classList?.contains("n") && depth === 1) {
          const after = nextToken(tok);
          if (after && /^[,)]/.test(after.textContent.trimStart())) {
            tok.classList.remove("doc-hl-call");
            tok.classList.add("doc-hl-param");
          }
        }
        if (depth <= 0) break;
      }
    });
  });

  // Directory trees (any code block drawn with ├ └ │): gray branches,
  // blue directories (ending in "/"), gray "<-- ..." and "(...)" notes.
  document.querySelectorAll(".md-typeset div.highlight").forEach((block) => {
    if (block.dataset.treeColored || !/[├└│]/.test(block.textContent)) return;
    block.dataset.treeColored = "true";
    const span = (cls, text) => {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = text;
      return el;
    };
    block.querySelectorAll('code > span[id^="__span"]').forEach((line) => {
      const anchor = line.querySelector(":scope > a");
      let text = [...line.childNodes].filter((n) => n !== anchor).map((n) => n.textContent).join("");
      const newline = text.endsWith("\n") ? "\n" : "";
      text = text.replace(/\n$/, "");
      const noteAt = text.search(/\s+(<--|[(（])/);
      const body = noteAt === -1 ? text : text.slice(0, noteAt);
      const note = noteAt === -1 ? "" : text.slice(noteAt);
      line.replaceChildren(...(anchor ? [anchor] : []));
      // Walk the line piece by piece so side-by-side trees color correctly too.
      // A bare "/" is the root directory only at the start or right after a branch;
      // elsewhere (e.g. "mnt / pid") it is just a separator.
      let atNodeStart = true;
      for (const [piece, branch, word] of body.matchAll(/([│├└─]+)|(\S+)|\s+/g)) {
        if (branch) {
          line.append(span("doc-tree-branch", piece));
          atNodeStart = true;
        } else if (word) {
          const isDir = word === "/" ? atNodeStart : word.endsWith("/");
          line.append(span(isDir ? "doc-tree-dir" : "doc-tree-file", piece));
          atNodeStart = false;
        } else {
          line.append(piece);
          if (piece.length >= 2) atNodeStart = true; // a wide gap starts a new column
        }
      }
      if (note) line.append(span("doc-tree-note", note));
      line.append(newline);
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

  // Long code blocks (COLLAPSE_MIN lines or more): show only the first
  // COLLAPSE_SHOW lines, fade out the rest, and add a button to expand / collapse.
  const COLLAPSE_MIN = 20;
  const COLLAPSE_SHOW = 12;
  document.querySelectorAll(".md-typeset div.highlight").forEach((block) => {
    if (block.dataset.collapseReady) return;
    block.dataset.collapseReady = "true";
    const pre = block.querySelector("pre");
    const lines = block.querySelectorAll('code > span[id^="__span"]');
    if (!pre || lines.length < COLLAPSE_MIN) return;
    const cut = lines[COLLAPSE_SHOW];
    const height = cut.getBoundingClientRect().top - pre.getBoundingClientRect().top;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doc-code-toggle";
    const collapse = (on) => {
      block.classList.toggle("doc-code-collapsed", on);
      pre.style.maxHeight = on ? height + "px" : "";
      button.textContent = on ? `展開全部（共${lines.length}行）` : "收起";
    };
    button.addEventListener("click", () => {
      const on = !block.classList.contains("doc-code-collapsed");
      collapse(on);
      if (on) block.scrollIntoView({ block: "nearest" });
    });
    block.after(button);
    collapse(true);
  });

  // Right-side TOC: items with a sub-list get a toggle; all collapsed by default,
  // so only the first level (h2) shows until the reader expands one.
  document.querySelectorAll('.md-nav--secondary [data-md-component="toc"] .md-nav__item').forEach((item) => {
    if (item.dataset.tocReady) return;
    item.dataset.tocReady = "true";
    const sub = item.querySelector(":scope > .md-nav");
    if (!sub || getComputedStyle(sub).display === "none") return;
    item.classList.add("doc-toc-parent", "doc-toc-collapsed");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doc-toc-toggle";
    button.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    button.setAttribute("aria-label", "展開或收起");
    button.addEventListener("click", (e) => {
      e.preventDefault();
      item.classList.toggle("doc-toc-collapsed");
    });
    item.prepend(button);
  });

  // Left nav: the "Tutorials" section is collapsible (collapsed by default,
  // open when the current page is inside it). The choice is remembered.
  // Desktop only: on narrow screens the drawer already drills into sections.
  if (window.matchMedia("(min-width: 76.25em)").matches) {
    document.querySelectorAll(".md-nav--primary .md-nav__item--section").forEach((item) => {
      const label = item.querySelector(":scope > .md-nav__link");
      if (!label || item.dataset.navReady || label.textContent.trim() !== "Tutorials") return;
      item.dataset.navReady = "true";
      const key = "doc-nav-tutorials";
      let saved = null;
      try { saved = localStorage.getItem(key); } catch (e) {}
      const active = item.querySelector(".md-nav__link--active");
      item.classList.add("doc-nav-collapsible");
      if (!active && saved !== "open") item.classList.add("doc-nav-collapsed");
      const arrow = document.createElement("span");
      arrow.className = "doc-nav-arrow";
      arrow.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      label.append(arrow);
      label.addEventListener("click", (e) => {
        e.preventDefault();
        const collapsed = item.classList.toggle("doc-nav-collapsed");
        try { localStorage.setItem(key, collapsed ? "closed" : "open"); } catch (e) {}
      });
    });
  }

  // Highlight lines from an HTML comment right before the code block:
  //   <!-- hl: 2 10 11 | hl2: 14 15 -->
  // hl = yellow (.hll), hl2 = teal (.doc-hl-2). A comment is used instead of
  // ```{.yaml hl_lines="..."} because the editor strips text after the fence language.
  document.querySelectorAll(".md-typeset .highlight").forEach((block) => {
    if (block.dataset.hlReady) return;
    block.dataset.hlReady = "true";
    let node = block.previousSibling;
    while (node && node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node = node.previousSibling;
    if (!node || node.nodeType !== Node.COMMENT_NODE) return;
    const lines = (key) => {
      const m = node.textContent.match(new RegExp("(?:^|\\|)\\s*" + key + ":\\s*([\\d\\s]+)"));
      return new Set(m ? m[1].trim().split(/\s+/).map(Number) : []);
    };
    const hl = lines("hl"), hl2 = lines("hl2");
    if (!hl.size && !hl2.size) return;
    block.querySelectorAll('code > span[id^="__span-"]').forEach((span) => {
      const n = Number(span.id.split("-").pop());
      if (hl.has(n)) span.classList.add("hll");
      if (hl2.has(n)) span.classList.add("doc-hl-2");
    });
  });
});
