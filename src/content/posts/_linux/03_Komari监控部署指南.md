---
id: 01N9ZGW0RNP8
title: Komari监控部署指南
pubDatetime: 2026-09-08T16:10:33+08:00
series: Linux实践
draft: false
tags:
  - Komari
  - 服务器监控
  - Docker
  - Nginx
description: 记录Komari服务端与Agent的部署、Nginx反向代理、权限控制、更新维护和卸载流程
---

当手头的服务器和虚拟机逐渐增加时，单纯依靠登录终端执行 `htop` 或 `free -m` 往往难以随时掌握全局状态。一个轻量、实时、资源占用低且易于维护的探针监控面板就成了运维过程中的刚需。

[Komari](https://github.com/komari-monitor/komari) 是一套轻量级自托管服务器状态监控系统。服务端基于Go语言构建，前端提供响应灵敏、支持秒级高刷新的现代Web仪表盘；客户端（Komari Agent）使用轻量级探针通过长连接向上汇报状态，支持网络流量统计、Ping延迟监测、进程资源追踪以及告警通知等功能。

本文基于较新的Komari 1.4+版本，整理了监控服务端（Server）与客户端（Agent）从零部署、Nginx反向代理配置、版本平滑更新到日常运维的完整流程，涵盖**Docker容器化**与**命令行/Systemd原生运行**两种核心方案，并就权限控制与日常运维提供实战建议。

## 1. 核心架构与运行建议

### 1.1 服务端与探针通信机制

Komari整体采用标准的客户端-服务端（Client-Server）架构：

- **Komari Server（面板端）**：负责监听外部连接、接收并解析各探针上报的系统性能指标、存储历史数据、渲染Web控制台，并在发生离线或指标超限时触发告警。默认监听本地或公网的 `25774端口`。
- **Komari Agent（探针端）**：部署在被监控的节点服务器上。探针启动后会主动与Server建立HTTP/WebSocket长连接，周期性上报CPU、内存、交换分区、网络流量、挂载点以及延迟等数据。
- **认证与注册模型**：Komari提供两种节点接入方式。**首推方式是基于自动发现密钥（Auto-Discovery Key）的批量接入**，在面板后台统一生成密钥后，所有探针可使用同一套命令自动完成注册与初始化；同时也支持基于**单节点Token**的精准绑定，为每个节点分配独立的专属认证凭据。

### 1.2 探针运行权限建议

在Linux系统上部署监控探针时，无需进行繁琐的权限对比。对于被监控节点，**最推荐采用“系统级服务 + 普通用户身份运行”**。

这种模式既能依托系统级Systemd在服务器重启时稳定自启、不受SSH会话注销影响，又严格遵循了最小权限原则，避免探针进程长期持有Root最高权限，从而有效规避面板下发Web SSH或远程命令时的越权安全隐患。

## 2. Komari面板部署（Server端）

Komari面板端推荐使用Docker部署，也可直接在具有Systemd的Linux系统上以原生二进制运行。默认情况下，面板服务监听 `25774端口`。

### 2.1 方案一：Docker部署（推荐）

Docker方式无需关心Go运行时环境，所有持久化配置与SQLite数据库均保存在宿主机目录中。

**(1) 使用单容器命令启动**

首先创建存放监控数据与配置的宿主机目录，并运行官方容器镜像：

```bash
# 创建数据存储目录
sudo mkdir -p /opt/komari/data && cd /opt/komari

# 启动 Komari 容器
docker run -d \
  --name komari \
  --restart unless-stopped \
  -p 25774:25774 \
  -v /opt/komari/data:/app/data \
  ghcr.io/komari-monitor/komari:latest
```

参数解释：

- `-p 25774:25774`：将容器内的 `25774端口`映射到宿主机。如果后续计划使用本地Nginx反向代理，可调整为 `-p 127.0.0.1:25774:25774`，避免裸端口直接暴露在公网。
- `-v /opt/komari/data:/app/data`：挂载持久化数据目录，Komari的数据库（`komari.db`）及生成的配置都会持久化保存在此。
- `--restart unless-stopped`：保证服务器重启或Docker服务重载时容器能够自动恢复运行。

**(2) 使用Docker Compose编排**

如果偏好使用Docker Compose管理服务，可以在 `/opt/komari` 目录下编写 `docker-compose.yml`：

```yaml
services:
  komari:
    image: ghcr.io/komari-monitor/komari:latest
    container_name: komari
    restart: unless-stopped
    ports:
      - "25774:25774"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Asia/Shanghai
```

随后在文件所在目录下执行启动命令：

```bash
docker compose up -d
```

### 2.2 方案二：命令行与Systemd原生部署

如果不希望在服务器上安装Docker，可采用以下两种命令行部署方式。

**(1) 使用官方一键脚本安装**

Komari官方提供了针对Systemd发行版（如Debian、Ubuntu等）的交互式管理脚本：

```bash
# 下载官方一键管理脚本并赋予执行权限
curl -fsSL https://raw.githubusercontent.com/komari-monitor/komari/main/install-komari.sh -o install-komari.sh
chmod +x install-komari.sh

# 以 root 权限运行
sudo ./install-komari.sh
```

首次运行脚本会进入交互式配置流程。首先需要选择安装版本（标准版本或针对低配优化的Lite版本）：

![官方一键脚本安装时选择版本界面（标准版与Lite版）](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908150129113.png)

随后选择发布通道（推荐选择1进入正式版通道）：

![官方一键脚本安装时选择发布通道界面（正式版与快照版）](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908150142683.png)

确认后脚本会自动检测系统CPU架构，拉取对应二进制文件写入 `/opt/komari/komari`，同时配置系统服务 `/etc/systemd/system/komari.service` 并立即启动。

**(2) 手动下载二进制配置服务**

如果希望完全自主掌控部署细节，可手动下载官方Release并注册Systemd服务：

```bash
# 1. 确认系统架构并创建工作目录
uname -m
sudo mkdir -p /opt/komari/data
cd /opt/komari

# 2. 从 GitHub Release 下载对应架构的二进制文件（以 amd64 为例）
sudo wget -O /opt/komari/komari https://github.com/komari-monitor/komari/releases/latest/download/komari_linux_amd64
sudo chmod +x /opt/komari/komari
```

接着编写Systemd服务单元文件：

```bash
sudo tee /etc/systemd/system/komari.service > /dev/null << 'EOF'
[Unit]
Description=Komari Monitor Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/komari
ExecStart=/opt/komari/komari server -l 0.0.0.0:25774
Restart=always
RestartSec=5
User=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
```

重载并启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now komari
```

### 2.3 验证面板初始化状态

服务启动后，执行状态检查：

```bash
# 若使用 Docker 部署
docker logs -f komari

# 若使用 Systemd 原生部署
sudo systemctl status komari --no-pager
```

服务正常运行后，使用浏览器访问 `http://<服务器IP>:25774`。Komari提供了清晰的5步安装向导（欢迎、管理员、站点、数据库、确认），点击“开始安装”并按步骤配置管理账号、站点名称及数据库设置：

![Komari初次访问的系统安装引导向导](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908150856064.png)

完成后登录控制台，即可进入管理后台主界面。

## 3. 常用配置与反向代理

### 3.1 Nginx反向代理与HTTPS配置

在生产环境中，建议通过配置域名、反向代理并启用HTTPS来访问Komari面板。由于Komari探针上报和控制台终端高度依赖WebSocket长连接，Nginx配置必须显式启用协议升级。

标准Nginx反向代理配置如下：

```nginx
server {
    listen 80;
    server_name monitor.example.com;

    # 强制将 HTTP 请求重定向至 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name monitor.example.com;

    # SSL 证书文件路径
    ssl_certificate /etc/nginx/ssl/monitor.example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/monitor.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:25774;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 启用 WebSocket 协议升级支持（关键）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";

        # 禁用反向代理缓冲，确保秒级监控指标实时推送
        proxy_buffering off;

        # 允许上传自定义主题或静态资源
        client_max_body_size 50M;

        # 超时时间设置，防止 WebSocket 偶发断联
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

配置完成后测试语法并重载Nginx：

```bash
sudo nginx -t && sudo nginx -s reload
```

### 3.2 WebSocket Origin跨域校验避坑

配置反代后，如果浏览器控制台报错或提示终端连接失败，通常是由于Komari面板自带的**Origin校验**拦截了外部域名的请求。

在最新版本中，设置路径有所调整，解决步骤如下：

1. 使用管理员账户登录Komari后台，点击左侧菜单的 `系统 -> 站点`。
2. 找到 `WebSocket Origin 允许列表`，将你的实际访问域名（如 `https://monitor.example.com`）输入到文本框中并点击保存；或者直接将上方的 `WebSocket Origin 校验` 开关关闭。

![Komari后台系统站点配置中的WebSocket Origin允许列表](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908151707683.png)

## 4. Komari Agent部署（探针端）

Komari Agent安装在所有需要被监控的节点服务器上。

### 4.1 获取部署凭据与模式选择

在安装Agent前，可在面板后台选择以下两种注册模式之一。**在日常运维中，强烈推荐优先使用自动发现模式。**

#### 模式一：自动发现（Auto-Discovery）模式（推荐）

自动发现是Komari最推荐的多节点部署方案。其最大优势在于**无需预先在后台为每台服务器单独手动新建记录**：

1. 登录Komari后台，点击左侧菜单 `系统 -> 通用`。
2. 页面顶部的首个配置卡片即为“自动发现”。在输入框中可以手动设置，或直接点击“生成”按钮生成一个24位的自动发现密钥（AD Key），然后点击保存。
3. 后续无论需要接入1台还是100台服务器，只需在各节点执行同一条带有 `--auto-discovery <AD Key>` 的命令，探针启动时就会自动向面板完成认证注册，并自动生成独立UUID与Token记录在节点列表中。后期可在节点列表随时修改名称、账单和标签。

![image-20260908154902992](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908154902992.png)

#### 模式二：单节点指定Token模式（替代方案 / 精确管理）

如果需要先在后台规划好节点名称、分组与计费规则，或在重装节点时绑定已有记录，可使用单节点模式：

1. 进入后台 `服务器列表`，此时右侧会显示“节点列表”视图。
2. 点击右上角的 `+ 添加节点` 按钮，输入节点名称并确认。

![Komari后台服务器列表与添加节点入口](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908153951797.png)

添加完成后，可通过以下两种途径获取凭据：

- **途径A（一键指令）**：在节点列表右侧操作栏点击“下载”图标（一键部署指令），在弹窗中选择目标平台与安装选项，系统会自动生成带 `-t <Token>` 的安装脚本命令。

![image-20260908155106069](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908155106069.png)

- **途径B（手动查阅Token）**：点击操作栏的“编辑”图标（铅笔状按钮），在弹出的“编辑信息”弹窗中直接查看并复制该节点的 `Token 令牌`。

![在节点编辑信息弹窗中查看与复制Token令牌](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260908154102984.png)

### 4.2 方案一：命令行与Systemd部署（推荐）

**(1) 一键安装命令与常用参数**

登录待监控的服务器，执行官方安装脚本。

- **自动发现模式**：

```bash
curl -fsSL https://raw.githubusercontent.com/komari-monitor/komari-agent/refs/heads/main/install.sh -o /tmp/install-agent.sh

sudo bash /tmp/install-agent.sh \
  -e https://monitor.example.com \
  --auto-discovery 'YOUR_AUTO_DISCOVERY_KEY' \
  --disable-web-ssh \
  --interval 1.0 \
  --month-rotate 1
```

- **单节点Token模式**：

若需要在特定节点上绑定已有Token，只需将 `--auto-discovery` 替换为 `-t`：

```bash
sudo bash /tmp/install-agent.sh \
  -e https://monitor.example.com \
  -t 'YOUR_NODE_TOKEN_HERE' \
  --disable-web-ssh \
  --interval 1.0 \
  --month-rotate 1
```

**常用参数深度解析**

| 参数                                            | 默认值     | 作用说明与实战建议                                                        |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `-e, --endpoint`                                | 无（必需） | Komari面板的完整访问地址，建议配置HTTPS协议。                             |
| `--auto-discovery`                              | 无         | 自动发现密钥（推荐）。用于批量全自动新建并接入节点，与 `-t` 互斥。        |
| `-t, --token`                                   | 无         | 节点专属Token。绑定已有节点或精准维护时使用。与 `--auto-discovery` 互斥。 |
| `--disable-web-ssh`                             | `false`    | 禁用面板下发的远程终端与命令执行。若仅需指标监控，建议开启以提升安全性。  |
| `--disable-auto-update`                         | `false`    | 禁用Agent自动升级。默认情况下Agent每6小时检查并拉取最新版本。             |
| `-i, --interval`                                | `1.0`      | 监控指标采集与上报周期（秒），支持浮点数。                                |
| `--month-rotate`                                | `1`        | 每月网络流量计费周期的重置日。例如设为 `1` 表示每月1日零点重置本月统计。  |
| `-u, --ignore-unsafe-cert`                      | `false`    | 若面板使用自签证书或测试域名，传递此参数可忽略TLS校验。                   |
| `--include-nics` / `--exclude-nics`             | 无         | 网卡过滤。例如排除虚拟网卡 `--exclude-nics "docker0,veth*"`。             |
| `--include-mountpoint` / `--exclude-mountpoint` | 无         | 磁盘挂载点过滤，避免挂载网络卷时产生误报。                                |

**(2) 深入理解运行权限与服务层级**

官方 `install.sh` 脚本内部有一行关键判定：

```bash
service_user="${SUDO_USER:-$(id -un)}"
```

这一行决定了服务将以什么身份运行，直接衍生出两种主要形态：

1. **通过 `sudo bash install.sh` 安装（推荐做法）**：脚本获得提升权限后，会把程序安装到 `/opt/komari/agent`，并生成系统级服务 `/etc/systemd/system/komari-agent.service`。由于脚本抓取到了 `SUDO_USER`，服务配置中的执行用户会被自动设为 `User=<普通用户名>`。这样既获得了系统引导开机自启的能力，又将实际运行权限限制在普通用户内，遵循最小权限原则。
2. **普通用户直接运行（EUID != 0）**：若直接以非root身份运行安装脚本，Agent会安装在 `~/.local/share/komari`，并配置Systemd用户服务（`~/.config/systemd/user/komari-agent.service`）。由于许多Linux系统在SSH会话断开后会休眠用户会话，需要由管理员执行 `sudo loginctl enable-linger <用户名>` 才能保持持续运行。

故而这里一般省事的话直接推荐使用root权限。

### 4.3 方案二：Docker容器化部署Agent

在纯PaaS容器平台或轻量Docker宿主机上，也可直接使用官方Docker镜像运行Agent：

```bash
docker run -d \
  --name komari-agent \
  --restart unless-stopped \
  --net=host \
  --pid=host \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  ghcr.io/komari-monitor/komari-agent:latest \
  -e https://monitor.example.com \
  --auto-discovery "YOUR_AUTO_DISCOVERY_KEY" \
  --disable-web-ssh \
  --month-rotate 1
```

> **注意**：容器化运行Agent时，必须添加 `--net=host` 与 `--pid=host` 并以只读方式挂载宿主机的 `/proc` 和 `/sys` 目录，否则探针采集到的只是容器内部的虚拟资源数据。

### 4.4 验证Agent运行状态

安装完成后，在终端检查服务状态与上报情况：

```bash
# 查看服务活跃状态
sudo systemctl status komari-agent --no-pager

# 检查实际运行该进程的系统用户
PID=$(sudo systemctl show komari-agent -p MainPID --value)
ps -o user,group,pid,cmd -p "$PID"

# 查看最新上报日志
sudo journalctl -u komari-agent -n 50 --no-pager
```

若日志输出 `Connected to server successfully`，刷新面板页面，该节点会立即显示在节点列表中，且状态指示灯变为绿色在线。

### 4.5 Agent卸载与环境清理

如果某台服务器不再需要监控，可按对应安装方式从系统中彻底清理：

**(1) 系统级Systemd服务卸载**

```bash
# 停止并禁用系统服务
sudo systemctl stop komari-agent
sudo systemctl disable komari-agent

# 删除服务定义并重载 Systemd
sudo rm -f /etc/systemd/system/komari-agent.service
sudo systemctl daemon-reload
sudo systemctl reset-failed

# 删除程序目录
sudo rm -rf /opt/komari /var/log/komari
```

**(2) 用户级Systemd服务卸载（非Root安装）**

```bash
systemctl --user stop komari-agent
systemctl --user disable komari-agent
rm -f ~/.config/systemd/user/komari-agent.service
systemctl --user daemon-reload
systemctl --user reset-failed
rm -rf ~/.local/share/komari
```

清理完毕后，登录Komari管理面板，在服务器列表中将对应的离线节点删除即可。

## 5. 面板与Agent的更新流程

### 5.1 Komari面板更新

**(1) Docker环境平滑升级**

Docker环境更新的核心是保留原挂载卷重新创建容器：

```bash
# 1. 备份现有数据卷
sudo cp -r /opt/komari/data /opt/komari/data_backup_$(date +%F)

# 2. 拉取最新镜像
docker pull ghcr.io/komari-monitor/komari:latest

# 3. 停止并移除现有容器（挂载目录不会被删除）
docker stop komari
docker rm komari

# 4. 使用原有挂载参数重新启动新容器
docker run -d \
  --name komari \
  --restart unless-stopped \
  -p 25774:25774 \
  -v /opt/komari/data:/app/data \
  ghcr.io/komari-monitor/komari:latest
```

使用Docker Compose的用户只需在配置文件所在目录执行：

```bash
docker compose pull
docker compose up -d
```

**(2) 命令行与Systemd环境升级**

如果使用 `install-komari.sh` 脚本安装，再次运行该脚本并在交互式菜单中选择 `2`（Upgrade / 升级）即可；脚本会自动拉取最新Release包覆盖并平滑重载服务。

若是纯手动下载二进制部署，可执行以下命令完成替换：

```bash
# 停止当前服务并备份旧文件
sudo systemctl stop komari
sudo cp /opt/komari/komari /opt/komari/komari.bak

# 下载新版二进制并赋予执行权限
sudo wget -O /opt/komari/komari https://github.com/komari-monitor/komari/releases/latest/download/komari_linux_amd64
sudo chmod +x /opt/komari/komari

# 重新启动服务并验证
sudo systemctl start komari
sudo systemctl status komari --no-pager
```

### 5.2 Komari Agent更新

- **自动更新（默认模式）**：若未在安装参数中添加 `--disable-auto-update`，Agent每隔6小时会自动向GitHub Release检测新版本，发布更新时会自动拉取并热重载自身。
- **手动覆盖更新**：若关闭了自动更新，在服务器上重新执行带有原参数的一键安装命令即可完成更新覆盖，Systemd服务会自动重载生效。

## 6. 结语

Komari凭借轻盈的架构设计与现代化的Web交互，为多节点监控提供了一个开箱即用的优质解法。在日常运维中，服务端优先采用Docker绑定持久化数据卷能够大幅降低跨机迁移与版本升级的维护成本；探针端推荐采用自动发现密钥配合系统级服务一键部署，不仅免去了逐台生成Token的手动繁琐流程，还能在保障开机自启稳定性的同时坚守最小权限原则。

本文涵盖了服务端与探针端部署、Nginx反向代理配置与版本平滑更新的核心主干。Komari本身还具备诸多丰富的可玩性与进阶功能，例如**多样化的前端主题定制与主题市场**、**多渠道告警通知模板（Telegram、Webhook等）**、**GitHub OAuth单点登录集成**以及**插件系统**等。如果在后续运维中有进一步的定制需求，可以直接查阅官方文档与开源项目主页深入探索：

- **官方文档与使用指南**：[Komari Wiki](https://www.komari.wiki/)
- **服务端开源仓库**：[komari-monitor/komari](https://github.com/komari-monitor/komari)
- **探针端开源仓库**：[komari-monitor/komari-agent](https://github.com/komari-monitor/komari-agent)
