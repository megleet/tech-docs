---
icon: lucide/file-code
---
# Chap-6 Declarative API & Operator

**目錄**

- [命令式和聲明式](#命令式和聲明式)
- [用Istio理解聲明式API](#用istio理解聲明式api)

## 命令式和聲明式

*同樣是寫YAML，怎樣才算「聲明式API」？*

[Chap-2](chap-2-kubernetes-architecture.md#聲明式api)說過，Kubernetes的API是***聲明式***的：只描述想要的狀態，交給[controller](chap-5-container-orchestration-controller.md#控制器模式)去達成。但用了YAML，不代表就是聲明式。管理同一個Deployment，`kubectl`有三種做法：

### ⌨️ 1. 命令式命令：參數寫在命令列

```bash
kubectl create deployment nginx --image=nginx:1.27 --replicas=2
kubectl set image deployment/nginx nginx=nginx:1.28
```

每一行都是一個***動作***：「建立」、「把image改成1.28」。要做什麼、怎麼做，都寫在命令列上。

### 📝 2. 命令式配置文件：create + replace

把參數改寫在YAML裡：

<!-- hl: 17 -->

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
```

先建立，之後把`image`改成`nginx:1.28`，再用`replace`更新：

<!-- hl: 2 -->

```bash
kubectl create -f nginx.yaml
# 把nginx.yaml裡的image改成nginx:1.28
kubectl replace -f nginx.yaml
```

這種先`create`、再`replace`的做法，叫***命令式配置文件***操作。它和[命令式命令](#-1-命令式命令參數寫在命令列)***沒有本質上的差別***，只是把命令列的參數寫進了YAML：

- **還是在下動作**：`create`是「建立」，`replace`是「整個換掉」。
- **要自己知道object的狀態**：object已經存在時`create`會失敗，還不存在時`replace`會失敗，所以每次都要先判斷該用哪一個。

### ✅ 3. 聲明式：kubectl apply

那到底什麼才是聲明式API？答案是***`kubectl apply`***：

<!-- hl: 2 -->

```bash
kubectl apply -f nginx.yaml
# 把nginx.yaml裡的image改成nginx:1.28
kubectl apply -f nginx.yaml
```

- **建立和更新都是同一個指令**：不用管object存不存在，`apply`只負責把YAML裡寫的***期望狀態***交給API Server。
- **只描述「要什麼」，不描述「怎麼做」**：YAML寫的是「image要是`nginx:1.28`」，要建立還是更新、怎麼把Pod換成新版本，交給API Server和controller決定。

| 做法             | 指令                                                                                                      | 你告訴Kubernetes的是                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **命令式** | `kubectl create deployment`、`kubectl set image`、<br />`kubectl create -f`、`kubectl replace -f` | ***動作***<br />參數在命令列或 -f YAML |
| **聲明式** | `kubectl apply -f`                                                                                      | ***期望狀態***                          |

### 🔀 4. replace和apply的差別：PUT和PATCH

兩個指令都能更新object，但送給API Server的request不一樣：

|                          | `kubectl replace`                                      | `kubectl apply`                                                        |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **HTTP**           | `PUT`                                                  | `PATCH`                                                                |
| **做什麼**         | 用YAML裡的object<br />***整個換掉***原本的object | 只改YAML裡***有寫的欄位***<br />和原本的object***合併*** |
| **別人改過的欄位** | 不在YAML裡就被蓋掉                                       | 保留                                                                     |
| **多人同時修改**   | ❌ 會互相覆蓋<br />YAML帶著舊版本時回`409 Conflict`    | ✅ 各改各的欄位、自動合併                                                |

`kubectl set image`、`kubectl edit`、`kubectl scale`也是send `PATCH` request，只改指定的欄位，**PATCH不會動到別人改過的其他欄位**。但***用`PATCH`不代表就是聲明式***：這些指令是當下下的一個[動作](#-1-命令式命令參數寫在命令列)（「把image改成1.28」「把`replicas`改成5」），**改完沒有留下描述期望狀態的YAML。之後有人用舊的YAML再`apply`，這些修改就會被改回去**。

> [!TIP]
> 用HPA的Deployment，YAML裡***不要寫`replicas`***。否則每次`apply`都會把HPA調好的數量改回YAML裡的值。

> [!TIP]
> 💡 **聲明式API的三個特點**
>
> 1. **提交的是期望狀態**：只要提交一個定義好的API object，「聲明」想要的狀態，不描述怎麼做。
> 2. **允許多個writer**：使用者、HPA、各種controller都可以用`PATCH`修改同一個object，**不需要知道別人local的YAML長什麼樣子**，各改各的欄位，由API Server合併。這讓HPA、Istio、各種Operator這些**互不認識的controller**，可以同時修改同一個object而不會互相覆蓋，是Kubernetes能一直***疊加***新功能的前提。
> 3. **controller能自動reconcile**：有了前兩點，controller只要對API object做增、刪、改、查，就能在**不需要外界介入**的情況下，持續把實際狀態調整成期望狀態，見[控制循環](chap-5-container-orchestration-controller.md#-2-控制循環)。
>
> 所以，***聲明式API是Kubernetes編排能力的核心***。

### 🧑‍💻 5. Kubernetes編程範式

有了聲明式API，要在Kubernetes上加入自己的功能，做法都一樣：

> **用[控制器模式](chap-5-container-orchestration-controller.md#控制器模式)，對Kubernetes裡API object做增、刪、改、查，完成自己的業務邏輯。**

這就是***Kubernetes編程範式***。Kubernetes內建的功能，和開源社群在它上面做的擴充，都照這個方式寫：

| 例子                                              | 監看什麼object                         | 做什麼                                                                                            |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Deployment controller**                   | Deployment、ReplicaSet                 | 建立和調整ReplicaSet，完成rolling update                                                          |
| **[Istio（istiod）](#用istio理解聲明式api)** | VirtualService、DestinationRule（CRD） | 把流量規則轉成Envoy的config，推送到每個Pod的sidecar（例如canary release時，90%流量給v1、10%給v2） |
| **cert-manager**                            | Certificate（CRD）                     | 自動向CA申請TLS certificate，快到期時自動更新                                                     |
| **Operator**                                | 自己定義的object（CRD）                | 例如`kind: MySQLCluster`，自動建立StatefulSet、做備份、failover                                 |

使用者只要寫YAML聲明期望狀態，剩下的交給這些controller。

從「**用Kubernetes deploy程式**」，到「**用Kubernetes寫程式**」，關鍵就在理解這個範式：

1. **自訂API object**：用CRD（CustomResourceDefinition）定義新的`kind`，例如`MySQLCluster`。
2. **自訂controller**：監看這些object，用控制循環把期望狀態變成實際狀態。

這兩者合起來就是***Operator***，也是這一章後面的內容。

## 用Istio理解聲明式API

*一個不用改程式、就能控制所有微服務流量的系統，怎麼建立在聲明式API上？*

### 🕸️ 1. Istio是什麼

Istio是一個***Service Mesh***：不用改app的程式，就能替cluster裡的微服務加上**流量控制**（例如canary release、retry、timeout）、**服務之間的mTLS，以及metrics和tracing**。

Istio有兩種模式：

1）**每個Node**上放一個ztunnel DaemonSet的**ambient mode**。

2）**每個Pod**裡放一個Envoy的**sidecar mode**。

兩者的差別在***網絡******proxy放在哪裡***：

|                              | ambient mode                                                                                                    | sidecar mode                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **proxy放在哪**        | ***每個Node***上一個ztunnel<br />（[DaemonSet](chap-5-container-orchestration-controller.md#daemonset)） | ***每個Pod***裡一個Envoy<br /> (sidecar)                       |
| **100個Pod、10個Node** | 10個ztunnel                                                                                                     | 100個Envoy                                                             |
| **app的Pod數量**       | 只有app一個container<br />（READY`1/1`）                                                                      | 多inject一個Envoy sidecar container<br />共兩個container（READY`2/2`） |
| **L7功能（例如分流）** | 需要時才部署waypoint proxy<br />（一個跑Envoy的Deployment）                                                     | 每個Envoy都能做                                                        |

> [!TIP]
> `1/1`、`2/2`是`kubectl get pods`輸出裡READY欄的值：***ready的container數 / Pod裡container的總數***。例如`1/1`是Pod裡有1個container，1個ready；`2/2`是app加上Envoy共2個container，2個都ready。

**ambient mode**的架構如下，Pod裡沒有sidecar：

<img src="images/ch06/istio-ambient-mode.svg" alt="Istio ambient mode的架構：control plane和sidecar mode一樣，istiod watch Kubernetes API Server，用xDS推config和certificate；data plane有兩個Node，每個Node上一個ztunnel（DaemonSet），Node上的Pod裡只有app（1/1），app的流量經過自己Node上的ztunnel，兩個ztunnel之間用mTLS（L4）；需要分流、retry這類L7功能時，流量才從ztunnel經過waypoint（跑Envoy的Deployment）再到另一個ztunnel" width="75%">

sidecar mode架構如下。這一節用**sidecar mode說明**，因為它最能看出聲明式API的作用。

<img src="images/ch06/istio-sidecar-mode.svg" alt="Istio的架構：control plane的istiod watch Kubernetes API Server上的Service、Pod、VirtualService、DestinationRule，把它們轉成Envoy的config和certificate，用xDS推給每個Pod裡的Envoy；data plane三個Pod裡各有一個Envoy和app（sidecar mode），app的流量都經過Envoy，Envoy之間雙向用mTLS；metrics和tracing由Envoy直接產生，給Prometheus抓" width="75%">

- **Control plane：istiod --** watch Kubernetes的object，轉成Envoy看得懂的config和certificate。
- **Data plane：Envoy --** 每個Pod裡一個網絡proxy，app的進出流量都經過它。
- **xDS**：Envoy定義的**一組config API**，名字是「x Discovery Service」的縮寫，x代表「某一種」config，例如RDS推路由規則、SDS推certificate。control plane（istiod）透過這組API，把config推給Envoy。每個Envoy啟動時**主動連到istiod**，建立一條gRPC長連線；之後istiod有新的config，就從這條連線推下來，Envoy不需要reload。

### 🔀 2. Envoy怎麼接管Pod的流量

Pod裡的container***共用同一個network namespace***（見[Chap-4](chap-4-container-orchestration-pod.md#-1-共用network-namespace的結果)），所以只要改這個network namespace的iptables規則，就能讓app的流量都先經過Envoy：

- **誰設定iptables**：不是Envoy，也不是使用者。***sidecar mode下***有兩種方式：
  - ***init container `istio-init`***：和Envoy一起，由[sidecar injection](#-3-sidecar怎麼自動加進pod)自動加進Pod。它在app啟動前執行Istio的`istio-iptables`程式寫好規則，然後結束。改iptables需要`NET_ADMIN`（Linux改網路設定的capability）權限，所以每個Pod裡都多了一個高權限的container。很多cluster用Pod Security Admission限制Pod的權限，`baseline`以上的等級不允許`NET_ADMIN`，這種Pod會直接被拒絕。
  - ***Istio CNI plugin***：安裝Istio時部署的DaemonSet，在每個Node上加一個CNI plugin。建立Pod網路時就把規則寫好，Pod裡不需要高權限的init container，官方建議用這種。
- **規則做什麼**：app的outbound流量，轉到Envoy的port 15001；inbound流量，轉到port 15006；Envoy自己的outbound流量（UID 1337）不轉，避免繞圈。

要注意，這裡的兩種方式，和[第1節](#-1-istio是什麼)的兩種模式是***不同層次***的選擇：

| 層次                                             | 選項                              | 決定什麼                                                                                                      |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **第一層：data plane用哪種模式**           | ambient mode / sidecar mode       | proxy放在哪裡：<br />**每個Node一個ztunnel**，還是**每個Pod一個Envoy**                            |
| **第二層：sidecar mode下，誰設定iptables** | `istio-init` / Istio CNI plugin | 把流量導到Envoy的iptables規則:<br />由**Pod裡的init container**寫，還是由**Node上的CNI plugin**寫 |

> [!NOTE]
> Istio CNI和ambient mode的ztunnel都是每個Node一個的DaemonSet，但角色不同：Istio CNI只在建立Pod網路時***設定iptables規則***，不處理流量；ztunnel是***真正處理流量***的proxy。ambient mode也需要Istio CNI，用它把Pod的流量導到ztunnel。

例如app要呼叫另一個叫`reviews`的服務（Service名稱是`reviews`，port 9080），程式裡照樣連`reviews:9080`，完全不知道Envoy的存在；但outbound流量已經先被iptables導到Envoy，由Envoy決定送到哪個Pod，並加上mTLS。這就是[Chap-4的sidecar](chap-4-container-orchestration-pod.md#-2-sidecar和app一起執行)設計思路。

### 💉 3. sidecar怎麼自動加進Pod

替namespace加上label，之後在這個namespace建立的Pod都會自動inject Envoy：

<!-- hl: 1 -->

```bash
kubectl label namespace default istio-injection=enabled
kubectl apply -f reviews-v1.yaml             # YAML裡只有一個container
kubectl get pods
# → NAME                          READY   STATUS    RESTARTS   AGE
#   reviews-v1-6b8f9c7d4-x2kqp    2/2     Running   0          20s

kubectl get pod reviews-v1-6b8f9c7d4-x2kqp -o jsonpath='{.spec.containers[*].name}'
# → reviews istio-proxy
```

你的YAML只寫了一個container，實際的Pod卻有兩個（`READY 2/2`），多出來的`istio-proxy`就是Envoy。它是這樣加進去的：

1. **Send request**：ReplicaSet controller照Pod template，send一個建立Pod的request。
2. **呼叫webhook**：API Server把Pod寫進etcd***之前***，先呼叫Istio註冊的***Mutating Admission Webhook***。
3. **回傳patch**：webhook看到這個namespace有`istio-injection=enabled` label，要inject Envoy sidecar，就把一個patch回傳給API Server：「加上`istio-proxy` container（以及`istio-init`）」。
4. **Write**：API Server套用patch，再把修改後的Pod寫進etcd。

這正是[聲明式API的特點](#-4-replace和apply的差別put和patch)：***你聲明的object，可以被另一個writer合併修改***。Deployment的YAML裡還是只有一個container，只有實際建立的Pod多了Envoy；你之後再`apply`，也不會把Envoy蓋掉。

### 🎯 4. 用聲明式API控制流量

流量規則也是API object。例如同一個app有舊版v1和新版v2，Pod的label分別是`version: v1`、`version: v2`，想讓90%流量給v1、10%給v2。

先用DestinationRule，依`version` label把Pod分成兩組（subset）：

<!-- hl: 7 8 9 10 11 12 13 -->

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

再用VirtualService，規定每組分到多少流量：

<!-- hl: 13 17 -->

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
    - reviews
  http:
    - route:
        - destination:
            host: reviews
            subset: v1
          weight: 90          # 90%給v1
        - destination:
            host: reviews
            subset: v2
          weight: 10          # 10%給v2
```

- **istiod是controller**：watch到這兩個object，轉成config推給每個Envoy。
- **比例和Pod數量無關**：只用Kubernetes的Service的話，流量平均分給所有Pod，比例只能靠Pod數量去湊。
- **要逐步切換到新版**：只要改`weight`，再`kubectl apply`。

> [!TIP]
> 💡 **一句話總結**
>
> ***Istio從頭到尾都建立在聲明式API上***：sidecar是Admission Webhook對Pod object的修改，流量規則是CRD，istiod是watch這些object的controller。使用者只要聲明期望狀態，剩下的交給Istio。

> [!NOTE]
> 撰寫中。
