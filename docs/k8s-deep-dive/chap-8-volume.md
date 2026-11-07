---
icon: lucide/hard-drive
---
# Chap-8 Storage & Volume

**目錄**

- [Projected Volume](#projected-volume)
- [PV、PVC、StorageClass](#pvpvcstorageclass)
- [CSI（Container Storage Interface）](#csicontainer-storage-interface)

## Projected Volume

*有些volume不是用來存資料的，而是把config、password「project」進container。它們怎麼運作？*

### 📽️ 1. 什麼是Projected Volume

大部分volume是用來***存資料***的，例如[chap-4的emptyDir、hostPath、PVC](chap-4-container-orchestration-pod.md#emptydir跟著pod生跟著pod死)。另外有幾種volume，作用是***把Kubernetes裡事先定義好的資料提供給container***：從container來看，這些檔案像是被Kubernetes「project」進來的，所以叫**Projected Volume**。

| 來源                          | 提供什麼                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Secret**              | password、token、certificate這類敏感資料                                                      |
| **ConfigMap**           | 一般的config                                                                                  |
| **Downward API**        | Pod自己的資訊：名稱、namespace、label、資源上限                                               |
| **ServiceAccountToken** | 存取API Server用的token，見[ServiceAccountToken](#-6-serviceaccounttokenpod怎麼存取api-server) |

這幾種都可以單獨當volume用（`secret`、`configMap`、`downwardAPI`），也可以用[`projected`](https://kubernetes.io/docs/concepts/storage/projected-volumes/)把好幾個來源***合併到同一個目錄***。

### 🔐 2. 例子：用Secret存DB的username和password

先把username、password各存成一個Secret：

```bash
kubectl create secret generic user --from-file=./username.txt
kubectl create secret generic pass --from-file=./password.txt
```

再用`projected`把兩個Secret mount到同一個目錄：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-projected-volume
spec:
  containers:
    - name: test-secret-volume
      image: busybox
      args: ["sleep", "86400"]
      volumeMounts:
        - name: mysql-cred
          mountPath: /projected-volume
          readOnly: true
  volumes:
    - name: mysql-cred
      projected:
        sources:
          - secret:
              name: user
          - secret:
              name: pass
```

```bash
kubectl exec -it test-projected-volume -- ls /projected-volume/
# → password.txt  username.txt
```

- **Secret的每個key，變成目錄裡的一個檔案**：key是檔名，value是檔案內容。
- **app只要讀檔案**：不用在程式裡寫死password，也不用呼叫Kubernetes API。
- **Secret更新後，檔案會自動更新**：kubelet定期同步，會有一點延遲。改用env var inject的話，要重建Pod才會更新，見[env var還是volume](#-5-env-var還是volume)。

> [!WARNING]
> [Secret](https://kubernetes.io/docs/concepts/configuration/secret/)default***只做base64編碼，沒有加密***，etcd裡存的內容可以直接還原。要真的加密，要另外設定[encryption at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)，或改用Vault這類外部的secret管理系統。

### ⚙️ 3. ConfigMap：一般的config

ConfigMap和Secret的用法幾乎一樣，差別在於它存的是***不敏感***的config，例如DB的位址、log等級、feature flag。

例如一個app的config file：

```bash
cat app.properties
# → db.host=mysql.default.svc.cluster.local
#   db.port=3306
#   log.level=info
#   feature.new-checkout=true

kubectl create configmap app-config --from-file=app.properties
kubectl get configmap app-config -o yaml        # -o yaml：把這個API object以YAML印出來
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  app.properties: |                             # key是檔名，value是整個檔案內容
    db.host=mysql.default.svc.cluster.local
    db.port=3306
    log.level=info
    feature.new-checkout=true
```

Pod裡用`configMap` volume把它mount進來，app照樣讀`/etc/app/app.properties`：

```yaml
spec:
  containers:
    - name: app
      image: example/my-app:1.0
      volumeMounts:
        - name: config
          mountPath: /etc/app
  volumes:
    - name: config
      configMap:
        name: app-config
```

- **建立方式**：`kubectl create configmap`可以從檔案（`--from-file`）、整個目錄，或直接給key=value（`--from-literal`）建立，也可以直接寫ConfigMap的YAML。
- **也可以變成env var**：用`envFrom`或`valueFrom.configMapKeyRef`，適合少量的值；但env var不會自動更新，見[env var還是volume](#-5-env-var還是volume)。

和Secret比較：

|                         | ConfigMap      | Secret                                         |
| ----------------------- | -------------- | ---------------------------------------------- |
| **存什麼**        | 不敏感的config | password、token、certificate                   |
| **存在etcd裡**    | 明文           | base64編碼，可另外設定encryption at rest       |
| **mount到Node上** | 一般的disk     | ***tmpfs（mem）***，不會寫進Node的disk |
| **權限**          | 通常大家都能讀 | 可以用RBAC限制，只讓需要的人和Pod讀            |
| **大小上限**      | 1MiB           | 1MiB                                           |

### 🪪 4. Downward API：讓container知道自己是誰

**Downward API**讓container***不用呼叫API Server***，就能拿到***自己這個Pod***的資訊：名稱、namespace、IP、所在的Node、label、資源上限。

下面的Pod同時用了***2種辦法***，把Pod的資訊給container：***給法一：env var***（`env`），***給法二：volume***（`downwardAPI`）。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-7d4f9
  labels:                                   # ① 來源：Pod自己的label
    app: web
    version: v2
spec:
  containers:
    - name: app
      image: busybox
      command: ["sleep", "3600"]
      env:                                  # 給法一：env var，啟動時給一次
        - name: MY_POD_NAME                 # → MY_POD_NAME=web-7d4f9
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: MY_NODE_NAME                # → MY_NODE_NAME=worker1
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: MY_POD_IP                   # → MY_POD_IP=10.244.1.5
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
      resources:
        limits:
          memory: 128Mi
      volumeMounts:
        - name: podinfo
          mountPath: /etc/podinfo           # ③ mount到container裡的/etc/podinfo
  volumes:
    - name: podinfo
      downwardAPI:                          # 給法二：volume，每個欄位一個檔案
        items:
          - path: labels                    # ② kubelet把①寫成檔案labels：
            fieldRef:                       #    每行一個key="value"
              fieldPath: metadata.labels
          - path: mem_limit                 # 檔案mem_limit：上面的limits.memory
            resourceFieldRef:
              containerName: app
              resource: limits.memory
```

```bash
# 給法一：env var
kubectl exec web-7d4f9 -- env | grep MY_
# → MY_POD_NAME=web-7d4f9
#   MY_NODE_NAME=worker1
#   MY_POD_IP=10.244.1.5

# 給法二：volume，downwardAPI的每個item變成一個檔案
kubectl exec web-7d4f9 -- ls /etc/podinfo
# → labels  mem_limit

kubectl exec web-7d4f9 -- cat /etc/podinfo/labels
# → app="web"            ← 來自metadata.labels的 app: web
#   version="v2"         ← 來自metadata.labels的 version: v2

kubectl exec web-7d4f9 -- cat /etc/podinfo/mem_limit
# → 134217728            ← 來自limits.memory的128Mi，單位是byte（128 × 1024 × 1024）
```

- **兩種給法**：
  - env var（`fieldRef`）：適合名稱、IP、Node名稱這類固定的值；
  - volume（`downwardAPI`）：每個欄位變成一個檔案，適合label、annotation，***它們改了，檔案會跟著更新***。
- **常見用途**：
  - log和metrics裡帶上Pod名稱和Node名稱，方便追查；
  - app依資源上限調整自己，例如JVM依`limits.memory`決定heap大小。
- **限制：只拿得到container啟動前就確定的資訊**：Downward API拿得到的，都是Pod object上***container啟動前就確定***的欄位，例如名稱、IP、label、資源上限。container執行後才出現的資訊，例如container裡process的PID，Downward API拿不到，要在Pod裡另外放一個sidecar來取得；sidecar要看得到app的process，Pod要設定`shareProcessNamespace: true`。另外，它也只拿得到***這個Pod自己***的資訊；其他Pod或Service的資訊，還是要呼叫API Server，見[ServiceAccountToken](#-6-serviceaccounttokenpod怎麼存取api-server)。

### 🔄 5. env var還是volume

Secret、ConfigMap和Downward API的資訊，大多也可以用env var給container：

|                      | env var                              | volume（檔案）                                            |
| -------------------- | ------------------------------------ | --------------------------------------------------------- |
| **寫法**       | `env`、`envFrom`、`valueFrom`  | `secret`、`configMap`、`downwardAPI`、`projected` |
| **來源更新後** | ❌ ***不會更新***，要重建Pod | ✅ kubelet定期同步，檔案自動更新（會有一點延遲）          |
| **app怎麼讀**  | 啟動時讀一次`getenv()`             | 讀檔案；要即時生效，app要重新讀檔或監看檔案變化           |
| **適合**       | 少量、啟動後不會變的值，例如Pod名稱  | config file、certificate、會變的label和config             |

***一般建議用volume（檔案）的方式***，因為來源更新後，container裡看到的內容會跟著更新。

> [!NOTE]
> 用`subPath`把volume裡的單一檔案mount到某個路徑時，這個檔案***不會***自動更新，和env var一樣要重建Pod。

### 🎫 6. ServiceAccountToken：Pod怎麼存取API Server

有些Pod裡的程式要***操作Kubernetes API***，例如[controller](chap-5-container-orchestration-controller.md#控制器模式)、CI的agent、[Headlamp](chap-3-kubernetes-architecture-operations.md#-step-7deploy-dashboardheadlamp)這類web UI。API Server收到request時，要先回答兩個問題：

| 問題                                  | 誰負責                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **你是誰**（authentication）    | ***ServiceAccount***：Pod的身分，用token證明                                                     |
| **你能做什麼**（authorization） | ***RBAC***：Role / ClusterRole定義權限，RoleBinding / ClusterRoleBinding把權限綁到ServiceAccount |

***ServiceAccount本身只是身分，不帶任何權限***。權限要另外用RBAC綁上去。

**① Pod怎麼自動拿到token**

每個namespace都有一個叫`default`的ServiceAccount。Pod沒有指定`serviceAccountName`時就用它，而且Kubernetes會自動替Pod加上一個**projected volume**，mount到每個container的`/var/run/secrets/kubernetes.io/serviceaccount/`：

```bash
kubectl describe pod web-7d4f9
```

```
Containers:
  app:
    Mounts:
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-7xk2q (ro)
Volumes:
  kube-api-access-7xk2q:
    Type:                    Projected (a volume that contains injected data from multiple sources)
    TokenExpirationSeconds:  3607
    ConfigMapName:           kube-root-ca.crt
    ConfigMapOptional:       <nil>
    DownwardAPI:             true
```

`kube-api-access-7xk2q`就是用[`projected`](#-1-什麼是projected-volume)把三個來源合併到同一個目錄，等於自動加了這段YAML：

<!-- hl: 4 5 6 -->

```yaml
volumes:
  - name: kube-api-access-7xk2q
    projected:
      sources:
        - serviceAccountToken:          # 來源一：token
            expirationSeconds: 3607
            path: token
        - configMap:                    # 來源二：ConfigMap
            name: kube-root-ca.crt
            items:
              - key: ca.crt
                path: ca.crt
        - downwardAPI:                  # 來源三：Downward API
            items:
              - path: namespace
                fieldRef:
                  fieldPath: metadata.namespace
```

| 檔案                    | 來源                                                        | 用途                                                         |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| **`token`**     | `serviceAccountToken`                                     | 證明身分，放在HTTP header：`Authorization: Bearer <token>` |
| **`ca.crt`**    | ConfigMap `kube-root-ca.crt`（每個namespace都自動有一份） | 驗證API Server的certificate                                  |
| **`namespace`** | [`downwardAPI`](#-4-downward-api讓container知道自己是誰)   | 這個Pod所在的namespace                                       |

**② token的特性**

- **不存在Secret裡**：kubelet透過API Server的***TokenRequest API***替這個Pod申請token，直接寫進volume。[Headlamp登入用的`kubectl create token`](chap-3-kubernetes-architecture-operations.md#-step-7deploy-dashboardheadlamp)，走的也是同一個API。
- **有期限**：大約1小時。kubelet會在到期前申請新的token、更新檔案（volume會自動更新，見[env var還是volume](#-5-env-var還是volume)），所以app要定期重新讀檔，不能啟動時讀一次就一直用。官方的client lib（例如Go的client-go）已經處理好了。
- **綁定這個Pod**：Pod刪掉，token馬上失效，就算外洩也用不了多久。

**③ 在Pod裡存取API Server**

client-go的`rest.InClusterConfig()`做的事情，就是讀上面三個檔案，再用env var `KUBERNETES_SERVICE_HOST`、`KUBERNETES_SERVICE_PORT`找到API Server。用`curl`手動做一次（container裡要有`curl`）：

```bash
SA=/var/run/secrets/kubernetes.io/serviceaccount
curl --cacert $SA/ca.crt \
  -H "Authorization: Bearer $(cat $SA/token)" \
  https://kubernetes.default.svc/api/v1/namespaces/$(cat $SA/namespace)/pods
# → "message": "pods is forbidden: User \"system:serviceaccount:default:default\"
#   cannot list resource \"pods\" in API group \"\" in the namespace \"default\""
```

- **`kubernetes.default.svc`**：`default` namespace裡叫`kubernetes`的Service，就是API Server的固定入口，見[Service的DNS](chap-5-container-orchestration-controller.md#-2-怎麼存取servicevip和dns)。
- **403 Forbidden**：API Server認出了身分`system:serviceaccount:default:default`（namespace `default`裡的`default` ServiceAccount），但***它沒有權限list Pod***。`default` ServiceAccount幾乎沒有權限。

**④ 用RBAC給權限**

建一個只能讀Pod的ServiceAccount：

<!-- hl: 13 -->

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pod-reader
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
rules:
  - apiGroups: [""]                   # ""：core API group，Pod在這裡
    resources: ["pods"]
    verbs: ["get", "list", "watch"]   # 只能讀，不能改或刪
```

<!-- hl: 5 6 7 8 -->

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader
subjects:                             # 綁給誰：ServiceAccount pod-reader
  - kind: ServiceAccount
    name: pod-reader
    namespace: default
roleRef:                              # 給什麼權限：Role pod-reader
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

Pod用`serviceAccountName`指定它：

<!-- hl: 2 -->

```yaml
spec:
  serviceAccountName: pod-reader
  containers:
    - name: app
      image: example/my-app:1.0
```

再跑一次上面的`curl`，就會return這個namespace裡的Pod清單；要刪Pod的話，一樣回403。

- **Role、ClusterRole的差別和更多用法**：見[Chap-6的RBAC](chap-6-declarative-api.md#rbac)。
- **權限給最小就好**：只給程式真正需要的resource和verb。

**⑤ 不需要就不要mount**

大部分app根本不會呼叫API Server，但token還是會被mount進去；container被入侵時，token就可能被拿去用。不需要的話，在Pod或ServiceAccount上關掉：

```yaml
spec:
  automountServiceAccountToken: false
```

> [!TIP]
> 💡 **一句話總結**
>
> ***ServiceAccount是Pod的身分，RBAC決定它能做什麼***。Kubernetes自動把token、`ca.crt`、`namespace`用projected volume mount進`/var/run/secrets/kubernetes.io/serviceaccount/`；token有期限、綁定Pod，由kubelet自動更新。

## PV、PVC、StorageClass

*一個PVC，怎麼變成container裡的持久化目錄？*

我們在Chap-5已經看過PVC和PV的基本用法：

- **PVC是開發者寫的**：***PVC 是 Pod 所希望使用的持久化volume的属性描述***。只寫要多大、怎麼存取（`accessModes`），Pod的`volumes`用`claimName`引用它，見[Chap-5的PVC](chap-5-container-orchestration-controller.md#pvc開發者只要兩步)。
- **PV是管理cluster的人提供的**：***PV是持久化volume實現***。寫清楚storage怎麼做到，例如用哪個CSI driver、哪個pool。CSI（Container Storage Interface）是Kubernetes和storage系統之間的**標準介面**，每種storage各自implement一個**CSI driver**，見[Chap-5的PV](chap-5-container-orchestration-controller.md#pv管理cluster的人提供implementation)。
- **兩者像interface和implementation**：**PVC說「要什麼」，PV說「怎麼做到」**，由Kubernetes把兩個綁在一起；開發者不用知道storage的細節。
- **PV也可以自動建立**：Kubernetes依PVC和StorageClass自動建PV（dynamic provisioning），實務上大多這樣用。大多數cluster安裝時就帶一個default StorageClass（例如kind的`standard`），PVC沒寫`storageClassName`就用它，見[StorageClass](#-3-storageclass自動建立pv)。

這一節接著看三件事：***PV和PVC怎麼綁定、PV怎麼變成host上的目錄、PV怎麼自動建立***。

<img src="images/ch08/pvc-pv-storageclass.svg" alt="PVC、PV和StorageClass的關係：Pod的volumes引用PVC（開發者寫：要多大、怎麼存取）。① Check：沒有合適的PV時，依PVC的storageClassName找到StorageClass（用哪個provisioner、什麼參數）；② Provision：StorageClass指定的Provisioner（通常是CSI driver）自動建立PV（storage的implementation）；③ Bind：PV和PVC綁定，兩者都變成Bound。StorageClass和Provisioner是管理cluster的人事先設定的" width="75%">

### 💞 1. Bind：PersistentVolumeController

kube-controller-manager裡有一個***PersistentVolumeController***，專門撮合PV和PVC：

<img src="images/ch08/pv-pvc-bind.svg" alt="PersistentVolumeController怎麼綁定PV和PVC：它在kube-controller-manager裡，不斷找還沒Bound的PVC。① 檢查條件：PVC pv-claim（開發者寫：storage 1Gi、accessModes RWO、storageClassName manual）和PV pv-volume（管理cluster的人建：capacity 10Gi、accessModes RWO、storageClassName manual），容量1Gi ≤ 10Gi、accessModes一樣、storageClassName一樣。② 寫上欄位：在PVC寫上volumeName: pv-volume指向PV，在PV寫上claimRef: pv-claim指向PVC。kubelet mount時，順著Pod的claimName → PVC的volumeName → PV，就知道storage在哪裡" width="90%">

- **控制循環**：不斷檢查每個PVC是不是`Bound`；不是的話，就在所有可用的PV裡找一個符合條件的綁上去。所以PVC先建、PV後建也沒關係，PV一出現就會被綁上。
- **綁定的條件**：兩個條件都要成立：

  - ① **`spec`滿足**：PV的`spec`要滿足PVC，例如容量夠大、`accessModes`對得上；
  - ② **`storageClassName`一致**：PV和PVC的`storageClassName`要一樣，見[Chap-5的NOTE](chap-5-container-orchestration-controller.md#pv管理cluster的人提供implementation)。

  > [!NOTE]
  > 圖裡兩邊都寫`manual`，因為這是手動建的PV。***`manual`不是default，是自己取的名字***：它只是PV和PVC上的同一個字串，cluster裡不需要真的有叫`manual`的StorageClass。PVC要是沒寫`storageClassName`，會被補上cluster的default（例如kind的`standard`），反而綁不到這個PV，見[StorageClass](#-3-storageclass自動建立pv)。

- **「綁定」是什麼**：不是什麼特別的連線，只是PersistentVolumeController在兩個object上***各寫一個欄位，互相指向對方***：

  <!-- hl: 3 7 8 -->

  ```yaml
  # PVC（開發者寫的pv-claim）
  spec:
    volumeName: pv-volume     # controller寫上：綁到哪個PV
  ---
  # PV（管理cluster的人建的pv-volume）
  spec:
    claimRef:                 # controller寫上：被哪個PVC綁走
      name: pv-claim
      namespace: default
  ```

- **為什麼要寫`volumeName`和`claimRef`**：Pod只寫了PVC的名字（`claimName: pv-claim`）。kubelet要mount時，順著Pod → PVC的`volumeName` → PV，就知道storage實際在哪裡。PV這邊的`claimRef`則讓這個PV不會再被別的PVC綁走。

### 📂 2. 從PV到container裡的目錄：CSI plugin的Attach和Mount

***container的volume，本質上就是把host上的一個目錄，[bind mount](chap-2-container-fs-security.md#mount---bind技術)到container裡***。所謂「**持久化volume**」，指的是這個host目錄裡的內容，***不會因為container刪除而消失，也不和這台host綁死***。

[emptyDir和hostPath](chap-4-container-orchestration-pod.md#emptydir跟著pod生跟著pod死)做不到：它們可能被kubelet清掉，也不能搬到別的Node。所以持久化volume通常靠**remote storage**：**remote file storage**（例如NFS），或**remote block storage**（例如cloud的disk、Ceph RBD）。

kubelet替Pod準備的volume目錄在：

```
/var/lib/kubelet/pods/<Pod的UID>/volumes/kubernetes.io~<volume類型>/<volume名字>
```

**🔌 把remote storage變成Node上的目錄**

把remote storage變成這個持久化目錄，分兩個階段。***Kubernetes的元件只決定要不要做，實際動手的是CSI plugin***：CSI driver會deploy成兩種Pod，[controller plugin和node plugin](#-2-csi-driver和sidecar)，下一節詳細介紹。

| 階段 | 做什麼 | 誰決定 | 誰執行 | 需要的參數 |
| --- | --- | --- | --- | --- |
| **① Attach** | 把remote disk接到Pod所在的Node，像替VM加一顆disk | ***AttachDetachController*** | ***controller plugin*** | Node名稱，例如：<br>`nodeName: nodeA`{ .nowrap } |
| **② Format + Mount** | 沒有file system就先format，再mount到volume目錄 | kubelet的***VolumeManager*** | ***node plugin*** | volume目錄，例如：<br>`target_path:`<br>`/var/lib/kubelet/pods/`{ .nowrap }<br>`<Pod的UID>/volumes/`{ .nowrap }<br>`kubernetes.io~csi/`{ .nowrap }<br>`<PV名字>/mount`{ .nowrap } |

<img src="images/ch08/attach-mount.svg" alt="把remote disk變成container裡的目錄。Master node（control plane）上，kube-controller-manager裡的AttachDetachController決定要不要attach，透過API Server建立VolumeAttachment，寫上nodeName: nodeA，attached從false變成true。某一台Node（通常是worker node）上的CSI controller plugin Pod（Deployment）裡，external-attacher（sidecar container）watch VolumeAttachment，用gRPC呼叫CSI driver的Controller service；CSI driver呼叫storage API，① Attach：把Storage系統裡的remote disk（例如cloud的disk、Ceph RBD）接到nodeA，完成後external-attacher寫回attached: true。Worker node nodeA（Pod所在的Node）上，nodeA多了一顆disk /dev/sdb，像替VM加一顆disk；kubelet的VolumeManager（獨立的goroutine）用gRPC呼叫node plugin Pod（DaemonSet）裡CSI driver的Node service，② format + mount到volume目錄 /var/lib/kubelet/pods/<UID>/volumes/…/<volume名字>；③ 建立container，④ bind mount到container裡的mountPath" width="90%">

1. **Attach：control plane決定，controller plugin執行**：kube-controller-manager裡的AttachDetachController決定disk要接到哪台Node後，會透過API Server建立一個VolumeAttachment（寫明`nodeName`）。***VolumeAttachment是一個API object，像一張工作單，記錄「哪個PV要接到哪台Node」***，和其他object一樣存在etcd裡。[CSI driver的controller plugin](#-2-csi-driver和sidecar)（一個Deployment，負責建立和attach disk）Pod裡的external-attacher看到它，呼叫CSI driver（`ControllerPublishVolume`），由driver呼叫storage API把remote disk接到Node上，完成後把VolumeAttachment標成`attached: true`。credentials只放在CSI controller Pod裡，不用每台Node都有；Node掛掉時也有人能detach。
2. **Format + Mount：kubelet決定，node plugin執行**：`mount`只能在Node上做，所以由kubelet負責觸發，但不在kubelet的主控制循環（SyncLoop，負責依Pod的變化建立、刪除container）裡做。mount remote disk可能要好幾秒，如果在主循環裡等，***其他Pod也會跟著卡住***。所以交給**VolumeManager**：它在kubelet裡跑在***獨立的goroutine***，用自己的循環，透過gRPC呼叫這台Node上node plugin的CSI driver，分兩步完成：

  - **`NodeStageVolume`**：format，再mount到這台Node共用的staging目錄（`/var/lib/kubelet/plugins/kubernetes.io/csi/<driver名字>/<hash>/globalmount`），同一顆disk在一台Node上只mount一次；
  - **`NodePublishVolume`**：從staging目錄bind mount到Pod的volume目錄，也就是表格裡的`target_path`。

**📦 把這個目錄掛進container**

目錄準備好之後，要讓container用到這個volume，也是兩步：

<ol start="3" markdown>
<li markdown="span">**建立container**：kubelet的主循環等volume目錄準備好，透過CRI呼叫container runtime建立container，request裡帶著「Node上的volume目錄 → container裡的`mountPath`」。</li>
<li markdown="span">**bind mount**：runtime建立container時，把volume目錄bind mount到`mountPath`。CRI只負責傳遞，真正做bind mount的是runtime；disk只在Node上mount一次，container看到的是同一個目錄。</li>
</ol>

> [!NOTE]
> **NFS這類file storage不需要Attach**：沒有disk要接到Node上，Node透過網路直接mount遠端的file system。CSI driver會宣告自己不需要attach，AttachDetachController就不建VolumeAttachment，直接進第2步；NFS本身就是file system，也不用format，由CSI driver的node plugin執行`mount -t nfs`。

刪除時反過來：先**Unmount**，再**Detach**。

### 🏭 3. StorageClass：自動建立PV

PV靠人手動建立屬於**static provisioning**，在大cluster裡做不到：可能有上千個PVC，每個都要先有一個符合的PV。所以Kubernetes提供**dynamic provisioning**：***StorageClass，就是建立PV的template***，它會義兩件事：

- **用哪個provisioner**：填***CSI driver的名字***，每種storage各有一個。例如GKE的Persistent Disk填`pd.csi.storage.gke.io`，AWS的EBS填`ebs.csi.aws.com`，[Chap-3用Rook裝的Ceph](chap-3-kubernetes-architecture-operations.md#建立storageclass再測一次pvc)（RBD block storage）填`rook-ceph.rbd.csi.ceph.com`。
- **PV的參數**：寫在`parameters`裡，key由各家driver決定。例如GKE的***disk類型***`type: pd-ssd`；Longhorn（一種開源的block storage）的***replica數***`numberOfReplicas: "3"`。

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: block-service
provisioner: pd.csi.storage.gke.io    # GKE的Persistent Disk CSI driver
parameters:
  type: pd-ssd                        # SSD類型的disk
```

管理cluster的人用`kubectl apply -f sc.yaml`建立這個StorageClass，***每個cluster只要建一次***，之後所有PVC都能用。

開發者在PVC裡寫`storageClassName: block-service`。建立PVC之後，這個CSI driver的[external-provisioner](#-1-整體架構)（和driver一起deploy的sidecar，負責watch PVC）會看到這個PVC，呼叫driver建出一塊SSD disk，再自動建立對應的PV並綁上。自動建立的PV名字是`pvc-<uid>`，`storageClassName`和PVC一樣，`Reclaim Policy` default是`Delete`：PVC刪掉，disk也會一起刪除。

- **在自己的cluster上**：[Chap-3用Rook-Ceph建立的StorageClass](chap-3-kubernetes-architecture-operations.md#建立storageclass再測一次pvc)，就是同樣的機制。
- **不在清單上的storage**：例如NFS，裝對應的CSI driver就好（例如csi-driver-nfs），它會帶著external-provisioner一起deploy。

**🔀 PVC的`storageClassName`四種寫法**

| PVC的寫法                          | 結果                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **沒寫，cluster有default**   | 建立時，`DefaultStorageClass`這個admission plugin自動補上default StorageClass，走dynamic provisioning                    |
| **沒寫，cluster沒有default** | 欄位維持沒有值，只能綁沒有StorageClass的PV。之後cluster新增了default，PersistentVolumeController會回頭補上                 |
| **寫`""`**                 | 明確表示不要StorageClass，永遠不會被補上，只綁沒有StorageClass的PV                                                         |
| **寫一個名字**               | 照寫的用。手動建PV時，PV和PVC都寫同一個名字（例如`manual`）就能配對，***cluster裡不需要真的有這個StorageClass*** |

- **default StorageClass**：StorageClass上有`storageclass.kubernetes.io/is-default-class: "true"` annotation的，就是default。
- **「沒寫」和「`""`」意思不同**：沒寫是「用default就好」；`""`是「我不要dynamic provisioning」，手動配對PV時用它，避免PVC被補上default、跑去建新的PV。

### 🤔 4. 會不會過度設計？

PV、PVC、StorageClass三層看起來很多，但實際上***開發者通常只需要寫PVC***：cluster有default StorageClass時，連`storageClassName`都不用寫，PV會自動產生、自動綁定。另外兩層是留給管理cluster的人，把storage的細節和開發者分開。

> [!TIP]
> 💡 **一句話總結**
>
> ***PVC是需求，PV是implementation，StorageClass是建PV的template***。PersistentVolumeController負責綁定；AttachDetachController和kubelet的VolumeManager分兩階段決定、CSI plugin執行，把remote storage變成host上的持久化目錄，再bind mount進container。

## CSI（Container Storage Interface）

*Kubernetes怎麼接上各家不同的storage？*

### 🗺️ 1. 整體架構

[PV、PVC、StorageClass](#pvpvcstorageclass)裡的Bind、Attach、Mount和dynamic provisioning，「**要不要做**」都由Kubernetes的**controller**和**kubelet**決定；但「**實際怎麼做**」，例如呼叫cloud API建disk、把disk接到Node、format和mount，每種storage都不一樣。CSI的設計，就是***把這些實際操作從Kubernetes的主程式拆出來，單獨包裝成外部元件（external-XXX sidecars）***：Kubernetes只建立、更新API object；外部元件watch這些object，再透過gRPC呼叫各家storage寫的CSI driver。

<img src="images/ch08/csi-architecture.svg" alt="CSI的架構：中間的CSI長短虛線左邊是Kubernetes社群維護的元件，右邊是storage提供者寫的CSI driver。Master node（control plane）上，API Server存著PVC、PV、VolumeAttachment；kube-controller-manager裡的PV controller綁定PV和PVC，AttachDetachController建立VolumeAttachment。某一台Node（通常是worker node）上的controller plugin Pod（Deployment）裡，external-provisioner watch PVC，用gRPC呼叫CSI driver建立disk，再建立PV；external-attacher watch VolumeAttachment，呼叫CSI driver把disk接到Node；另外還可以有其他external sidecar，例如resizer、snapshotter。這個CSI driver開Identity和Controller兩個service，不開Node（虛線框），呼叫storage API。每台Node上的node plugin Pod（DaemonSet）裡，node-driver-registrar向kubelet登記這個CSI driver；kubelet裡的VolumeManager mount時直接用gRPC呼叫CSI driver做format+mount；這個CSI driver開Identity和Node兩個service，不開Controller（虛線框），把remote storage（cloud的disk、Ceph、NFS）mount到Node上。橘色虛線框是Pod，一個CSI driver deploy成這兩個Pod；灰色虛線框是Node；粉色是main container（CSI driver），綠色是sidecar container，兩者透過unix socket溝通" width="90%">

### 🧩 2. CSI driver和sidecar

圖中間那條橘色長短虛線就是CSI：左邊是**Kubernetes社群維護**的***外部sidecar元件***，右邊是**storage提供者寫**的***CSI driver***。

- **sidecar**：Kubernetes社群（SIG Storage）維護的container，和CSI driver放在**同一個Pod**裡。sidecar透過**unix socket**呼叫CSI driver：

  - **external-provisioner**：watch PVC，***只處理StorageClass的`provisioner`是自己driver名字的PVC***，呼叫CSI driver建立disk（`CreateVolume`），再建立對應的PV，見[dynamic provisioning](#-3-storageclass自動建立pv)；

    > [!NOTE]
    > 例如GKE上同時裝了Persistent Disk和Filestore兩個CSI driver，就有兩個external-provisioner。PVC寫`storageClassName: block-service`，這個StorageClass的`provisioner`是`pd.csi.storage.gke.io`，所以只有Persistent Disk的external-provisioner接手，Filestore的那個會略過。
    >
    > <img src="images/ch08/provisioner-match.svg" alt="external-provisioner怎麼決定要不要接手：API Server裡，PVC寫storageClassName: block-service，指向StorageClass block-service，它的provisioner是pd.csi.storage.gke.io。Persistent Disk和Filestore兩個controller plugin Pod裡的external-provisioner都watch PVC、讀StorageClass，比對provisioner欄位：Persistent Disk的CSI driver名字是pd.csi.storage.gke.io，名字一樣，接手建disk和PV；Filestore的CSI driver名字是filestore.csi.storage.gke.io，名字不一樣，略過" width="90%">
    >
  - **external-attacher**：watch VolumeAttachment，呼叫CSI driver把disk接到Node（`ControllerPublishVolume`），見[Attach和Mount](#-2-從pv到container裡的目錄csi-plugin的attach和mount)；
  - **node-driver-registrar**：向這台Node的kubelet登記這個CSI driver，讓kubelet知道這台Node上有這個driver，以及它的socket在哪裡。它**不做任何storage操作**；
  - **external-resizer**：watch PVC，PVC要求的容量變大時，呼叫CSI driver擴容（`ControllerExpandVolume`）；
  - **external-snapshotter**：watch VolumeSnapshotContent，呼叫CSI driver建立snapshot（`CreateSnapshot`）。
- **CSI driver**：storage提供者（cloud provider、storage廠商、開源storage project）寫的程式，通常只有**一個binary**，用gRPC提供**3組service**：

  | Service              | 做什麼                                                                            | 在哪個Pod開       |
  | -------------------- | --------------------------------------------------------------------------------- | ----------------- |
  | **Identity**   | 回報driver的名字和功能                                                            | 兩種Pod都會開     |
  | **Controller** | 不需要在特定Node上做的事，例如建立 / 刪除disk、attach / detach，會呼叫storage API | controller plugin |
  | **Node**       | 一定要在那台Node上做的事，例如format、mount                                       | node plugin       |


  <img src="images/ch08/csi-same-binary.svg" alt="同一個CSI driver image，用不同的啟動參數deploy成兩種Pod：args: controller的是controller plugin Pod（Deployment），CSI driver開Identity和Controller，不開Node；args: node的是node plugin Pod（DaemonSet），CSI driver開Identity和Node，不開Controller" width="90%">

  這個binary會deploy成**兩種Pod**，只是開的service和搭配的sidecar不一樣：

  - **controller plugin**：Deployment，同時只有**一個**在工作。裡面的sidecar（external-provisioner、external-attacher）watch PVC、VolumeAttachment這些API object，有變化就呼叫CSI driver建立disk、把disk attach到Node。這些都是呼叫storage API，在哪台Node上做都一樣，所以不用每台Node都跑；storage的**credentials**也只放在這裡，***不用發到每台Node上***。
  - **node plugin**：DaemonSet，**每台Node一個**，搭配node-driver-registrar。它不watch API object，而是由kubelet直接呼叫，負責把disk format、mount到Node上。這些***一定要在disk接上的那台Node上做***，所以每台Node都要有一個。
  - **例子**：[Chap-3裝的Rook-Ceph](chap-3-kubernetes-architecture-operations.md#建立ceph-cluster)就是這樣，`…-ctrlplugin-…`是controller plugin，`…-nodeplugin-…`是node plugin。

> [!TIP]
> 💡 **一句話總結**
>
> ***Kubernetes決定要做什麼，CSI driver負責怎麼做***。controller plugin（Deployment）裡的sidecar watch PVC和VolumeAttachment，呼叫driver建disk、attach；node plugin（DaemonSet）在每台Node上，由kubelet直接呼叫，負責format和mount。
