---
icon: simple/claude
---

# Claude Code 入口

**目錄**

- [這個專案是什麼](#這個專案是什麼)
- [開始工作前](#開始工作前)
- [常用指令](#常用指令)
- [工作規則](#工作規則)
- [和使用者溝通](#和使用者溝通)

> [!NOTE]
> 這一頁是 Claude Code 的專案入口。專案根目錄的 `CLAUDE.md` 用 `@docs/tutorials/claude-code.md` 匯入這一頁，所以每次開新對話都會自動讀到。要改入口內容，改這一頁就好。

## 這個專案是什麼

- **內容**：個人技術文檔網站，目前有 Tutorials（網站本身的教學）和 K8S Deep Dive（Kubernetes / 容器學習筆記）兩個分類。
- **工具**：[Zensical](https://zensical.org/)，設定檔是 `zensical.toml`，文章在 `docs/`。
- **發佈**：GitHub repo `megleet/tech-docs`，push 到 `main` 後由 GitHub Actions 發佈到 <https://megleet.github.io/tech-docs/>。

## 開始工作前

1. **先讀排版風格**：寫或改任何文章前，***必須先讀 [網站排版風格](style-guide.md)***（`docs/tutorials/style-guide.md`）。粗體分級、標點、提示框、文章固定結構、顏色和間距都在那裡。
2. **先同步**：使用者有時會直接在 GitHub 網頁上改文章，所以開工前先 `git pull`。
3. **啟動預覽**：在背景執行 `zensical serve`，預覽網址是 <http://localhost:8000/tech-docs/>。

## 常用指令

```bash
cd ~/zensical-docs
./.venv/bin/zensical serve           # 預覽（在背景執行）
./.venv/bin/zensical build --clean   # 建置，確認 "No issues found"
git pull                             # 開工前同步
```

**用無頭 Chrome 檢查 JS 效果**：圖示、shell 上色、青綠色小標題都是 `extra.js` 在瀏覽器裡加的，建好的 HTML 裡看不到。

```bash
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --disable-gpu --user-data-dir=<暫存資料夾> \
  --virtual-time-budget=4000 --dump-dom <網址>                    # 看 JS 執行後的 HTML
"$C" --headless=new --disable-gpu --user-data-dir=<暫存資料夾> \
  --virtual-time-budget=4000 --hide-scrollbars \
  --window-size=1300,1300 --screenshot=<輸出.png> <網址>          # 截圖
```

- 長頁面截圖：把 `--window-size` 的高度設大（例如 9000），再用 `ffmpeg -vf crop=寬:高:x:y` 裁出要看的區塊。
- 帶 `#錨點` 的網址截圖會是空白，不要用。

## 工作規則

- **改完就驗證**：每次修改後都要建置；改了樣式或 JS，就用無頭 Chrome 截圖確認效果，不要只憑推測。
- **新文章的清單**：
    - front matter 加不重複的 `icon`；
    - 開頭加只列 h2 的 `**目錄**`；
    - 加到 `zensical.toml` 的 `nav`；
    - 更新「網站排版風格」裡的圖示表。
- **改了規則或配色**：同步更新「網站排版風格」頁，下一個對話才會照新規則寫。
- **git**：
    - commit 可以在本地做；**push 一定要等使用者說「push」**；
    - push 前先 `git fetch`，遠端有新 commit 時用 `git rebase origin/main` 合併，**不要強制推送**；
    - commit 訊息最後加上 Claude 共同作者那一行。
- **SSH**：`github.com` 用 `~/.ssh/id_ed25519_megleet`（GitHub 帳號 megleet），設定在 `~/.ssh/config`，不要改。

## 和使用者溝通

- **語言**：用**繁體中文**回覆。
- **回饋方式**：使用者常用截圖指出要改的地方，並用「再暗一點點」「再小一點點」這種方式微調顏色和間距。每次只做小幅調整，改完告訴使用者具體數值（例如行高 1.55 → 1.45）。
- **意思不明確時**：先說出自己的理解再動手；如果有兩種解讀，可以兩個都小幅調整，並說明怎麼還原。
- **使用者中途插話**：馬上把新要求一起處理，並在回報裡說明。
- **回報**：說清楚改了哪些檔案、驗證了什麼、哪些沒有實際看過，以及是否已經 commit / push。
