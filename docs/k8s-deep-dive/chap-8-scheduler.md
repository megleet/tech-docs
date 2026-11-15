---
icon: lucide/calendar-clock
---
# Chap-8 Scheduler

**目錄**

- [資源模型](#資源模型)
- [QoS和eviction](#qos和eviction)
- [Scheduler怎麼選Node](#scheduler怎麼選node)
- [Scheduling framework](#scheduling-framework)
- [Priority和preemption](#priority和preemption)
- [思考題](#思考題)

> [!NOTE]
> 撰寫中：「Scheduler怎麼選Node」只寫了開頭，之後的section還沒寫。

## 資源模型

*Pod要用多少CPU和mem，怎麼告訴Kubernetes？*

### 📦 1. 資源寫在Pod上

[Pod是Kubernetes最小的排程單位](chap-4-container-orchestration-pod.md#-4-為什麼排程單位是pod)，所以***和排程、資源管理有關的欄位，都寫在Pod上***。其中最重要的是**CPU**和**mem**：

<!-- hl: 9 10 11 12 13 14 15 18 19 20 21 22 23 24 -->

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: frontend
spec:
  containers:
  - name: web                 # app
    image: nginx
    resources:
      requests:
        cpu: "250m"
        memory: "64Mi"
      limits:
        cpu: "500m"
        memory: "128Mi"
  - name: log-agent           # 收log的sidecar
    image: fluent/fluent-bit
    resources:
      requests:
        cpu: "50m"
        memory: "32Mi"
      limits:
        cpu: "100m"
        memory: "64Mi"
```

- **resources寫在每個container上**：`resources`在`containers[]`底下，每個container各寫一份。
- **Pod的總量由scheduler算出來**：scheduler看的不是單純的加總，而是：
  - **一般container**：全部加起來，例如上面的Pod，`requests.cpu`是250m + 50m = **300m**，`requests.memory`是64Mi + 32Mi = **96Mi**；
  - **[init container](chap-4-container-orchestration-pod.md#-1-init-container啟動前的準備)**：一個一個依序執行，所以只取**最大的那一個**，再和一般container的總和比，取大的；
  - **[sidecar](chap-4-container-orchestration-pod.md#-2-sidecar和app一起執行)**（`restartPolicy: Always`的init container）：和一般container一起跑，所以***要加進總和***。

<img src="images/ch08/pod-requests-formula.svg" alt="Pod的requests（scheduler用的值）= max(Σ一般container + Σsidecar, 最大的init container)。一般container和sidecar一起跑，全部加起來；init container依序跑，一次只跑一個，所以只取最大的。例子：log-agent改寫成sidecar，再加一個要400m的init container，400m = max(web的250m + log-agent的50m, init container的400m)" width="100%">

**resources也可以寫在Pod這一層**：在`spec.resources`寫整個Pod的額度，由Pod裡所有container共用，不用逐一分配。這是**Pod-level resources**，只支援CPU、mem和hugepages：

```yaml
spec:
  resources:              # 整個Pod共用
    requests:
      cpu: "500m"
      memory: "128Mi"
    limits:
      cpu: "1"
      memory: "256Mi"
  containers:
  - name: web
    image: nginx
  - name: log-agent
    image: fluent/fluent-bit
```

### 🧮 2. CPU和mem的單位

#### 🖥️ CPU：以「CPU的個數」為單位

- **`1`是1個CPU**：等於1個vCPU，或physical core上的1個hyperthread，看Node的硬體決定。
- **可以寫小數**：`500m`就是500 millicpu，也就是**0.5個CPU**。最小單位是`1m`。
- ***寫`500m`，不要寫`0.5`***：兩者完全一樣，API Server會把`0.5`統一存成`500m`，`kubectl get`看到的也是`500m`。

#### 💾 mem：以bytes為單位

有兩組單位：

| 寫法                                     | 進位     | 例子                                                                                |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| **`Ki`、`Mi`、`Gi`、`Ti`** | 2的次方  | `1Mi` = 1024 × 1024 = 1,048,576 bytes；上面例子的`64Mi`就是2²⁶ bytes         |
| **`K`、`M`、`G`、`T`**     | 10的次方 | `1M` = 1000 × 1000 = 1,000,000 bytes，比`1Mi`少大約5%；`1G`比`1Gi`少大約7% |

- **統一用`Mi`、`Gi`**：和`free`、`top`這些工具看到的數字一致。
- **YAML裡不寫`B`**：寫`64Mi`，不是`64MiB`，後者會被API Server拒絕。
- **mem不要寫小寫`m`**：`m`的意思是「千分之一」，和CPU的`500m`一樣。所以`memory: 128m`是128 × 0.001 = ***0.128 bytes***，不是128MiB；mem請寫`128Mi`。

### 🗜️ 3. 可壓縮和不可壓縮資源

Kubernetes用`requests`和`limits`管理的資源有三種：**CPU**、**mem**，以及**`ephemeral-storage`**（Pod在Node disk上用的空間）。scheduler排程時三者都會檢查，但用到上限時，結果完全不同：

| 資源                        | 類型                                 | 用到上限時                                                                                                                                               |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU**               | **compressible**（可壓縮）     | kernel限制它能用的CPU時間（**throttling**），container只會**變慢，不會被殺掉**                                                               |
| **mem**               | **incompressible**（不可壓縮） | kernel的**OOM killer**殺掉container裡的process；kubelet再依`restartPolicy`重啟container，`kubectl get pod`會看到`OOMKilled`和restart次數增加 |
| **ephemeral-storage** | **incompressible**             | Node的disk空間，例如[emptyDir、log、container的writable layer](chap-9-volume.md#storage的分類)；用量超過limit時，Pod會被**evict**                   |

- **被殺的是container，不是Pod**：mem超過limit時，OOM kill的是container裡的process，Pod還在，container會被重啟。
- **Node的mem不夠是另一回事**：scheduler只看`requests`，所以一台Node上所有Pod的`limits`加起來可以超過Node的mem（見[overcommit](#-4-requests和limits)）。例如4Gi的Node上有4個Pod，每個`requests`是1Gi、`limits`是2Gi；每個Pod都用1.5Gi，***沒超過自己的limit***，但加起來**6Gi**，Node的mem不夠了。這時kubelet會主動**evict** Pod，見[QoS和eviction](#qos和eviction)。

### ⚖️ 4. requests和limits

#### 🎯 requests和limits的差別

每種資源都分成`requests`和`limits`：

- **`requests`**：保證能從scheduler拿到的量。
  - **scheduler只看`requests`**：決定Pod能不能放進一台Node。它***不看`limits`，也不看實際用量***。
  - **CPU緊張時依比例分配**：`requests.cpu`會寫進cgroup。
  - **mem緊張時evict**：Node的mem不夠時，用量超過`requests`越多的Pod，越先被evict。
- **`limits`**：不能超過的上限。寫進cgroup。
  - CPU用到上限會被throttle，mem超過上限會被OOM kill。

#### 🗂️ 對應到cgroup的檔案

這些值最後都變成cgroup v2的檔案，原理見[Chap-1的cgroups](chap-1-container-namespace-cgroups.md#-3-實際建立一個cgroup)：

| 欄位                                                  | cgroup v2的檔案 | 效果                                                              |
| ----------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `requests.cpu`                                      | `cpu.weight`  | CPU不夠用時，各container依這個比例分配                            |
| `limits.cpu`                                        | `cpu.max`     | `500m`寫成`50000 100000`：每100ms最多用50ms                   |
| `requests.memory`                                   | 不寫進cgroup    | 只給scheduler和eviction用                                         |
| `limits.memory`                                     | `memory.max`  | `128Mi`寫成`134217728`，超過就OOM kill                        |
| `requests.cpu`（[Guaranteed](#-1-guaranteed)、整數） | `cpuset.cpus` | static CPU manager policy時才有：只能在這幾個核上跑，不和別人共用 |

> [!TIP]
> 💡 **共享和綁核**
>
> 限制container用CPU有兩種方式：一種是**共享**，container不固定在哪個核，和別人一起用所有的核，CPU不夠時照`cpu.weight`的比例分配；另一種是**綁核**，用cgroup的`cpuset.cpus`指定container***只能在哪幾個核上跑***，這幾個核不和別人共用。在Kubernetes裡，綁核由kubelet的CPU Manager處理，不用自己設`cpuset`。

#### 🧮 實際寫進cgroup的值怎麼算

- **`limits.cpu` → `cpu.max`**：這個檔案裡有兩個數字，用空格隔開，例如`50000 100000`，單位都是微秒（µs）：
  - **週期（第二個數字）**：多久重新計算一次，kubelet default設成100000µs（100ms），一般不會改；
  - **配額（第一個數字）**：每個週期內，最多能用多少CPU時間：
    - **配額 = `limits.cpu` × 週期**：`500m`是0.5 × 100000 = 50000，寫成`50000 100000`，每100ms最多用50ms，也就是***半個CPU***；`2`寫成`200000 100000`，每100ms可以用200ms，因為同時跑在2個CPU上。

<img src="images/ch08/cpu-max-quota.svg" alt="cpu.max的配額和週期。limits.cpu: 500m寫成cpu.max 50000 100000：每個100ms的週期裡，前50ms（配額）可以跑，後50ms被throttled，等下一個週期，0到300ms重複三次。limits.cpu: 2寫成cpu.max 200000 100000：每個週期裡CPU 1和CPU 2各跑100ms，2個CPU × 100ms = 配額200ms，可以一直跑" width="100%">

其他幾個值比較單純：

- **`limits.memory` → `memory.max`**：直接換算成bytes。`128Mi`是128 × 1024 × 1024 = `134217728`。
- **`requests.memory`**：不寫進cgroup，只給scheduler和eviction用。
- **`requests.cpu` → `cpu.weight`**：`cpu.weight`是***搶CPU時的分配比例***，只在CPU不夠用時才有作用。
  - **例子**：Node只有1個CPU，A、B兩個container都想用滿。A的`cpu.weight`是100、B是300，就照100：300分配，A拿到25%、B拿到75%；B閒著時，A可以用滿100%。
  - **和`cpu.max`的差別**：`cpu.max`是硬上限，CPU閒著也不能超過；`cpu.weight`平常不限制任何人，只決定搶CPU時誰拿得多。
  - **為什麼分兩步**：Kubernetes最早是照cgroup v1設計的，v1用`cpu.shares`表示權重，約定**1個CPU = 1024 shares**，所以kubelet到現在還是先算出**shares** = millicpu × 1024 ÷ 1000，例如`250m` → 256；cgroup v2改用`cpu.weight`，範圍變成1～10000、default 100，所以container runtime（例如runc）再把shares換算成`cpu.weight`，過程見下圖。

<img src="images/ch08/cpu-weight-conversion.svg" alt="requests.cpu換算成cpu.weight的過程：寫在Pod YAML的requests.cpu，① kubelet乘以1024再除以1000，得到shares（cgroup v1的約定：1 CPU = 1024）；② runc做非線性換算，得到cgroup v2的cpu.weight（範圍1～10000）。例子：沒寫 → 最小值2 → 1，最低，幾乎搶不到CPU；250m → 256 → 35；500m → 512 → 59，比250m多，但不到2倍；1 → 1024 → 100，等於default，和系統service一樣" width="100%">

換算的目標是讓**`requests.cpu: 1`剛好等於`cpu.weight`的default 100**，和Node上不歸Kubernetes管的process（例如systemd的service）一樣重。換算不是線性的，所以`250m`和`500m`大約是35：59，不是剛好1：2。

> [!NOTE]
> runc 1.3.2、crun 1.23以後，換算的非線性公式如下：
>
> $$
> \text{cpu.weight} = \left\lceil 10^{\frac{L^2}{612} + \frac{125L}{612} - \frac{7}{34}} \right\rceil, \quad L = \log_2(\text{shares})
> $$

#### ✏️ 沒寫requests或limits時

- **只寫`limits`**：`requests`自動補成和`limits`一樣。
- **兩個都不寫**：CPU的權重是***最低值***，CPU一緊張，這個container最先被擠掉。

#### 🚫 requests > limits：不允許

`limits`不能小於`requests`，例如`requests.cpu`是500m、`limits.cpu`是250m，API Server會***直接拒絕這個Pod***。

#### 📈 requests < limits：overcommit

`requests`可以比`limits`小，例如上面的`web`，`requests.cpu`是250m、`limits.cpu`是500m。scheduler只用`requests`計算，所以一台4個CPU的Node，可以放下16個這樣的container，即使它們的`limits`加起來是8個CPU。這叫**overcommit**：平常大家用不滿，Node的使用率比較高。

代價是大家***同時用到接近`limits`***時，Node的資源就不夠：

- **CPU**：互相搶，有starvation，大家都變慢。
- **mem**：Node的mem被用完，kubelet開始evict Pod，或kernel直接OOM kill。`requests`和`limits`差得越多，越容易被選中。

> [!NOTE]
> **實務上怎麼設**
>
> - **mem**：`requests`和`limits`設成**一樣**，避免Node的mem被超賣，最後被OOM kill或evict。
> - **CPU**：一定要設`requests`。`limits`可以不設，或設大一點：CPU超過只會變慢、不會被殺掉，不設limit反而能用到Node閒置的CPU。

> [!TIP]
> 💡 **一句話總結**
>
> ***`requests`給scheduler看，`limits`給cgroup用***。CPU是可壓縮資源，超過只會變慢；mem是不可壓縮資源，超過就OOM kill。

## QoS和eviction

*Node的資源不夠時，Kubernetes先犧牲誰？*

`requests`和`limits`怎麼設，決定了Pod的**QoS（Quality of Service）等級**。QoS的***主要用途是eviction***：Node的資源緊張、kubelet要回收資源時，依這個等級決定先犧牲哪些Pod，見[Node資源不夠時](#-4-node資源不夠時eviction和oom)。等級由Kubernetes自動算出來，寫在Pod的`status.qosClass`，不是在`spec`裡自己填的。

<img src="images/ch08/qos-classes.svg" alt="三種QoS等級，Node資源不夠時evict、OOM kill的順序由後到先是Guaranteed、Burstable、BestEffort。Guaranteed：每個container的CPU和mem requests = limits，oom_score_adj是-997，保證拿得到，最後才被動到。Burstable：不是Guaranteed，但至少設了一個requests或limits，requests比limits小，可以burst，oom_score_adj是2～999，大多數Pod都在這一級。BestEffort：所有container都沒設requests和limits，requests當成0、沒有上限，oom_score_adj是1000，沒有任何保證，最先被犧牲" width="100%">

三種QoS各適合什麼app：

<img src="images/ch08/qos-use-cases.svg" alt="三種QoS適合的app。Guaranteed（穩定第一：掛掉代價很大）：DB例如CockroachDB、PostgreSQL，etcd、Kafka，對latency敏感的API例如付款；寫法是requests和limits相同，例如cpu: 2、memory: 8Gi。Burstable（平常用一點，偶爾衝高）：web server、一般的API、啟動時CPU用很多的Java app；寫法例如requests cpu: 250m、memory: 512Mi，limits只寫memory: 512Mi。BestEffort（可以重跑、不急：隨時能被犧牲）：batch job例如每日報表、清log，dev／test環境的Pod，臨時debug用的Pod；沒有resources，production少見，因為LimitRange會補上default" width="100%">

### 🛡️ 1. Guaranteed

**條件**：Pod裡***每一個container***（包括init container）的CPU和mem，都設了`requests`和`limits`，而且**兩者相等**。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-guaranteed
spec:
  containers:
  - name: nginx
    image: nginx
    resources:
      limits:
        memory: "200Mi"
        cpu: "700m"
      requests:
        memory: "200Mi"
        cpu: "700m"
```

建立後確認它的QoS等級：

```bash
kubectl get pod qos-guaranteed -o jsonpath='{.status.qosClass}'
# → Guaranteed
```

- **CPU和mem都要符合**：只有mem相等、CPU沒設，就不算Guaranteed。
- **最後才被evict**：Node的mem不夠時，kubelet***最後才會動Guaranteed的Pod***。
- **可以獨佔CPU**：kubelet開了static CPU manager policy、而且`requests.cpu`是整數（例如`2`）時，這個container會被綁在固定的CPU核心上（kubelet寫進cgroup的[`cpuset.cpus`](#-對應到cgroup的檔案)），不和別人共用，適合延遲敏感的應用。
- **只寫`limits`也算**：`requests`會自動補成和`limits`一樣，所以下面這樣寫也是Guaranteed：

  ```yaml
  resources:
    limits:          # 沒寫requests，自動補成一樣的值
      memory: "200Mi"
      cpu: "700m"
  ```

### 🎈 2. Burstable

**條件**：不符合Guaranteed，但***至少有一個container設了`requests`或`limits`***（CPU或mem都算）。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-burstable
spec:
  containers:
  - name: nginx
    image: nginx
    resources:
      limits:
        memory: "200Mi"
      requests:
        memory: "100Mi"
```

- **可以「burst」**：平常保證有100Mi，Node有空閒時可以用到200Mi，這就是[overcommit](#-4-requests和limits)。
- **大多數Pod都在這一級**：只設`requests`、或`requests`比`limits`小，都屬於Burstable。**最常見的寫法：只寫`requests`**：例如CPU只設`requests: {cpu: "250m"}`、不設`limits`，也是Burstable，這正是[實務上建議](#-4-requests和limits)的CPU設定。

### 🪶 3. BestEffort

**條件**：Pod裡***所有container都沒設`requests`和`limits`***。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-besteffort
spec:
  containers:
  - name: nginx
    image: nginx
```

- **沒有任何保證**：scheduler當它的`requests`是0，放到哪台Node都行；CPU的權重是最低值。
- **最先被犧牲**：Node的資源一緊張，***BestEffort的Pod最先被evict***。

### 🚨 4. Node資源不夠時：eviction和OOM

Node的mem或disk快用完時，有三道防線：① kubelet主動evict Pod，順序大致照QoS；② mem真的用完、kubelet來不及反應時，kernel的OOM killer直接殺process（只有mem）；③ Node[暫時不接新的Pod](#③-node有pressure時新的pod排不上來)。

#### ① kubelet主動evict Pod

Node的available mem低於一定值（例如`memory.available<100Mi`）時，kubelet挑Pod刪掉。挑選的順序是：

- **先看用量有沒有超過`requests`**：
- **再看[Priority](#priority和preemption)**：優先度低的先；
- **最後看超過`requests`多少**：超過越多越先。

<img src="images/ch08/evict-order.svg" alt="kubelet挑Pod evict的順序，以Node上5個Pod的mem為例。Pod A（BestEffort）requests 0、用量400Mi、超過400Mi、priority 0；Pod B（Burstable）requests 256Mi、用量512Mi、超過256Mi、priority 0；Pod C（Burstable）requests 256Mi、用量400Mi、超過144Mi、priority 1000；Pod D（Burstable）requests 512Mi、用量300Mi、沒超過、priority 0；Pod E（Guaranteed）requests 1Gi、用量800Mi、沒超過、priority 1000。① 先看用量有沒有超過requests，超過的先被evict：A、B、C一組，D、E一組。② 同一組裡priority低的先被evict：A、B在C前面，D在E前面。③ 超過requests越多越先被evict：A在B前面。結果是A、B、C、D、E，大致是BestEffort → Burstable → Guaranteed" width="100%">

結果就是***BestEffort最先、Burstable其次、Guaranteed最後***。

#### ② kernel的OOM killer

kubelet來不及反應、mem已經真的用完時，kernel直接殺process。kubelet事先依QoS替每個container設好`oom_score_adj`，數字越大越先被殺：

| QoS                  | `oom_score_adj`                               | 被OOM kill的順序 |
| -------------------- | ----------------------------------------------- | ---------------- |
| **BestEffort** | `1000`                                        | 最先             |
| **Burstable**  | 介於`2`到`999`，`requests.memory`越小越大 | 其次             |
| **Guaranteed** | `-997`                                        | 最後             |

#### 🔍 實際看看

把上面三個Pod都建起來，一次列出它們的QoS等級，再看container裡PID 1的`oom_score_adj`：

```bash
kubectl get pod -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass
kubectl exec qos-guaranteed -- cat /proc/1/oom_score_adj
kubectl exec qos-burstable -- cat /proc/1/oom_score_adj
kubectl exec qos-besteffort -- cat /proc/1/oom_score_adj
```

```
NAME             QOS
qos-guaranteed   Guaranteed
qos-burstable    Burstable
qos-besteffort   BestEffort

-997
988
1000
```

- **Burstable的988怎麼來的**：1000 − 1000 × `requests.memory` ÷ Node的mem。這台Node有大約7.65Gi，`qos-burstable`的`requests.memory`是100Mi，算出來大約是988。`requests.memory`越大，數字越小，越晚被OOM kill。

#### ③ Node有pressure時：新的Pod排不上來

除了evict已經在跑的Pod，kubelet還會讓這台Node***暫時不接新的Pod***：

1. kubelet發現mem或disk快不夠，把Node的condition設成`MemoryPressure`或`DiskPressure`。
2. control plane依這個condition替Node加上**taint**（Node上的標記，意思是「沒有對應**toleration**的Pod不要排過來」）：`node.kubernetes.io/memory-pressure:NoSchedule`或`node.kubernetes.io/disk-pressure:NoSchedule`。
3. scheduler看到taint，Pod沒有對應的toleration就不排到這台Node。

兩種pressure擋下的Pod不一樣：

| Node的condition          | 被擋下的新Pod                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **DiskPressure**   | 所有新Pod，除了有toleration的                                                                     |
| **MemoryPressure** | **只有BestEffort的Pod**。Guaranteed和Burstable的Pod會被自動加上這個toleration，還是排得上去 |

**DaemonSet的Pod不受影響**：DaemonSet controller會自動替它的Pod加上`memory-pressure`、`disk-pressure`、`pid-pressure`等toleration，所以每台Node上的agent照樣排得上去。

> [!NOTE]
> **DaemonSet的Pod要設好`requests.memory`**
>
> DaemonSet的Pod被evict之後，DaemonSet controller會馬上***在同一台Node上重建***它，等於白回收了，所以要讓它不容易被evict。**DaemonSet跑的多半是Node本身需要的agent，例如CNI、log收集、監控。少了它們，這台Node可能連網路都不通**。依照[kubelet挑Pod的順序](#①-kubelet主動evict-pod)，有效的做法是：
>
> - **`requests.memory`設成接近實際用量**：最好等於`limits.memory`，用量就不會超過`requests`；
> - **設高的PriorityClass**：Node上不可少的agent（例如CNI、log agent）用`system-node-critical`。
>
> 不一定要設成Guaranteed：Guaranteed還要求CPU的`requests`等於`limits`，CPU有limit就會被throttle，agent可能因此變慢。CPU和eviction無關，**不用為了eviction限制CPU**。

> [!TIP]
> 💡 **一句話總結**
>
> ***QoS等級由`requests`和`limits`自動決定***：兩者相等是Guaranteed，有設一部分是Burstable，都沒設是BestEffort。Node資源不夠時，BestEffort最先被犧牲，Guaranteed最後。

## Scheduler怎麼選Node

### 🧭 1. Scheduler是什麼

**default scheduler**（`kube-scheduler`）只做一件事：***替每一個還沒有Node的Pod選一台Node***。

<img src="images/ch08/scheduler-matching.svg" alt="scheduler替Pod配Node。左邊是還沒有Node的Pod：web-1、api-2、db-0，各用一種顏色。三條線匯進中間的default scheduler（配對：Pod → Node），再分出去到cluster裡的Node：api-2配到node-a，web-1配到node-b，db-0配到node-c。結果寫進每個Pod的spec.nodeName（binding）" width="70%">

- **哪些Pod要排**：Pod的`spec.nodeName`是空的，而且`spec.schedulerName`沒寫，或者填了`default-scheduler`。
- **什麼是binding**：scheduler把Pod的`spec.nodeName`填上選好的Node，就算**調度成功**。***注意：真正啟動container的是那台Node上的kubelet。***
- **哪些Pod不需要scheduler**：自己寫了`spec.nodeName`的Pod（見[Chap-4](chap-4-container-orchestration-pod.md#-2-排程nodeselector和nodenamepod-level)），以及kubelet從Node上的檔案直接啟動的**static Pod**。

一個Pod從建立到container啟動，會經過下面這些判斷：

<img src="images/ch08/who-schedules.svg" alt="一個Pod怎麼走到Node上。新的Pod還沒有Node，先判斷spec.nodeName是不是空的：不是空的（① 自己寫了spec.nodeName）就直接到API server，不經過default scheduler；是空的再判斷schedulerName是不是空的或default：不是（② 填了別的名字）就交給其他scheduler；是的話由default scheduler選一台Node，binding寫入spec.nodeName＝node-a，調度成功，寫回API server（背後是etcd）。node-a上的kubelet watch到之後，透過CRI啟動container；真正啟動container的是kubelet。③ static Pod是Node上的yaml檔，kubelet直接啟動，不經過API server和default scheduler。實線是經過default scheduler的路徑，虛線是不經過default scheduler的Pod" width="100%">

### 🔀 2. Scheduler原理：Informer Path和Scheduling Path

#### 🎛️ Scheduler是特殊的controller

**scheduler可以看成一種特殊的controller**：用[Informer](chap-5-container-orchestration-controller.md#-5-控制循環實際怎麼跑) watch Pod和Node，在自己的cache裡存一份，***只在有變化時才做事***。和一般controller不同的是，它只做binding，並不會create/delete object。

**scheduler核心的問題是「SELECT 」**：scheduler要同時考慮資源夠不夠、[taint](#③-node有pressure時新的pod排不上來)、affinity、分散到不同zone等條件，**比較很多台Node才選得出一台**。

> [!TIP]
> 💡 **一句話總結**
>
> ***scheduler是一個專門做「Pod配Node」的controller***：watch還沒有Node的Pod，選一台Node寫進`spec.nodeName`，剩下的交給kubelet。

#### 🛤️ Informer Path和Scheduling Path

scheduler裡有***兩個各自獨立的控制循環***：**Informer Path**負責收資料，**Scheduling Path**負責選Node。兩者***不直接呼叫對方***，*只透過**scheduling queue**和**Scheduler Cache**交接*：

<img src="images/ch08/scheduler-paths.svg" alt="scheduler的兩條path。Informer Path：Informer watch API server（背後是etcd），Enqueue把還沒有Node的Pod放進scheduling queue（activeQ、backoffQ、unschedulable），Update cache把Node和已排好的Pod更新到Scheduler Cache。Scheduling Path分成兩段：Scheduling cycle一次排一個Pod，從queue Pop一個Pod，用cache裡的Node資訊做Filter、Score，再assume，先把結果記進cache；Binding cycle做Bind（async），在背景把nodeName寫回API server，同時排下一個Pod" width="100%">

- **Informer Path**：**負責「看」**，watch API server，把變化放進兩個地方：
  - **Enqueue**：還沒有Node的Pod，放進scheduling queue<span class="analogy">比喻：還單身的Pod，排隊等配對</span>；
  - **Update cache**：Node和已經排好的Pod，更新到Scheduler Cache<span class="analogy">比喻：記下哪些Pod已結婚、嫁到哪台Node，以及每台Node還能再配幾個</span>。
- **Scheduling Path**：**負責「決策」**，從queue一次Pop一個Pod，用cache裡的Node資訊做Filter(初選，進入比賽)、Score（決賽，選出winner），選好Node。
  - **Filter**：***選出所有放得下這個Pod的Node***。<span class="analogy">比喻：像餐廳帶位，先排除坐不下的桌子</span>；
  - **Score**：替filter出的Nodes算score，***選出score最高的一台node***。<span class="analogy">比喻：再從坐得下的桌子裡挑最好的，例如靠窗</span>；
  - **assume**：***先在cache裡記下選好的node***。Assume是**基于“乐观”假设的API对象更新方式**，有助於scheduler的**無鎖化設計**。<span class="analogy">比喻：先在訂位表上把這張桌子劃掉，下一組客人就不會被帶到這裡</span>；
  - **Bind（相對於主迴圈async）**：***在另一個goroutine裡把`nodeName`寫回API server***，主迴圈不等它，直接進入下一個loop，排下一個Pod。 <span class="analogy">比喻：請服務生去擺餐具，帶位的人不等，直接招呼下一組客人</span>。

> [!NOTE]
> 👥 **並行處理**
>
> 排一個Pod時，scheduler會用多個goroutine（default 16個，由`parallelism`設定）並行地對Node跑Filter，找出可以放這個Pod的Node。*大cluster裡不一定會檢查所有Node*：找到夠多可以用的Node（由`percentageOfNodesToScore`決定，至少100個）就停下來，接著進入Score<span class="analogy">比喻：16個服務生分頭找空桌，找到夠多就停，再挑最好的</span>。

#### 🗃️ scheduling queue裡的三個queue

| Queue                   | 放什麼                                                                                                               | 什麼時候離開                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **activeQ**       | **馬上可以排的Pod**，依priority排序                                                                            | scheduler每次從這裡Pop一個Pod                     |
| **backoffQ**      | **等一段時間就可以retry的Pod**：不是Node不夠，而是過程中出錯，例如呼叫API server失敗、Bind失敗、plugin內部錯誤 | backoff時間到（1秒起加倍，最多10秒），回到activeQ |
| **unschedulable** | **要等cluster變化才值得retry的Pod**：Filter之後沒有任何Node放得下，preemption也救不了                          | cluster有相關變化時移出；最多待5分鐘              |

**三個queue**解決同一個問題：***不讓排失敗的Pod馬上重試，浪費scheduler的時間***。

#### ⚡ Scheduler為什麼快

scheduler的效能設計有三個，目標都一樣：***讓Scheduling Path保持non-blocking***。

| 設計                 | 解決什麼                                  | 怎麼做                                                                                       |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| **cache化**    | 不用每次都向API server要資料              | Informer把Node和Pod存進Scheduler Cache，Filter和Score讀cache                                 |
| **樂觀assume** | 不用等Bind寫回API server，就能排下一個Pod | 選好Node先記進cache，Bind在另一個goroutine做（見[樂觀assume和async Bind](#-樂觀assume和async-bind)） |
| **無鎖化**     | 並行計算Filter、Score時，不用等lock       | 每個scheduling cycle開始時，把cache更新到snapshot，goroutine只讀不寫，也不共用會互相搶的資源 |

無鎖化的原則是***盡量避免設置全局競爭資源***，*就是多個goroutine會同時搶著用的共享資料*。*無鎖化不是完全沒有lock*：存取scheduling queue和Scheduler Cache時還是要加lock，只是這些動作很短，而且不在Filter、Score的計算路徑上。Scheduling Path只有三個地方加lock：

- **Pop Pod from queue**：從scheduling queue Pop一個Pod，這一輪scheduling cycle就是替它找Node；
- **Update snapshot**：每個scheduling cycle開始時，把Scheduler Cache最新的狀態更新到snapshot；
- **Assume back to cache**：assume時寫回Scheduler Cache。

> [!NOTE]
> 📸 **snapshot**
>
> **snapshot是Scheduler Cache的一份副本**，整個scheduler只有一份。每個scheduling cycle開始時，*在上一輪的snapshot上，只更新有變化的Node*。Filter、Score讀的都是這份snapshot，計算過程完全不用lock，所以能用多個goroutine並行地檢查很多台Node。

### 🗂️ 3. Scheduler的「cache狀態管理」和「樂觀assume」

前面說scheduler選好Node就先**assume**，不等API server確認。那Scheduler Cache怎麼分得出哪些是假設、哪些已經確認？核心規則是：***assumed只是暫時的，收到API server的真實事件，就以事件為準***。

#### 🗄️ Cache裡記了什麼

- **`nodes`**：每台Node一份NodeInfo，記著已用資源和Pod清單。Filter和Score讀的就是它的snapshot；
- **`podStates`**：用Pod key查到Pod object；
- **`assumedPods`**：一個set，***只放assumed的Pod key***。Pod在這裡面，就代表「這是scheduler自己的假設，API server還沒確認」。

<img src="images/ch08/scheduler-cache-data.svg" alt="Scheduler Cache只在scheduler的mem裡，有三份資料。nodes：每台Node一張NodeInfo，node-a上有web-1、db-0和虛線的log-4（assumed），node-b上有api-2和虛線的web-3（assumed），assumed Pod的資源已經扣掉；Filter、Score讀的是這份資料的snapshot。podStates：Pod key對應Pod object，log-4和web-3那兩列是虛線。assumedPods：一個set，只放log-4和web-3，代表API server還沒確認。虛線把三處的assumed Pod連起來" width="100%">

圖裡的`log-4`和`web-3`剛被assume：資源已經分別算進node-a和node-b，`podStates`有它們的Pod object，key也在`assumedPods`裡。其他3個Pod已經確認，不在`assumedPods`裡。

#### 🔄 Pod在cache裡的狀態

<img src="images/ch08/scheduler-cache-states.svg" alt="Pod在Scheduler Cache裡的狀態。Initial（cache裡還沒有）經過① AssumePod（選好Node）變成虛線的Assumed（scheduler的假設）；Assumed經過② AddPod（Informer收到Add事件，nodeName不同時改記到實際的Node）變成Added（API server確認了）；Assumed經過③ ForgetPod（Bind失敗）變成Removed；Added經過④ RemovePod（Delete事件）變成Removed，資源還給Node" width="100%">

| 事件 | cache的動作 |
| --- | --- |
| **① 選好Node** | **AssumePod**：把Pod加進那台Node的NodeInfo（資源馬上扣掉），放進`assumedPods` |
| **② Informer收到Add事件** | **AddPod**：確認假設，移出`assumedPods`。`nodeName`和假設的不同時（例如另一個scheduler搶先綁了），以API server為準，改記到實際的Node |
| **③ Bind失敗** | **ForgetPod**：從NodeInfo拿掉、移出`assumedPods`，Pod回到queue重排 |
| **④ Pod被刪除** | **RemovePod**：從cache移除，資源還給Node |

只有Assumed是假設。它***不會過期***，只會被② 確認，或被③ 撤銷。

#### ⏩ 樂觀assume和async Bind

⏩ **Bind相對於主迴圈是async，本身是sync等待**

選好Node之後，scheduler已經先**assume**：在自己的cache裡把這個Pod算進那台Node的資源。接下來，Bind要把`nodeName`寫回API server，**是整個流程裡最慢的一步**。所以***Bind相對於scheduler主迴圈是async，本身是sync等待***：*scheduler替每個Pod開一個goroutine，依序跑WaitOnPermit → PreBind → Bind → PostBind*，Bind在goroutine裡一直等到API server回應。主迴圈***不等這個goroutine***，直接從activeQ Pop下一個Pod。

<img src="images/ch08/binding-goroutine-wait.svg" alt="主迴圈和binding goroutine。左邊scheduling cycle：主迴圈從activeQ Pop一個Pod，跑Filter、Score、assume，再回到Pop，不等Bind回應，一直轉；裡面紫、玫紅、黃3個圈表示轉了3圈。右邊binding cycle：每圈assume完就開一個goroutine，web-1、api-2、db-0各自對API server發POST binding，sync等回應。web-1和db-0成功，等Informer確認；api-2收到409 Conflict失敗，ForgetPod後回backoffQ" width="100%">

<img src="images/ch08/binding-goroutine-timeline.svg" alt="同一件事用時間軸看。上排主迴圈，每格是一個scheduling cycle：web-1、api-2、db-0、log-4一格接一格跑Filter、Score、assume，中間沒有空檔，主迴圈不等goroutine。下面每排是一個binding goroutine，跑一個binding cycle：每個Pod assume完就分出一個goroutine，先Bind，再等API server回應，幾個goroutine的等待時間互相重疊。web-1成功，等Informer確認；api-2失敗（409），ForgetPod後回backoffQ；db-0成功" width="100%">

Bind的結果有兩種：

- **① Bind失敗**：***binding cycle負責收拾***，*撤銷預留（**Unreserve**）、把assume從cache拿掉（**ForgetPod**），再把Pod放回queue（**backoffQ**）*。它不會重試Bind，Pod之後從scheduling cycle重新排，可能選到別的Node。
- **② Bind成功**：***binding cycle負責收尾***，跑完PostBind就結束。Informer收到這個Pod已經有`nodeName`的事件，cache裡的assume就被確認，變成正式的記錄。

#### 🏷️ 為什麼要標記assumed Pod

Scheduler Cache用`assumedPods`把assumed的Pod標記出來，***分得出、撤得回***，所以才敢先扣資源：

- **可以放心先扣資源**：因為之後撤得回，assumed Pod可以馬上算進NodeInfo，下一個Pod就不會拿到同一份資源；
- **分清「假設」和「已確認」**：Add事件來的時候，用這個標記決定是確認還是新增，避免資源被算兩次；
- **失敗時精準rollback**：只有assumed的Pod能被forget，已確認的Pod不會被誤刪。

### 🧩 4. 多個scheduler：什麼時候不用default

上面講的都是default scheduler（`kube-scheduler`）的實作。下面看什麼時候需要換成其他scheduler。

***大部分情況用default scheduler就夠了***。真的需要時，在Pod寫`spec.schedulerName: <名字>`，default scheduler就會跳過它，交給那個scheduler排。

#### 🤔 什麼時候才需要其他scheduler

| 情況                                                         | 為什麼default不夠                                                                                           | 常見的選擇                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **AI訓練、MPI這類一組Pod要一起跑**                     | default一次排一個Pod，可能只排上一半，另一半排不上，已經排上的那一半就白白占著資源（gang scheduling的問題） | Volcano、KAI Scheduler、scheduler-plugins的coscheduling |
| **很多團隊共用一個GPU或batch cluster，要分配額、排隊** | default沒有「團隊配額」和「job排隊」的概念                                                                  | Kueue（搭配default scheduler）、YuniKorn、Volcano       |
| **線上服務和batch混合部署，要依實際負載排**            | default只看`requests`，不看實際用量                                                                       | Koordinator、scheduler-plugins的Trimaran                |

#### 🪜 建議的順序

1. 先用default scheduler，再加上affinity、taint、spread這些設定；
2. 需要配額或排隊時，加**Kueue**，scheduler還是用default；
3. 真的需要gang scheduling或GPU的特殊排法，才換成Volcano或KAI這類scheduler。

*換scheduler的代價不小*：要多維護一個元件，兩個scheduler同時運作時也可能互搶資源。所以沒有明確的需求，就不要換。

## Scheduling framework

***和[CRI、CNI、CSI](chap-3-kubernetes-architecture-operations.md#-1-kubelet與各個interface)一樣，scheduler也有定義好的擴充介面***，就是**Scheduling Framework**：scheduler的每一步，從Enqueue、Filter、Score到Bind，都是可以**掛plugin的extension point**。*差別是CRI、CNI、CSI呼叫的是另一個獨立的程式（透過gRPC或執行檔），scheduler的plugin則是用Go寫，**和scheduler compile成同一個執行檔**，所以不走網路、速度快，但新增plugin要重新build scheduler*。

下面是schedule一個Pod的完整流程。每個箭形都是一個extension point（scheduler內建的一些功能本身也都是plugin）：

<img src="images/ch08/scheduling-framework.svg" alt="Scheduling Framework的extension point，每個都是可以插plugin的箭形。scheduling queue（排隊）：PreEnqueue決定Pod能不能進activeQ，QueueSort決定誰先排，內建例子PrioritySort。Scheduling cycle（一次一個Pod，依序跑）：過濾階段PreFilter先算好、先檢查，Filter刪掉放不下的Node，虛線的PostFilter只在沒有Node放得下時才跑（preemption），內建例子NodeResourcesFit、TaintToleration；打分階段PreScore先算好打分要用的資料，Score替每台Node打分，NormalizeScore把分數縮放到0～100，內建例子ImageLocality；保留階段Reserve預留資源（assume），Permit放行、拒絕或等待（拒絕就回queue），內建例子VolumeBinding。Binding cycle（相對於主迴圈async）：PreBind是Bind前的準備，Bind把nodeName寫回API server，PostBind是成功後的清理，內建例子DefaultBinder。plugin怎麼插進去：用app.WithPlugin(myplugin.Name, myplugin.New)，和scheduler compile成同一個執行檔" width="100%">

## Priority和preemption

## 思考題

??? question "1. 要怎麼知道container的`requests.cpu`設多少才夠用？"

    答案稍後補上。

??? question "2. eviction後，是不是scheduler需要繼續look for最合適的node來schedule這個pod？"

    答案稍後補上。

??? question "3. 什麼情況下，要把container綁在固定的CPU核上（`cpuset.cpus`），而不是和別人共享（`cpu.weight`）？在Kubernetes裡要怎麼做到？"

    答案稍後補上。

??? question "4. scheduler的assume和Bind都沒有加lock。如果兩個scheduler同時把同一個Pod綁到不同的Node，會發生什麼事？"

    答案稍後補上。

??? question "5. 為什麼叫scheduling cycle和binding cycle？為什麼用cycle這個詞？"

    **cycle在這裡是「一輪」的意思，不是「迴圈」。**

    每個Pod都要走一輪固定的步驟：

    - **Scheduling cycle**：這個Pod走一輪Pop → Filter → Score → assume，選出Node。
    - **Binding cycle**：同一個Pod再走一輪WaitOnPermit → PreBind → Bind → PostBind，把結果寫回API server。

    <img src="images/ch08/cycle-rings.svg" alt="左邊scheduling cycle（主迴圈，一次排一個Pod）：起點是Pop，從activeQ Pop一個Pod，依序跑Filter、Score、assume，再回到Pop。右邊binding cycle（每個Pod一個goroutine，走完就結束）：assume之後進來，起點是WaitOnPermit，依序跑PreBind、Bind、PostBind" width="75%">

    兩輪各走一次就結束，裡面不會繞圈；Bind失敗時，Pod回queue，下次再從新的scheduling cycle開始。

    會一直繞圈的是**主迴圈**：它每轉一圈，就是一個Pod的scheduling cycle。

    <img src="images/ch08/cycle-main-loop.svg" alt="主迴圈一直轉，第1圈web-1、第2圈api-2、第3圈db-0，每一圈是一個Pod的scheduling cycle；每圈往下分出同色的binding cycle：PreBind、Bind、PostBind，各走一輪就結束，不繞圈，web-1和db-0成功，api-2失敗" width="80%">

??? question "6. extension point是不是都有default的plugin？比如Score有沒有default的打分方式？如果user沒有提供自己的plugin，會怎麼樣？"

    答案稍後補上。

??? question "7. Scheduler Cache只存在scheduler的mem裡。如果scheduler在assume之後、Bind寫回API server之前突然斷電或重啟，cache裡的資料不見了，這個Pod會怎麼樣？會不會被排兩次，或者永遠排不上？"

    答案稍後補上。

??? question "8. Scheduler Cache裡的Pod，有些已經真的寫回API server，有些只是assume。scheduler分得出哪些是assumed的嗎？如果分得出，它要拿這個資訊做什麼？"

    ***分得出***：cache用`assumedPods`這個set標記哪些Pod是assumed，也就是scheduler自己的假設，API server還沒確認。

    這個標記讓下一個Pod馬上看到資源被占用、讓Informer事件來時分清是確認還是新增、讓Bind失敗時只forget assumed的Pod。詳細見[Scheduler的「cache狀態管理」和「樂觀assume」](#-3-scheduler的cache狀態管理和樂觀assume)。
