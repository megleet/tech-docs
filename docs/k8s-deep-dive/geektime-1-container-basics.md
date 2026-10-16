---
icon: lucide/container
---

# GeekTime-1-容器基礎

**目錄**

- [Container如果只做了cgroup資源限制和namespace障眼法是不夠的，還需要什麼才可以 seamless 部署到遠端？](#container如果只做了cgroup資源限制和namespace障眼法是不夠的還需要什麼才可以-seamless-部署到遠端)
- [A 操作系統的 Image，可以 deploy 到 B 操作系統運行嗎？](#a-操作系統的-image可以-deploy-到-b-操作系統運行嗎)
- [容器靠 namespace 做隔離，為什麼說這種隔離「不徹底」？業界又是怎麼補強的？](#容器靠-namespace-做隔離為什麼說這種隔離不徹底業界又是怎麼補強的)

## Container如果只做了cgroup資源限制和namespace障眼法是不夠的，還需要什麼才可以 seamless 部署到遠端？

如果 Container 只是 Linux Kernel 上的「資源限制（`cgroups`）」與「障眼法（`Namespace`）」，為什麼我們能把在本地開發好的容器，完全無縫地搬到遠端的 AWS、GCP 或任何一台伺服器上直接執行，且保證「**在我的電腦能跑，在遠端就能跑**」？

答案在於：Container 的真正威力，是「**隔離機制**」搭配了「**打包標準與聯合檔案系統（RootFS + Image）**」。

### 1. 關鍵核心：它打包了完整的「根檔案系統（RootFS）」

當我們在傳統 Server 部署程式時，常常因為本地與遠端的 `libc` 版本不一致、Python / Java 依賴庫版本不同、或是缺少某個特定 Dynamic Link Library（`.so`）而導致部署失敗。

但容器鏡像（Container Image）不僅僅是打包你的程式碼，它是直接把作業系統**用戶態（User Space）的所有檔案**完整抓了下來：

- ✅ **包含了**：所有的依賴套件、環境變數、配置檔案、系統 C 函式庫（如 `glibc`）、甚至是 `/bin/bash`。
- ❌ **不包含**：Linux Kernel（核心）。

當你把這個 Image 送到遠端時，遠端宿主機透過 **Mount Namespace** 和 `pivot_root`，把容器的根目錄 `/` 替換成 Image 裡載入的 RootFS。對容器內的進程來說，它看到的完全是本地開發時那一套**一模一樣的檔案結構**，根本感受不到底層硬體或宿主機 OS 變了。

### 2. 寫時複製與分層技術（OverlayFS / UnionFS）

如果每次部署都要傳送幾 GB 的完整作業系統，那網路會被塞爆，也談不上無縫。

容器利用了 **Union Filesystem**（聯合檔案系統，如 `overlay2`），把 RootFS 切分成多個**唯讀層（Read-Only Layers）**：

| 層 | 內容 |
| --- | --- |
| **基底層** | Ubuntu / Alpine 操作系統基本環境 |
| **依賴層** | 安裝 Node.js / Python / Java 等 Runtime |
| **應用層** | 你的 App 程式碼與 Config |

無縫運送的關鍵在於：

- **增量傳輸**：遠端伺服器如果已經有 Ubuntu 基底層，部署新版程式時只需要下載**幾 MB 的應用層**，幾秒鐘就能完成更新。
- **Copy-on-Write（寫時複製）**：運行時所有修改只會寫在最頂層的「暫存可寫層」（`UpperDir`），**絕不破壞**底下唯讀的 Image。

### 3. ABI（應用程式二進制介面）的穩定性

你可能會問：「容器借用了遠端宿主機的 Kernel，難道不同 Kernel 不會出事嗎？」

這歸功於 Linux Kernel 廣為人知的設計鐵律——**"Never break userspace"**（絕不破壞用戶態介面）。

Linux 的 System Call（如 `open`、`read`、`socket`）介面非常穩定。只要遠端伺服器的 Linux Kernel 版本沒有老舊到不支援容器所需的 syscall（例如核心 **≥ 3.10**），容器內部的用戶態程式碼就能毫無障礙地透過 syscall 與遠端核心對話。

### 4. 統一的 OCI 國際標準（Open Container Initiative）

Docker 社群推動了 **OCI 標準**，規範了：

- **Image Spec（鏡像規範）**：檔案怎麼打包、Layer 怎麼疊加、Manifest 檔長怎樣。
- **Runtime Spec（運行時規範）**：底層工具（如 `runc`）拿到 Image 後，要下什麼 syscall、怎麼配置 Namespace 與 cgroup。

這意味著，不論你在 Mac（Docker Desktop）上 Build，還是在 CI/CD 管道（GitHub Actions）上 Build，產出的 Image **都符合同一套規格**。送到遠端的 AWS ECS、Kubernetes 或是平價 VPS 上，底層的 Container Runtime（如 `containerd` 或 `cri-o`）都能用完全相同的邏輯把它剖析並跑起來。

> [!TIP]
> **總結**
>
> - **`Namespace` + `cgroups`**：讓進程在執行時有了孤立的「包廂」。
> - **OCI Image + `OverlayFS`**：把包廂裡的「家具、裝潢與工具（RootFS）」全部壓縮封箱，做成了標準化貨櫃。
>
> 正因為「障眼法環境」和「看到的檔案內容」被一併完整打包搬移了，容器才能做到極致的**無縫跨環境部署**。

## A 操作系統的 Image，可以 deploy 到 B 操作系統運行嗎？

簡單來說：

- A 與 B 都屬於 **Linux 家族**，且 **CPU 架構相同** → ✅ **可以**。
- A 與 B 是**完全不同的作業系統**（例如 Linux 與 Windows） → ❌ **不能直接運行**。

### 1. Linux 發行版之間：完全可以

> 例：Ubuntu Image → CentOS 宿主機

如果你在本地用 Ubuntu 作為 Base Image 打包了一個容器，把它部署到遠端執行 CentOS 或 Debian 的伺服器上，是可以無縫執行的。

- **原因**：容器**不包含** OS Kernel，只包含 User Space 的檔案與函式庫（`libc` 等）。所有的 Linux 發行版**共享相同的 Linux Kernel API / System Calls**。
- **運作機制**：CentOS 宿主機的 Linux Kernel 會直接接管並執行 Ubuntu Image 裡面的應用程式與系統呼叫。

### 2. 跨不同作業系統：不能直接運行

> 例：Linux Image → 原生 Windows 宿主機

如果你打包了一個 Linux 容器 Image，想直接把它放到 Windows Server 或 macOS 的原生 Kernel 上執行，是無法直接執行的。

- **原因**：不同作業系統的 **Kernel API 和 ABI 完全不同**。Linux 程式編譯出來的 syscall（例如 `epoll`、`clone`）在 Windows Kernel 裡根本不存在，Windows 無法直接解析並執行 Linux 的二進制檔案。
- **例外（虛擬化層）**：macOS / Windows 上的 Docker Desktop 之所以能跑 Linux 容器，是因為 Docker 在背景悄悄啟動了一台**輕量級 Linux 虛擬機**（macOS 的 HyperKit / VFKit，Windows 的 WSL2 / Hyper-V）。容器實際上是跑在那個 **Linux 虛擬機的 Kernel** 之上，而不是直接跑在 Host OS 上。

### 3. 跨 CPU 架構：不能直接運行

> 例：`x86_64` Image → `arm64` 伺服器

除了作業系統 Kernel 外，**CPU 架構（Instruction Set Architecture）** 也是硬性限制。

如果你在 Intel / AMD（`x86_64`）的電腦上 Build 出 Image，直接拿到 Apple Silicon（M1 / M2 / M3）或 AWS Graviton（`arm64`）伺服器上，Kernel 會因為無法解析 CPU 指令集而報錯：`exec format error`。

解決方案：

- **Multi-arch Image（多架構鏡像）**：利用 `docker buildx` 同時針對 x86 與 ARM 編譯並打包，部署時會**自動根據宿主機 CPU** 抓取對應架構的 Image。
- **QEMU 模擬器**：透過指令集模擬（如 Docker Desktop 的 QEMU 模擬），但**效能會大幅下降**。

### 總結對照表

| A（Image 來源） | B（部署宿主機） | CPU 架構 | 能否直接部署？ | 關鍵原因 |
| --- | --- | --- | --- | --- |
| Ubuntu | CentOS / RHEL | 相同 | ✅ **可以** | 共享相同的 Linux Kernel 系統呼叫 |
| Linux | Windows Server | 相同 | ❌ **不行**（除非開 WSL2 虛擬機） | Kernel API 完全不同（POSIX vs Win32） |
| Linux（`x86_64`） | Linux（`arm64`） | 不同 | ❌ **不行**（除非用 Multi-arch） | CPU 機器指令集不相容 |

## 容器靠 namespace 做隔離，為什麼說這種隔離「不徹底」？業界又是怎麼補強的？

> [!NOTE]
> **簡答**：namespace 只隔離了「**視圖**」，所有容器仍**共用同一個 Linux kernel**，所以 kernel 或運行時的任何一個漏洞，都可能讓攻擊者逃出容器。要接近 VM 等級的隔離，必須在 namespace 之外**疊加其他機制**（gVisor、Kata、Firecracker 等），而不是靠優化 namespace 本身。這個問題在多租戶 K8s、AI agent、GPU 叢集共享等場景下尤其關鍵。

### 🔍 1. 根本原因：隔離的是「視圖」，不是 kernel

namespace 只是把 kernel 的某些資源做成各容器各自看到的版本（PID、網路介面、掛載點等），但所有容器**共用同一個 Linux kernel**。

| | 容器 | VM |
| --- | --- | --- |
| **Kernel** | 與宿主機及其他容器共用 | 每個 VM 有獨立的 guest kernel |
| **隔離邊界** | kernel 的軟體機制 | hypervisor，由硬體虛擬化強制 |
| **攻擊者要碰到其他租戶** | 突破**一個** kernel 漏洞即可能 | 先打穿 guest kernel，再突破 hypervisor |

### 🧨 2. 「不徹底」的具體表現

- **Kernel 漏洞是全域性風險**：漏洞打的是所有容器共用的 kernel 本身，例如 **Dirty Pipe** 這類漏洞，就可能繞過 namespace 隔離逃出容器。
- **運行時本身也是攻擊面**：容器運行時（如 `runc`）的漏洞同樣可能導致逃逸，例如曾出現透過**覆寫宿主機上 `runc` 二進位檔**的逃逸漏洞。這類問題不來自 kernel，但同樣說明容器的隔離邊界比 VM 脆弱。
- **Syscall 攻擊面巨大**：容器能呼叫的 syscall 與宿主機上的原生程式**基本一樣多**。namespace 不負責限縮這件事，那是 `seccomp`、AppArmor 等額外機制的工作。

### 🛡️ 3. 業界如何補強

namespace 的隔離有天生上限，所以做法是**疊加機制，或換架構**：

| 方案 | 做法 | 隔離強度來源 | 主要限制 |
| --- | --- | --- | --- |
| **gVisor（Google）** | 在使用者空間攔截所有 syscall，由 **Sentry**（用 Go 寫的、記憶體安全的模擬核心）處理，縮小暴露給宿主 kernel 的攻擊面 | 攔截層 | 並未實作全部 Linux syscall，相容性不是 100%；依賴特殊 syscall 的應用（如某些 debugger、高效能 I/O 場景）可能無法執行或效能下降 |
| **Kata Containers** | 每個 Pod 跑在一個輕量 **microVM** 裡，有獨立 guest kernel，對 K8s 而言仍是一般容器 | KVM 硬體虛擬化 | 有記憶體開銷與啟動延遲 |
| **Firecracker（AWS）** | 專為 microVM 設計的輕量 VMM，開機約 **100–200ms**，是 AWS Lambda / Fargate 背後的技術 | KVM 硬體虛擬化 | 功能刻意精簡 |

使用 Kata 或 Firecracker 時，攻擊者要逃逸必須先攻破 guest kernel，再突破 hypervisor，**兩層**都要打穿。

- **較輕量的前置手段**：在考慮上述方案前，通常先做 `seccomp`、AppArmor / SELinux、移除不必要的 capabilities、user namespace 與 rootless 容器。這些成本低，能縮小攻擊面，但**不改變「共用 kernel」的本質**。

### 🤖 4. 為什麼對 LLM infra 特別重要

- 🖥️ **多租戶 GPU 叢集**：讓不同團隊或客戶共用同一批 GPU 節點跑推理或訓練時，「共享 kernel」是必須面對的設計決策。
- 🧪 **AI agent 執行不可信程式碼**：讓 LLM agent 執行使用者提供的程式碼，本質上就是執行**不可信 workload**，標準容器的隔離強度不夠，這是 gVisor、Kata 目前很熱門的應用場景。
- ⚖️ **實務限制**：GPU 搭配 gVisor 或 Kata 時，會遇到 GPU 直通、驅動支援與效能損耗等問題，選型時需要一併評估。

### 🎤 5. 面試應答思路

被問到「怎麼做多租戶隔離」時，可以分層回答：

1. **基礎層**：namespace + cgroup，提供資源與視圖隔離。
2. **加固層**：`seccomp`、AppArmor / SELinux、capabilities 限制、rootless。
3. **強隔離層**：面對互相不信任的租戶（adversarial multi-tenancy），考慮 gVisor 或 Kata。
4. **取捨**：說明相容性、效能、成本與 GPU 支援的代價。

這樣能展現對問題層次的理解，而不只是回答 K8s RBAC 這類表層做法。

> [!TIP]
> 💡 **一句話總結**
>
> namespace 本身的隔離有上限，解法不是「原地優化 namespace」，而是在其上**疊加 gVisor / Kata / Firecracker** 這類獨立技術，並依**威脅模型與成本**取捨。
