---
icon: lucide/palette
---

# 網站排版風格

**目錄**

- [專案概覽](#專案概覽)
- [寫作規則](#寫作規則)
- [每篇文章的固定結構](#每篇文章的固定結構)
- [實作位置](#實作位置)
- [工作流程](#工作流程)
- [踩過的坑](#踩過的坑)

> [!NOTE]
> 這一頁是給**新對話**快速了解這個網站的脈絡用的。新增或修改文章前，先讀完這一頁，並照這裡的規則寫。專案入口和工作規則見[Claude Code入口](claude-code.md)。

## 專案概覽

- **工具**：[Zensical](https://zensical.org/)（Material for MkDocs團隊的接班專案），設定檔是`zensical.toml`。
- **local路徑**：`~/zensical-docs`，Python虛擬環境在`.venv/`。
- **GitHub**：`megleet/tech-docs`（公開repo），remote用SSH：`git@github.com:megleet/tech-docs.git`。
- **網站**：<https://megleet.github.io/tech-docs/>，push到`main`後由GitHub Actions自動發佈。
- **語言**：介面是繁體中文（`zh-TW`），內文以繁體中文為主，技術名詞保留英文。
- **雙重閱讀**：同一份Markdown會在**網站**和**在GitHub上直接打開`.md`檔**兩個地方被閱讀，寫法要在兩邊都正常顯示。

## 寫作規則

### 粗體分三級

| 寫法 | 用途 | 網站上的效果 |
| --- | --- | --- |
| `**一般強調**` | 一般的強調、名詞 | 黑色粗體 |
| `***非常重要***` | 核心結論、關鍵句，一節最多兩三處 | 灰褐色粗體，直體（不是斜體） |
| `**小標題**：` | 條列或段落開頭的小標題，後面緊接全形冒號 | 青綠色粗體 |

- 小標題前面可以有emoji，例如`✅ **包含了**：`，仍然算小標題。
- 句子中間碰巧接冒號的粗體**不算**小標題，維持黑色。
- 表格裡的粗體一律是黑色粗體，**不另外上色**。

### 中英文之間不留空格

- ***中文和英文、數字之間一律不留空格***：寫`在mount namespace裡`，不要寫`在 mount namespace 裡`。
- 範圍是**全文**：內文、標題、表格、提示框、行內`code`和粗體的交界、程式碼註解、目錄樹的說明文字，以及`zensical.toml`的`nav`導覽列名稱都一樣。英文詞和英文詞之間的空格照常保留。
- 不用「遞迴」這個詞，一律寫**recursive**。

### 技術名詞用英文

技術名詞直接用英文，不翻成中文：

| 不要寫 | 改寫成 |
| --- | --- |
| 部署 | deploy |
| 作業系統 | OS |
| 宿主機 | host |
| 環境變數 | env var |
| 配置 | config |
| （容器的）運行時 | runtime |
| 伺服器 | server |
| 容器 | container |
| 本地 | local |
| 遠端 | remote |
| 編排對象 / 編排object、服務對象 / 服務object | orchestration object、service object |
| memory / library / dependency / package | mem / lib / dep / pkg（程式碼、命令參數、專有名詞不改） |
| 系統呼叫、system call、syscall | sys call（程式碼裡的`syscall()`等識別字不改） |

其他技術名詞比照辦理：有通用英文說法的，就用英文。

標題（h1～h4）如果以英文開頭，***第一個字母大寫***，例如`## Container為什麼能seamless deploy`。程式識別字和命令名稱（`pivot_root`、`unshare()`、`mount`、`umount`）維持原樣，***不要大寫***。

***不要中英文各說一遍***：不寫「中文（English）」或「English（中文）」，只寫英文。例如寫`Copy-on-Write`，不寫`寫時複製（Copy-on-Write）`；寫`mount propagation`，不寫`掛載傳播（propagation）`。括號裡放英文縮寫的全名（例如`OCI（Open Container Initiative）`）、補充說明或舉例，都可以。

### 標點與粗體的位置

- 內文用**全形標點**：`，。：；？！「」（）`。
- 粗體要包在引號或括號**裡面**：寫`「**重點**」`，不要寫`**「重點」**`。
- 原因：Markdown規定`**`一邊是中文字、另一邊是標點或符號（包括全形標點、`` ` ``、`≥`）時，不能當作粗體的開頭或結尾，結果會原樣顯示`**`。
- 因為中英文之間不留空格，粗體的**頭尾都要是文字**：句號、括號、`code`放在粗體外面，例如寫`***重點***。`、`**CPU架構**（ISA）`，不要寫`***重點。***`、`**CPU架構（ISA）**也是`。
- 寫完後建置，到HTML裡確認沒有原樣顯示的`**`。

### 行內程式碼

- 指令、檔案路徑、工具名、sys call、錯誤訊息用`` `code` ``，例如`runc`、`/etc/fstab`、`exec format error`。
- 網站上會顯示成玫紅字、淡粉底的小標籤。

### 程式碼區塊

- 一律標註語言，例如` ```bash `、` ```python `。網站會在左上角顯示語言標籤。
- 沒有語言的純文字內容（例如設定檔的一行）用` ``` `不標語言，就不會顯示標籤。
- bash / sh / zsh區塊：每行**第一個字**是藍色（指令），其他是綠色（參數），`#`註解是灰色。
- 所有語言共用一套One Light風格的語法配色：關鍵字 / 型別 / `#include` `#define`紫色，函式名和巨集名藍色，字串和標頭檔綠色，數字和`NULL`青色，**參數**橙色，註解灰色。C / C++ 的函式呼叫、參數、`#define`拆分由`extra.js`補上（Pygments本身不分類）。
- 程式碼區塊背景是**非常淡的灰色**（`#f6f7f8`），加細邊框和圓角。
- 指令前面**不加`$`**提示符號，否則上色時`$`會被當成指令。指令放`bash`區塊；較長的輸出放另一個不標語言的區塊，短的輸出寫成`# → …`註解。
- 註解太長時拆成多行，和上一行的`#`或`//`對齊，不要寫成一行要左右捲動的長註解。
- **長程式碼自動折疊**：20行以上的程式碼區塊，網站上只顯示前12行，底部淡出，加一個「展開全部（共N行）」按鈕；複製按鈕仍然複製完整內容。行數設定在`extra.js`的`COLLAPSE_MIN` / `COLLAPSE_SHOW`。GitHub上照常完整顯示。
- 同一個例子裡的ID或佔位符要前後一致，例如都寫`{container_id}`，並說明它從哪裡來。
- 目錄樹：用` ``` `不標語言，畫成`├──` `└──` `│`的樹狀。只要區塊裡有這些符號就會自動上色：線條和`<-- 註解`、`(括號說明)`是灰色，**以`/`結尾的目錄**是藍色，檔案是一般文字顏色。所以目錄名稱後面一定要加`/`。

### 提示框

用GitHub的alert寫法，兩邊都能顯示：

```markdown
> [!NOTE]
> **簡答**：……

> [!TIP]
> 💡 **一句話總結**
>
> ……
```

- **`[!NOTE]`**：簡答、判斷方法、補充說明。
- **`[!TIP]`**：每一節最後的總結（「一句話總結」「一句話記憶」）。
- **`[!WARNING]`**：需要特別注意的地方。
- 不要用Material的`!!! note`寫法，GitHub上會顯示成純文字。

### 表格

- 分隔線寫成`| --- | --- |`（兩邊有空格），避免編輯器的Markdown警告。
- 第一欄常作為「列標題」，可以整格加粗。
- 可以用 ✅ / ❌ 表示可以 / 不行。
- 表格裡的程式碼如果含有`|`，不能寫`\|`（反斜線會原樣顯示），要改寫成HTML：`<code>MS_REC &#124; MS_PRIVATE</code>`。

### 圖片

- **依章節分資料夾**：圖片放在文章同層`images/`底下的章節資料夾，例如第1章放`docs/k8s-deep-dive/images/ch01/`、第2章放`images/ch02/`。不要另外建`image/`。
- **VS Code貼圖**：`.vscode/settings.json`把Office擴充（`vscode-office`）的貼圖位置設成`images/{文章名}-{時間}.{副檔名}`，貼上後要把圖搬進對應的`chNN/`，並改文章裡的路徑。
- **命名**：貼上後如果檔名是數字，改成看得出內容的名字，例如`container-layers.png`。
- **沒用到的圖要刪掉**：換圖或刪段落後，檢查`images/`裡有沒有文章不再引用的檔案。
- **大小**：需要調整時用`<img src="…" alt="…" width="…">`；圖片本身的白邊先裁掉，避免和上下文之間空太多。

### 交叉連結

- 提到文章裡其他地方的內容時，***一律用錨點連結***，不要寫「前面說的」「剛才提到」這種沒有指向的說法；被引用的段落刪掉後，這種句子就會變成空引用。
- 文章裡有完整的實作（例如`mini_container.c`）時，其他講到同一步驟的地方都要連過去，例如寫成`對應[實作](#錨點)的步驟5a`。
- 刪掉或改名標題後，建置並檢查所有錨點連結都還有效。
- **概念先出現、解釋在後面時，連到解釋的位置**：例如前面提到Static Pod，就連到後文解釋Static Pod的地方，讓讀者看不懂時可以直接跳過去。網站裡已經有解釋的概念，一律用這種***自我連結***，不要連到外部文件；只有網站裡沒有解釋的，才連到官方文件。
- **外部連結會自動標示**：`extra.css`會把連到其他網站的連結顯示成深藍色、點狀底線，後面加一個小↗；站內連結（網址含`/tech-docs/`或`#錨點`）維持原本的樣式。寫文章時不需要手動加↗。
- **連到段落中間**：要連的地方不是標題時，在那裡加一個`<a id="英文名稱"></a>`當錨點，例如`**④ …Static Pod YAML**：<a id="static-pod"></a>`。

### Emoji

- **適量**，讓頁面不平淡就好。
- 常用位置：h3小標題的開頭（例如`### 🔍 1. 根本原因`）、條列小標題前、總結提示框的標題（💡 🧠）。
- h2大標題**不加**emoji，因為開頭目錄的連結依賴h2的錨點。

## 每篇文章的固定結構

```markdown
---
icon: lucide/container      # 必填，每篇用不同的圖示
toc_depth: 4                # 選填，右側目錄要顯示到h4時才加（預設到h3）
---

# 文章標題

**目錄**

- [第一個大標題](#第一個大標題的錨點)
- [第二個大標題](#第二個大標題的錨點)

## 第一個大標題
……
```

- **`icon`**：每篇文章都要有，而且**盡量不同**。它會同時顯示在左側導覽列和文章h1前面；首頁上連到這篇的連結也會自動帶這個圖示。可用`lucide/…`（線條圖示）或`simple/…`（品牌標誌），圖示檔在`.venv/lib/python3.14/site-packages/zensical/templates/.icons/`。
- **開頭目錄**：只列h2大標題，用`**目錄**`加條列。
- **長標題要拆成主標題＋副標題**：h2只放***精簡的主標題***，完整的長問句放在下一行，寫成`*斜體*`。網站上會顯示成淡灰底、最黑文字顏色的粗體副標題；開頭目錄和右側目錄都只顯示主標題。例如：

    ```markdown
    ## 容器隔離的極限與補強

    *容器靠namespace做隔離，為什麼說這種隔離「不徹底」？業界又是怎麼補強的？*
    ```
- **錨點**：保留中文。規則是轉小寫、去掉標點、空白換成`-`，例如`## mount常用命令總結` → `#mount常用命令總結`。不確定時建置後到HTML裡查`<h2 id="…">`。
- **右側目錄**：全站預設顯示兩層（h2和h3），h3可以折疊：一開始全部收起，只看到h2，點`>`展開、再點收起（不會隨捲動自動展開）。要顯示到h4，在front matter加`toc_depth: 4`。實作在`extra.js`和`extra.css`。
- **導覽列**：新文章要加到`zensical.toml`的`nav`裡對應的分類。
- **h2改名時**：記得同步更新開頭目錄的文字和錨點。

已經使用的圖示：

| 頁面 | 圖示 |
| --- | --- |
| Index | `lucide/house` |
| Get started | `lucide/rocket` |
| Markdown in 5min | `simple/markdown` |
| GitHub相容寫法 | `simple/github` |
| 網站排版風格 | `lucide/palette` |
| Claude Code入口 | `simple/claude` |
| Reference | `lucide/book-open` |
| Chap-1-container基礎 | `lucide/container` |
| Chap-2-Kubernetes architecture | `simple/kubernetes` |
| Chap-3-Kubernetes operations | `lucide/wrench` |
| Chap-4 Container orchestration之Pod篇 | `lucide/ship-wheel` |
| Chap-5 Volume | `lucide/hard-drive` |

## 實作位置

| 檔案 | 負責什麼 |
| --- | --- |
| `zensical.toml` | 網站設定、`nav`、Markdown擴充、`extra_css` / `extra_javascript`、`custom_dir`、中文錨點（`toc.slugify`）、GitHub alert（`github-callouts`） |
| `docs/stylesheets/extra.css` | 所有顏色和間距。顏色都是檔案開頭的CSS變數，淺色 / 深色模式各一組 |
| `docs/javascripts/extra.js` | 把頁面圖示移到h1前、首頁連結加圖示、程式碼語言標籤、shell指令上色、C語法補強（函式呼叫 / 參數 / #define）、目錄樹上色、標記青綠色小標題 、長程式碼折疊 、右側目錄折疊 |
| `overrides/main.html` | 覆寫主題樣板：輸出頁面圖示、首頁標記、`toc_depth`標記 |
| `.github/workflows/docs.yml` | GitHub Actions：安裝`zensical`和`markdown-callouts`，建置並發佈到Pages |

### 目前的顏色（淺色模式）

| 變數 | 用途 | 色碼 |
| --- | --- | --- |
| `--doc-strong-color` | `***非常重要***` | `#74513a`灰褐 |
| `--doc-label-color` | `**小標題**：` | `#3d6b66`灰青綠 |
| `--md-typeset-a-color` | 內文連結 | `#1a4fae`暗藍 |
| `--doc-ext-link-color` | 外部連結（連到其他網站）：再深一點的藍、點狀底線、後面自動加小↗；站內連結維持原樣 | `#0b347a`深藍 |
| `--doc-code-color` / `--doc-code-bg` | 行內`code` | `#c2185b` / `#fbeff4` |
| `--doc-h2-bg` / `--doc-h2-bar` | h2大標題背景 / 左邊細邊 | `#fff8e1` / `#f2b600` |
| `--doc-th-bg` | 表格標題列 | `#f2f3f5` |
| `--doc-sh-cmd` / `--doc-sh-arg` / `--doc-sh-comment` | shell指令 / 參數 / 註解（所有語言的註解） | `#1a4fae` / `#2e7d32` / `#8a8f98` |
| `--doc-hl-keyword` / `--doc-hl-function` / `--doc-hl-string` | 語法：關鍵字 / 函式 / 字串 | `#9333b0` / `#2f5fd0` / `#2e7d32` |
| `--doc-hl-number` / `--doc-hl-param` | 語法：數字和常數 / 參數 | `#0e7c86` / `#b85c00` |
| `--doc-code-block-bg` | 程式碼區塊背景 | `#f6f7f8` |
| `--doc-subtitle-bg` | h2下面的副標題背景（文字用最黑的`--md-default-fg-color`） | `#f3f4f6` |

### 間距

- **內文行高**`1.4`，**程式碼行高**`1.35`。
- **段落間距**`0.7em`，**條列項目間距**`0.2em`。
- **表格格子內距**`0.45em 0.8em`。
- 全形標點用`text-spacing-trim: trim-both`擠壓空白（Chrome支援）。

## 工作流程

```bash
cd ~/zensical-docs
git pull                          # 先同步，避免和GitHub網頁上的修改衝突
source .venv/bin/activate
zensical serve                    # 預覽：http://localhost:8000/tech-docs/
zensical build --clean            # 只建置，檢查有沒有錯誤
git add -A && git commit -m "…"
git push                          # 推上去後GitHub Actions自動發佈
```

- **改完樣式看不到效果**：按**Cmd + Shift + R**強制重新整理。GitHub Pages的CSS快取是10分鐘。
- **檢查JS效果**：JS加的效果（圖示、上色、小標題）在建好的HTML裡看不到，要用瀏覽器或無頭Chrome打開頁面才看得到。

## 踩過的坑

- **`page.is_homepage`在Zensical裡沒有值**：判斷首頁要用`not page.url`。
- **Lucide圖示是線條圖示**（`fill="none"`）：CSS不能對它加`fill`，否則會變成實心色塊。
- **zsh的變數修飾符**：在shell裡寫`$v:a`會被當成路徑修飾符，要寫成`${v}:a`。
- **perl處理中文**：要加`-Mutf8 -CSD`，否則中文比對不到。
- **SSH金鑰**：`~/.ssh/config`裡`github.com`用`~/.ssh/id_ed25519_megleet`，對應GitHub帳號megleet。
- **GitHub網頁上的修改**：push被拒絕時，先`git fetch`看remote改了什麼，再`git rebase origin/main`，**不要強制推送**。
- **`zensical build`偶爾出現`cache directory could not be removed`**：預覽伺服器開著時同時建置可能會撞到，等一下重跑一次就好。
- **巢狀條列要縮排4格**：只縮2格時，Zensical不會把它當成子條列。
- **標題裡的`-`會保留在錨點裡**：`## mount --bind技術`的錨點是`#mount---bind技術`（空白變`-`，加上原本的`--`），不是`#mount-bind技術`。
- **`(c)`會變成©**：`smartsymbols`擴充會把`(c)`轉成版權符號（`(r)`、`(tm)`也一樣）。用`(a)`、`(b)`、`(c)`編號時，要寫成`\(c)`。
