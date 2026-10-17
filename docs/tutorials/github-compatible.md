---
icon: simple/github
---

# GitHub相容寫法

這份文檔的Markdown會在兩個地方被閱讀：Zensical生成的網站，以及GitHub上直接打開的`.md`檔案。
下面這些寫法在兩邊都能正常顯示，優先使用。

## 提示框

> [!NOTE]
> 一般說明。

> [!TIP]
> 小技巧。

> [!WARNING]
> 需要注意的地方。

在網站上會顯示成提示框，在GitHub上會顯示成GitHub的alert。
`!!! note`寫法只有網站會顯示成提示框，在GitHub上只是純文字。

## 流程圖

```mermaid
graph LR
  A[寫Markdown] --> B[push到GitHub]
  B --> C[Actions自動建置]
  C --> D[GitHub Pages網站]
```

## 程式碼、表格、任務清單

```python
print("兩邊都能高亮")
```

| 寫法 | 網站 | GitHub |
| --- | --- | --- |
| `> [!NOTE]` | 提示框 | alert |
| `!!! note` | 提示框 | 純文字 |
| `=== "分頁"` | 分頁 | 純文字 |
| ` ```mermaid ` | 圖 | 圖 |

- [x] 任務清單
- [ ] 兩邊都支援

## 只有網站支援的功能

內容分頁（`=== "Tab"`）、程式碼註解（`# (1)!`）、圖示（`:lucide-rocket:`）、
`==標記==`等寫法，在GitHub上會顯示成原始文字。用的時候要接受這一點，
或者只在不太需要在GitHub上閱讀的頁面使用。
