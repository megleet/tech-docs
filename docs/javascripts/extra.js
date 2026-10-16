// Mark bold text that acts as a label, e.g. "**原因**：..." or "✅ **包含了**：...",
// so it can be styled differently from inline emphasis. A label must start its
// block (only whitespace or emoji before it) and be directly followed by "：" or ":".
document$.subscribe(() => {
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
