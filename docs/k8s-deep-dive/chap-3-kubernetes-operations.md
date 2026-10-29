---
icon: lucide/wrench
---
# Chap-3 Kubernetes Operations

**目錄**

- [用kubeadm deploy Kubernetes](#用kubeadm-deploy-kubernetes)

## 用kubeadm deploy Kubernetes

*kubeadm是Kubernetes官方提供的cluster初始化工具：`kubeadm init`建立Master，`kubeadm join`把其他Node加進來。*

### 🤔 為什麼需要kubeadm

Kubernetes是Go寫的，每個元件編譯好就是一個完整的binary，不用像Python那樣還需要安裝lang層級的dep。但除了binary之外，還需要每個元件的config、設定開機自動啟動、替kube-apiserver準備certs和token等AuthZ & AuthN等文件……這些Ops工作很繁瑣，kubeadm就是把它們自動化的工具。

#### kubeadm和SaltStack、Ansible、Terraform的差別

|                    | Terraform                                                     | SaltStack / Ansible                        | kubeadm                                 |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| **是什麼**   | 建立basic infra的工具                                         | 通用的config management工具                | 專用的Kubernetes官方的cluster初始化工具 |
| **負責什麼** | 建立VM、網路、Load Balancer，或直接建立EKS / GKE等託管cluster | 自動化任何運維步驟，步驟要自己寫成playbook | 只負責在機器上把Kubernetes初始化起來    |

***三者不衝突，常見的是分工合作***：

```
Terraform
   │ 建立VM、網路
   ▼
Ansible
   │ 設定OS、安裝containerd / kubeadm / kubelet
   ▼
kubeadm
   │ 初始化cluster（init / join）
   ▼
Kubernetes cluster
```

[Kubespray](https://github.com/kubernetes-sigs/kubespray)就是這樣：它是一組Ansible playbook，底層呼叫kubeadm。

### 🫀 kubelet：每個Node的「心臟」

**每個Node上都一定有一個kubelet（包括master和worker nodes）**，它是Node的「心臟」，從cluster建立開始，到日常運作都靠它：

**a）建立cluster時**

- **啟動Master元件**：kubeadm把API Server、Scheduler、Controller Manager、etcd寫成[Static Pod](#static-pod)的YAML，由kubelet讀取並啟動。也就是說，***連Control Plane都是kubelet跑起來的***。
- **把Node加入cluster**：`kubeadm join`時，kubelet用[bootstrap token](#bootstrap-token)向API Server申請certificate、註冊這個Node，之後這台機器才會出現在`kubectl get nodes`裡。

**b）cluster運作時**

- **聽API Server的指示**：API Server把Pod排到這個Node之後，由kubelet負責把它跑起來。
- **管理這個Node上的所有Pod**：透過CRI叫container runtime建立Pod和container（網路由runtime再呼叫CNI設定），透過CSI設定volume。
- **回報狀態**：定期把Node和Pod的狀態回報給API Server，Control Plane才知道這個Node還活著、Pod有沒有正常執行。

***所以kubelet是完全獨立的元件，其他元件都要靠它才能跑起來***。

#### 為什麼kubelet不能是container

- **kubelet要直接操作host**：設定container網路、mount volume、管理cgroup，都要在host上做。kubelet如果跑在container裡，它看到的是container自己的mount ns和network ns，要操作host就很麻煩。

所以kubeadm的做法是：***kubelet用binary直接跑在host上***，由systemd管理；其他元件，也就是API Server、Scheduler、Controller Manager、etcd，都用container（[Static Pod](#static-pod)）跑。見Chap-2的[System Services](chap-2-kubernetes-architecture.md#system-services)。

### 📦 Step 1：安裝kubeadm、kubelet、kubectl

這一步在***每一台機器（Master和Worker）上都要做***：關閉swap、安裝container runtime（例如containerd），再安裝kubeadm和kubelet。kubectl只需要裝在要下指令的機器上，通常是Master。

> [!NOTE]
> **為什麼要關閉swap**：Kubernetes排程和資源限制的前提是「Pod用的mem就是真正的mem」。有swap時，部分mem會被虛擬到disk上，使得scheduler算的可用mem不準。關閉時除了`swapoff -a`，還要把`/etc/fstab`裡swap那一行註解掉，否則重開機後swap又會打開。

安裝前先加入Kubernetes官方的apt repo（`pkgs.k8s.io`），完整步驟見[官方安裝說明](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)：

```bash
apt-get install -y kubelet kubeadm kubectl
```

### 📘 Step 2：kubeadm基本原理

#### ⚙️ 為kubeadm init準備執行參數（Optional）

這一步***只在Master上做***，因為`kubeadm init`只在第一台Master上執行；Worker用`kubeadm join`加入，不需要這份`kubeadm.yaml`。

kubeadm default參數可以適合大部分情況。但要自訂components(例如：kube-apiserver)的啟動參數，就把config寫成一個YAML檔，`init`時用`--config`帶進去：

```bash
kubeadm config print init-defaults > kubeadm.yaml    # 先產生一份預設值當範本
kubeadm init --config kubeadm.yaml
```

`kubeadm.yaml`的主要部分：

```yaml
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration                     # 這台機器自己的config
localAPIEndpoint:
  advertiseAddress: 192.168.0.102           # API Server對外的IP
  bindPort: 6443
nodeRegistration:
  criSocket: unix:///var/run/containerd/containerd.sock
  ...
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration                  # 整個cluster共用的config，整份存成ConfigMap kubeadm-config
kubernetesVersion: v1.36.0
imageRepository: registry.k8s.io
networking:
  dnsDomain: cluster.local
  podSubnet: 10.244.0.0/16                  # 要和CNI plugin的config一致
  serviceSubnet: 10.96.0.0/12
apiServer:                                  # ┐
  extraArgs:                                # │
    - name: anonymous-auth                  # │
      value: "false"                        # │
  ...                                       # │
controllerManager:                          # │ 各元件的參數，
  ...                                       # │ 各自寫進對應的Static Pod YAML
scheduler:                                  # │
  ...                                       # │
etcd:                                       # │
  local:                                    # │
    dataDir: /var/lib/etcd                  # ┘
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration                  # kubelet的config，寫成host上的/var/lib/kubelet/config.yaml
address: 0.0.0.0
...
---
apiVersion: kubeproxy.config.k8s.io/v1alpha1
kind: KubeProxyConfiguration                # kube-proxy的config，存成ConfigMap kube-proxy
bindAddress: 0.0.0.0
...
```

這幾段config用`---`分隔，放在同一個`kubeadm.yaml`裡。它是你交給kubeadm的***輸入檔***：kubeadm讀完之後，把每一段config***分送***到各元件真正會讀的地方：

| `kubeadm.yaml`裡的那一段                                                                 | 內容                                                  | kubeadm把它寫到哪裡                                                                   | 最後誰讀取                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `InitConfiguration`                                                                      | 這台機器自己的config，例如IP、container runtime的socket | 只在`init`時使用                                                                    | kubeadm自己                                                      |
| `ClusterConfiguration`整份                                                               | 整個cluster共用的config，例如版本、網段                 | `kube-system`裡的ConfigMap `kubeadm-config`                                       | 之後的`kubeadm join`、`kubeadm upgrade`                      |
| `ClusterConfiguration`的`apiServer` / `controllerManager` / `scheduler` / `etcd` | 各元件的參數，例如`extraArgs`                       | 對應的[Static Pod](#static-pod) YAML，`/etc/kubernetes/manifests/*.yaml`裡的啟動參數 | 那4個Static Pod                                                  |
| `KubeletConfiguration`                                                                   | kubelet的config                                         | host上的`/var/lib/kubelet/config.yaml`，另外存一份成ConfigMap `kubelet-config`    | 直接跑在host上的kubelet；之後`join`的Node也從ConfigMap拿同一份 |
| `KubeProxyConfiguration`                                                                 | kube-proxy的config                                      | ConfigMap `kube-proxy`                                                              | kube-proxy的**DaemonSet** Pod                              |

***`kubeadm.yaml`只在執行`kubeadm init`的那一刻被讀取***，kubeadm也不是常駐的程式。之後元件讀的，都是kubeadm分送出去的檔案或ConfigMap，不會再回頭讀`kubeadm.yaml`。

#### 🗺️ kubeadm流程講解

kubeadm讀取`kubeadm.yaml`，寫出的4種config file：

![kubeadm init讀取kubeadm.yaml的4段config，寫出certificate、kubeconfig、Static Pod YAML和kubelet的運行參數](images/ch03/kubeadm-init-outputs.svg)

kubeadm怎麼把各元件跑起來：透過systemd啟動kubelet，kubelet再依Static Pod YAML啟動control plane的4個元件；kube-proxy、CoreDNS則是kubeadm透過API Server建立object，最後同樣由kubelet執行。

![kubeadm透過systemd啟動kubelet，kubelet以Static Pod啟動control plane的4個元件；kubeadm透過API Server建立kube-proxy和CoreDNS，再由kubelet執行它們的Pod](images/ch03/kubeadm-start-components.svg)

##### init完成後：元件怎麼執行

| 元件                                                                    | 執行方式                              | 誰啟動                                        |
| ----------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| **kube-apiserver、kube-controller-manager、kube-scheduler、etcd** | **Static Pod**                  | kubelet讀`/etc/kubernetes/manifests/`的YAML |
| **kubelet**                                                       | host上的***binary***，不是Pod | systemd                                       |
| **kube-proxy**                                                    | **DaemonSet**，每個Node一個Pod  | 一般的Kubernetes機制，由API Server管理        |
| **CoreDNS**                                                       | **Deployment**                  | 一般的Kubernetes機制                          |

所以「元件是[Static Pod](#static-pod)」只對***control plane的4個元件***成立。kubelet不是Pod，kube-proxy和CoreDNS是一般的Pod，不是Static Pod。

### 🚀 Step 3：kubeadm init

#### 🪜 kubeadm init的步驟

**① Preflight Checks**：先檢查這台機器能不能deploy Kubernetes，例如：

- OS kernel版本、cgroups是否符合要求；
- hostname是否符合DNS命名（Kubernetes裡的機器名稱和存在etcd裡的API object，都要用標準的DNS名稱）；
- swap是否關閉：kubelet預設要求關閉swap；
- kubeadm和kubelet的版本是否相符；
- 要用的port是否被占用：6443（API Server）、2379-2380（etcd）、10250（kubelet）、10257（controller-manager）、10259（scheduler）；
- container runtime是否已經安裝，`ip`、`mount`等指令是否存在。

**② 產生certificate**：kubeadm先建立這個cluster自己的***根CA***（`ca.crt` / `ca.key`），也就是cluster的「發證機關」，再用它替cluster裡的***每個元件***簽發certificate，讓元件之間的連線可以互相驗證身分。certificate都放在Master Node的`/etc/kubernetes/pki/`：

| certificate                             | 給誰用                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `ca.crt` / `ca.key`          | cluster的根CA，簽發下面這些certificate                                                      |
| `apiserver.crt`                | API Server的server certificate：kubectl、kubelet連API Server時，用來確認對方真的是API Server |
| `apiserver-kubelet-client.crt` | API Server當client連kubelet時使用，例如`kubectl logs`、`kubectl exec`            |
| `apiserver-etcd-client.crt`    | API Server當client連etcd時使用                                                       |
| `etcd/`底下的certificate              | etcd自己的CA、server certificate，以及etcd member之間互相連線用的certificate                        |

各certificate的完整清單見[PKI certificates and requirements](https://kubernetes.io/docs/setup/best-practices/certificates/)。如果你已經有自己的CA，事先把`ca.crt`和`ca.key`放進`/etc/kubernetes/pki/`，kubeadm就會跳過產生CA這一步，直接用你的CA簽發其他certificate。

**③ Generate各元件call API Server所需要用的kubeconfig**：

```bash
ls /etc/kubernetes/
# → admin.conf  controller-manager.conf  kubelet.conf  manifests  pki  scheduler.conf  super-admin.conf
```

kubeadm替**每個需要連到API Server的元件** ，各產生一個config文件（[kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)），告訴它「API Server在哪裡、怎麼確認對方、怎麼證明自己是誰」。也就是說每個kubeconfig檔裡都有API Server的位址、port、cluster的`ca.crt`，以及這個元件***自己的client certificate***。scheduler、kubelet等元件直接載入它，就能和API Server建立安全的連線。

**④ Generate Master元件運行需要的Static Pod YAML**：<a id="static-pod"></a>

***Static Pod***是一種特殊的啟動方式：把Pod的YAML放進指定目錄，kubelet啟動時就會自動載入並執行。kubeadm把Master元件的YAML放在`/etc/kubernetes/manifests/`：

```bash
ls /etc/kubernetes/manifests/
# → etcd.yaml  kube-apiserver.yaml  kube-controller-manager.yaml  kube-scheduler.yaml
```

以`kube-apiserver.yaml`為例：

```yaml
apiVersion: v1
kind: Pod                                   # 就是一般的Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
  labels:
    component: kube-apiserver
    tier: control-plane
spec:
  containers:
  - name: kube-apiserver
    image: registry.k8s.io/kube-apiserver:v1.36.0
    command:
    - kube-apiserver
    - --advertise-address=192.168.0.102
    - --authorization-mode=Node,RBAC
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt     # 第②步產生的certificate
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key
    # ...其他參數，Step 2的extraArgs加的也會出現在這裡
    volumeMounts:
    - name: k8s-certs
      mountPath: /etc/kubernetes/pki
      readOnly: true
  hostNetwork: true                         # 直接用host的網路：它比CNI更早啟動
  priorityClassName: system-cluster-critical
  volumes:
  - name: k8s-certs
    hostPath:                               # 把host上的certificate目錄mount進去
      path: /etc/kubernetes/pki
      type: DirectoryOrCreate
```

- **Static Pod就是一般的Pod YAML**：`kind: Pod`，沒有任何特殊欄位，差別只在它放在`/etc/kubernetes/manifests/`裡，由kubelet直接讀取。
- **和前後的步驟接得上**：`--tls-cert-file`用的就是第②步產生的certificate；[Step 2](#-為kubeadm-init準備執行參數optional)`extraArgs`加的參數，最後也會出現在`command`裡。
- **control plane元件的特殊config**：`hostNetwork: true`直接用host的網路，因為它比CNI更早啟動；`hostPath`把host上的certificate目錄mount進去；`priorityClassName: system-cluster-critical`讓它在資源不夠時最後才被驅逐。

kubelet一看到這些YAML，就把它們跑起來，見[kubelet：每個Node的「心臟」](#-kubelet每個node的心臟)。

**⑤ 等待Master元件就緒**：檢查`https://localhost:6443/healthz`。

**⑥ 產生bootstrap token**：<a id="bootstrap-token"></a>之後任何裝好kubelet和kubeadm的Node，只要持有這個token，就能用`kubeadm join`加入cluster。token會在`kubeadm init`結束時印出來，預設24小時後過期；過期後用`kubeadm token create --print-join-command`重新產生。

***token要等Master的API Server跑起來之後，才能真正生效***。原因是bootstrap token不是一個本機檔案，而是***存在cluster裡的一個Secret***：

```
⑤ 等待Master元件就緒（API Server可以用了）
   ▼
⑥ 產生bootstrap token
   │ 透過API Server寫進kube-system namespace
   ▼
Secret：bootstrap-token-<token-id>
```

```bash
kubectl get secrets -n kube-system | grep bootstrap-token
# → bootstrap-token-abcdef   bootstrap.kubernetes.io/token   ...
```

新Node執行`kubeadm join`時，是拿token去問API Server「這個token有效嗎？」，API Server查這個Secret，確認token存在、還沒過期，才讓它申請certificate。這也是⑤要先確認API Server正常，⑥才建立token的原因。

**⑦ 標記control plane**：<a id="mark-control-plane"></a>等API Server可以用之後，kubeadm替Master的Node object加上label `node-role.kubernetes.io/control-plane`，以及taint `node-role.kubernetes.io/control-plane:NoSchedule`，讓一般的Pod不會被排到Master上。taint是寫在API Server裡的Node object上，所以也要等⑤完成。要調整這個策略，見[用Taint / Toleration調整Master能不能跑Pod](#taint-toleration)。

**⑧ 保存cluster資訊**：<a id="cluster-info"></a>把`ca.crt`等Master的重要資訊，存成`kube-public` namespace裡名為`cluster-info`的ConfigMap，給之後加入的Node使用。

**⑨ 安裝必要的addon**：[kube-proxy](chap-2-kubernetes-architecture.md#kube-proxy在哪裡做什麼)和[CoreDNS](https://kubernetes.io/docs/tasks/administer-cluster/coredns/)，分別負責Service轉發和cluster內的DNS。它們也只是兩個container image：kubeadm用Kubernetes client建立kube-proxy的DaemonSet（每個Node一個）和CoreDNS的Deployment就好。

> [!WARNING]
> ***kubeadm不會安裝CNI plugin***。`kubeadm init`之後，要自己裝一個CNI plugin，例如Flannel、Calico、Cilium，否則Node會一直是`NotReady`，CoreDNS也會卡在`Pending`。做法見[Step 5：Deploy CNI plugin](#-step-5deploy-cni-plugin)。

#### 🖼️ 在Master上執行kubeadm init的完整流程圖

![kubeadm init的完整流程：kubeadm.yaml、kubeadm寫出的config file、systemd與kubelet、control plane的Static Pod、透過API Server建立的object，以及kube-proxy和CoreDNS的Pod](images/ch03/kubeadm-init-flow.svg)

> [!NOTE]
> <a id="taint-toleration"></a>**用Taint / Toleration調整Master能不能跑Pod**
>
> [第⑦步](#mark-control-plane)已經替Master加上taint：
>
> ```bash
> kubectl describe node master | grep Taints
> # → Taints:  node-role.kubernetes.io/control-plane:NoSchedule
> ```
>
> - **taint是什麼**：加在Node上的「**排斥標記**」。`NoSchedule`表示scheduler***不會***把一般Pod分配到這個Node，除非Pod宣告了對應的***toleration***。
> - **為什麼Master要有**：讓app的Pod只跑在Worker上，不和control plane搶資源，也避免app影響API Server和etcd。
>
> 要讓一般的Pod也能跑在Master上，有兩種做法：
>
> | 做法                   | 改哪裡    | 影響範圍                                  |
> | ---------------------- | --------- | ----------------------------------------- |
> | **拿掉taint**    | Node      | ***所有***Pod都可以排到Master上   |
> | **加toleration** | Pod的YAML | ***只有這個Pod***可以排到Master上 |
>
> taint、effect和toleration更完整的說明，見[第5章的Taint和Toleration](chap-5-container-orchestration-controller.md#taint和toleration)。

### 🤝 Step 4：kubeadm join

`kubeadm init`產生[bootstrap token](#bootstrap-token)之後，任何一台裝好kubelet和kubeadm的機器（通常是Worker），都可以執行`kubeadm join`加入cluster。指令就是`kubeadm init`結束時印出來的那一行：

```bash
kubeadm join 192.168.0.102:6443 --token abcdef.0123456789abcdef \
  --discovery-token-ca-cert-hash sha256:<hash>
```

join不需要先裝好CNI plugin：剛join的Node會和Master一樣是`NotReady`，等[Step 5](#-step-5deploy-cni-plugin)裝好CNI plugin，所有Node會一起變成`Ready`。

#### 為什麼join需要token

- **新Node一定要向API Server註冊**：任何機器要成為cluster的Node，都必須在kube-apiserver上註冊。
- **和API Server溝通需要certificate**：要連API Server，這台機器得先有cluster的CA（`ca.crt`），才能確認對方真的是API Server。
- **不能要使用者手動複製**：為了一鍵安裝，不能讓使用者自己到Master上把這些檔案複製過來。

所以kubeadm至少要用「***不安全模式***」連一次API Server，拿到[第⑧步](#cluster-info)存在`kube-public`裡的`cluster-info` ConfigMap，裡面有API Server的位址、port和`ca.crt`。***bootstrap token在這個過程中負責安全驗證***。

拿到`cluster-info`之後，kubelet就能用「安全模式」連上API Server，這台Node就deploy完成了。其他Node重複執行同一行指令就好。

```
kubeadm join（新Node）
   │ 不安全模式：讀kube-public的cluster-info，用token驗證
   ▼
取得API Server的位址、port、ca.crt
   │ 安全模式：用token向API Server申請kubelet自己的certificate
   ▼
kubelet用自己的certificate連API Server，Node註冊完成
```

> [!NOTE]
> 「不安全模式」不代表完全不驗證：`cluster-info`裡附有用bootstrap token簽的簽章，kubeadm用token確認內容沒被竄改；`--discovery-token-ca-cert-hash`再確認拿到的`ca.crt`是對的CA。接著kubelet用token向API Server申請自己的client certificate（TLS bootstrap），之後就改用這張certificate連線。

***Worker和Master幾乎一樣***：兩者執行的都是kubelet。唯一的差別是在master上`kubeadm init`時，kubelet啟動後，Master上還會以[Static Pod](#static-pod)執行control plane元件：kube-apiserver、kube-scheduler、kube-controller-manager，以及etcd（kubeadm預設把etcd也放在Master上）。

### 🕸️ Step 5：Deploy CNI plugin

*kubeadm不會安裝CNI plugin，要自己用`kubectl apply`裝一個。*

Step 3和Step 4做完之後，所有Node都還是`NotReady`：

```bash
kubectl get nodes
# → NAME      STATUS     ROLES           AGE   VERSION
#   master    NotReady   control-plane   10m   v1.36.0
#   worker1   NotReady   <none>          2m    v1.36.0
#   worker2   NotReady   <none>          2m    v1.36.0

kubectl describe node master
# → Conditions:
#   ...
#   Ready   False ... KubeletNotReady   container runtime network not ready:
#           NetworkReady=false reason:NetworkPluginNotReady
#           message:Network plugin returns error: cni plugin not initialized
```

`NotReady`的原因寫得很清楚：***還沒有CNI plugin***。再看`kube-system`裡的Pod：

```bash
kubectl get pods -n kube-system
# → NAME                             READY   STATUS    RESTARTS   AGE
#   coredns-7c65d6cfc9-j9s52         0/1     Pending   0          10m
#   coredns-7c65d6cfc9-jm4wf         0/1     Pending   0          10m
#   etcd-master                      1/1     Running   0          10m
#   kube-apiserver-master            1/1     Running   0          10m
#   kube-controller-manager-master   1/1     Running   0          10m
#   kube-proxy-xbd47                 1/1     Running   0          10m
#   kube-proxy-7mq2k                 1/1     Running   0          2m
#   kube-proxy-p9lzt                 1/1     Running   0          2m
#   kube-scheduler-master            1/1     Running   0          10m
```

- **control plane的4個元件都是`Running`**：它們是[Static Pod](#static-pod)，用`hostNetwork`，不需要CNI。名稱後面的`-master`是Node名稱。
- **kube-proxy也是`Running`**：它同樣用`hostNetwork`。kube-proxy是DaemonSet，所以每個Node一個，共3個。
- **CoreDNS卡在`Pending`**：它需要Pod網路，要等CNI裝好。

`kube-system`是Kubernetes的***Namespace***，用來劃分不同的工作空間，Kubernetes自己的系統Pod都放在這裡。它和[Linux namespace](chap-1-container-basics.md#-①-建立namespace)是兩回事。

在Kubernetes「***一切皆container***」的設計下，CNI plugin本身也是用Kubernetes object deploy的，只要一行`kubectl apply`。在任一台有kubectl的機器上（通常是Master）執行，以Flannel為例：

```bash
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
```

- **只要執行一次**：它建立的是DaemonSet，已經join的Node和之後才join的Node，都會自動有一個Flannel Pod。
- **網段要一致**：Flannel預設的Pod網段是`10.244.0.0/16`，和[Step 2](#-為kubeadm-init準備執行參數optional)`kubeadm.yaml`裡的`podSubnet`一樣。換別的CNI plugin時，要確認兩邊config相同。

裝好之後，再跑一次`kubectl get nodes`和`kubectl get pods -n kube-system`，確認所有Node都變成`Ready`、CoreDNS變成`Running`。

### 💾 Step 6：Deploy CSI driver（Rook-Ceph）

*kubeadm也不會安裝任何storage plugin。這一步用Rook在cluster裡deploy Ceph，讓PVC可以自動拿到持久化volume。*

#### 為什麼需要持久化storage

我們常把host上的目錄或檔案mount進container的mount namespace（原理見[mount --bind技術](chap-1-container-basics.md#mount---bind%E6%8A%80%E8%A1%93)），讓container和host共享這些目錄或檔案，container裡的app也能在其中新建、write檔案。但這種做法把storage***綁定在單一host上*** ：Pod一旦被重新排程到別的Node，原本寫的資料就找不到了。這正是container**無狀態**的典型表現

要讓container**有狀態** ，就需要**持久化storage**：storage plugin會在container裡mount一份remote的儲存空間（透過網路等方式），檔案實際存放在remote storage server上，或分散在多個Node上， ***和目前這台host沒有綁定關係*** 。因此不管新的container在哪台host啟動，都能mount同一份儲存，讀到原來的資料，這就是「持久化」。在K8s中，這通常透過PV/PVC和CSI plugin來實現。

#### 沒有CSI driver時，PVC會一直Pending

先建一個沒有指定StorageClass的PVC（PersistentVolumeClaim），當作之後的測試：

```yaml
# test-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
```

建立這個PVC，再看它的狀態：

```bash
kubectl apply -f test-pvc.yaml
kubectl get pvc test-pvc
# → NAME       STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
#   test-pvc   Pending                                                     1m

kubectl describe pvc test-pvc
# → Events:
#   Normal  FailedBinding  ...  no persistent volumes available for this claim
#                               and no storage class is set
```

- **cluster裡沒有StorageClass**：`kubectl get storageclass`什麼都沒有，所以沒有provisioner可以替這個PVC建volume。
- **也沒有現成的PV**：沒有人手動建PV，PVC就一直停在`Pending`。

#### Rook是什麼

[Rook](https://rook.io/)是一個以[Ceph](https://ceph.io/)為基礎的Kubernetes storage plugin。Rook不只是把Ceph簡單包起來，還加入了水平擴展、遷移、災難備份、監控等大量企業級功能，是一個production等級可用的container storage plugin。

Ceph本身是分散式storage，主要有3種daemon（mon / mgr / OSD）。最後一列是Rook另外deploy的CSI nodeplugin，放在一起對照：

| 元件                                   | 做什麼                                                          | 數量看什麼                            | 用什麼deploy                                         |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| **mon**（monitor）               | 保存cluster map，記錄有哪些成員、資料放在哪裡；用多數決維持一致 | 固定奇數個，通常3個                   | **Deployment** 每個mon一個                     |
| **mgr**（manager）               | 監控、dashboard、提供metrics                                    | 固定1～2個（一個active，一個standby） | **Deployment** 每個mgr一個                     |
| **OSD**（Object Storage Daemon） | 真正存資料的地方                                                | ***每顆disk一個***            | **Deployment** 一個Node可能有0顆或好幾顆disk  |
| **CSI nodeplugin**               | kubelet透過它把volume mount進Pod                                | ***每個Node一個***            | **DaemonSet**                                  |

所以Rook替每個mon、mgr、OSD各建一個`replicas: 1`的Deployment，例如`rook-ceph-osd-0`，用`nodeSelector`綁在它的Node上，升級時也能一個一個來。

自己裝Ceph很複雜，Rook用***Operator***把這件事自動化：

- **Operator**：一個用Deployment執行的controller。Rook定義了`CephCluster`、`CephBlockPool`等CRD（CustomResourceDefinition），Operator負責盯著這些object。
- **順便deploy CSI driver**：Ceph的CSI driver也由Rook一起裝好，kubelet透過它mount volume，見[kubelet與各個interface](chap-2-kubernetes-architecture.md#-1-kubelet與各個interface)。

#### 事前準備

- **每個Worker要有一顆空白disk**：不能有partition，也不能有filesystem。用`lsblk -f`檢查，`FSTYPE`是空的才能用：

    ```bash
    lsblk -f
    # → NAME    FSTYPE   MOUNTPOINTS
    #   vda
    #   └─vda1  ext4     /
    #   vdb                           ← FSTYPE是空的，Rook可以用
    ```
- **至少3個Worker**：`cluster.yaml`會把3個mon放在不同Node，資料也存3份。只有1～2個Worker時，改用`cluster-test.yaml`（1個mon、資料只存1份，只適合測試）。
- **kernel要有`rbd` module --> RBD driver**。Node要靠它，才能把Ceph裡的RBD image變成一顆本機的disk（`/dev/rbd0`）。
- **Ceph的Pod只會跑在Worker上**：Master有`NoSchedule`的taint，見[用Taint / Toleration調整Master能不能跑Pod](#taint-toleration)。

#### 安裝Rook Operator

Rook的YAML都放在repo的`deploy/examples/`裡，先clone指定的release版本：

```bash
git clone --single-branch --branch v1.21.0 https://github.com/rook/rook.git
cd rook/deploy/examples
kubectl create -f crds.yaml -f common.yaml -f csi-operator.yaml
kubectl create -f operator.yaml
kubectl -n rook-ceph get pod      # 等rook-ceph-operator變成Running再繼續
```

#### 建立Ceph cluster

```bash
kubectl create -f cluster.yaml    # 少於3個Worker時改用cluster-test.yaml
kubectl -n rook-ceph get pod
```

等幾分鐘後，所有Pod都放在`rook-ceph`這一個namespace裡（只留NAME和STATUS兩欄，Pod名稱的亂數省略）：

```
NAME                                          STATUS
ceph-csi-controller-manager-…                 Running
rook-ceph-operator-…                          Running
rook-ceph-mon-a-… / -b-… / -c-…               Running
rook-ceph-mgr-a-… / -b-…                      Running
rook-ceph-osd-0-… / -1-… / -2-…               Running
rook-ceph-osd-prepare-worker1-…               Completed
rook-ceph-osd-prepare-worker2-…               Completed
rook-ceph-osd-prepare-worker3-…               Completed
rook-ceph.rbd.csi.ceph.com-ctrlplugin-…       Running
rook-ceph.rbd.csi.ceph.com-nodeplugin-…       Running     (每個Node一個)
rook-ceph.cephfs.csi.ceph.com-ctrlplugin-…    Running
rook-ceph.cephfs.csi.ceph.com-nodeplugin-…    Running     (每個Node一個)
```

用Rook的toolbox確認Ceph cluster是健康的：

```bash
kubectl create -f toolbox.yaml
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph status
# → cluster:
#     health: HEALTH_OK
#   services:
#     mon: 3 daemons, quorum a,b,c
#     mgr: a(active), standbys: b
#     osd: 3 osds: 3 up, 3 in
```

- **`HEALTH_OK`**：有`HEALTH_WARN`時，照訊息排查。
- **mon全部在quorum裡**、**mgr有一個active**、**OSD都是`up`和`in`**。

#### 建立StorageClass，再測一次PVC

```bash
kubectl create -f csi/rbd/storageclass.yaml     # 少於3個Worker時改用csi/rbd/storageclass-test.yaml
kubectl patch storageclass rook-ceph-block \
  -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

- **`storageclass.yaml`建了兩個object**：`CephBlockPool` `replicapool`（Ceph裡的pool，資料存3份，分散在不同Node），以及StorageClass `rook-ceph-block`，它的`provisioner`是`rook-ceph.rbd.csi.ceph.com`，也就是上表的RBD CSI driver。
- **設成default StorageClass**：之後沒寫`storageClassName`的PVC都會用它。

所以前面的`test-pvc`不用重建，就會自己變成`Bound`：

```bash
kubectl get pvc test-pvc
# → NAME       STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
#   test-pvc   Bound    pvc-3f1c2a9e-5b7d-4c1e-9a8f-2d6e0b4c7a11   1Gi        RWO            rook-ceph-block   12m
```

最後確認資料真的「持久化」：開一個Pod掛上`test-pvc`，寫一個檔案。

```yaml
# writer.yaml
apiVersion: v1
kind: Pod
metadata:
  name: writer
spec:
  nodeName: worker1
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "echo hello > /data/hello.txt && sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: test-pvc
```

- **`volumes`**：用`persistentVolumeClaim`引用`test-pvc`，Pod就會拿到它背後的RBD image。
- **`volumeMounts`**：把這個volume mount到container裡的`/data`。
- **`command`**：啟動時寫一個`/data/hello.txt`，再`sleep`讓Pod繼續跑。
- **`nodeName: worker1`**：直接指定Pod跑在worker1，不經過scheduler，方便等一下換到另一個Node比較。

接著分3步驗證：

1. **在worker1建Pod**：Pod啟動時write `hello.txt`。
2. **刪掉Pod**：Pod刪掉了，PVC和裡面的資料還在。RBD volume同時只能掛在一個Node上，所以要等舊的Pod完全刪除，worker2才掛得上去。
3. **把`nodeName`改成worker2，再建一次**：新的Pod跑在另一個Node上，讀讀看`hello.txt`還在不在。

```bash
kubectl apply -f writer.yaml
kubectl delete pod writer
# 把writer.yaml的nodeName改成worker2，再建一次
kubectl apply -f writer.yaml
kubectl exec writer -- cat /data/hello.txt
# → hello
```

Pod換到另一個Node，還是讀得到原本寫的檔案，因為資料存在Ceph裡，***不在worker1的disk上***。

#### 🖼️ 從PVC到Pod的流程

```
PVC（StorageClass：rook-ceph-block）
  │  CSI Controller plugin（ctrlplugin）看到新的PVC
  ▼
在Ceph的replicapool建一個RBD image，建立PV，和PVC綁定（Bound）
  │  Pod被排到某個Node
  ▼
kubelet透過CSI呼叫這個Node上的CSI Node plugin（nodeplugin）
  │  把RBD image接成這個Node上的block device（例如/dev/rbd0）
  │  第一次使用時格式化，再mount到Pod的volume目錄
  ▼
container裡看到/data
```

#### ⚖️ 業界常見的做法：Ceph不是所有stateful app的最佳選擇

Ceph每次write都要經過網路、等其他OSD確認，latency比local disk高1～2個數量級。app自己就會複製資料時，跑在Ceph上等於***同一筆資料被複製兩次***，例如CockroachDB（CRDB）存3份、每份在Ceph裡再存3份，空間和latency都疊加。所以要依app選storage：

| app類型                                                            | 建議的storage                                                                            | 原因                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **自己會複製的分散式DB**：CRDB、Cassandra、Kafka、etcd       | **local PV**：local NVMe，例如`local-path-provisioner`、TopoLVM、OpenEBS LocalPV | 讓app自己複製，storage只求快                             |
| **單機DB**：一個PostgreSQL / MySQL instance，沒有設定replica | **Ceph RBD**這類network storage                                                    | DB自己不會複製，靠storage保護資料，Node壞掉時Pod能換Node |
| **多個Pod要共用檔案**                                        | **CephFS**（`ReadWriteMany`）                                                    | RBD做不到多個Node同時寫                                  |

- **local PV會把Pod綁在Node上**：Node重開機時，Pod在同一個Node上恢復，資料還在。Node永久壞掉時，Pod會卡在`Pending`，要刪掉它的PVC，讓StatefulSet在別的Node上重建，再由app（例如CRDB）把資料補回來。
- **雲端**：很多人直接用雲端的network block storage，例如AWS EBS、GCP PD。複製由雲端廠商做，不會和app搶自己的網路和CPU，Node壞掉時volume也能跟著Pod搬走。

> [!TIP]
> 💡 **一句話總結**
>
> kubeadm只負責control plane；network（[Step 5](#-step-5deploy-cni-plugin)）和storage（Step 6）都是用`kubectl apply`裝上去的plugin。Rook用Operator把Ceph和它的CSI driver一起deploy好，PVC就能自動拿到***不綁在任何一台host上***的持久化volume。

### 🖥️ Step 7：Deploy Dashboard（Headlamp）

*kubeadm不會安裝web UI。想用瀏覽器看cluster的狀態，要自己deploy一個。*

這裡用[Headlamp](https://headlamp.dev/)：Kubernetes官方文件目前推薦的web UI。

Headlamp和CNI、CSI一樣，也是用Kubernetes object deploy的。這次用Helm安裝，先在Master上[安裝Helm](https://helm.sh/docs/intro/install/)：

```bash
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
helm install headlamp headlamp/headlamp --namespace kube-system
kubectl get pods -n kube-system | grep headlamp
# → headlamp-5d8f7c9b6d-x7k2p   1/1     Running   0          1m
```

- **Helm**：Kubernetes的pkg manager。一個chart把Deployment、Service、RBAC等YAML打包在一起，`helm install`一次建好。
- **Headlamp就是一個web server**：一個Deployment加一個`ClusterIP`的Service（port 80），沒有什麼特別的。

#### 怎麼存取

***web UI預設不對外開放***：web UI要是暴露到公開網路，任何人都能看到、甚至修改cluster。所以Service預設是`ClusterIP`，只能在cluster裡面連。

Master通常是沒有瀏覽器的VM，用SSH port forwarding從自己的電腦連進去：

```bash
# 在自己的電腦上
ssh -L 8080:localhost:8080 <master>

# 在Master上
kubectl port-forward -n kube-system service/headlamp 8080:80
```

瀏覽器打開`http://localhost:8080`。登入要一個token：先建一個ServiceAccount，再替它產生token：

```bash
kubectl create serviceaccount headlamp-admin -n kube-system
kubectl create clusterrolebinding headlamp-admin \
  --clusterrole=cluster-admin --serviceaccount=kube-system:headlamp-admin
kubectl create token headlamp-admin -n kube-system --duration=24h
```

- **token會過期**：預設1小時，`--duration`可以調長。ServiceAccount、RBAC和token的原理，見[Chap-7的ServiceAccountToken](chap-7-volume.md#-6-serviceaccounttokenpod怎麼存取api-server)。
- **權限**：`cluster-admin`權限最大，只適合練習環境。另外，Helm chart預設也替Headlamp自己的ServiceAccount綁了`cluster-admin`，正式環境可以在安裝時加`--set clusterRoleBinding.create=false`關掉。
- **從cluster外存取**：不要直接把Service改成`NodePort`或`LoadBalancer`，要透過Ingress，並加上TLS和認證。
