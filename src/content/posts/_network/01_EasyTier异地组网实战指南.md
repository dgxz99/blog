---
id: 01NEBZC37NXA
title: "EasyTier异地组网实战指南"
description: "从NAT穿透原理到GUI、CLI与Docker混合部署，记录EasyTier异地组网、自建共享节点、访问控制与连通性排查的完整流程"
pubDatetime: 2026-10-31T22:38:59+08:00
draft: false
tags:
  - EasyTier
  - Linux
  - Docker
  - 异地组网
---

平时在多地办公或维护家庭设备时，经常会遇到这样的痛点：家里的NAS存着核心数据，办公室的台式机需要跑重载编译，随身携带的笔记本要随时访问前两者的服务，而云上还挂着一台低配置的Linux云服务器。由于家庭宽带和公司内网普遍缺乏公网IPv4地址，即便有IPv6，在移动网络或纯IPv4环境下也会时常断连。

过去常见的解法是部署FRP或NPS做端口映射。但这种方式的致命短板是**常规代理模式下，业务流量需要经过公网服务器中转**，国内轻量云服务器的下行和上行带宽普遍被限制在3Mbps到8Mbps，传输大文件时速度极慢。另一种解法是自建WireGuard或OpenVPN，但常见的中心节点部署通常需要至少一端具有可被访问的公网地址或端口映射。Tailscale固然成熟，但在完全依靠自建国内中继（DERP）与网络打洞环境较为苛刻的场景下，其配置门槛与依赖外部账号系统的机制仍有一定局限。

