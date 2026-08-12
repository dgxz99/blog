---
id: 01N7R4P88YH9
title: 使用acme.sh与Cloudflare DNS签发、部署并自动续期HTTPS证书
pubDatetime: 2026-08-11T17:06:32+08:00
series: Linux实践
featured: true
draft: false
tags:
  - HTTPS
  - acme.sh
  - Cloudflare
  - Nginx
description: 介绍如何使用acme.sh配合Cloudflare DNS或HTTP验证签发证书，并完成Nginx部署与自动续期
---

给站点启用HTTPS时，真正麻烦的通常不是第一次拿到证书，而是后面的续期、替换证书文件以及让Web服务重新加载。如果这些环节依赖手动操作，证书到期前总会多一件需要惦记的事。

[acme.sh](https://github.com/acmesh-official/acme.sh)是一个使用Unix Shell编写的**ACME客户端**，可以完成账户注册、域名验证、证书签发、部署和续期。它不依赖Python，也不强制要求root权限。本文以Linux和Nginx为例，分别介绍**Cloudflare DNS-01**与**服务器HTTP验证**这两种方式，再走完证书部署和自动续期流程。

## 1. 开始前先理清几个概念

HTTPS证书主要解决两个问题：一是让客户端确认当前访问的服务器确实对应目标域名，二是为客户端和服务器之间的通信建立加密连接。

一套常见的证书文件包含以下内容：

- **私钥**：只保存在服务器上，用于证明服务器身份，不能泄露
- **站点证书**：由证书颁发机构签发，包含域名、公钥和有效期等信息
- **中间证书链**：帮助客户端把站点证书一路验证到受信任的根证书
- `fullchain`：通常是站点证书和中间证书链的组合，Nginx一般使用这个文件

**ACME**是证书颁发机构和客户端之间的一套自动化协议。**acme.sh是ACME客户端**，而**Let’s Encrypt、ZeroSSL才是证书颁发机构（CA）**。acme.sh负责向CA发起申请，并通过HTTP或DNS等方式证明我们确实控制着域名。

域名验证常用的两条路径是**DNS-01**和**HTTP-01**。DNS-01不要求业务服务器开放80端口，并且可以签发`*.example.com`这样的泛域名证书；HTTP-01不需要DNS API凭据，但要求域名已经指向当前服务器，并且CA能通过公网80端口访问它。后文会分别给出完整流程。

## 2. 环境和前置条件

开始前需要准备：

- 一台可执行`sh`、`curl`或`wget`、`openssl`和`cron`/`crond`的Linux主机
- 一个已正确解析的域名；使用DNS-01时，该域名需要托管到Cloudflare
- 使用DNS-01时需要Cloudflare API Token，以及对应的Account ID或Zone ID
- 使用HTTP验证时，需要域名指向当前服务器并保证公网80端口可访问
- 一个用于注册ACME账户的邮箱
- 如果最终部署给Nginx，需要有权写入证书目标目录并执行Nginx reload

acme.sh本身可以由普通用户运行，但“能运行”不等于“整个流程都不需要权限”。DNS验证不需要监听80/443端口；把证书写入`/etc/nginx/`并重载Nginx，通常仍需要root或经过限制的`sudo`权限。

## 3. 安装acme.sh

本文使用 [官方提供的在线安装脚本](https://github.com/acmesh-official/get.acme.sh)，通过`curl`下载并安装acme.sh：

```bash
curl https://get.acme.sh | sh -s email=admin@example.com
```

其中，`email=admin@example.com`用于指定ACME账户邮箱，需要替换为自己的邮箱地址。这条命令安装的是**acme.sh客户端**，并不是把证书部署到Nginx。默认情况下，安装程序会完成三件事：

1. 把程序和配置放到当前用户的`~/.acme.sh/`
2. 添加`acme.sh`命令别名
3. 为当前用户创建每日运行的cron任务

安装程序会把`acme.sh`别名写入Shell配置。当前使用Bash时，可以重新加载`~/.bashrc`，让别名在当前终端立即生效：

```bash
source ~/.bashrc
```

然后检查版本和帮助信息：

```bash
acme.sh --version
acme.sh --help
```

如果当前使用的不是Bash，或者配置文件没有立即生效，也可以关闭并重新打开终端。

## 4. 选择并切换证书颁发机构

### 4.1 证书颁发机构负责什么

**证书颁发机构（Certificate Authority，CA）**负责验证域名控制权并签发证书。浏览器和操作系统预先信任一批根证书，站点证书通过中间证书逐级连接到受信任的根证书后，客户端才能建立可信的HTTPS连接。

这里要区分三个角色：acme.sh是负责提交申请和完成验证的**ACME客户端**；Let’s Encrypt、ZeroSSL是签发证书的**CA**；[Cloudflare](https://www.cloudflare.com/)在本文中只是DNS服务商。更换CA不会改变域名验证的基本目标，但签发接口、账户信息和最终证书链可能随之变化。

### 4.2 ZeroSSL与Let’s Encrypt有什么区别

截至本文撰写时，[acme.sh官方](https://github.com/acmesh-official/acme.sh)将 **[ZeroSSL](https://zerossl.com/)标记为默认CA**，同时支持[Let’s Encrypt](https://letsencrypt.org/)、[Google Public CA](https://pki.goog/)等符合ACME规范的机构。ZeroSSL和Let’s Encrypt都可以通过ACME自动签发受公开信任的域名验证证书，部署到Nginx后都能用于正常的HTTPS访问。

日常使用时，主要关注下面几类区别：

- **签发者和证书链不同**：证书的Issuer、中间证书及最终连接的根证书可能不同；需要兼容旧设备或特殊客户端时，应实际检查证书链
- **账户注册方式不同**：不同CA对邮箱、账户注册以及EAB等信息的要求可能不同，acme.sh会处理其中一部分流程
- **速率限制不同**：单位时间内可注册账户、创建订单或为同组域名签发证书的限制由各CA自己制定，批量签发和频繁测试前需要查看对应规则，例如[Let’s Encrypt速率限制](https://letsencrypt.org/docs/rate-limits/)
- **管理方式不同**：有的CA更偏向纯自动化签发，有的还提供控制台、证书管理或商业服务；如果全程交给acme.sh管理，这部分差异通常不明显
- **服务策略可能变化**：证书有效期、续期窗口和账户要求并不是永久固定的，因此不建议在脚本里依赖某个未经确认的固定天数

这些区别不等于某一家签发的证书天然“更安全”。对普通网站而言，更重要的是客户端兼容性、自动续期是否稳定，以及团队是否熟悉对应CA的限制。

### 4.3 常见ACME证书机构对比

下表中的“有效期”指证书签发后可以使用多久，不是命令执行时间。DV证书在域名验证通过后通常可以较快签发，但实际耗时还会受到DNS解析生效、网络和CA服务状态影响。

| 证书机构                                                                        | 常见有效期                                                           | 费用情况                                                             | 使用门槛                                              | 更适合的场景                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| [Let’s Encrypt](https://letsencrypt.org/)                                       | 截至2026年8月，默认配置仍以90天为主；官方已公布后续逐步缩短计划      | 证书免费，没有付费证书套餐                                           | ACME注册和域名验证即可                                | 个人网站、普通Web服务，以及希望使用成熟社区资料的场景 |
| [ZeroSSL](https://zerossl.com/)                                                 | 免费证书通常为90天；付费产品可提供更长的订阅周期，具体以当前套餐为准 | 同时提供免费和付费方案                                               | 免费ACME可用，也提供控制台、API和商业服务             | 希望同时使用可视化管理后台或商业支持的场景            |
| [Google Public CA](https://cloud.google.com/certificate-manager/docs/public-ca) | Google托管的公共证书默认通常为90天；实际ACME证书应以签发结果为准     | Public CA签发本身可免费，但Certificate Manager等配套资源可能产生费用 | 需要Google Cloud项目、结算账号，并通过EAB绑定ACME账户 | 已使用Google Cloud，或需要统一管理大规模证书的场景    |
| [SSL.com](https://www.ssl.com/products/website-security/acme/)                  | 有效期取决于具体证书产品；其免费DV产品当前为90天                     | ACME协议本身免费，但通过ACME申请的SSL.com产品仍按对应证书方案计费    | 通常需要SSL.com账户及ACME凭据                         | 需要商业支持、OV/EV或企业证书管理方案的场景           |

证书有效期和价格策略都可能调整，执行前应查看对应CA的最新说明：[Let’s Encrypt有效期计划](https://letsencrypt.org/docs/cert-lifetimes/)、[ZeroSSL证书方案](https://zerossl.com/features/certificates/)、[Google Certificate Manager价格](https://cloud.google.com/certificate-manager/pricing)和[SSL.com ACME说明](https://www.ssl.com/products/website-security/acme/)。

仅从本文使用acme.sh自动签发普通DV证书的角度看，Let’s Encrypt和ZeroSSL的上手成本最低。Google Public CA更偏向已有Google Cloud体系的用户；SSL.com则更适合明确需要商业证书产品或支持服务的场景。

### 4.4 为什么本文使用Let’s Encrypt

[**Let’s Encrypt**](https://letsencrypt.org/)是目前使用非常广泛的免费自动化CA，相关文档、社区案例和故障排查资料都比较丰富。很多运维工具的示例也会直接以Let’s Encrypt为例。对于个人网站和普通Web服务，它通常是一个容易理解和维护的选择。

这并不意味着必须把ZeroSSL换掉。如果现有证书一直由ZeroSSL稳定签发，或者团队已经使用它的管理服务，可以继续保持默认配置。本文切换到Let’s Encrypt，主要是为了让后续命令、签发者和排查口径保持一致。

### 4.5 切换并确认默认CA

将acme.sh的默认CA切换为Let’s Encrypt：

```bash
acme.sh --set-default-ca --server letsencrypt
```

这项设置会影响后续没有显式传入`--server`的签发操作。为了让示例即使脱离上下文也能看懂，本文签发命令仍保留`--server letsencrypt`；实际使用时，设置默认CA后可以省略它。

如果只想让某一张证书使用Let’s Encrypt，不希望修改全局默认值，直接在该次`--issue`命令后增加`--server letsencrypt`即可。切换默认CA **不会自动替换已经签发的证书**，已有证书通常要等下一次使用新CA续签或重新签发后，签发者才会发生变化。

签发完成后，可以通过下面的命令查看证书签发者：

```bash
openssl x509 -in /path/to/fullchain.pem -noout -issuer -subject -dates
```

其中，`issuer`表示签发者，`subject`表示证书对应的主体，`dates`用于查看生效时间和到期时间。

## 5. 选择验证方式并签发证书

两种方式最终得到的都是可用于HTTPS的证书，区别主要发生在“如何证明域名属于自己”这一步。需要泛域名、服务器不方便开放80端口，或者证书并不部署在域名指向的服务器上时，选择DNS-01；域名指向当前服务器、只签发明确域名且不想保存DNS API凭据时，可以选择HTTP验证。

### 5.1 使用dns_cf完成DNS-01验证

#### 5.1.1 创建最小权限的Cloudflare Token

Cloudflare的**Global API Key权限过大**，一旦泄露会影响整个账户，因此不建议使用。[acme.sh官方DNS API文档](https://github.com/acmesh-official/acme.sh/wiki/dnsapi)推荐使用**User Token**或**Account-owned Token**，并尽可能缩小权限和资源范围。

具体创建步骤可以对照[Cloudflare官方API Token文档](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。用于acme.sh的Token至少需要：

- 权限：`Zone > DNS > Edit`
- 资源：只包含需要签发证书的Zone
- 如果启用了Client IP Address Filtering，需要放行运行acme.sh的主机公网IP
- Token必须处于有效期内

![image-20260804155242083](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155242083.png)

![image-20260804155525053](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155525053.png)

![image-20260804155608292](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804155608292.png)

![image-20260804161250646](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161250646.png)

然后点击`继续以显示摘要`：

![image-20260804161449813](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161449813.png)

创建后立即复制Token。Cloudflare通常只完整展示一次，不要把真实Token泄露。

![image-20260804161550596](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260804161550596.png)

#### 5.1.2 设置Cloudflare环境变量

接下来设置环境变量。只有一个Zone时，可以使用Zone ID：

```bash
export CF_Token="替换为 Cloudflare API Token"
export CF_Zone_ID="替换为 Zone ID"
```

同一个Cloudflare账户下有多个Zone时，也可以使用Account ID：

```bash
export CF_Token="替换为 Cloudflare API Token"
export CF_Account_ID="替换为 Account ID"
```

`CF_Zone_ID`和`CF_Account_ID`可以在Cloudflare对应域名的Overview页面右侧找到。首次成功调用DNS API后，acme.sh会把认证信息保存到`~/.acme.sh/account.conf`，供后续无人值守续期使用。因此应限制该文件和目录的访问权限，也不要把它复制到公开位置。

<!-- TODO: 补充Cloudflare Overview页面中Zone ID和Account ID的位置截图 -->

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
- `--dns dns_cf`：使用Cloudflare DNS API完成DNS-01验证
- `-d example.com`：加入根域名，并将第一个`-d`作为证书主域名
- `-d '*.example.com'`：加入一级泛域名；单引号可以避免 `*` 被Shell展开
- `--server letsencrypt`：本次明确使用Let’s Encrypt；已设置默认CA时可省略

`*.example.com`可以覆盖`www.example.com`，但不能覆盖根域名`example.com`，也不能覆盖`a.b.example.com`，所以这里同时写了两个`-d`。

如果DNS服务商的解析生效较慢，可以根据实际情况增加`--dnssleep秒数`。不要一开始就盲目设置很长时间，先看默认的DNS检查能否正常通过。

#### 5.1.4 检查签发结果

签发完成后，可以查看acme.sh管理的证书：

```bash
acme.sh --list
```

证书会保存在`~/.acme.sh/`下，但这个目录是acme.sh的内部工作目录。[acme.sh官方说明](https://github.com/acmesh-official/acme.sh)明确建议不要让Nginx或Apache直接引用其中的文件，因为内部目录结构将来可能变化。

### 5.2 直接在服务器上完成HTTP验证

如果不使用Cloudflare DNS API，也可以直接在域名指向的服务器上申请证书。CA会通过域名访问这台服务器，以确认申请者确实能够控制该域名。这种方式不需要Cloudflare Token，但必须保证域名已经解析到当前服务器，并且公网可以访问80端口。

如果服务器还没有运行Nginx、Apache等Web服务，并且80端口处于空闲状态，可以使用更直接的**standalone模式**：

```bash
acme.sh --issue \
  --standalone \
  -d example.com \
  -d www.example.com \
  --server letsencrypt
```

主要参数含义如下：

- `--standalone`：由acme.sh临时启动一个用于验证的Web服务
- `-d example.com`：申请根域名证书
- `-d www.example.com`：把`www`子域名加入同一张证书
- `--server letsencrypt`：本次使用Let’s Encrypt签发

standalone模式会临时监听80端口，因此该端口不能被其他程序占用。Linux普通用户通常也不能直接监听80端口，可以使用root执行，或者单独配置监听低位端口所需的权限。

需要特别注意：HTTP验证 **不能签发泛域名证书**。如果要申请`*.example.com`，仍然需要使用前面的Cloudflare DNS-01方式。另外，standalone续期时还要再次使用80端口；如果签发后又启动了Nginx，后续自动续期可能因为端口被占用而失败。已经长期运行Web服务的站点，更适合根据实际网站根目录使用Webroot，而不是standalone。

### 5.3 两种验证方式怎么选

| 对比项     | Cloudflare DNS-01            | 服务器HTTP验证                                  |
| ---------- | ---------------------------- | ----------------------------------------------- |
| 域名要求   | DNS托管在Cloudflare          | 域名解析到当前服务器                            |
| 对外端口   | 不依赖80/443端口             | 公网必须能访问80端口                            |
| 泛域名证书 | 支持                         | 不支持                                          |
| 所需权限   | Cloudflare Zone DNS编辑权限  | Webroot需要目录写权限；standalone需要监听80端口 |
| 敏感凭据   | 需要保存最小权限API Token    | 不需要DNS API Token                             |
| 自动续期   | 支持                         | standalone需保证80端口可用                      |
| 常见场景   | 泛域名、内网服务、多台服务器 | 域名直接指向当前服务器                          |

如果DNS服务商不提供API，还可以手工添加TXT记录，但传统DNS手工模式每次续期都要更新验证值，**无法实现完全无人值守的自动续期**，不应与自动化的HTTP验证混为一谈。

## 6. 将证书部署给Nginx

签发证书和部署证书是两个独立步骤。正确做法是使用`--install-cert`把证书复制到稳定的业务路径，并保存服务重载命令。

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

`--key-file`是私钥目标路径，`--fullchain-file`是完整证书链目标路径。**`--reloadcmd`尤其重要**：续期成功后，acme.sh会再次复制新证书并执行这个命令；如果没有reload，磁盘上的证书虽然更新了，Nginx进程仍可能继续提供旧证书。

这里要注意一个容易忽略的权限问题：如果acme.sh是普通用户安装的，却临时使用`sudo`执行部署，`sudo`下的`HOME`和acme.sh配置目录可能发生变化。更稳妥的做法是从一开始就确定运行身份：

- 全部由root管理：以root安装、签发、部署和创建cron，路径统一为`/root/.acme.sh`
- 普通用户管理：以该用户安装和签发，并仅授予写入目标证书文件、执行特定reload命令所需的最小权限

不要让root和普通用户各安装一套后混用cron、证书目录和账户配置，否则很容易出现“手动执行成功，定时任务却找不到证书或Token”的情况。

Nginx配置中引用稳定路径：

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

安装acme.sh时创建的cron通常每天运行一次`acme.sh --cron`。每天执行检查不代表每天都会签发新证书：acme.sh会判断证书是否进入续期窗口，满足条件时才联系CA；如果CA提供[ARI](https://github.com/acmesh-official/acme.sh/wiki/ARI)，acme.sh也会参考CA建议的续期时间。

先确认当前用户的定时任务是否存在：

```bash
crontab -l
```

任务一般类似下面这样，具体用户目录可能不同：

```cron
0 0 * * * "/home/user/.acme.sh"/acme.sh --cron --home "/home/user/.acme.sh" > /dev/null
```

自动续期能否成功，取决于整条链路是否仍然可用：

- cron必须属于安装并管理这套证书的同一个用户
- `--home`必须指向正确的acme.sh目录
- 使用DNS-01时，`account.conf`中保存的Cloudflare Token仍需有效且有权修改对应Zone
- 使用HTTP验证时，域名解析和80端口仍需满足对应模式的要求
- 定时任务用户必须能读取账户配置和证书私钥
- 部署阶段必须能写入Nginx的证书目标文件
- `--reloadcmd`必须能在无交互环境中成功执行
- 系统的cron服务必须处于运行状态

可以手动运行一次cron流程观察日志：

```bash
acme.sh --cron --home ~/.acme.sh
```

如果证书尚未进入续期窗口，日志显示跳过续期是正常现象。

### 7.2 手动续期证书

需要主动检查某张证书时，可以执行：

```bash
acme.sh --renew -d example.com
```

证书尚未到续期时间时，普通的`--renew`仍然会跳过，不会无条件重新签发。

只有在证书损坏等明确场景下，才使用`--force`强制续期：

```bash
acme.sh --renew -d example.com --force
```

强制续期会真实创建新的证书订单。不要连续重复执行，否则可能触发CA的速率限制，例如[Let’s Encrypt速率限制](https://letsencrypt.org/docs/rate-limits/)。执行后需要确认三件事：续期是否成功、`--install-cert`配置的目标文件是否更新、Nginx是否执行了reload。

需要检查所有已管理证书是否应当续期，可以执行：

```bash
acme.sh --renew-all
```

`--renew-all`同样会判断续期时间，不建议日常搭配`--force`使用。

### 7.3 常用证书管理命令

查看acme.sh当前管理的全部证书：

```bash
acme.sh --list
```

查看某个域名的证书配置和下次续期信息：

```bash
acme.sh --info -d example.com
```

当私钥泄露、域名不再受控或证书不应继续被信任时，可以向CA **吊销证书**：

```bash
acme.sh --revoke -d example.com
```

吊销会改变证书在CA侧的状态，不是普通的本地清理操作。执行前应确认域名和证书类型，吊销后还要及时签发并部署新证书，避免线上服务继续使用已吊销的证书。需要提交吊销原因时，可以增加`--revoke-reason`，其取值应参照[acme.sh官方吊销说明](https://github.com/acmesh-official/acme.sh/wiki/revokecert)。

如果只是希望acme.sh停止管理和续期某张证书，应使用`--remove`：

```bash
acme.sh --remove -d example.com
```

**移除不等于吊销**。`--remove`只会把证书从acme.sh的续期列表中移除，不会向CA吊销证书，也不会自动删除磁盘上的证书和私钥。执行后，如果Nginx仍引用旧文件，站点会一直使用它们直到证书过期或被手动替换。

最后，可以手动升级acme.sh：

```bash
acme.sh --upgrade
```

如果希望acme.sh自动检查升级，可以执行：

```bash
acme.sh --upgrade --auto-upgrade
```

生产环境是否开启自动升级需要结合自己的变更管理方式决定；不开启时，也应定期关注[acme.sh官方版本](https://github.com/acmesh-official/acme.sh/releases)和CA接口变化。

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

如果文件已更新但线上证书没有变化，优先检查Nginx是否引用了正确路径，以及`--reloadcmd`是否执行成功。

## 9. 几个常见问题

### 9.1 Cloudflare Token写进了shell配置文件

为了方便，有人会把Token直接写进`.bashrc`。这会扩大凭据暴露范围。acme.sh首次成功使用后会把相关值保存到自己的`account.conf`，不需要长期把Token放在shell启动脚本中。应限制`~/.acme.sh`的访问权限，并避免将调试日志公开。

### 9.2 只签发了泛域名，没有根域名

泛域名`*.example.com`不包含`example.com`。如果两个地址都要使用，签发时必须分别传入`-d example.com`和`-d '*.example.com'`。

### 9.3 直接让Nginx读取`~/.acme.sh`中的证书

这个目录属于acme.sh内部状态，不适合作为服务的稳定配置路径。使用`--install-cert`部署到`/etc/nginx/ssl/`等固定位置，续期时也会沿用该部署配置。

### 9.4 手动签发成功，cron续期失败

通常是执行身份或环境不同。检查cron属于哪个用户、`--home`指向哪里、Token是否保存在同一套配置中，以及该用户能否写证书目标路径和无交互执行reload。

### 9.5 使用DNS手工模式后期待自动续期

手工添加TXT记录的DNS模式不能做到传统DNS-01的无人值守续期，因为每次验证值都会变化。Cloudflare已提供API，应优先使用`dns_cf`。

## 10. 写在最后

用acme.sh管理证书时，可以把流程理解为四段：安装客户端并确定运行身份、通过Cloudflare DNS-01或服务器HTTP验证证明域名控制权、用`--install-cert`部署到稳定路径、让cron在续期后执行同一套部署和reload。

其中最值得提前设计的不是签发命令，而是权限边界。只要安装用户、配置目录、验证方式依赖的权限、证书目标路径和服务重载权限保持一致，自动续期通常就能稳定运行；如果中途混用root和普通用户，即使第一次签发成功，后续也很容易留下隐患。

本文命令根据acme.sh官方仓库及Wiki整理，未在真实域名和Cloudflare账户上执行。实际部署前，建议再对照以下官方资料确认最新参数和CA策略：

- [acme.sh官方仓库](https://github.com/acmesh-official/acme.sh)
- [Let’s Encrypt官方网站](https://letsencrypt.org/)
- [acme.sh安装说明](https://github.com/acmesh-official/acme.sh/wiki/How-to-install)
- [acme.sh证书签发方式](https://github.com/acmesh-official/acme.sh/wiki/How-to-issue-a-cert)
- [acme.sh DNS API与Cloudflare配置](https://github.com/acmesh-official/acme.sh/wiki/dnsapi)
- [acme.sh证书吊销说明](https://github.com/acmesh-official/acme.sh/wiki/revokecert)
