---
title: 使用 acme.sh 与 Cloudflare DNS 签发、部署并自动续期 HTTPS 证书
pubDatetime: 2026-08-11T17:06:32+08:00
featured: true
draft: false
tags:
  - HTTPS
  - acme.sh
  - Cloudflare
  - Nginx
description: 介绍如何使用 acme.sh 配合 Cloudflare DNS 或 HTTP 验证签发证书，并完成 Nginx 部署与自动续期
---

给站点启用 HTTPS 时，真正麻烦的通常不是第一次拿到证书，而是后面的续期、替换证书文件以及让 Web 服务重新加载。如果这些环节依赖手动操作，证书到期前总会多一件需要惦记的事。

[acme.sh](https://github.com/acmesh-official/acme.sh) 是一个使用 Unix Shell 编写的 **ACME 客户端**，可以完成账户注册、域名验证、证书签发、部署和续期。它不依赖 Python，也不强制要求 root 权限。本文以 Linux 和 Nginx 为例，分别介绍 **Cloudflare DNS-01** 与 **服务器 HTTP 验证**这两种方式，再走完证书部署和自动续期流程。

## 1. 开始前先理清几个概念

HTTPS 证书主要解决两个问题：一是让客户端确认当前访问的服务器确实对应目标域名，二是为客户端和服务器之间的通信建立加密连接。

一套常见的证书文件包含以下内容：

- **私钥**：只保存在服务器上，用于证明服务器身份，不能泄露
- **站点证书**：由证书颁发机构签发，包含域名、公钥和有效期等信息
- **中间证书链**：帮助客户端把站点证书一路验证到受信任的根证书
- `fullchain`：通常是站点证书和中间证书链的组合，Nginx 一般使用这个文件

**ACME** 是证书颁发机构和客户端之间的一套自动化协议。**acme.sh 是 ACME 客户端**，而 **Let’s Encrypt、ZeroSSL 才是证书颁发机构（CA）**。acme.sh 负责向 CA 发起申请，并通过 HTTP 或 DNS 等方式证明我们确实控制着域名。

域名验证常用的两条路径是 **DNS-01** 和 **HTTP-01**。DNS-01 不要求业务服务器开放 80 端口，并且可以签发 `*.example.com` 这样的泛域名证书；HTTP-01 不需要 DNS API 凭据，但要求域名已经指向当前服务器，并且 CA 能通过公网 80 端口访问它。后文会分别给出完整流程。

## 2. 环境和前置条件

开始前需要准备：

- 一台可执行 `sh`、`curl` 或 `wget`、`openssl` 和 `cron`/`crond` 的 Linux 主机
- 一个已正确解析的域名；使用 DNS-01 时，该域名需要托管到 Cloudflare
- 使用 DNS-01 时需要 Cloudflare API Token，以及对应的 Account ID 或 Zone ID
- 使用 HTTP 验证时，需要域名指向当前服务器并保证公网 80 端口可访问
- 一个用于注册 ACME 账户的邮箱
- 如果最终部署给 Nginx，需要有权写入证书目标目录并执行 Nginx reload

acme.sh 本身可以由普通用户运行，但“能运行”不等于“整个流程都不需要权限”。DNS 验证不需要监听 80/443 端口；把证书写入 `/etc/nginx/` 并重载 Nginx，通常仍需要 root 或经过限制的 `sudo` 权限。

## 3. 安装 acme.sh

本文使用 [官方提供的在线安装脚本](https://github.com/acmesh-official/get.acme.sh)，通过 `curl` 下载并安装 acme.sh：

```bash
curl https://get.acme.sh | sh -s email=admin@example.com
```

其中，`email=admin@example.com` 用于指定 ACME 账户邮箱，需要替换为自己的邮箱地址。这条命令安装的是 **acme.sh 客户端**，并不是把证书部署到 Nginx。默认情况下，安装程序会完成三件事：

1. 把程序和配置放到当前用户的 `~/.acme.sh/`
2. 添加 `acme.sh` 命令别名
3. 为当前用户创建每日运行的 cron 任务

安装程序会把 `acme.sh` 别名写入 Shell 配置。当前使用 Bash 时，可以重新加载 `~/.bashrc`，让别名在当前终端立即生效：

```bash
source ~/.bashrc
```

然后检查版本和帮助信息：

```bash
acme.sh --version
acme.sh --help
```

如果当前使用的不是 Bash，或者配置文件没有立即生效，也可以关闭并重新打开终端。

## 4. 选择并切换证书颁发机构

### 4.1 证书颁发机构负责什么

**证书颁发机构（Certificate Authority，CA）**负责验证域名控制权并签发证书。浏览器和操作系统预先信任一批根证书，站点证书通过中间证书逐级连接到受信任的根证书后，客户端才能建立可信的 HTTPS 连接。

这里要区分三个角色：acme.sh 是负责提交申请和完成验证的 **ACME 客户端**；Let’s Encrypt、ZeroSSL 是签发证书的 **CA**；[Cloudflare](https://www.cloudflare.com/) 在本文中只是 DNS 服务商。更换 CA 不会改变域名验证的基本目标，但签发接口、账户信息和最终证书链可能随之变化。

### 4.2 ZeroSSL 与 Let’s Encrypt 有什么区别

截至本文撰写时，[acme.sh 官方](https://github.com/acmesh-official/acme.sh) 将 **[ZeroSSL](https://zerossl.com/) 标记为默认 CA**，同时支持 [Let’s Encrypt](https://letsencrypt.org/)、[Google Public CA](https://pki.goog/) 等符合 ACME 规范的机构。ZeroSSL 和 Let’s Encrypt 都可以通过 ACME 自动签发受公开信任的域名验证证书，部署到 Nginx 后都能用于正常的 HTTPS 访问。

日常使用时，主要关注下面几类区别：

- **签发者和证书链不同**：证书的 Issuer、中间证书及最终连接的根证书可能不同；需要兼容旧设备或特殊客户端时，应实际检查证书链
- **账户注册方式不同**：不同 CA 对邮箱、账户注册以及 EAB 等信息的要求可能不同，acme.sh 会处理其中一部分流程
- **速率限制不同**：单位时间内可注册账户、创建订单或为同组域名签发证书的限制由各 CA 自己制定，批量签发和频繁测试前需要查看对应规则，例如 [Let’s Encrypt 速率限制](https://letsencrypt.org/docs/rate-limits/)
- **管理方式不同**：有的 CA 更偏向纯自动化签发，有的还提供控制台、证书管理或商业服务；如果全程交给 acme.sh 管理，这部分差异通常不明显
- **服务策略可能变化**：证书有效期、续期窗口和账户要求并不是永久固定的，因此不建议在脚本里依赖某个未经确认的固定天数

这些区别不等于某一家签发的证书天然“更安全”。对普通网站而言，更重要的是客户端兼容性、自动续期是否稳定，以及团队是否熟悉对应 CA 的限制。

### 4.3 常见 ACME 证书机构对比

下表中的“有效期”指证书签发后可以使用多久，不是命令执行时间。DV 证书在域名验证通过后通常可以较快签发，但实际耗时还会受到 DNS 解析生效、网络和 CA 服务状态影响。

| 证书机构                                                                        | 常见有效期                                                             | 费用情况                                                                | 使用门槛                                                    | 更适合的场景                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| [Let’s Encrypt](https://letsencrypt.org/)                                       | 截至 2026 年 8 月，默认配置仍以 90 天为主；官方已公布后续逐步缩短计划  | 证书免费，没有付费证书套餐                                              | ACME 注册和域名验证即可                                     | 个人网站、普通 Web 服务，以及希望使用成熟社区资料的场景 |
| [ZeroSSL](https://zerossl.com/)                                                 | 免费证书通常为 90 天；付费产品可提供更长的订阅周期，具体以当前套餐为准 | 同时提供免费和付费方案                                                  | 免费 ACME 可用，也提供控制台、API 和商业服务                | 希望同时使用可视化管理后台或商业支持的场景              |
| [Google Public CA](https://cloud.google.com/certificate-manager/docs/public-ca) | Google 托管的公共证书默认通常为 90 天；实际 ACME 证书应以签发结果为准  | Public CA 签发本身可免费，但 Certificate Manager 等配套资源可能产生费用 | 需要 Google Cloud 项目、结算账号，并通过 EAB 绑定 ACME 账户 | 已使用 Google Cloud，或需要统一管理大规模证书的场景     |
| [SSL.com](https://www.ssl.com/products/website-security/acme/)                  | 有效期取决于具体证书产品；其免费 DV 产品当前为 90 天                   | ACME 协议本身免费，但通过 ACME 申请的 SSL.com 产品仍按对应证书方案计费  | 通常需要 SSL.com 账户及 ACME 凭据                           | 需要商业支持、OV/EV 或企业证书管理方案的场景            |

证书有效期和价格策略都可能调整，执行前应查看对应 CA 的最新说明：[Let’s Encrypt 有效期计划](https://letsencrypt.org/docs/cert-lifetimes/)、[ZeroSSL 证书方案](https://zerossl.com/features/certificates/)、[Google Certificate Manager 价格](https://cloud.google.com/certificate-manager/pricing)和 [SSL.com ACME 说明](https://www.ssl.com/products/website-security/acme/)。

仅从本文使用 acme.sh 自动签发普通 DV 证书的角度看，Let’s Encrypt 和 ZeroSSL 的上手成本最低。Google Public CA 更偏向已有 Google Cloud 体系的用户；SSL.com 则更适合明确需要商业证书产品或支持服务的场景。

### 4.4 为什么本文使用 Let’s Encrypt

[**Let’s Encrypt**](https://letsencrypt.org/) 是目前使用非常广泛的免费自动化 CA，相关文档、社区案例和故障排查资料都比较丰富。很多运维工具的示例也会直接以 Let’s Encrypt 为例。对于个人网站和普通 Web 服务，它通常是一个容易理解和维护的选择。

这并不意味着必须把 ZeroSSL 换掉。如果现有证书一直由 ZeroSSL 稳定签发，或者团队已经使用它的管理服务，可以继续保持默认配置。本文切换到 Let’s Encrypt，主要是为了让后续命令、签发者和排查口径保持一致。

### 4.5 切换并确认默认 CA

将 acme.sh 的默认 CA 切换为 Let’s Encrypt：

```bash
acme.sh --set-default-ca --server letsencrypt
```

这项设置会影响后续没有显式传入 `--server` 的签发操作。为了让示例即使脱离上下文也能看懂，本文签发命令仍保留 `--server letsencrypt`；实际使用时，设置默认 CA 后可以省略它。

如果只想让某一张证书使用 Let’s Encrypt，不希望修改全局默认值，直接在该次 `--issue` 命令后增加 `--server letsencrypt` 即可。切换默认 CA **不会自动替换已经签发的证书**，已有证书通常要等下一次使用新 CA 续签或重新签发后，签发者才会发生变化。

签发完成后，可以通过下面的命令查看证书签发者：

```bash
openssl x509 -in /path/to/fullchain.pem -noout -issuer -subject -dates
```

其中，`issuer` 表示签发者，`subject` 表示证书对应的主体，`dates` 用于查看生效时间和到期时间。

## 5. 选择验证方式并签发证书

两种方式最终得到的都是可用于 HTTPS 的证书，区别主要发生在“如何证明域名属于自己”这一步。需要泛域名、服务器不方便开放 80 端口，或者证书并不部署在域名指向的服务器上时，选择 DNS-01；域名指向当前服务器、只签发明确域名且不想保存 DNS API 凭据时，可以选择 HTTP 验证。

### 5.1 使用 dns_cf 完成 DNS-01 验证

#### 5.1.1 创建最小权限的 Cloudflare Token

Cloudflare 的 **Global API Key 权限过大**，一旦泄露会影响整个账户，因此不建议使用。[acme.sh 官方 DNS API 文档](https://github.com/acmesh-official/acme.sh/wiki/dnsapi)推荐使用 **User Token** 或 **Account-owned Token**，并尽可能缩小权限和资源范围。

具体创建步骤可以对照 [Cloudflare 官方 API Token 文档](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。用于 acme.sh 的 Token 至少需要：

- 权限：`Zone > DNS > Edit`
- 资源：只包含需要签发证书的 Zone
- 如果启用了 Client IP Address Filtering，需要放行运行 acme.sh 的主机公网 IP
- Token 必须处于有效期内

![image-20260804155242083](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155242083.png)

![image-20260804155525053](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155525053.png)

![image-20260804155608292](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155608292.png)

![image-20260804161250646](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161250646.png)

然后点击`继续以显示摘要`：

![image-20260804161449813](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161449813.png)

创建后立即复制 Token。Cloudflare 通常只完整展示一次，不要把真实 Token 泄露。

![image-20260804161550596](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161550596.png)

#### 5.1.2 设置 Cloudflare 环境变量

接下来设置环境变量。只有一个 Zone 时，可以使用 Zone ID：

```bash
export CF_Token="替换为 Cloudflare API Token"
export CF_Zone_ID="替换为 Zone ID"
```

同一个 Cloudflare 账户下有多个 Zone 时，也可以使用 Account ID：

```bash
export CF_Token="替换为 Cloudflare API Token"
export CF_Account_ID="替换为 Account ID"
```

`CF_Zone_ID` 和 `CF_Account_ID` 可以在 Cloudflare 对应域名的 Overview 页面右侧找到。首次成功调用 DNS API 后，acme.sh 会把认证信息保存到 `~/.acme.sh/account.conf`，供后续无人值守续期使用。因此应限制该文件和目录的访问权限，也不要把它复制到公开位置。

<!-- TODO: 补充 Cloudflare Overview 页面中 Zone ID 和 Account ID 的位置截图 -->

#### 5.1.3 签发根域名和泛域名证书

下面同时申请根域名和泛域名证书：

```bash
acme.sh --issue \
  --dns dns_cf \
  -d example.com \
  -d '*.example.com' \
  --server letsencrypt
```

几个主要参数的含义如下：

- `--issue`：发起证书签发
- `--dns dns_cf`：使用 Cloudflare DNS API 完成 DNS-01 验证
- `-d example.com`：加入根域名，并将第一个 `-d` 作为证书主域名
- `-d '*.example.com'`：加入一级泛域名；单引号可以避免 `*` 被 Shell 展开
- `--server letsencrypt`：本次明确使用 Let’s Encrypt；已设置默认 CA 时可省略

`*.example.com` 可以覆盖 `www.example.com`，但不能覆盖根域名 `example.com`，也不能覆盖 `a.b.example.com`，所以这里同时写了两个 `-d`。

如果 DNS 服务商的解析生效较慢，可以根据实际情况增加 `--dnssleep 秒数`。不要一开始就盲目设置很长时间，先看默认的 DNS 检查能否正常通过。

#### 5.1.4 检查签发结果

签发完成后，可以查看 acme.sh 管理的证书：

```bash
acme.sh --list
```

证书会保存在 `~/.acme.sh/` 下，但这个目录是 acme.sh 的内部工作目录。[acme.sh 官方说明](https://github.com/acmesh-official/acme.sh)明确建议不要让 Nginx 或 Apache 直接引用其中的文件，因为内部目录结构将来可能变化。

### 5.2 直接在服务器上完成 HTTP 验证

如果不使用 Cloudflare DNS API，也可以直接在域名指向的服务器上申请证书。CA 会通过域名访问这台服务器，以确认申请者确实能够控制该域名。这种方式不需要 Cloudflare Token，但必须保证域名已经解析到当前服务器，并且公网可以访问 80 端口。

如果服务器还没有运行 Nginx、Apache 等 Web 服务，并且 80 端口处于空闲状态，可以使用更直接的 **standalone 模式**：

```bash
acme.sh --issue \
  --standalone \
  -d example.com \
  -d www.example.com \
  --server letsencrypt
```

主要参数含义如下：

- `--standalone`：由 acme.sh 临时启动一个用于验证的 Web 服务
- `-d example.com`：申请根域名证书
- `-d www.example.com`：把 `www` 子域名加入同一张证书
- `--server letsencrypt`：本次使用 Let’s Encrypt 签发

standalone 模式会临时监听 80 端口，因此该端口不能被其他程序占用。Linux 普通用户通常也不能直接监听 80 端口，可以使用 root 执行，或者单独配置监听低位端口所需的权限。

需要特别注意：HTTP 验证 **不能签发泛域名证书**。如果要申请 `*.example.com`，仍然需要使用前面的 Cloudflare DNS-01 方式。另外，standalone 续期时还要再次使用 80 端口；如果签发后又启动了 Nginx，后续自动续期可能因为端口被占用而失败。已经长期运行 Web 服务的站点，更适合根据实际网站根目录使用 Webroot，而不是 standalone。

### 5.3 两种验证方式怎么选

| 对比项     | Cloudflare DNS-01            | 服务器 HTTP 验证                                    |
| ---------- | ---------------------------- | --------------------------------------------------- |
| 域名要求   | DNS 托管在 Cloudflare        | 域名解析到当前服务器                                |
| 对外端口   | 不依赖 80/443 端口           | 公网必须能访问 80 端口                              |
| 泛域名证书 | 支持                         | 不支持                                              |
| 所需权限   | Cloudflare Zone DNS 编辑权限 | Webroot 需要目录写权限；standalone 需要监听 80 端口 |
| 敏感凭据   | 需要保存最小权限 API Token   | 不需要 DNS API Token                                |
| 自动续期   | 支持                         | standalone 需保证 80 端口可用                       |
| 常见场景   | 泛域名、内网服务、多台服务器 | 域名直接指向当前服务器                              |

如果 DNS 服务商不提供 API，还可以手工添加 TXT 记录，但传统 DNS 手工模式每次续期都要更新验证值，**无法实现完全无人值守的自动续期**，不应与自动化的 HTTP 验证混为一谈。

## 6. 将证书部署给 Nginx

签发证书和部署证书是两个独立步骤。正确做法是使用 `--install-cert` 把证书复制到稳定的业务路径，并保存服务重载命令。

先创建目标目录：

```bash
sudo install -d -m 700 /etc/nginx/ssl/example.com
```

然后以有权写入目标目录的身份执行证书部署，明确选择对应证书：

```bash
sudo ~/.acme.sh/acme.sh --install-cert \
  -d example.com \
  --key-file /etc/nginx/ssl/example.com/privkey.key \
  --fullchain-file /etc/nginx/ssl/example.com/fullchain.pem \
  --reloadcmd "nginx -t && systemctl reload nginx"
```

`--key-file` 是私钥目标路径，`--fullchain-file` 是完整证书链目标路径。**`--reloadcmd` 尤其重要**：续期成功后，acme.sh 会再次复制新证书并执行这个命令；如果没有 reload，磁盘上的证书虽然更新了，Nginx 进程仍可能继续提供旧证书。

这里要注意一个容易忽略的权限问题：如果 acme.sh 是普通用户安装的，却临时使用 `sudo` 执行部署，`sudo` 下的 `HOME` 和 acme.sh 配置目录可能发生变化。更稳妥的做法是从一开始就确定运行身份：

- 全部由 root 管理：以 root 安装、签发、部署和创建 cron，路径统一为 `/root/.acme.sh`
- 普通用户管理：以该用户安装和签发，并仅授予写入目标证书文件、执行特定 reload 命令所需的最小权限

不要让 root 和普通用户各安装一套后混用 cron、证书目录和账户配置，否则很容易出现“手动执行成功，定时任务却找不到证书或 Token”的情况。

Nginx 配置中引用稳定路径：

```nginx
ssl_certificate     /etc/nginx/ssl/example.com/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/example.com/privkey.key;
```

修改后先检查配置，再重载服务：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 证书续期与常用维护命令

### 7.1 自动续期依赖什么

安装 acme.sh 时创建的 cron 通常每天运行一次 `acme.sh --cron`。每天执行检查不代表每天都会签发新证书：acme.sh 会判断证书是否进入续期窗口，满足条件时才联系 CA；如果 CA 提供 [ARI](https://github.com/acmesh-official/acme.sh/wiki/ARI)，acme.sh 也会参考 CA 建议的续期时间。

先确认当前用户的定时任务是否存在：

```bash
crontab -l
```

任务一般类似下面这样，具体用户目录可能不同：

```cron
0 0 * * * "/home/user/.acme.sh"/acme.sh --cron --home "/home/user/.acme.sh" > /dev/null
```

自动续期能否成功，取决于整条链路是否仍然可用：

- cron 必须属于安装并管理这套证书的同一个用户
- `--home` 必须指向正确的 acme.sh 目录
- 使用 DNS-01 时，`account.conf` 中保存的 Cloudflare Token 仍需有效且有权修改对应 Zone
- 使用 HTTP 验证时，域名解析和 80 端口仍需满足对应模式的要求
- 定时任务用户必须能读取账户配置和证书私钥
- 部署阶段必须能写入 Nginx 的证书目标文件
- `--reloadcmd` 必须能在无交互环境中成功执行
- 系统的 cron 服务必须处于运行状态

可以手动运行一次 cron 流程观察日志：

```bash
acme.sh --cron --home ~/.acme.sh
```

如果证书尚未进入续期窗口，日志显示跳过续期是正常现象。

### 7.2 手动续期证书

需要主动检查某张证书时，可以执行：

```bash
acme.sh --renew -d example.com
```

证书尚未到续期时间时，普通的 `--renew` 仍然会跳过，不会无条件重新签发。

只有在证书损坏等明确场景下，才使用 `--force` 强制续期：

```bash
acme.sh --renew -d example.com --force
```

强制续期会真实创建新的证书订单。不要连续重复执行，否则可能触发 CA 的速率限制，例如 [Let’s Encrypt 速率限制](https://letsencrypt.org/docs/rate-limits/)。执行后需要确认三件事：续期是否成功、`--install-cert` 配置的目标文件是否更新、Nginx 是否执行了 reload。

需要检查所有已管理证书是否应当续期，可以执行：

```bash
acme.sh --renew-all
```

`--renew-all` 同样会判断续期时间，不建议日常搭配 `--force` 使用。

### 7.3 常用证书管理命令

查看 acme.sh 当前管理的全部证书：

```bash
acme.sh --list
```

查看某个域名的证书配置和下次续期信息：

```bash
acme.sh --info -d example.com
```

当私钥泄露、域名不再受控或证书不应继续被信任时，可以向 CA **吊销证书**：

```bash
acme.sh --revoke -d example.com
```

吊销会改变证书在 CA 侧的状态，不是普通的本地清理操作。执行前应确认域名和证书类型，吊销后还要及时签发并部署新证书，避免线上服务继续使用已吊销的证书。需要提交吊销原因时，可以增加 `--revoke-reason`，其取值应参照 [acme.sh 官方吊销说明](https://github.com/acmesh-official/acme.sh/wiki/revokecert)。

如果只是希望 acme.sh 停止管理和续期某张证书，应使用 `--remove`：

```bash
acme.sh --remove -d example.com
```

**移除不等于吊销**。`--remove` 只会把证书从 acme.sh 的续期列表中移除，不会向 CA 吊销证书，也不会自动删除磁盘上的证书和私钥。执行后，如果 Nginx 仍引用旧文件，站点会一直使用它们直到证书过期或被手动替换。

最后，可以手动升级 acme.sh：

```bash
acme.sh --upgrade
```

如果希望 acme.sh 自动检查升级，可以执行：

```bash
acme.sh --upgrade --auto-upgrade
```

生产环境是否开启自动升级需要结合自己的变更管理方式决定；不开启时，也应定期关注 [acme.sh 官方版本](https://github.com/acmesh-official/acme.sh/releases)和 CA 接口变化。

## 8. 验证线上使用的证书

可以在服务器上检查部署文件的签发者和有效期：

```bash
openssl x509 \
  -in /etc/nginx/ssl/example.com/fullchain.pem \
  -noout -issuer -subject -dates
```

再从客户端连接站点，确认线上实际提供的证书，而不是只看磁盘文件：

```bash
openssl s_client \
  -connect example.com:443 \
  -servername example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

如果文件已更新但线上证书没有变化，优先检查 Nginx 是否引用了正确路径，以及 `--reloadcmd` 是否执行成功。

## 9. 几个常见问题

### 9.1 Cloudflare Token 写进了 shell 配置文件

为了方便，有人会把 Token 直接写进 `.bashrc`。这会扩大凭据暴露范围。acme.sh 首次成功使用后会把相关值保存到自己的 `account.conf`，不需要长期把 Token 放在 shell 启动脚本中。应限制 `~/.acme.sh` 的访问权限，并避免将调试日志公开。

### 9.2 只签发了泛域名，没有根域名

泛域名 `*.example.com` 不包含 `example.com`。如果两个地址都要使用，签发时必须分别传入 `-d example.com` 和 `-d '*.example.com'`。

### 9.3 直接让 Nginx 读取 `~/.acme.sh` 中的证书

这个目录属于 acme.sh 内部状态，不适合作为服务的稳定配置路径。使用 `--install-cert` 部署到 `/etc/nginx/ssl/` 等固定位置，续期时也会沿用该部署配置。

### 9.4 手动签发成功，cron 续期失败

通常是执行身份或环境不同。检查 cron 属于哪个用户、`--home` 指向哪里、Token 是否保存在同一套配置中，以及该用户能否写证书目标路径和无交互执行 reload。

### 9.5 使用 DNS 手工模式后期待自动续期

手工添加 TXT 记录的 DNS 模式不能做到传统 DNS-01 的无人值守续期，因为每次验证值都会变化。Cloudflare 已提供 API，应优先使用 `dns_cf`。

## 10. 写在最后

用 acme.sh 管理证书时，可以把流程理解为四段：安装客户端并确定运行身份、通过 Cloudflare DNS-01 或服务器 HTTP 验证证明域名控制权、用 `--install-cert` 部署到稳定路径、让 cron 在续期后执行同一套部署和 reload。

其中最值得提前设计的不是签发命令，而是权限边界。只要安装用户、配置目录、验证方式依赖的权限、证书目标路径和服务重载权限保持一致，自动续期通常就能稳定运行；如果中途混用 root 和普通用户，即使第一次签发成功，后续也很容易留下隐患。

本文命令根据 acme.sh 官方仓库及 Wiki 整理，未在真实域名和 Cloudflare 账户上执行。实际部署前，建议再对照以下官方资料确认最新参数和 CA 策略：

- [acme.sh 官方仓库](https://github.com/acmesh-official/acme.sh)
- [Let’s Encrypt 官方网站](https://letsencrypt.org/)
- [acme.sh 安装说明](https://github.com/acmesh-official/acme.sh/wiki/How-to-install)
- [acme.sh 证书签发方式](https://github.com/acmesh-official/acme.sh/wiki/How-to-issue-a-cert)
- [acme.sh DNS API 与 Cloudflare 配置](https://github.com/acmesh-official/acme.sh/wiki/dnsapi)
- [acme.sh 证书吊销说明](https://github.com/acmesh-official/acme.sh/wiki/revokecert)
