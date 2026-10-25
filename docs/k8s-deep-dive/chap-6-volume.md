---
icon: lucide/hard-drive
---
# Chap-6 Volume

**目錄**

- [Projected Volume](#projected-volume)

## Projected Volume

*有些volume不是用來存資料的，而是把config、password「project」進container。它們怎麼運作？*

### 📽️ 1. 什麼是Projected Volume

大部分volume是用來***存資料***的，例如[chap-4的emptyDir、hostPath、PVC](chap-4-container-orchestration-pod.md#emptydir跟著pod生跟著pod死)。另外有幾種volume，作用是***把Kubernetes裡事先定義好的資料提供給container***：從container來看，這些檔案像是被Kubernetes「project」進來的，所以叫Projected Volume。

| 來源 | 提供什麼 |
| --- | --- |
| **Secret** | password、token、certificate這類敏感資料 |
| **ConfigMap** | 一般的config |
| **Downward API** | Pod自己的資訊：名稱、namespace、label、資源上限 |
| **ServiceAccountToken** | 存取API Server用的token |

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
- **Secret更新後，檔案會自動更新**：kubelet定期同步，會有一點延遲。改用env var注入的話，要重建Pod才會更新，見[env var還是volume](#-5-env-var還是volume)。

> [!WARNING]
> [Secret](https://kubernetes.io/docs/concepts/configuration/secret/)預設***只做base64編碼，沒有加密***，etcd裡存的內容可以直接還原。要真的加密，要另外設定[encryption at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)，或改用Vault這類外部的secret管理系統。

### ⚙️ 3. ConfigMap：一般的config

ConfigMap和Secret的用法幾乎一樣，差別在於它存的是***不敏感***的config，例如DB的位址、log等級、功能開關。

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

| | ConfigMap | Secret |
| --- | --- | --- |
| **存什麼** | 不敏感的config | password、token、certificate |
| **存在etcd裡** | 明文 | base64編碼，可另外設定encryption at rest |
| **mount到Node上** | 一般的disk | ***tmpfs（mem）***，不會寫進Node的disk |
| **權限** | 通常大家都能讀 | 可以用RBAC限制，只讓需要的人和Pod讀 |
| **大小上限** | 1MiB | 1MiB |

### 🪪 4. Downward API：讓container知道自己是誰

Downward API讓container***不用呼叫API Server***，就能拿到***自己這個Pod***的資訊：名稱、namespace、IP、所在的Node、label、資源上限。

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
- **限制：只拿得到container啟動前就確定的資訊**：Downward API拿得到的，都是Pod object上***container啟動前就確定***的欄位，例如名稱、IP、label、資源上限。container執行後才出現的資訊，例如container裡process的PID，Downward API拿不到，要在Pod裡另外放一個sidecar來取得；sidecar要看得到app的process，Pod要設定`shareProcessNamespace: true`。另外，它也只拿得到***這個Pod自己***的資訊；其他Pod或Service的資訊，還是要呼叫API Server。

### 🔄 5. env var還是volume

Secret、ConfigMap和Downward API的資訊，大多也可以用env var給container：

| | env var | volume（檔案） |
| --- | --- | --- |
| **寫法** | `env`、`envFrom`、`valueFrom` | `secret`、`configMap`、`downwardAPI`、`projected` |
| **來源更新後** | ❌ ***不會更新***，要重建Pod | ✅ kubelet定期同步，檔案自動更新（會有一點延遲） |
| **app怎麼讀** | 啟動時讀一次`getenv()` | 讀檔案；要即時生效，app要重新讀檔或監看檔案變化 |
| **適合** | 少量、啟動後不會變的值，例如Pod名稱 | config file、certificate、會變的label和config |

***一般建議用volume（檔案）的方式***，因為來源更新後，container裡看到的內容會跟著更新。

> [!NOTE]
> 用`subPath`把volume裡的單一檔案mount到某個路徑時，這個檔案***不會***自動更新，和env var一樣要重建Pod。
