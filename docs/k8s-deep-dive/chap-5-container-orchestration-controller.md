---
icon: lucide/refresh-cw
---
# Chap-5 Container orchestration之Controller篇

**目錄**

- [控制器模式](#控制器模式)
- [Deployment](#deployment)
- [Service](#service)
- [StatefulSet](#statefulset)

## 控制器模式

*Deployment、StatefulSet、DaemonSet這些不同的object，Kubernetes怎麼用同一套方法管理它們？*

Kubernetes用一種叫***控制器模式***（controller pattern）的設計，***用一種object管理另一種object***，統一處理各種object的編排：Deployment、StatefulSet、DaemonSet、Job……每一種背後都有一個controller，而且都照同一個流程工作：***控制循環***（control/reconcile loop）。

### 🏭 1. 誰在執行：kube-controller-manager

[架構圖](chap-2-kubernetes-architecture.md#kubernetes的架構)裡的kube-controller-manager，其實就是***一組controller的集合***。看Kubernetes原始碼的`pkg/controller`目錄：

```bash
cd kubernetes/pkg/controller/
ls -d */
# → cronjob/  daemon/  deployment/  disruption/  endpointslice/  garbagecollector/
#   job/  namespace/  nodelifecycle/  podautoscaler/  replicaset/  serviceaccount/
#   statefulset/  volume/  ...
```

- **每個目錄是一個controller**：各自負責一種編排功能，Deployment只是其中之一。
- **放在一起，是因為它們遵循同一個模式**：***控制循環***。
- **跑在同一個process裡**：kube-controller-manager把它們編進同一個binary，以[Static Pod](chap-3-kubernetes-operations.md#static-pod)執行。

### 🔁 2. 控制循環

每個controller都在不停地做同一件事：

```go
for {
    實際狀態 := 取得object X在cluster裡的實際狀態
    期望狀態 := 取得object X的期望狀態
    if 實際狀態 != 期望狀態 {
        執行編排動作，把實際狀態調整成期望狀態
    }
}
```

- **實際狀態**：來自cluster本身，例如kubelet回報的container和Node狀態、監控系統的資料，或controller自己收集的資訊。
- **期望狀態**：來自使用者提交的YAML，例如`replicas: 2`，存在etcd裡。controller透過API Server watch這些object，不直接讀etcd。

以`replicas: 2`為例：

1. **數實際狀態**：找出所有帶`app: nginx` label的Pod，數出有幾個。實際負責數Pod的是Deployment底下的ReplicaSet controller，見[ownerReferences](#-4-ownerreferences記錄誰擁有誰)。
2. **讀期望狀態**：`replicas`的值是2。
3. **比較、調整**：少了就建立Pod，多了就刪除Pod。例如手動刪掉一個Pod，controller發現只剩1個，就再建立一個。

主要的編排邏輯都在第3步。這個比較、調整的動作叫***reconcile***，整個循環也叫reconcile loop或sync loop。文件裡看到這幾個詞，指的都是同一件事：***控制循環***。

reconcile的結果，通常是對被控制object的寫入：建立Pod、刪除Pod，或更新Pod的某個欄位。***使用者只寫期望狀態，「怎麼做到」交給controller***，這就是[聲明式API](chap-2-kubernetes-architecture.md#聲明式api)能運作的原因。

### 🧩 3. 控制器的兩半：定義和模板

以Deployment為例，一個controller object的YAML分成上下兩半：

<img src="images/ch05/controller-definition-template.svg" alt="Deployment的YAML分成兩半：上半部是控制器定義，包含期望狀態replicas: 2和selector app: nginx；下半部是被控制對象的模板，也就是Pod template，labels app: nginx要和selector對得上" width="75%">

- **上半部：控制器定義**：controller object本身，***期望狀態***寫在這裡，例如`replicas: 2`要2個Pod。
- **下半部：被控制對象的模板**：`template`就是一個Pod的定義（Pod template），controller照著它建立Pod。
- **`selector`要對得上`template`的`labels`**：controller用`selector`找出「哪些Pod是我在管的」，再拿來和期望狀態比較。

其他controller也是同樣的結構，只是期望狀態和被控制的對象不同：

| controller            | 期望狀態           | 被控制對象                         |
| --------------------- | ------------------ | ---------------------------------- |
| **Deployment**  | replicas、更新策略 | ReplicaSet（再由它管理Pod）        |
| **ReplicaSet**  | replicas           | Pod                                |
| **StatefulSet** | replicas、啟動順序 | Pod（每個有固定的名稱和自己的PVC） |
| **DaemonSet**   | 每個Node一個       | Pod                                |
| **Job**         | 要成功完成幾次     | Pod                                |

### 🔗 4. ownerReferences：記錄誰擁有誰

controller照模板建立object時，會在新object的`metadata.ownerReferences`裡記下***它的擁有者***。所以每個API object都有這個欄位。Deployment其實不直接擁有Pod，中間還有一層ReplicaSet：

```
Deployment nginx-deployment
└── ReplicaSet nginx-deployment-7c5ddbdf54        ← ownerReferences指向Deployment
    ├── Pod nginx-deployment-7c5ddbdf54-x2kqp     ← ownerReferences指向ReplicaSet
    └── Pod nginx-deployment-7c5ddbdf54-9pq7r
```

```bash
kubectl get pod nginx-deployment-7c5ddbdf54-x2kqp \
  -o jsonpath='{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}'
# → ReplicaSet/nginx-deployment-7c5ddbdf54

kubectl describe pod nginx-deployment-7c5ddbdf54-x2kqp | grep "Controlled By"
# → Controlled By:  ReplicaSet/nginx-deployment-7c5ddbdf54
```

它的用途：

- **一起刪除**：刪掉Deployment時，garbage collector照著`ownerReferences`往下找，把它的ReplicaSet和Pod一起刪掉。
- **不搶別人的Pod**：一個Pod的label就算剛好符合某個controller的`selector`，只要它的owner是別人，這個controller也不會去管它。

> [!NOTE]
> Deployment中間多一層ReplicaSet，是為了做rolling update：更新image時，Deployment建立一個新的ReplicaSet，再逐步把新的調多、舊的調少。每個ReplicaSet只負責「維持幾個Pod」，更新的流程由Deployment控制。見[Deployment](#deployment)。

> [!TIP]
> 💡 **一句話總結**
>
> ***每個controller都是一個控制循環：拿期望狀態和實際狀態比較，不一樣就動手調整***。controller的YAML上半部寫期望狀態，下半部是被控制對象的模板，建立出來的object用`ownerReferences`記住自己屬於誰。

## Deployment

*Deployment、ReplicaSet和Pod是什麼關係？*

Deployment**不直接管理Pod**：它**管理ReplicaSet，ReplicaSet再管理Pod**，每一層都用[ownerReferences](#-4-ownerreferences記錄誰擁有誰)記錄自己的擁有者。Deployment同樣透過控制器模式，調整ReplicaSet的***數量和屬性***，實現兩種編排動作：[rolling update](#-2-rolling-update)和[scale out / scale in](#-3-scale-out--scale-in)。

### 📋 1. ReplicaSet

一個ReplicaSet object，就是***`replicas`的定義，加上一個Pod template***。它的YAML和Deployment幾乎一樣，下面用同一份YAML標出差別，★的兩行改掉，就是一個ReplicaSet：

```{.yaml hl_lines="2 10 11"}
apiVersion: apps/v1
kind: Deployment                  # ★ 改成ReplicaSet
metadata:
  name: nginx-deployment
spec:
  replicas: 3                     # 共通：期望狀態，維持3個Pod
  selector:                       # 共通：用label找出自己管的Pod
    matchLabels:
      app: nginx
  strategy:                       # ★ 只有Deployment有，ReplicaSet要拿掉
    type: RollingUpdate           #   rolling update怎麼做
  template:                       # 共通：Pod template，照這個建立Pod
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
```

- **ReplicaSet是Deployment的子集**：`replicas`、`selector`、`template`兩者共通；Deployment多了rolling update相關的欄位，例如`strategy`、`revisionHistoryLimit`，沒寫的話就用預設值。
- **ReplicaSet只做一件事**：讓label符合的Pod維持`replicas`個，少了就建立、多了就刪除。
- ***Deployment controller實際操作的是ReplicaSet，不是Pod***：它只調整各個ReplicaSet的`replicas`；真正建立、刪除Pod的，是ReplicaSet controller。
- **一般不直接建立ReplicaSet**：直接用Deployment，才有rolling update和回到上一版的功能。

### 🔄 2. Rolling update

<img src="images/ch05/deployment-replicaset-pod.svg" alt="Deployment、ReplicaSet和Pod的關係：Deployment nginx-deployment（replicas: 3）底下有ReplicaSet v1（nginx:1.26，replicas: 2）和ReplicaSet v2（nginx:1.27，replicas: 1）；v1有2個舊版本的Pod，逐步減少到0，v2有1個新版本的Pod，逐步增加到3，是rolling update進行到一半的狀態" width="75%">

- **Deployment管理ReplicaSet**：改了Pod template，例如image從`nginx:1.26`換成`nginx:1.27`，Deployment就建立一個新的ReplicaSet（v2）。每個ReplicaSet對應***一個版本***的Pod template。
- **逐步替換**：Deployment把v2一個一個調多、v1一個一個調少，直到v2有3個、v1剩0個。圖裡就是更新到一半的狀態：v1還有2個Pod，v2已經有1個。

像這樣，把cluster裡正在執行的多個Pod版本，***交替地逐一升級***，就是rolling update。完成之後，看新、舊兩個ReplicaSet的最終狀態：

```bash
kubectl get rs
# → NAME                          DESIRED   CURRENT   READY   AGE
#   nginx-deployment-1764197365   3         3         3       6s    ← v2：新版本
#   nginx-deployment-3167673210   0         0         0       30s   ← v1：舊版本
```

- **舊的ReplicaSet不會刪掉**：只是`replicas`變成0。`kubectl rollout undo`回到上一版時，Deployment就是把它重新調多，見[Rollback](#-4-rollback回到之前的版本)。保留幾個舊版本，由`revisionHistoryLimit`決定，預設10個。

### 📈 3. Scale out / scale in

scale最簡單：Deployment controller只要修改它所控制的ReplicaSet的`replicas`就好。

```bash
kubectl scale deployment nginx-deployment --replicas=4      # 3 → 4

kubectl get replicaset
# → NAME                          DESIRED   CURRENT   READY   AGE
#   nginx-deployment-7c5ddbdf54   4         4         3       10m
```

- **scale out**：`replicas`從3改成4，ReplicaSet發現少了1個Pod，就照Pod template再建立一個。
- **scale in**：反過來，`replicas`調小，ReplicaSet就刪掉多出來的Pod。
- **不會建立新的ReplicaSet**：scale只改數量，沒有改Pod template，所以還是同一個ReplicaSet。改了template（例如換image），才會觸發[rolling update](#-2-rolling-update)，建立新的ReplicaSet。
- **也可以自動scale**：HorizontalPodAutoscaler依CPU使用率等指標，自動調整Deployment的`replicas`。

### ⏪ 4. Rollback：回到之前的版本

每次修改Pod template，都會產生一個新的***revision***，各自對應一個ReplicaSet。假設依序做了3次變更：建立（`nginx:1.26`）、升級到`nginx:1.27`，以及一次打錯版本號、更新失敗的`nginx:1.91`。

**① 記下每次變更的原因**：在annotation `kubernetes.io/change-cause`寫下說明，`rollout history`會顯示它。

```bash
kubectl set image deployment/nginx-deployment nginx=nginx:1.91
kubectl annotate deployment/nginx-deployment kubernetes.io/change-cause="升級到nginx:1.91"
```

**② 查看歷史**：

```bash
kubectl rollout history deployment/nginx-deployment
# → REVISION  CHANGE-CAUSE
#   1         建立：nginx:1.26
#   2         升級到nginx:1.27
#   3         升級到nginx:1.91      ← 這個image不存在，新的Pod一直起不來

# 看revision 2的Pod template細節
kubectl rollout history deployment/nginx-deployment --revision=2
```

**③ 回到指定的revision**：

```bash
kubectl rollout undo deployment/nginx-deployment --to-revision=2
# → deployment.apps/nginx-deployment rolled back
```

- **rollback也是rolling update**：Deployment controller把revision 2的ReplicaSet調多、revision 3的調少，和[rolling update](#-2-rolling-update)一樣逐步替換。
- **不加`--to-revision`**：回到上一個revision。
- **revision號碼會往上加**：回到revision 2之後，它變成***revision 4***，歷史裡的2就不見了。
- **能回到多久以前**：由`revisionHistoryLimit`決定，預設保留10個舊的ReplicaSet。

> [!NOTE]
> **一次改好幾個地方：`rollout pause`**
>
> 每改一次Pod template，就會觸發一次rolling update、多一個revision。要同時改image和資源上限這類好幾個地方時，可以先暫停：
>
> ```bash
> # ① 暫停：之後的修改先不觸發rolling update
> kubectl rollout pause deployment/nginx-deployment
> # ② 修改1：換image（還不會更新Pod）
> kubectl set image deployment/nginx-deployment nginx=nginx:1.27
> # ③ 修改2：調整mem上限（還不會更新Pod）
> kubectl set resources deployment/nginx-deployment -c nginx --limits=memory=256Mi
> # ④ 恢復：②③的修改一次生效，只觸發一次rolling update
> kubectl rollout resume deployment/nginx-deployment
> ```
>
> - **只產生一次rolling update、一個revision**：pause期間的修改都會累積起來，resume之後一起套用。
> - **pause期間scale照常**：改`replicas`不受影響，因為scale不會改Pod template。
> - **pause期間不能rollback**：要先`resume`，才能`rollout undo`。

## Service

*Pod的IP會變，client要怎麼穩定地找到它們？*

Service是Kubernetes用來***把一組Pod暴露給外界存取***的機制。例如一個Deployment有3個Pod，就可以定義一個Service；client只要連到這個Service，就會連到其中一個Pod。為什麼需要它，見[第2章的存取關係：Service](chap-2-kubernetes-architecture.md#存取關係service)。

### 🚪 1. 什麼是Service：一組Pod的固定入口

```{.yaml hl_lines="6 7"}
apiVersion: v1
kind: Service
metadata:
  name: nginx
spec:
  selector:               # 用label找出這個Service背後的Pod
    app: nginx
  ports:
    - port: 80            # Service的port
      targetPort: 80      # 轉發到Pod的port
```

- **用`selector`找Pod**：和[controller的`selector`](#-3-控制器的兩半定義和模板)一樣，帶`app: nginx` label的Pod，就是這個Service背後的Pod。
- **Pod換了也不用改**：Pod重建、IP改了，Kubernetes會自動更新Service背後的Pod清單（EndpointSlice），client完全不用知道。
- **固定的DNS名稱**：CoreDNS替Service建立`nginx.default.svc.cluster.local`這樣的名稱，同一個namespace裡直接用`nginx`就連得到。
- **流量怎麼轉到Pod**：每個Node上的kube-proxy把轉發規則寫進kernel，見[kube-proxy在哪裡、做什麼](chap-2-kubernetes-architecture.md#kube-proxy在哪裡做什麼)。

### 🔀 2. 怎麼存取Service：VIP和DNS

Service有兩種被存取的方式，其中DNS又分成兩種：

```
存取Service
├── ① VIP：直接連Service的IP，例如10.0.23.1
│         → kube-proxy把request轉到其中一個Pod
│
└── ② DNS：連my-svc.my-namespace.svc.cluster.local
          ├── ⓐ Normal Service：DNS解析成Service的VIP → 接下來和①一樣
          └── ⓑ Headless Service：DNS直接解析成Pod的IP（不分配VIP）
```

- **① VIP**：Virtual IP，不屬於任何一台機器的虛擬IP。連到它的request，由每個Node上的kube-proxy轉到Service背後的某一個Pod。
- **② DNS**：連Service的DNS名稱，例如`my-svc.my-namespace.svc.cluster.local`，由CoreDNS解析。依Service有沒有VIP，又分成兩種：
    - **ⓐ Normal Service**：有VIP，DNS名稱只是VIP的別名。
    - **ⓑ Headless Service**：***不分配VIP***，DNS名稱直接解析成Pod的IP。DNS會回傳所有ready Pod的IP，由client自己選一個連。

Headless Service的寫法，只差在`clusterIP: None`：

```{.yaml hl_lines="2"}
spec:
  clusterIP: None         # headless Service：不分配VIP
  selector:
    app: nginx
```

***StatefulSet就是靠headless Service，讓每個Pod有固定的DNS名稱***，見[StatefulSet](#statefulset)。

> [!NOTE]
> 從cluster外面存取Service，還有`NodePort`、`LoadBalancer`這幾種類型，以及HTTP層的Ingress / Gateway。這些屬於網路的主題，之後另外整理。

## StatefulSet

*Deployment管不好哪一類app？StatefulSet多做了什麼？*

### 🗃️ 1. Stateless vs stateful

Deployment對app做了一個簡化的假設：***一個app的所有Pod都一模一樣***。所以Pod之間沒有順序，也不在乎跑在哪一台host上，壞了一個就照template再建一個。

但有些app不符合這個假設：

- **instance之間有依賴關係**：尤其是分散式app，例如主從（primary / replica）、主備（active / standby）。誰先啟動、誰是primary，都有講究。
- **每個instance有自己的資料**：DB這類storage app，每個instance通常在local disk上存著自己的一份資料。instance被刪掉後，就算重建出來，***instance和資料之間的對應關係也已經不見了***，app就會出錯。

這種***instance之間不對等***、或***instance依賴外部資料***的app，叫做***stateful app***；反過來，所有instance都一樣、可以隨意替換的，叫stateless app。

|                        | stateless app                | stateful app                                 |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| **instance之間** | 完全一樣，可以互相替換       | 不對等：有順序、有主從                       |
| **資料**         | 不存在instance裡，或可以丟掉 | 每個instance有自己的資料，重建後要接回同一份 |
| **例子**         | web server、API server       | MySQL主從、etcd、Kafka、CockroachDB          |
| **用什麼管理**   | [Deployment](#deployment)     | StatefulSet                                  |

stateful app放在哪一種storage上比較好，見[第3章「Ceph不是所有stateful app的最佳選擇」](chap-3-kubernetes-operations.md#-業界常見的做法ceph不是所有stateful-app的最佳選擇)。

### 🧩 2. StatefulSet的兩種狀態

StatefulSet把真實世界裡app的狀態，抽象成兩種：

**① topology state：instance之間不對等**

- **要照順序啟動**：例如primary A要比replica B先啟動。
- **重建時也要照同樣的順序**：把A和B兩個Pod都刪掉，再建立時還是A先、B後。
- **重建後的network identity要和原來一樣**：新的Pod要用同樣的名字、同樣的方式被找到，原本連它的client才不用改。

**② storage state：每個instance綁著自己的資料**

- **Pod A不管重建幾次，讀到的都是同一份資料**：例如Pod A第一次讀到的資料，和十分鐘後再讀到的，應該是同一份，即使這段時間Pod A被重建過。
- **最典型的例子**：DB的多個instance，每個存著自己的資料。

***StatefulSet的核心功能，就是把這兩種狀態記錄下來，在Pod重建時替新的Pod恢復***：

| 狀態                     | StatefulSet怎麼記錄                                                              | 重建後恢復成什麼                                                                                |
| ------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **topology state** | 每個Pod有固定的編號名稱：`web-0`、`web-1`……，照編號依序建立                | 同樣的名稱、同樣的DNS名稱（透過[headless Service](#-2-怎麼存取servicevip和dns)），啟動順序也一樣 |
| **storage state**  | 每個Pod有自己的PVC：`www-web-0`、`www-web-1`……（`volumeClaimTemplates`） | 重建後的`web-0`掛回同一個PVC，讀到同一份資料                                                  |

### 🏷️ 3. Topology state：serviceName和固定的DNS名稱

StatefulSet怎麼用[headless Service](#-2-怎麼存取servicevip和dns)的DNS名稱，維持Pod的topology state？先準備一個headless Service，名稱是`nginx`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx
spec:
  clusterIP: None             # headless：不分配VIP
  selector:
    app: nginx
  ports:
    - port: 80
```

再建立StatefulSet：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"        # 用上面那個headless Service，替Pod建立DNS名稱
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

***和[Deployment](#-1-replicaset)的YAML比，唯一的差別就是多了`serviceName`***。它告訴StatefulSet controller：執行[控制循環](#-2-控制循環)時，用`nginx`這個headless Service，替每個Pod保證一個***解析得到的固定身分***。

用`-w`（watch）即時看StatefulSet建立兩個Pod的過程：

```bash
kubectl get pods -w -l app=nginx
# → NAME    READY   STATUS              RESTARTS   AGE
#   web-0   0/1     Pending             0          0s
#   web-0   0/1     ContainerCreating   0          0s
#   web-0   1/1     Running             0          19s   ← web-0 Ready之後
#   web-1   0/1     Pending             0          0s    ← web-1才開始建立
#   web-1   0/1     ContainerCreating   0          0s
#   web-1   1/1     Running             0          20s
```

Pod很快就建好了，來不及看的話，用`kubectl describe statefulset web`看最後的Events，也有同樣的建立順序。結果是：

```
StatefulSet web（serviceName: nginx）
├── Pod web-0    ← web-0.nginx.default.svc.cluster.local
└── Pod web-1    ← web-1.nginx.default.svc.cluster.local
```

- **Pod名稱是固定的編號**：`<StatefulSet名稱>-<編號>`，從0開始往上加，一個編號對應一個Pod，不會重複，也不是Deployment那種亂數。
- **照編號依序建立**：`web-0`進入Running、而且conditions裡的`Ready`變成`True`之前，`web-1`一直不會建立。所以替Pod設定readiness probe很重要：沒設的話，container一啟動就算Ready，app可能還沒準備好，下一個Pod就開始建立了。conditions見[第4章的Pod的status](chap-4-container-orchestration-pod.md#-5-pod的statusphase和conditionspod-level)。
- **每個Pod有自己的DNS名稱**：`Pod名稱.Service名稱.namespace.svc.cluster.local`，直接解析成那個Pod的IP。
- **重建後身分不變**：`web-0`被刪掉，重建出來的還是叫`web-0`，DNS名稱也一樣，只有IP可能不同。client用DNS名稱連，就不受影響。

這樣，***StatefulSet就保證了Pod network identity的穩定性***：Pod怎麼重建，名稱、DNS名稱和建立順序都不變。

### 💾 4. Storage state：volumeClaimTemplates和固定的PVC

> [!NOTE]
> 撰寫中。
