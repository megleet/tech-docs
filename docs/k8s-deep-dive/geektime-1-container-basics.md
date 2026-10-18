---
icon: lucide/container
---

# GeekTime-1-容器基礎

**目錄**

- [Container如果只做了cgroup資源限制和namespace障眼法是不夠的，還需要什麼才可以seamless部署到遠端？](#container如果只做了cgroup資源限制和namespace障眼法是不夠的還需要什麼才可以seamless部署到遠端)
- [A操作系統的Image，可以deploy到B操作系統運行嗎？](#a操作系統的image可以deploy到b操作系統運行嗎)
- [容器靠namespace做隔離，為什麼說這種隔離「不徹底」？業界又是怎麼補強的？](#容器靠namespace做隔離為什麼說這種隔離不徹底業界又是怎麼補強的)
- [mount常用命令總結](#mount常用命令總結)
- [pivot_root工作原理](#pivot_root工作原理)
- [pivot_root在容器中如何工作](#pivot_root在容器中如何工作)

## Container如果只做了cgroup資源限制和namespace障眼法是不夠的，還需要什麼才可以seamless部署到遠端？

如果Container只是Linux Kernel上的「資源限制（`cgroups`）」與「障眼法（`Namespace`）」，為什麼我們能把在本地開發好的容器，完全無縫地搬到遠端的AWS、GCP或任何一台伺服器上直接執行，且保證「***在我的電腦能跑，在遠端就能跑***」？

答案在於：Container的真正威力，是「***隔離機制***」搭配了「***打包標準與聯合檔案系統（RootFS + Image）***」。

### 1. 關鍵核心：它打包了完整的「根檔案系統（RootFS）」

當我們在傳統Server部署程式時，常常因為本地與遠端的`libc`版本不一致、Python / Java依賴庫版本不同、或是缺少某個特定Dynamic Link Library（`.so`）而導致部署失敗。

但容器鏡像（Container Image）不僅僅是打包你的程式碼，它是直接把作業系統**用戶態（User Space）的所有檔案**完整抓了下來：

- ✅ **包含了**：所有的依賴套件、環境變數、配置檔案、系統C函式庫（如`glibc`）、甚至是`/bin/bash`。
- ❌ **不包含**：Linux Kernel（核心）。

當你把這個Image送到遠端時，遠端宿主機透過**Mount Namespace**和`pivot_root`，把容器的根目錄`/`替換成Image裡載入的RootFS。對容器內的進程來說，它看到的完全是本地開發時那一套**一模一樣的檔案結構**，根本感受不到底層硬體或宿主機OS變了。

### 2. 寫時複製與分層技術（OverlayFS / UnionFS）

如果每次部署都要傳送幾GB的完整作業系統，那網路會被塞爆，也談不上無縫。

容器利用了**Union Filesystem**（聯合檔案系統，如`overlay2`），把RootFS切分成多個**唯讀層（Read-Only Layers）**：

| 層 | 內容 |
| --- | --- |
| **基底層** | Ubuntu / Alpine操作系統基本環境 |
| **依賴層** | 安裝Node.js / Python / Java等Runtime |
| **應用層** | 你的App程式碼與Config |

無縫運送的關鍵在於：

- **增量傳輸**：遠端伺服器如果已經有Ubuntu基底層，部署新版程式時只需要下載**幾MB的應用層**，幾秒鐘就能完成更新。
- **Copy-on-Write（寫時複製）**：運行時所有修改只會寫在最頂層的「暫存可寫層」（`UpperDir`），**絕不破壞**底下唯讀的Image。

### 3. ABI（應用程式二進制介面）的穩定性

你可能會問：「容器借用了遠端宿主機的Kernel，難道不同Kernel不會出事嗎？」

這歸功於Linux Kernel廣為人知的設計鐵律——***"Never break userspace"***（絕不破壞用戶態介面）。

Linux的System Call（如`open`、`read`、`socket`）介面非常穩定。只要遠端伺服器的Linux Kernel版本沒有老舊到不支援容器所需的syscall（例如核心≥**3.10**），容器內部的用戶態程式碼就能毫無障礙地透過syscall與遠端核心對話。

### 4. 統一的OCI國際標準（Open Container Initiative）

Docker社群推動了**OCI標準**，規範了：

- **Image Spec（鏡像規範）**：檔案怎麼打包、Layer怎麼疊加、Manifest檔長怎樣。
- **Runtime Spec（運行時規範）**：底層工具（如`runc`）拿到Image後，要下什麼syscall、怎麼配置Namespace與cgroup。

這意味著，不論你在Mac（Docker Desktop）上Build，還是在CI/CD管道（GitHub Actions）上Build，產出的Image**都符合同一套規格**。送到遠端的AWS ECS、Kubernetes或是平價VPS上，底層的Container Runtime（如`containerd`或`cri-o`）都能用完全相同的邏輯把它剖析並跑起來。

> [!TIP]
> **總結**
>
> - **`Namespace` + `cgroups`**：讓進程在執行時有了孤立的「包廂」。
> - **OCI Image + `OverlayFS`**：把包廂裡的「家具、裝潢與工具（RootFS）」全部壓縮封箱，做成了標準化貨櫃。
>
> 正因為「障眼法環境」和「看到的檔案內容」被一併完整打包搬移了，容器才能做到極致的***無縫跨環境部署***。

## A操作系統的Image，可以deploy到B操作系統運行嗎？

簡單來說：

- A與B都屬於**Linux家族**，且**CPU架構相同** → ✅ **可以**。
- A與B是**完全不同的作業系統**（例如Linux與Windows） → ❌ **不能直接運行**。

### 1. Linux發行版之間：完全可以

> 例：Ubuntu Image → CentOS宿主機

如果你在本地用Ubuntu作為Base Image打包了一個容器，把它部署到遠端執行CentOS或Debian的伺服器上，是可以無縫執行的。

- **原因**：容器**不包含**OS Kernel，只包含User Space的檔案與函式庫（`libc`等）。所有的Linux發行版***共享相同的Linux Kernel API / System Calls***。
- **運作機制**：CentOS宿主機的Linux Kernel會直接接管並執行Ubuntu Image裡面的應用程式與系統呼叫。

### 2. 跨不同作業系統：不能直接運行

> 例：Linux Image → 原生Windows宿主機

如果你打包了一個Linux容器Image，想直接把它放到Windows Server或macOS的原生Kernel上執行，是無法直接執行的。

- **原因**：不同作業系統的***Kernel API和ABI完全不同***。Linux程式編譯出來的syscall（例如`epoll`、`clone`）在Windows Kernel裡根本不存在，Windows無法直接解析並執行Linux的二進制檔案。
- **例外（虛擬化層）**：macOS / Windows上的Docker Desktop之所以能跑Linux容器，是因為Docker在背景悄悄啟動了一台**輕量級Linux虛擬機**（macOS的HyperKit / VFKit，Windows的WSL2 / Hyper-V）。容器實際上是跑在那個**Linux虛擬機的Kernel**之上，而不是直接跑在Host OS上。

### 3. 跨CPU架構：不能直接運行

> 例：`x86_64` Image → `arm64`伺服器

除了作業系統Kernel外，**CPU架構**（Instruction Set Architecture）也是硬性限制。

如果你在Intel / AMD（`x86_64`）的電腦上Build出Image，直接拿到Apple Silicon（M1 / M2 / M3）或AWS Graviton（`arm64`）伺服器上，Kernel會因為無法解析CPU指令集而報錯：`exec format error`。

解決方案：

- **Multi-arch Image（多架構鏡像）**：利用`docker buildx`同時針對x86與ARM編譯並打包，部署時會**自動根據宿主機CPU**抓取對應架構的Image。
- **QEMU模擬器**：透過指令集模擬（如Docker Desktop的QEMU模擬），但**效能會大幅下降**。

### 總結對照表

| A（Image來源） | B（部署宿主機） | CPU架構 | 能否直接部署？ | 關鍵原因 |
| --- | --- | --- | --- | --- |
| Ubuntu | CentOS / RHEL | 相同 | ✅ **可以** | 共享相同的Linux Kernel系統呼叫 |
| Linux | Windows Server | 相同 | ❌ **不行**（除非開WSL2虛擬機） | Kernel API完全不同（POSIX vs Win32） |
| Linux（`x86_64`） | Linux（`arm64`） | 不同 | ❌ **不行**（除非用Multi-arch） | CPU機器指令集不相容 |

## 容器靠namespace做隔離，為什麼說這種隔離「不徹底」？業界又是怎麼補強的？

> [!NOTE]
> **簡答**：namespace只隔離了「**視圖**」，所有容器仍***共用同一個Linux kernel***，所以kernel或運行時的任何一個漏洞，都可能讓攻擊者逃出容器。要接近VM等級的隔離，必須在namespace之外**疊加其他機制**（gVisor、Kata、Firecracker等），而不是靠優化namespace本身。這個問題在多租戶K8s、AI agent、GPU叢集共享等場景下尤其關鍵。

### 🔍 1. 根本原因：隔離的是「視圖」，不是kernel

namespace只是把kernel的某些資源做成各容器各自看到的版本（PID、網路介面、掛載點等），但所有容器**共用同一個Linux kernel**。

| | 容器 | VM |
| --- | --- | --- |
| **Kernel** | 與宿主機及其他容器共用 | 每個VM有獨立的guest kernel |
| **隔離邊界** | kernel的軟體機制 | hypervisor，由硬體虛擬化強制 |
| **攻擊者要碰到其他租戶** | 突破**一個**kernel漏洞即可能 | 先打穿guest kernel，再突破hypervisor |

### 🧨 2. 「不徹底」的具體表現

- **Kernel漏洞是全域性風險**：漏洞打的是所有容器共用的kernel本身，例如**Dirty Pipe**這類漏洞，就可能繞過namespace隔離逃出容器。
- **運行時本身也是攻擊面**：容器運行時（如`runc`）的漏洞同樣可能導致逃逸，例如曾出現透過**覆寫宿主機上`runc`二進位檔**的逃逸漏洞。這類問題不來自kernel，但同樣說明容器的隔離邊界比VM脆弱。
- **Syscall攻擊面巨大**：容器能呼叫的syscall與宿主機上的原生程式**基本一樣多**。namespace不負責限縮這件事，那是`seccomp`、AppArmor等額外機制的工作。

### 🛡️ 3. 業界如何補強

namespace的隔離有天生上限，所以做法是**疊加機制，或換架構**：

| 方案 | 做法 | 隔離強度來源 | 主要限制 |
| --- | --- | --- | --- |
| **gVisor（Google）** | 在使用者空間攔截所有syscall，由**Sentry**（用Go寫的、記憶體安全的模擬核心）處理，縮小暴露給宿主kernel的攻擊面 | 攔截層 | 並未實作全部Linux syscall，相容性不是100%；依賴特殊syscall的應用（如某些debugger、高效能I/O場景）可能無法執行或效能下降 |
| **Kata Containers** | 每個Pod跑在一個輕量**microVM**裡，有獨立guest kernel，對K8s而言仍是一般容器 | KVM硬體虛擬化 | 有記憶體開銷與啟動延遲 |
| **Firecracker（AWS）** | 專為microVM設計的輕量VMM，開機約**100–200ms**，是AWS Lambda / Fargate背後的技術 | KVM硬體虛擬化 | 功能刻意精簡 |

使用Kata或Firecracker時，攻擊者要逃逸必須先攻破guest kernel，再突破hypervisor，**兩層**都要打穿。

- **較輕量的前置手段**：在考慮上述方案前，通常先做`seccomp`、AppArmor / SELinux、移除不必要的capabilities、user namespace與rootless容器。這些成本低，能縮小攻擊面，但***不改變「共用kernel」的本質***。

### 🤖 4. 為什麼對LLM infra特別重要

- 🖥️ **多租戶GPU叢集**：讓不同團隊或客戶共用同一批GPU節點跑推理或訓練時，「共享kernel」是必須面對的設計決策。
- 🧪 **AI agent執行不可信程式碼**：讓LLM agent執行使用者提供的程式碼，本質上就是執行**不可信workload**，標準容器的隔離強度不夠，這是gVisor、Kata目前很熱門的應用場景。
- ⚖️ **實務限制**：GPU搭配gVisor或Kata時，會遇到GPU直通、驅動支援與效能損耗等問題，選型時需要一併評估。

### 🎤 5. 面試應答思路

被問到「怎麼做多租戶隔離」時，可以分層回答：

1. **基礎層**：namespace + cgroup，提供資源與視圖隔離。
2. **加固層**：`seccomp`、AppArmor / SELinux、capabilities限制、rootless。
3. **強隔離層**：面對互相不信任的租戶（adversarial multi-tenancy），考慮gVisor或Kata。
4. **取捨**：說明相容性、效能、成本與GPU支援的代價。

這樣能展現對問題層次的理解，而不只是回答K8s RBAC這類表層做法。

> [!TIP]
> 💡 **一句話總結**
>
> namespace本身的隔離有上限，解法不是「原地優化namespace」，而是在其上***疊加gVisor / Kata / Firecracker***這類獨立技術，並依**威脅模型與成本**取捨。

## mount常用命令總結

### 🔗 1) `--bind`：把目錄再接到另一個位置

```bash
mount --bind /home/me/data /srv/data      # 同一份內容多一個入口
mount --rbind /dev /mnt/dev               # Recursive bind，把一個目錄綁定到另一個位置時，連同它底下所有的子掛載點一起帶過去
mount -o remount,bind,ro /srv/data        # 把這個入口改成唯讀
```

- source是**已存在的目錄**，***不產生新的文件系統***
- 預設不是recursive，只帶來源那一個掛載點（底下所有子目錄和檔案都在），不含底下另外掛的子掛載點；要子掛載用`--rbind`
- 重開機後消失

### 🪞 self bind：把目錄bind到自己身上

```bash
mount --bind /new_root /new_root          # 來源和目標是同一個目錄
```

self bind就是來源和目標相同的`--bind`。目錄裡的內容***完全不變***，只是這個目錄多了一筆掛載紀錄，從「普通目錄」變成「掛載點」。

- **為什麼需要**：有些操作只能對**掛載點**做，普通目錄不行：
    - `pivot_root`要求`new_root`必須是掛載點；
    - `mount -o remount,ro`、`--make-private`這類修改屬性的操作，對象也必須是掛載點。
- **怎麼確認**：用`findmnt`看前後的差別。

```bash
findmnt /new_root                          # 之前：沒有輸出，它只是根檔案系統裡的普通目錄
mount --bind /new_root /new_root
findmnt /new_root                          # 之後：多出一筆
# TARGET     SOURCE               FSTYPE
# /new_root  /dev/sda2[/new_root] ext4
```

- **`SOURCE`的`[/new_root]`**：表示這個掛載點來自`/dev/sda2`這個檔案系統裡的`/new_root`子目錄，也就是bind mount的來源。
- **內容一樣的原因**：bind mount不複製檔案，兩個路徑指向磁碟上***同一個目錄***，所以改哪一邊都是同一份。

> [!TIP]
> 💡 **一句話總結**
>
> self bind不改內容，只是***把普通目錄變成掛載點***，讓`pivot_root`、remount、修改propagation這些「只能對掛載點做」的操作可以進行。

### 🧭 2) `source target`：基本用法

```bash
mount [-t類型] [-o選項] <source> <target>
```

| 情境 | 指令 |
| --- | --- |
| **掛磁碟分割區** | `mount /dev/sdb1 /mnt/usb` |
| **用UUID** | `mount UUID=1234-abcd /mnt/usb` |
| **掛ISO / 映像檔** | `mount -o loop disk.iso /mnt/iso` |
| **記憶體文件系統** | `mount -t tmpfs tmpfs /mnt/ram` |
| **網路（NFS）** | `mount -t nfs server:/export /mnt/nfs` |
| **唯讀掛載** | `mount -o ro /dev/sdb1 /mnt/usb` |

**相關指令**：

```bash
umount /mnt/usb          # 卸載（可寫mount點或裝置）
findmnt                  # 樹狀查看所有掛載
findmnt /dev             # 查單一路徑
mount -a                 # 掛載/etc/fstab裡尚未掛載的項目
```

**開機自動掛載**要寫進`/etc/fstab`：

```
UUID=1234-abcd   /data   ext4   defaults   0   2
```

### 📁 3) 常用目錄

| 目錄 | 角色 | 屬於Linux文件系統嗎？ |
| --- | --- | --- |
| `/dev` | devtmpfs，裝置節點（`/dev/sda1`、`/dev/null`），kernel每次開機重建，常作為mount的**source** | ✅ **是**，是Linux kernel的虛擬文件系統（devtmpfs），在記憶體中，不在磁碟上 |
| `/mnt` | 管理員**手動臨時掛載**的慣例目錄，本身只是普通空目錄，也常當chroot的新根 | ❌ **不是**，只是FHS的目錄慣例，本身是根文件系統（如ext4）裡的普通目錄，沒有特殊的文件系統 |
| `/media` | 桌面環境**自動掛載**的USB、光碟（部分發行版用`/run/media`） | ❌ **不是**，同`/mnt`，只是慣例目錄；掛在它底下的USB才有自己的文件系統（如vfat、exfat、ext4） |
| `/proc`、`/sys` | 虛擬文件系統，chroot時通常也要綁進去 | ✅ **是**，分別是procfs、sysfs，都是kernel提供的虛擬文件系統，沒有磁碟後端 |
| `/etc/fstab` | 開機自動掛載的設定檔 | ❌ **不是**，只是根文件系統上的一個普通文字檔，被mount流程讀取 |

> [!NOTE]
> **判斷方法**：用`findmnt <路徑>`看它是不是***自己有一個掛載點***。有獨立掛載、FSTYPE是devtmpfs / proc / sysfs等的，才是「文件系統」；只是出現在`/`底下的普通目錄或檔案，屬於根文件系統的內容而已。

### 🔁 4) 掛載傳播（propagation）

建立新的mount namespace時（例如用`unshare -m`，或啟動容器），新namespace會**複製**一份宿主機的掛載樹。複製出來之後，兩邊的掛載點之間可能還保持著「同步關係」，關係是哪一種，就由propagation類型決定：

| 類型 | 意思 |
| --- | --- |
| **shared** | 雙向同步：任何一邊新掛載或卸載，另一邊也會跟著變化 |
| **private** | 完全不同步：各自掛載、各自卸載，互不影響 |
| **slave** | 單向同步：宿主機的變化會傳進來，這邊的變化不會傳出去 |
| **unbindable** | private，而且不能被`--bind`綁定到別處 |

### 🥞 5) mount疊加：同一個位置掛好幾層

同一個目錄可以**連續mount好幾次**。每一次mount都疊在上一層上面，***看到的永遠是最上面那一層***；下面的內容沒有消失，只是被蓋住了。

**先看懂這行指令**：

```bash
mount -t tmpfs layer1 /mnt/demo
```

| 部分 | 意思 |
| --- | --- |
| `-t tmpfs` | 檔案系統類型。tmpfs放在記憶體裡，不需要磁碟，卸載後內容就消失 |
| `layer1` | 來源（source）。tmpfs沒有真正的裝置，這裡填什麼都可以，只是一個名字，會顯示在`findmnt`的`SOURCE`欄，方便分辨是哪一層 |
| `/mnt/demo` | 掛載點 |

每執行一次，kernel就建立一個**全新的、空的**tmpfs掛上去。所以下面的例子用`layer1`、`layer2`兩個名字掛兩次，才看得出疊加的效果。

```bash
mkdir -p /mnt/demo && echo "原本的檔案" > /mnt/demo/orig.txt

mount -t tmpfs layer1 /mnt/demo           # 第1層：蓋住orig.txt
echo "第1層" > /mnt/demo/a.txt

mount -t tmpfs layer2 /mnt/demo           # 第2層：蓋住第1層
echo "第2層" > /mnt/demo/b.txt

ls /mnt/demo                              # 只看到b.txt
```

疊起來的樣子：

```
/mnt/demo
├── layer2（tmpfs）   <-- 最上層：看得到，只有b.txt
├── layer1（tmpfs）   <-- 被蓋住：a.txt還在
└── 原本的目錄         <-- 被蓋住：orig.txt還在
```

用`findmnt`可以看到同一個位置有兩筆掛載紀錄，後掛的排在下面：

```bash
findmnt /mnt/demo
# TARGET     SOURCE  FSTYPE
# /mnt/demo  layer1  tmpfs
# /mnt/demo  layer2  tmpfs
```

`umount`一次只拆**最上面**那一層，像剝洋蔥一樣：

```bash
umount /mnt/demo && ls /mnt/demo          # 拆掉第2層 → 看到a.txt
umount /mnt/demo && ls /mnt/demo          # 拆掉第1層 → 看到orig.txt
```

- **被蓋住的內容還在**：不是刪除，也不是覆寫。卸載後原本的檔案會原封不動地回來。
- **正在使用的程式不受影響**：疊上新的一層之前就已經開著的檔案，或者`cd`在裡面的shell，仍然指向舊的那一層，可能會看到和`ls`不一樣的內容。
- **常見的意外**：把USB掛到一個原本就有檔案的目錄上，那些檔案會「看起來消失」；卸載後就會回來，不是被刪掉了。

> [!TIP]
> 💡 **一句話記憶**
>
> 同一個位置可以疊好幾層mount，***看到最上層，拆時也從最上層開始***。`pivot_root(".", ".")`就是讓舊根疊在新根上面，再用`umount2`把上面那層拆掉。

> [!TIP]
> 🧠 **一句話記憶**
>
> - **普通mount**：把「裝置 / 虛擬來源」的文件系統拼進目錄樹
> - **`--bind`**：把「已在樹上的目錄」再開一個入口（讓命名空間變成圖）
> - `/dev`是來源，`/mnt`是暫放的目標，***`fstab`讓掛載持久化***

## pivot_root工作原理

> [!NOTE]
> **簡答**：`pivot_root`把當前mount namespace的**根掛載點**換成另一個目錄，舊的根被移到新根底下的一個子目錄。之後再把舊根卸載掉，容器裡的進程就***完全看不到宿主機的檔案系統***。容器runtime就是用它來切換到Image的RootFS。

### 📜 函式原型

```c
int pivot_root(const char *new_root, const char *put_old);
```

| 參數 | 意思 |
| --- | --- |
| `new_root` | 要成為新根目錄的路徑，**必須是一個掛載點** |
| `put_old` | 舊根目錄要被移到哪裡，**必須在`new_root`底下** |

> [!WARNING]
> glibc沒有提供`pivot_root()`這個包裝函式，實際程式裡要寫成`syscall(SYS_pivot_root, new_root, put_old)`。下面的範例為了好讀，仍然寫成`pivot_root(...)`。

### 🌳 1. 執行前的初始狀態

假設在執行`pivot_root`之前，整體的檔案系統長這樣：

```
/  (Old Root)
├── a.txt
├── bin/                   <-- 舊的系統工具
├── lib/                   <-- 舊的函式庫
└── new_root/              <-- 新根目錄的掛載點
    ├── app                <-- 新root裡特有的檔案或程式
    └── .old_root/         <-- 預先建立好、準備用來收容舊root的空資料夾
```

`pivot_root`要求`new_root`必須是掛載點，常用的做法是先[self bind](#-self-bind把目錄bind到自己身上)：`mount --bind /new_root /new_root`。

### ⚙️ 2. 執行指令

```c
chdir("/new_root");
pivot_root("/new_root", "./.old_root");
```

1. **`chdir("/new_root")`**：先把工作目錄移到新根裡，這樣後面可以用相對路徑`./.old_root`指定`put_old`。
2. **`pivot_root(...)`**：kernel把`/new_root`這個掛載點變成新的`/`，再把原本的根掛載點移到新根底下的`.old_root`。

### 🔄 3. 執行後的新根目錄

`pivot_root`成功後，原本的`new_root`直接變成了全新的`/`：

```
/  (New Root，即原本的/new_root)
├── app                    <-- 原本新root裡的東西保留著
└── .old_root/             <-- 舊的根目錄被完整掛載在這裡
    ├── a.txt              <-- 來自舊root的a.txt
    ├── bin/               <-- 來自舊root的bin/
    ├── lib/               <-- 來自舊root的lib/
    └── new_root/          <-- 來自舊root的new_root目錄
        ├── app            <-- /app和/.old_root/new_root/app內容一樣
        └── .old_root/     <-- 當時預先建好的空資料夾
```

### 🧹 4. 卸載舊根

```c
chdir("/");
umount2("/.old_root", MNT_DETACH);  // 卸載舊根目錄
rmdir("/.old_root");                // 刪除這個掛載點目錄
```

- **`MNT_DETACH`**：lazy unmount，先把舊根從目錄樹上拆下來；如果還有東西在使用它，等用完才真正釋放。
- **`rmdir`**：舊根卸載後，`/.old_root`只剩一個空目錄，順手刪掉。

最終的新根目錄結構：

```
/  (New Root)
└── app                    <-- 原本新root裡的檔案保留著，.old_root已經刪掉
```

`/.old_root`已經被`umount2`卸載，而且透過`rmdir`從檔案樹中刪除了，所以根目錄下已經找不到`.old_root`這個資料夾。***從這一刻起，宿主機的檔案系統在這個namespace裡完全不可見。***

> [!WARNING]
> `pivot_root`不會產生任何檔案：新根裡原本有什麼，切換後就只有什麼。這個例子的新根裡只有`app`，所以切換後連`/bin/sh`都沒有。實際的容器裡，`bin/`、`lib/`等檔案要***事先放在新根裡***，這正是Image的RootFS提供的東西。

### 🆚 unshare()和clone()的差別

兩者都能建立新的namespace（用同一組`CLONE_NEW*` flag），差別只在於**哪個行程**會進入新的namespace：

| 比較項目 | `unshare()` | `clone()` |
| --- | --- | --- |
| **作用對象** | 針對「**現有的**」行程（Current Process） | 針對「**新建立的**」子行程（Child Process） |
| **對自身的影響** | 會讓**當前行程**直接脫離原本的Namespace，進入全新的Namespace。 | 當前行程（Parent）保持不變，只有**新生成的子行程**會進入全新的Namespace。 |

### 🆚 pivot_root和chroot的差別

| | `chroot` | `pivot_root` |
| --- | --- | --- |
| **改變的是** | 這個**進程**看到的根路徑 | 整個**mount namespace**的根掛載點 |
| **舊根還在嗎** | 還掛在原處，只是看不到 | 被移到`put_old`，可以卸載掉 |
| **能不能逃出去** | 有root權限時有已知的逃逸方法 | 舊根卸載後，路徑上已經不存在 |
| **典型用途** | 救援系統、建置環境 | 容器runtime（例如`runc`） |

> [!TIP]
> 🧠 **一句話記憶**
>
> - **`unshare -m`**：拿到一棵屬於自己的掛載樹
> - **`make-rprivate`**：切斷和宿主機的同步
> - **`pivot_root` + `umount`**：把根換成Image的RootFS，***再把宿主機的根拆掉***

## pivot_root在容器中如何工作

> [!NOTE]
> **簡答**：以最常見的**containerd + runc**為例（Docker和Kubernetes底下都是這一套）。containerd先用overlayfs把Image疊成一個目錄，runc在新的mount namespace裡把需要的檔案系統掛進這個目錄，再用`pivot_root`把它換成`/`，***最後把宿主機的根卸載掉***，才執行容器的程式。

### 🗺️ 整體流程

```
docker run / kubelet
└─ containerd ── 準備rootfs（overlayfs）
   └─ containerd-shim
      └─ runc create / start
         ├─ ① clone出新進程 + 新的namespace（mnt / pid / net / uts / ipc …）
         ├─ ② 在新的mount namespace裡設定propagation
         ├─ ③ 把rootfs bind到自己身上，讓它變成掛載點
         ├─ ④ 在rootfs裡掛好/proc /dev /sys和volumes
         ├─ ⑤ pivot_root：把/換成rootfs，再拆掉宿主機的根
         ├─ ⑥ 安全設定：唯讀路徑、遮蔽路徑、capabilities、seccomp
         └─ ⑦ execve容器的entrypoint
```

### 📦 0. new_root從哪裡來

`pivot_root`需要一個「新根」，在容器裡，它就是**Image的RootFS**，由containerd用overlayfs疊出來：

```
lowerdir = Image的各個唯讀層（Ubuntu基底層、依賴層、應用層）
upperdir = 這個容器專屬的可寫層
merged/  = 疊起來的結果  <-- 這個目錄就是new_root
```

所以`merged/`裡已經有完整的`bin/`、`lib/`、`etc/`。***`pivot_root`本身不產生檔案，檔案是Image事先準備好的。***

### 🧬 ① 建立namespace

runc用`clone()`產生容器的第一個進程（`runc init`），同時帶上`CLONE_NEWNS`等flag。

***`clone`之後，舊的mount tree（宿主機的整棵掛載樹）會被複製到新的mount namespace裡***。從這一刻起，這個進程有了一份**複製出來的**掛載樹：這時它看到的`/`還是宿主機的根，只是一份副本。之後在新namespace裡的掛載和卸載，只改這份副本；但副本和原本的掛載點之間可能還保持著同步關係，所以下一步要設定propagation。

```
宿主機的mount namespace新的mount namespace（容器）
/                                 /                    <-- 複製出來的副本
├── proc/                         ├── proc/
├── sys/                          ├── sys/
├── dev/                          ├── dev/
└── var/lib/.../merged/           └── var/lib/.../merged/   <-- 之後的new_root
```

### 🔁 ② 設定propagation

```c
mount("", "/", NULL, MS_SLAVE | MS_REC, NULL);   // 不做mount，僅僅修改屬性：修改propagation為slave（recursive，runc預設rslave）
```

- **為什麼是slave**：宿主機之後掛上的東西還能傳進來，容器裡的動作不會傳出去。OCI設定裡的`rootfsPropagation`可以改成`private` / `shared`。各種類型的差別見[掛載傳播（propagation）](#-4-掛載傳播propagation)。
- **上一層也要private**：runc還會確保rootfs的上一層掛載點是private，這也是`pivot_root`的要求。

### 🔗 ③ 讓rootfs從普通目錄變成為掛載點

```c
mount(rootfs, rootfs, "bind", MS_BIND | MS_REC, NULL);
```

這一步是為了下一步的`pivot_root`：它要求`new_root`***必須是掛載點***，但`merged/`這類目錄不一定是。把一個目錄bind mount到它自己身上（[self bind](#-self-bind把目錄bind到自己身上)），內容完全不變，只是讓它多了一個掛載點的身份，就能滿足這個要求。

### 🧱 ④ 在新根裡掛好要用的檔案系統

此時還沒切換根，所以路徑都是**宿主機視角**的`rootfs/...`：

| 掛載點 | 類型 | 作用 |
| --- | --- | --- |
| `rootfs/proc` | 新的`proc` | 配合新的PID namespace，`ps`只看得到容器裡的進程 |
| `rootfs/dev` | `tmpfs` | 只放需要的裝置：`null`、`zero`、`random`、`tty` … |
| `rootfs/dev/pts` | `devpts`（`newinstance`） | 容器自己的終端機，不和宿主機共用 |
| `rootfs/dev/shm`、`mqueue` | `tmpfs`、`mqueue` | 共享記憶體、訊息佇列 |
| `rootfs/sys` | `sysfs`（唯讀） | 系統資訊 |
| `rootfs/data` … | bind mount | 使用者指定的volume（`-v /host:/data`） |
| `rootfs/etc/hosts`、`resolv.conf`、`hostname` | bind mount | 由runtime產生的網路設定檔 |

***容器需要的宿主機資源（volume、設定檔等），都必須在這一步、`pivot_root`之前掛載進來***。一旦切換完成，宿主機的路徑就再也看不到了。

### 🔄 ⑤ pivot_root：runc的特殊寫法

[pivot_root工作原理](#pivot_root工作原理)的例子要先建立一個`.old_root`目錄。runc不這樣做，它用的是`pivot_root(".", ".")`的技巧（`libcontainer/rootfs_linux.go`的`pivotRoot`函式）：

```c
int oldroot = open("/", O_DIRECTORY | O_RDONLY);    // 先抓住舊根
int newroot = open(rootfs, O_DIRECTORY | O_RDONLY);

fchdir(newroot);
pivot_root(".", ".");                                // 新根和放舊根的位置都是「這裡」
                                                     // step1）把cur dir切換成新根
                                                     // step2）把舊根mount到cur dir上
                                                     // 實際效果：old root覆蓋在new root之上

fchdir(oldroot);                                     // 回到舊根（它現在疊在新根上面）
mount("", ".", NULL, MS_SLAVE | MS_REC, NULL);       // 確保卸載不會傳回宿主機
umount2(".", MNT_DETACH);                            // 把舊根拆掉
chdir("/");
```

- **`pivot_root(".", ".")`**：舊根被掛在**新根的同一個位置**，兩層疊在一起，上面那層是舊根。
- **不需要`.old_root`**：不用在Image裡建立任何多餘的目錄，Image可能是唯讀的，或根本沒有這個目錄。
- **`umount2(..., MNT_DETACH)`**：把上面那層舊根拆掉，露出底下的新根。從此***宿主機的整棵檔案樹在這個容器裡消失了***。

### 🛡️ ⑥ ⑦ 收尾，然後執行程式

- **遮蔽和唯讀**：把`/proc/kcore`、`/proc/keys`等敏感路徑遮蔽（mask），把`/proc/sys`等設成唯讀。
- **權限**：設定hostname、丟掉不需要的capabilities、套用seccomp、切換到指定的UID。
- **執行**：`execve`容器的entrypoint，例如`/bin/sh`。這時它找到的`/bin/sh`，是Image裡的那一個。

### 🧩 延伸重點

- **為什麼不直接用`chroot`**：`chroot`只改變「這個進程看到的根路徑」，宿主機的掛載樹整棵還在，有root權限時有已知的逃逸方法。`pivot_root` + `umount`是把舊根從namespace裡**真正移除**。

> [!TIP]
> 💡 **一句話總結**
>
> 容器的「根目錄」= ***Image疊出來的overlayfs + `pivot_root`把它換成`/` + 把宿主機的根卸載掉***。前面要先用`unshare` / `clone`拿到自己的掛載樹，再用rslave / private切斷和宿主機的同步，這三件事加起來，才是容器「看起來像一台獨立機器」的檔案系統部分。