[EasyTier](https://easytier.cn/)是一套采用Rust编写的去中心化P2P虚拟局域网（Mesh VPN）方案。它不仅支持节点间自动UDP打洞建立低延迟直连，而且不强制依赖中心化控制器；只要任意两台设备能共同连接到一个公共或自建的“共享节点”，就可以自动完成握手、寻址并建立对等网络。

在具体部署时，很多用户在GUI（图形界面）与CLI（命令行）之间纠结。其实最佳的实践是**混合搭配**：

- **Windows或macOS等桌面端**：直接使用开箱即用的**官方GUI**，界面直观，配置与拓扑一目了然
- **Linux工作站、NAS或云服务器等无头设备**：直接运行轻量的**CLI程序**，并配合Systemd守护进程实现开机静默常驻
- **公网协调服务器**：强烈推荐使用**Docker Compose**自建共享节点，隔离干净，升级与维护极其省心

本文将从NAT穿透底层机制出发，系统拆解EasyTier的工作原理，以真实异地混合环境为主线，手把手带大家搭建一条高速、稳定、打洞成功后流量不经过服务器的私有虚拟内网。

![EasyTier去中心化Mesh组网拓扑架构](https://dg-typora.oss-cn-chengdu.aliyuncs.com/01-framework-mesh-network-topology.png)

## 1，网络基础与P2P组网原理

在深入具体工具前，有必要先理清两台位于不同NAT（网络地址转换）后面的设备究竟如何建立直接通信。

### (1) 传统C/S架构与P2P网络拓扑

在传统的客户端与服务器（C/S）架构中，服务器部署在具有公网固定IP的机房内，监听已知端口。内网客户端A和客户端B发起请求时，路由器会为它们建立出站映射，流量必须经由服务器集中转发。这种架构模型简单可靠，但传输带宽完全受制于中心服务器的上下行瓶颈，且物理距离会导致额外的延迟。

对等网络（P2P）的目标是打破中心转发依赖，让设备A与设备B之间建立一条跨越公网的端到端隧道。即便两端都没有公网IP，只要通信双方能在底层路由器的NAT表中协商出一条可以直接互通的双向通道，后续所有流量即可在两台终端之间点对点全速传输。

![传统云中继模式vs EasyTier P2P直连模式对比](https://dg-typora.oss-cn-chengdu.aliyuncs.com/02-comparison-relay-vs-p2p.png)

### (2) NAT穿透与UDP打洞机制

大多数家用路由器与企业网关都开启了NAPT（网络地址端口转换）。当内网主机`192.168.1.100:5000`向外网发起UDP请求时，路由器会为其分配一个公网映射，例如`203.0.113.10:45000`。外网设备若直接向`203.0.113.10:45000`发送数据包，路由器是否放行，取决于该NAT的类型：

1. **全锥型（Full Cone NAT / NAT1）**：内网端口一旦映射为外网端口，任何公网IP发送给该外网端口的数据包都会被路由器无条件转发至内网主机。打洞极易成功
2. **受限锥型（Restricted Cone NAT / NAT2）**：仅允许内网主机曾经主动发送过数据包的目标公网IP回传数据，不限制目标端口
3. **端口受限锥型（Port Restricted Cone NAT / NAT3）**：不仅限制目标公网IP，还限制目标公网端口。只有内网主机向特定`IP:Port`发过包，该特定`IP:Port`发回的数据包才被放行
4. **对称型（Symmetric NAT / NAT4）**：内网主机向每一个不同的外部`IP:Port`通信时，路由器都会分配一个全新的随机公网映射端口。由于端口无法预测，两台同处对称型NAT下的设备通常难以完成常规UDP打洞，具体仍取决于端口分配行为与工具实现

UDP打洞（UDP Hole Punching）的核心步骤如下：

- 节点A和节点B同时向具备公网IP的协调服务器发送UDP探测包
- 协调服务器作为第三方观察者，分别记录下A在公网呈现的映射地址`IPA:PortA`以及B的映射地址`IPB:PortB`
- 协调服务器通过控制信令，把`IPB:PortB`告知节点A，把`IPA:PortA`告知节点B
- 节点A尝试向`IPB:PortB`发送UDP包，节点B也同时向`IPA:PortA`发送UDP包
- 双方路由器均在本地状态表中记录了“本端已向对端主动发包”，防火墙过滤规则随之被打开，后续点对点直连隧道正式建立

![NAT穿透与UDP打洞机制时序流程图](https://dg-typora.oss-cn-chengdu.aliyuncs.com/03-flowchart-udp-hole-punching.png)

### (3) 直连与中继机制及协调节点的开销

打洞成功后，数据直接通过电信、联通或移动骨干网在A与B之间传输，延迟几乎等同于两地物理链路的真实延迟，带宽取决于通信双方宽带的上行与下行峰值。

但打洞并非百分百成功（例如双方处于对称型NAT、或者移动网络CGNAT策略极度严苛时）。此时协调节点将退化为中继服务器（Relay），负责接收节点A发送的加密数据并直接转发给节点B。中继能够保证极端网络环境下的连通性兜底，但代价是延迟可能增加，吞吐受到中继节点带宽、负载及两段链路质量的共同限制。

> **移动网络CGNAT策略说明**：手机蜂窝网络、手机热点或部分宽带可能处于运营商级NAT（CGNAT）之后，常见共享地址段为`100.64.0.0/10`。CGNAT并不等同于对称型NAT，映射、过滤和超时策略也因运营商而异。多层NAT与严格防火墙可能降低UDP打洞成功率，需要结合实际诊断，并准备可用的中继路径。

### (4) 常见异地互联方案对比

在做技术选型时，不同方案在组网架构、配置复杂度和传输性能上存在明显差异：

| 方案类别          | 代表工具             | 公网IP要求             | 流量路径                  | 穿透打洞能力                 | 典型适用场景                               |
| ----------------- | -------------------- | ---------------------- | ------------------------- | ---------------------------- | ------------------------------------------ |
| 端口映射/内网穿透 | FRP, NPS, ngrok      | 需要公网服务器         | 全程走云服务器中转        | 部分支持P2P模式              | 单个HTTP/TCP端口暴露，如临时Web测试        |
| 传统中心化VPN     | OpenVPN, 纯WireGuard | 通常需要可达的公网端点 | 汇聚到中心节点分发        | 不具备NAT穿透能力            | 企业固定分支互联、中心机房内网接入         |
| 中心化Mesh VPN    | Tailscale, ZeroTier  | 依赖官方或自建控制器   | P2P打洞，失败走中转       | 强（依托STUN/DERP）          | 个人/多团队设备统一纳管，依赖外部账号      |
| 去中心化Mesh VPN  | **EasyTier**         | 仅首次发现需共享节点   | P2P直连优先，失败自动中继 | 极强（支持多协议与混合拓扑） | 自由组网、内网穿透、私有化部署、无账号依赖 |

## 2，EasyTier核心机制与多形态生态

[EasyTier官方仓库](https://github.com/EasyTier/EasyTier)将其定义为一款简单、安全、去中心化的跨平台虚拟局域网工具。它采用Rust开发，没有复杂的中央管理平台依赖，能够通过对等组网构建高性能的私有覆盖网络（Overlay Network）。

### (1) 核心功能与技术特点

1. **去中心化拓扑**：没有严格的客户端与服务端划分，任意节点都可以作为发现对等端的中介，每个节点都可以参与网络路由计算
2. **多协议打洞与传输**：默认采用UDP协议进行NAT探测与穿透，同时支持TCP、WebSocket、WSS（加密WebSocket）、WireGuard与FakeTCP等多种协议组合，在严苛的QoS或企业网环境下穿透率更高
3. **点对点直连优先**：组网成功后自动执行STUN检测并尝试打洞。打洞成功即转为P2P直连，打洞失败则由共享节点平滑中继，用户业务层无感知
4. **端到端加密保障**：启用加密并妥善保管网络密钥时，可保护业务载荷；共享节点仍可能观察连接来源、流量大小和时序等元数据
5. **子网代理能力**：支持子网路由声明（Proxy CIDR），一台接入EasyTier的节点可以将其所在的整段本地物理局域网（如`192.168.10.0/24`）广播至整个虚拟网，被代理子网内的设备无需安装客户端，其他已接入虚拟网的异地设备即可访问该子网中路由和防火墙允许的打印机、摄像头与服务器

### (2) 工作原理与连接生命周期

EasyTier的网络启动与通信建立过程分为四个阶段：

1. **节点引导与注册**：各节点启动后，根据配置连接至共享节点
2. **虚拟IP分配**：节点通过内置去中心化IPAM模块协商虚拟IP，支持自动DHCP获取或手动指定静态IP
3. **对等信息交换与打洞**：共享节点记录各节点的网络名称哈希与公网通信端口。同一虚拟网络的节点交换对等信息，结合STUN探测结果尝试UDP打洞
4. **路由更新与故障降级**：直连隧道建立成功后，两端直连通信；若直连链路因网络波动断开，路由机制尝试切换到可用中继路径，实际恢复时间取决于链路探测、拓扑和网络状态，期间可能出现短暂中断

![EasyTier节点连接生命周期与自动降级机制](https://dg-typora.oss-cn-chengdu.aliyuncs.com/04-flowchart-connection-lifecycle.png)

### (3) 工具形态与选型原则

EasyTier的工具生态涵盖了底层核心、图形界面以及社区衍生工具，了解它们的分工有助于在不同系统下选择最高效的搭配方案：

- **官方GUI客户端（EasyTier GUI）**：基于Tauri框架构建，跨平台支持Windows、macOS、Linux及Android。界面清爽直观，支持网络参数表单化配置、对等节点发现、直连与中继状态可视识别、延迟监控以及子网代理，**最适合Windows与macOS等日常桌面办公设备**
- **命令行核心工具（easytier-core与easytier-cli）**：压缩包内包含的轻量二进制程序。`easytier-core`负责虚拟网卡驱动与网络底层包转发，`easytier-cli`用于本地IPC状态查询与诊断。体积小巧、无图形依赖、内存占用低，**最适合Linux服务器、家庭NAS（如群晖、TrueNAS、飞牛OS）、软路由或开发板**
- **Docker容器镜像**：官方维护的`easytier/easytier`镜像，集成完整运行环境，**是部署公网共享协调节点的首选方案**
- **社区衍生工具**：针对垂直领域，社区也诞生了丰富的外围项目。例如面向联机游戏的**EasyTier Game**（轻量免安装启动器，专注游戏房间一键打通）、面向深度玩家的**EasyTier Manager**（支持多配置切换与表单/文本双向同步），以及集中纳管大规模节点的**Web控制台**

在实际组网场景中，我们不需要死板地在所有设备上强求统一工具，按照个人使用习惯即可。

## 3，使用公共共享节点组网

对于刚接触EasyTier、没有公网服务器、或者仅需临时打通两台设备的用户，可以直接配合公共共享节点完成快速组网。

这里我们以最典型的跨端场景为例：

- **节点A（Windows）**：使用**官方GUI客户端**配置
- **节点B（Linux或家庭NAS）**：使用**CLI命令行**配置并加入开机自启

### (1) 公共共享节点机制与安全边界

公共共享节点由社区和志愿者提供，对外开放统一端口供全球节点连接。使用公共共享节点时，通信两端必须配置完全一致的“网络名称”与“网络密码”。

请保持加密功能开启，并使用独立的强网络密钥。中继节点通常只需转发加密业务载荷，但仍能观察连接与流量元数据；同一虚拟网络中的设备也需要遵循最小权限原则。

> **注意**：公共节点列表、默认配置与可用性可能随版本变化，本文不依赖某个固定公共地址。用户可以在[EasyTier官方讨论区](https://github.com/EasyTier/EasyTier/discussions)查找社区志愿者分享的公共共享节点，或者进行自建节点。在客户端中，只需要在【初始节点】栏目或命令行参数中直接填入节点的协议、地址与端口即可。

### (2) 下载与安装准备

本文截图来自EasyTier GUI `v2.6.4`，下方CLI安装命令保留固定版本`v2.2.1`作为示例，两者界面和参数可能存在差异。实际部署时应选择官方当前稳定版，并尽量统一各节点版本；运行前通过`easytier-core --help`核对参数。截图、示意图中的带宽与延迟仅作说明，不代表实测承诺。

推荐访问[EasyTier官方下载页面](https://easytier.cn/guide/download.html)，该页面提供了针对不同操作系统与硬件架构的清晰筛选表格，比直接在[GitHub Release发布页](https://github.com/EasyTier/EasyTier/releases)中翻找更为高效。

![EasyTier官方下载页面的操作系统与架构选择](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20261031211427088.png)

#### ① Windows节点安装（官方GUI）

下载带有`easytier-gui`前缀的Windows安装包（`.exe`）直接进行安装即可。

#### ② Linux节点安装（CLI工具）

在Linux终端中下载对应架构（以x86_64为例）的二进制压缩包并部署至系统路径：

```bash
# 确认系统架构
uname -m

# 下载对应版本的压缩包并解压
curl -LO https://github.com/EasyTier/EasyTier/releases/download/v2.2.1/easytier-linux-x86_64-v2.2.1.zip
unzip easytier-linux-x86_64-v2.2.1.zip -d /tmp/easytier

# 拷贝二进制文件至系统PATH
sudo cp /tmp/easytier/easytier-core /usr/local/bin/
sudo cp /tmp/easytier/easytier-cli /usr/local/bin/
sudo chmod +x /usr/local/bin/easytier-core /usr/local/bin/easytier-cli

# 验证安装
easytier-core --version
```

### (3) Windows端使用官方GUI建网

1. 打开EasyTier GUI，主界面默认展示【编辑网络】面板（若需要管理多个网络，可随时点击右上角的【+ 创建新网络】）
2. **虚拟IPv4地址**：默认已勾选【DHCP】复选框，网络启动后会自动在`10.126.126.0/24`网段协商分配独立IP；如果需要固定IP，可取消勾选DHCP并在右侧输入静态IP与子网掩码（如`/ 24`）
3. **网络名称**：输入一个自定义且不易重名的网络标识，例如`team_mesh_dev`
4. **网络密码**：输入足够强度的密码，例如`Secret@Pass_2026`
5. **初始节点设置**：在【初始节点】区域添加公共共享节点
   - 协议下拉框选择`tcp`（或根据节点支持情况选择`udp`）
   - 地址栏输入公共共享节点的域名或IP
   - 端口栏填写节点提供者公布的端口（常见为`11010`）
   - 如有多个可用节点，可点击下方的【+ 添加初始节点】继续添加备用地址
6. **保存与运行**：点击左上角的【保存配置】按钮持久化参数，然后点击界面正中央醒目的绿色大按钮【运行网络 ->】
7. 几秒钟后，顶部状态徽章会由灰色的【已停止】切换为绿色的【运行中】，并在上方清晰显示当前设备分配到的虚拟IPv4地址（例如`10.126.126.1`）

![EasyTier GUI网络配置界面：网络名称、密码与初始节点](https://dg-typora.oss-cn-chengdu.aliyuncs.com/clipboard_2026-10-31_21-18.png)

### (4) Linux端使用CLI接入网络

在Linux无头服务器或NAS上，可以通过命令行启动`easytier-core`并加入虚拟网络。在实际使用中，通常先用单行命令快速验证连通性，再通过配置文件配合Systemd实现长期稳定运行。

#### ① 命令行快速单行调试

如果仅需临时验证组网连通性，可以直接在终端以管理员权限执行：

```bash
# 快速启动并接入网络
sudo easytier-core \
  -d \
  --network-name team_mesh_dev \
  --network-secret "Secret@Pass_2026" \
  -p tcp://shared-node.example.com:11010
```

> `shared-node.example.com`是占位域名，必须替换成实际可用的共享节点地址。本文所有示例密码均为公开教学值，请统一替换为自行生成的强密码，不要直接用于真实网络。

参数解释：

- `-d` 启用自动DHCP分配虚拟IP（默认在`10.126.126.0/24`网段内协商）
- `--network-name` 虚拟网络名称，必须与Windows GUI端一致
- `--network-secret` 网络密码，必须与Windows GUI端一致
- `-p` 初始引导节点地址（Peer），指向公共共享节点

终端将打印初始化日志，显示TUN虚拟网卡已创建并接入网络。

#### ② 使用TOML配置文件管理节点

虽然单行命令测试方便，但随着初始节点增多或后续配置子网代理，命令行参数会变得异常繁杂，而且在系统进程列表（`ps -ef`）中会暴露网络密码明文。在Linux环境下，官方推荐通过配置文件进行集中维护。

如果不想手动手写TOML格式，可以直接访问官方提供的[EasyTier配置助手](https://easytier.cn/assistant/)。在网页表单中输入网络名称、密钥与初始节点，即可自动生成格式规范的配置文件内容。

![EasyTier配置助手：通过表单生成TOML配置](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20261031212301437.png)

在Linux系统上创建专用配置目录并写入配置文件：

```bash
sudo mkdir -p /etc/easytier
sudo install -m 600 /dev/null /etc/easytier/config.toml
sudo nano /etc/easytier/config.toml
```

配置文件`/etc/easytier/config.toml`内容示例如下：

```toml
instance_name = "team_mesh_dev"
instance_id = "31ee4370-21e2-4f78-8bc5-d7563b75f5b1"
ipv6_public_addr_auto = false
dhcp = true
listeners = [
	"tcp://0.0.0.0:11010",
	"udp://0.0.0.0:11010",
	"wg://0.0.0.0:11011",
]

[network_identity]
network_name = "team_mesh_dev"
network_secret = "Secret@Pass_2026"

[[peer]]
uri = "tcp://shared-node.example.com:11010"

[flags]
```

使用`-c`参数即可直接加载该配置文件运行：

```bash
sudo easytier-core -c /etc/easytier/config.toml
```

#### ③ 配置Linux端开机自启（Systemd）

为了让虚拟网卡在系统后台静默常驻并随系统自启，创建Systemd服务文件`/etc/systemd/system/easytier.service`，直接加载上一步创建的配置文件：

```ini
[Unit]
Description=EasyTier Networking Service
After=network.target syslog.target
Wants=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/easytier-core -c /etc/easytier/config.toml
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

启动并启用开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now easytier
sudo systemctl status easytier
```

在Linux端执行状态检查：

```bash
easytier-cli node
```

即可看到本机分配到的虚拟IP（例如`10.126.126.2`）。

### (5) 跨端双向连通性测试

此时两端均已成功运行：

- 在Windows电脑上打开命令提示符，Ping Linux主机的虚拟IP

```cmd
    ping 10.126.126.2
```

- 在Linux终端上，Ping Windows电脑的虚拟IP

```bash
   ping 10.126.126.1 -c 4
```

若能稳定收到回包，说明虚拟IP层面已连通，但仅凭Ping不能判断是否直连。若Windows不回应Ping，应先检查防火墙的ICMP入站规则，不建议直接关闭防火墙。

在Linux端执行`easytier-cli peer`查看对等连接，并结合`easytier-cli route`核对到目标节点的下一跳；直连与中继应以实际路径为准。DHCP地址可能变化，长期运行的NAS建议使用不冲突的静态虚拟IP。同时，在Windows端的GUI界面中，切换至“对等节点”选项卡，已经能直观看到Linux主机以绿色在线状态呈现。

## 4，基于Docker自建EasyTier共享节点

公共节点可能受到跨运营商调度波动和公共带宽瓶颈的干扰。如果拥有一台具备固定公网IP的云服务器（哪怕是每月十几元的轻量低配云服务器），**通过Docker Compose自建专属共享节点是获得最高稳定性和传输体验的最佳方式**。

### (1) 自建共享节点的工作定位与流量路径

不少人在考虑自建节点时会有疑虑，担心自己的公网服务器只有3Mbps到5Mbps的带宽，会不会拖慢整个虚拟局域网的文件传输速度。

**直连成功时，云服务器带宽通常不会限制两端的业务传输；走中继时则会受到限制**。在EasyTier的设计中，自建共享节点的核心任务是**信令协调与打洞辅助**：

- 两台设备上线时，仅消耗几KB的信令数据向云端共享节点注册并探测NAT映射
- 一旦双方UDP打洞成功，数据将直接在两端设备的公网出口之间端到端传输，**根本不经过云服务器**。即使你在两端之间全速对拷几十GB的视频文件，云服务器的实时网络吞吐也基本保持在零附近
- 在防火墙限制、NAT行为或运营商策略导致直连失败的情况下，共享节点才会作为保底中继介入

![自建共享节点真实流量路径：轻量信令与千兆业务流分离](https://dg-typora.oss-cn-chengdu.aliyuncs.com/05-infographic-server-traffic-path.png)

### (2) 环境准备与端口开放

在具备公网固定IP的Linux主机上准备以下环境：

- 安装Docker与Docker Compose（推荐Docker 24.0+版本）
- 确认系统内核已加载TUN模块（执行`ls -d /dev/net/tun`有对应设备文件即可）

EasyTier默认以基准端口`11010`为基础。为了确保各平台多协议打洞顺畅，可按实际启用的监听协议，在云控制台安全组及主机防火墙放行对应端口；基础TCP/UDP连接使用`11010`，其他端口以日志为准：

| 协议 | 端口  | 用途说明                                  |
| ---- | ----- | ----------------------------------------- |
| TCP  | 11010 | 控制连接、节点注册、TCP基础传输           |
| UDP  | 11010 | UDP隧道监听与数据传输，不是独立的STUN服务 |
| TCP  | 11011 | WebSocket隧道备用连接                     |
| UDP  | 11011 | WireGuard兼容协议端口                     |
| TCP  | 11012 | WebSocket SSL加密隧道                     |
| UDP  | 11012 | QUIC协议端口                              |

### (3) 编写Docker Compose配置文件

在服务器上创建工作目录并编写`compose.yaml`：

```bash
mkdir -p /opt/easytier-server
cd /opt/easytier-server
```

以下示例使用`latest`便于试用；长期运行建议替换为已验证的固定版本标签或镜像摘要，更新前备份配置。

创建`compose.yaml`文件：

```yaml
services:
  easytier-server:
    image: easytier/easytier:latest
    container_name: easytier-server
    restart: unless-stopped
    # 共享节点强烈建议使用 host 网络模式，避免 Docker NAT 干扰 STUN 端口判断
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data:/root
      - /etc/machine-id:/etc/machine-id:ro
    # 作为自建专属共享节点启动，监听 11010 端口，并设置中继白名单保护带宽
    command: >
      -l 11010
      --relay-network-whitelist "my_vpn_*"
```

#### ① 关键配置参数解析

- **网络模式选择`network_mode: host`**：对于负责NAT打洞协调的节点，强烈推荐使用host网络模式。若采用默认bridge桥接并做端口映射，Docker网关自身的二次转换可能会改写UDP源端口，直接干扰STUN探测对客户端NAT类型的正确感知
- **权限与设备映射**：`cap_add`与`/dev/net/tun`赋予容器操作网络设备的权限，为后续节点扩展提供基础
- **中继白名单保护`--relay-network-whitelist`**：这是自建公网节点的重要安全防线。通过设置通配符（如`"my_vpn_*"`），限制可被中继的网络名称。注意：名称白名单不是身份认证，知道匹配名称的其他用户仍可能利用转发；需要按凭据隔离时，应使用下文的私有模式

### (4) 启动与运行检查

执行命令启动容器服务：

```bash
docker compose up -d
```

查看实时运行日志：

```bash
docker compose logs -f easytier-server
```

确认日志没有启动错误，并核对实际监听地址。`-l 11010`启用哪些附加协议可能随版本和编译特性变化，应以启动日志为准；未启用的协议无需开放端口。

### (5) 多端客户端接入自建共享节点

自建节点部署完成后，两端客户端由公共节点切换至专属节点极为简便：

#### ① Windows客户端（GUI配置）

1. 打开EasyTier GUI，若网络正在运行，先点击停止网络
2. 将【网络名称】更改为匹配服务器白名单的规则（例如`my_vpn_office`），并输入对应的【网络密码】
3. 在【初始节点】区域
   - 将原有的公共节点地址删除
   - 协议选择`tcp`，地址栏输入云服务器公网IP（例如`203.0.113.10`），端口保持`11010`
   - 点击【+ 添加初始节点】，再添加一条协议为`udp`、地址和端口相同的条目，以便同时通过TCP和UDP发起并发协商
4. 点击顶部的【保存配置】，然后点击【运行网络 ->】

#### ② Linux客户端（CLI配置）

在Linux客户端，由于此前已经将参数抽离至配置文件，此时无需改动Systemd服务文件，只需直接编辑`/etc/easytier/config.toml`：

```toml
[network_identity]
network_name = "my_vpn_office"
network_secret = "Secret@Pass_2026"

# 将引导节点修改为自建云服务器地址（同时配置 TCP 和 UDP 引导）
[[peer]]
uri = "tcp://203.0.113.10:11010"

[[peer]]
uri = "udp://203.0.113.10:11010"
```

保存后重启服务即可生效：

```bash
sudo systemctl restart easytier
```

此时，所有客户端均脱离了第三方节点，接入了完全由自己掌控的专属协调集群。

### (6) 配置私有模式与中继访问白名单

作为公网服务器的管理者，往往需要合理控制服务器的计算和网络开销。EasyTier提供了针对性的访问控制参数。

#### ① 仅协助打洞并关闭大流量中继

如果服务器的月度流量较为紧张，希望服务器仅协助内网设备协商握手建立P2P通道，在打洞失败时不提供大流量中继，可以调整启动命令：

```bash
easytier-core --relay-network-whitelist --relay-all-peer-rpc
```

其中`--relay-network-whitelist ""`表示将中继白名单置空，拒绝转发任何网络的中继业务报文；`--relay-all-peer-rpc`则保证RPC控制信令依然放行，维持节点间的握手探测能力。

#### ② 启用完全私有模式

如果希望该服务器成为专属节点，不对外部网络开放任何握手信令，只允许指定的网络连接：

```bash
easytier-core --private-mode true --network-name my_vpn_office --network-secret "MyCustomStrongSecret2026"
```

开启完全私有模式后，未携带匹配网络名称与密钥的连接请求会被服务器直接丢弃。

### (7) 容器生命周期管理与更新

使用Docker Compose管理共享节点的最大优势在于更新极其方便：

```bash
cd /opt/easytier-server
# 拉取最新镜像
docker compose pull
# 重建并启动新容器，更新期间连接可能短暂中断
docker compose up -d --remove-orphans
```

## 5，总结与选型建议

在异地组网的技术选型中，我们不必走向“全走中心服务器转发生怕卡顿”或“一定要固定公网IP否则无法连接”的两个极端。

EasyTier通过去中心化的Mesh架构设计，巧妙地平衡了这两种矛盾：

- 它以点对点直连为第一优先级，在保障极速传输体验的同时，以共享节点中继作为可靠的保底手段
- 在多设备混合组网实践中，最推荐的选型策略是**各取所长**
  - **Windows/macOS办公桌面端**：使用**官方GUI客户端**，享受可视化的配置管理与拓扑监控
  - **Linux服务器/NAS/软路由**：使用**CLI二进制程序**，结合Systemd开机自启，占用资源极低且长期稳定免运维
  - **公网协调服务器**：使用**Docker Compose**搭建自建共享节点，配合中继白名单，不仅成本低廉、管理方便，而且能彻底保障打洞协商的速度与私密性

通过这种“桌面GUI + 服务端CLI + 云端Docker”的自然组合，无论是跨地域多机互通、家庭NAS高速远程访问，还是异地开发运维，都能构建起一条高带宽、低延迟且安全可靠的现代化私有内网。

![EasyTier跨平台多形态混合部署最佳实践矩阵](https://dg-typora.oss-cn-chengdu.aliyuncs.com/06-framework-deployment-matrix.png)

参考文档：

- [EasyTier官方仓库与版本发布](https://github.com/EasyTier/EasyTier)
- [官方指南：搭建共享节点、转发白名单与私有模式](https://easytier.cn/guide/network/host-public-server.html)
- [官方指南：P2P连接优化](https://easytier.cn/guide/network/p2p-optimize.html)
