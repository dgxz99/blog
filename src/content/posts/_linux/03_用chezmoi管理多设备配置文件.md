---
id: 01NAWEY9PQD6
title: 用chezmoi管理多设备配置文件
pubDatetime: 2026-09-19T15:36:24+08:00
series: Linux
draft: false
tags:
  - chezmoi
  - dotfiles
  - Linux
  - 配置管理
description: 介绍使用chezmoi管理多设备配置文件的原理、模板、远程同步、敏感信息保护和日常维护流程
---

![用chezmoi管理多设备配置文件](https://dg-typora.oss-cn-chengdu.aliyuncs.com/00-hero-chezmoi-cover.png)

在 Linux 下工作，终端和开发环境几乎就是日常的“生产车间”。随着使用时间变长，每个人都会按照自己的手感一点点调校出一套顺手的配置：

- Shell 的别名、环境变量与补全（`~/.bashrc`、`~/.zshrc`）；
- 经常敲的 Git 快捷命令与个人偏好（`~/.gitconfig`）；
- 终端模拟器、Starship 提示符、Tmux、Neovim 等工具的定制（`~/.config/...`）；
- 甚至包括现代 AI 编程工具的全局配置（如 `~/.pi/agent/settings.json`、`~/.codex/config.toml`）。

这些文件因为前面通常带一个点（`.`），在 Unix/Linux 习惯中被称为 **dotfiles（点文件）**。

调教这些配置往往花了几十甚至上百个小时。但只要遇到以下几种常见场景，往往就让人头大：

1. **配置散落，重装与换机成本极高**：新配一台 Linux 机器、买了一台轻薄本装双系统，或者登录刚买的云服务器（VPS），面对空荡荡的默认终端，要么凭记忆从头手敲一遍，要么满世界翻历史记录和笔记。
2. **手写符号链接（Symlink）的局限**：大部分人最早想到的办法，是在 GitHub 建一个 `dotfiles` 仓库，再手写一个 `install.sh` 脚本，把仓库里的文件通过软链接（`ln -s`）指向家目录（或者借助 GNU Stow）。但这套方案很快就会遇到瓶颈：
   - **机器间的微妙差异**：主力桌面机、办公机、纯命令行 VPS，有 80% 的配置是一样的，但总有 20% 不一样（比如终端字体、屏幕缩放、代理端口、内网路径）。软链接是整份文件硬连过去，很难优雅处理局部差异；
   - **软链接被软件“斩断”**：不少现代工具保存配置时，机制是“先写临时文件再重命名覆盖原文件”，这种原子写入会直接斩断软链接，导致配置变成独立文件，改动根本没同步回 Git；
   - **跨平台与权限问题**：如果要在 Linux、macOS 以及 Windows/WSL 之间同步，软链接在 Windows 上需要管理员权限或开发者模式，跨系统同步过去的链接经常失效；
   - **敏感信息无处安放**：某些配置中不可避免会夹杂 API Token、内部代理地址或私有邮箱，直接推公共 Git 仓库有泄露风险，不推又怕丢。

针对这些让人抓狂的痛点，社区里衍生过许多点文件管理方案，而 [chezmoi](https://www.chezmoi.io/) 是目前综合体验非常出色的一个。

它的名字来自法语 **chez moi**（读音接近 `/ʃe mwa/`），意为“在我家”。Linux 每个用户的配置都在自己的家目录（`$HOME` / `~`）下，chezmoi 的名字正是这个寓意：不管换到哪台机器，都能把自己的“家”迅速收拾得井井有条。

与传统的软链接脚本相比，chezmoi 并不是简单地建立链接，而是用一个私有 Git 仓库作为唯一来源（Source），在每台机器上根据当前系统和变量计算出目标配置，再写入到真实文件（Destination）中。它天生自带模板引擎、敏感数据加密支持，并能优雅避开软链接被破坏的问题。

下面先从核心工作原理与三层状态模型讲起，随后完成环境安装与补全配置；接着在本地单机走通纳管、修改与模板的完整闭环，再接入远程仓库实现多端协同，最后介绍针对敏感密钥与机密配置的安全治理方案。

![chezmoi 核心三层状态模型与单向数据流](https://dg-typora.oss-cn-chengdu.aliyuncs.com/01-framework-three-state-model.png)

## 1. 核心工作原理与三层状态模型

很多初接触 chezmoi 的人会以为它只是个“高级版的软链接工具”，但它的设计理念完全不同。理解 chezmoi 的关键，在于掌握它的**三层状态模型**与**文件名元数据系统**。

### 1.1 三层状态与单向数据流

chezmoi 把配置的状态严格拆解为三层，而不是网盘式的实时双向同步：

1. **源状态（Source State / 源目录）**
   - 默认存放在 `~/.local/share/chezmoi`（Windows 下为 `%LOCALAPPDATA%\chezmoi`）。
   - 本质是一个**纯粹、标准的本地 Git 仓库**，里面保存着所有受管源文件、模板以及加密文件。所有的版本管理、分支切换、远程推送都在这里进行。
2. **目标状态（Target State / 期望状态）**
   - 存在于**内存中**的计算结果，不是磁盘上的真实文件。
   - chezmoi 在执行计算时，会读取源仓库的内容，结合当前机器的环境信息（如操作系统、CPU 架构、主机名）以及自定义变量，动态渲染出该机器“理论上应该长什么样”。
3. **落地状态（Destination State / 目标目录）**
   - 即真实的家目录（`$HOME`，即 `~`）。
   - 各种软件（Bash、Neovim、Git 等）日常运行和读写的真实配置文件。

#### 为什么这种模型能解决传统方案的痛点？

- **单向流动，杜绝污染**：数据流向是 `源状态 → 目标状态 → 落地状态`。很多现代软件喜欢在退出时自行把窗口大小、历史记录回写进配置文件，在 chezmoi 的体系下，软件改写的永远只是第三层的真实配置文件，绝不会直接污染你的 Git 源仓库。
- **摆脱脆弱的软链接**：落地状态下全部是**真实文件**，不再依赖符号链接，彻底规避了软件“原子重命名”导致软链接被斩断的硬伤。

### 1.2 编码在文件名上的元数据

在 Linux 下，Git 默认只能记录基本的文件权限（`0644` 和 `0755`），无法记录如 `0700`（私有目录）、`0600`（私有文件）等更细致的权限，也无法直接用文件名表达行为。

chezmoi 没有采用引入外部 SQLite 数据库这种沉重且不便版本管理的方案，而是创造性地发明了一套**文件名前缀系统（Attributes）**——将权限、行为与类型直接编码在源文件的命名中：

| 属性术语      | 作用与含义                                                                                               | 落地后的形态举例                                  |
| :------------ | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| `dot_`        | **隐藏点文件**：在源仓库中显式命名，落地时自动还原为以 `.` 开头的隐藏文件。                              | `dot_gitconfig` 落地为 `~/.gitconfig`             |
| `private_`    | **私有权限保护**：确保文件或目录具有严格的访问权限（目录 `0700`，文件 `0600`），避免同组或其他用户读取。 | `private_id_ed25519` 落地为权限 `0600` 的密钥文件 |
| `readonly_`   | **只读锁定**：落地后移除写权限（`0400` 或 `0444`），防止某些工具擅自修改写入。                           | `readonly_dot_npmrc` 落地为防篡改文件             |
| `exact_`      | **精确匹配目录**：严格对齐目录内容。若落地目录中存在未在源仓库中定义的文件，会被直接清理。               | 保持某配置目录绝对干净                            |
| `executable_` | **可执行权限**：确保落地后的脚本具备 `+x` 可执行权限（`0755`）。                                         | 用于自定义维护脚本                                |
| `.tmpl`       | **动态模板后缀**：声明该文件包含 Go Template 语法，落地前先由内存引擎计算取值。                          | `dot_gitconfig.tmpl` 动态渲染为 `~/.gitconfig`    |

> **直观理解：**
> 如果你在源仓库看到一个名为 `private_dot_config/app/config.toml.tmpl` 的文件，就可以一眼读出它的全貌：它是一个**带隐藏点号的目录**（`dot_`），具有**严格的私有权限**（`private_`），并且是一个**动态模板文件**（`.tmpl`）。

![chezmoi 文件名元数据属性解码体系](https://dg-typora.oss-cn-chengdu.aliyuncs.com/02-infographic-metadata-attributes.png)

### 1.3 受管与非受管边界

在家目录下有成千上万个文件和缓存，chezmoi 采用了严格的**白名单机制**：

- **受管文件（Managed）**：显式加入源仓库的文件。chezmoi 只会关注、计算和维护这部分文件。
- **非受管文件（Unmanaged）**：家目录下其余绝大多数未加入的文件。chezmoi 默认不会触碰、也不会扫描它们，保证系统绝对安全、无侵入。

## 2. 安装与环境准备

chezmoi 本质上是一个用 Go 编写的单文件静态二进制程序，无需任何外部运行环境依赖，安装极其轻巧迅速。

不同 Linux 发行版和操作系统的安装方式略有不同，推荐按以下方式选择：

### 2.1 Linux 环境安装

#### 官方脚本安装

无论在个人桌面机、云服务器（VPS）还是没有 `sudo` 权限的受限环境下，官方一键脚本都是最稳妥、版本最新的安装方式。它会自动下载预编译二进制并存放在用户专用的 `~/.local/bin` 中，完全不污染系统底层目录：

```bash
# 下载 chezmoi 二进制到当前用户的 ~/.local/bin
sh -c "$(curl -fsLS https://get.chezmoi.io)" -- -b ~/.local/bin
```

安装完成后，验证是否可用：

```bash
chezmoi --version
```

> **提示：检查 `$PATH` 环境变量**
> 多数现代 Linux 发行版默认已将 `~/.local/bin` 加入 `$PATH`。若终端提示 `command not found`，只需在当前 Shell 配置文件（如 `~/.bashrc` 或 `~/.zshrc`）末尾加上一行：
>
> ```bash
> export PATH="$HOME/.local/bin:$PATH"
> ```
>
> 保存后执行 `source ~/.bashrc` 即可生效。

#### 发行版包管理器安装

如果你习惯让系统包管理器来集中管理更新，各大主流发行版官方仓库也均已收录：

- **Arch Linux**：

  ```bash
  sudo pacman -S chezmoi
  ```

- **Debian / Ubuntu**（Debian 12+ / Ubuntu 23.04+）：
  ```bash
  sudo apt install chezmoi
  ```
  _(注：若为较老版本的 Ubuntu/Debian，apt 仓库中的版本可能偏旧，更推荐使用方案 A 的脚本安装)_
- **Fedora / RHEL 系列**：

  ```bash
  sudo dnf install chezmoi
  ```

- **Alpine Linux**（常用于轻量容器或极简 VPS）：
  ```bash
  apk add chezmoi
  ```

### 2.2 macOS 环境安装

如果你在 Mac 上开发，首选通过 Homebrew 安装：

```bash
brew install chezmoi
```

_(也可以直接使用 Linux 的方案 A 官方脚本)_

### 2.3 Windows 环境安装

如果日常需要兼顾 Windows 工作机（例如管理 PowerShell 或跨平台工具配置）：

- **winget（推荐，Windows 10/11 内置）**：
  ```powershell
  winget install twpayne.chezmoi
  ```
- **Scoop**：

  ```powershell
  scoop install chezmoi
  ```

### 2.4 验证与环境自检

安装好之后，可以执行 chezmoi 自带的环境自检命令：

```bash
# 查看版本
chezmoi --version
# chezmoi环境自检
chezmoi doctor
```

它会自动检查当前系统的 Git、Shell 路径、相关目录权限等是否齐备正常。

![image-20260915150724294](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915150724294.png)

### 2.5 命令别名与补全配置

在正式开始纳管文件前，顺手配上这两个小配置会让后续体验顺滑很多：

1. **配置别名（Alias）**：`chezmoi` 敲起来有 7 个字母，日常操作频繁，建议加个短别名：

   - **Bash / Zsh**（写入 `~/.bashrc` 或 `~/.zshrc`）：

     ```bash
     alias cz=chezmoi
     ```

   - **Fish**（写入 `~/.config/fish/config.fish`）：

     ```fish
     alias cz=chezmoi
     ```

     后面常用的 `cz status`、`cz diff`、`cz apply` 敲起来就轻快多了。

2. **启用 Shell 命令补全（可选）**：chezmoi 原生支持生成主流 Shell 的补全脚本：

   - **Bash**：

     ```bash
     mkdir -p ~/.local/share/bash-completion/completions
     chezmoi completion bash > ~/.local/share/bash-completion/completions/chezmoi
     ```

   - **Zsh**：
     ```bash
     mkdir -p ~/.zfunc
     chezmoi completion zsh > ~/.zfunc/_chezmoi
     ```
   - **Fish**：
     ```fish
     mkdir -p ~/.config/fish/completions
     chezmoi completion fish > ~/.config/fish/completions/chezmoi.fish
     ```

## 3. 本地操作与状态追踪

在把配置推到GitHub或同步到其他机器之前，最稳妥的做法是在本地单机把纳管、对比、修改和模板这套流程跑顺。这里先用一个简单的 `~/.config/cm-demo.toml` 做演示，避免一开始改动正在使用的真实配置。后面掌握流程后，再把它替换成自己的Git、Shell或编辑器配置。

### 3.1 初始化本地仓库

刚装好chezmoi时，本地还没有任何仓库。第一步是在本地初始化源仓库：

```bash
chezmoi init
```

这条命令执行后，chezmoi会在后台创建目录 `~/.local/share/chezmoi`（Windows下对应 `%LOCALAPPDATA%\chezmoi`）。可以使用下面的命令进行查看。

```bash
# 查看源仓库的根目录绝对路径
chezmoi source-path
```

这个目录本质上就是一个标准的空Git仓库，里面包含完整的 `.git` 隐藏目录。此时家目录下的任何真实配置文件都还没被触碰，也没有任何文件处于受管状态。

可以通过以下命令进入该目录验证状态：

```bash
# 查看本地新生成的源仓库目录
ls -la ~/.local/share/chezmoi

# 或者切入源仓库环境检查Git状态
chezmoi cd
git status
exit
```

执行 `git status` 会看到当前处于空的初始提交状态，`exit` 则会退出 `chezmoi cd` 创建的子Shell，回到原来的工作目录。

![image-20260915155003418](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915155003418.png)

### 3.2 管理配置文件

为了直观体验纳管流程与不同文件的属性识别，这里以XDG规范下最常见的配置路径 `~/.config/cm-demo.toml` 为例。

先创建配置目录，再在里面写入一个简单的示例文件：

```bash
mkdir -p ~/.config
echo "theme=dark" > ~/.config/cm-demo.toml
```

将其纳入chezmoi管理：

```bash
# 添加配置文件给chezmoi管理
chezmoi add ~/.config/cm-demo.toml

# 查看该文件在源仓库中的映射路径
chezmoi source-path ~/.config/cm-demo.toml
```

![image-20260915161628865](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915161628865.png)

从终端输出中可以看到，原本家目录下的 `.config` 在源仓库中变成了 `private_dot_config`。这是因为Linux下 `~/.config` 目录的默认权限通常是 `0700`（仅当前用户拥有读写执行权限）。chezmoi在纳管时忠实记录下了这个权限特征，并自动将元数据编码进前缀：`private_` 代表私有安全权限，`dot_` 代表隐藏目录。这样后续跨设备恢复时，权限完全不会走样。

如果纳管其他具有不同权限特征的文件，chezmoi会如何识别？

1. **普通隐藏文件（权限 `0644`）**：

   ```bash
   # 纳管家目录下的 .bashrc
   chezmoi add ~/.bashrc
   chezmoi source-path ~/.bashrc
   ```

   ![image-20260915194128081](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915194128081.png)

   普通文件没有严格的私有权限要求，因此仅添加 `dot_` 前缀，落地后还原为 `~/.bashrc`。

2. **带可执行权限的脚本（权限 `0755`）**：

   ```bash
   # 创建并纳管一个可执行脚本
   mkdir -p ~/.local/bin
   echo '#!/bin/bash\necho "hello"' > ~/.local/bin/my-script
   chmod +x ~/.local/bin/my-script
   chezmoi add ~/.local/bin/my-script
   chezmoi source-path ~/.local/bin/my-script
   # 输出：~/.local/share/chezmoi/dot_local/bin/executable_my-script
   ```

   源仓库中自动加上了 `executable_` 前缀，确保在新机器上落地后脚本天然具备执行权限，无需手动补敲 `chmod +x`。

   ![image-20260915194329250](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915194329250.png)

3. **私有配置或密钥（权限 `0600` / `0700`）**：
   包含敏感访问控制的文件或目录，源仓库路径会前缀 `private_`，保障落地时自动设置严格的权限掩码。

查看本机当前受管的完整清单：

```bash
# 查看全部受管对象（包含父目录）
chezmoi managed

# 仅查看受管的具体文件
chezmoi managed --include=files
```

![image-20260915195308832](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915195308832.png)

初次看到默认输出里多出了 `.config` 目录项容易让人产生疑惑，以为chezmoi把整个配置目录下的临时缓存全接管了。实际上，这行目录项仅标记chezmoi在目标机器落地时会保证父目录存在且保持 `0700` 权限，绝不会扫描或改动该目录下未纳管的其他同级文件。

### 3.3 日常修改配置与生效

既然已经把配置文件交给了chezmoi，平时需要修改设置时，最稳妥的方式就是通过chezmoi统一进行管理与修改。这样所有改动都会直接保存在受版本控制的源仓库中，避免直接改动家目录导致配置脱节。

平时要调整某项设置，直接运行编辑命令。假设我们想把之前示例文件中的深色主题改为浅色，并新增一行字号配置：

```bash
chezmoi edit ~/.config/cm-demo.toml
```

chezmoi会自动找到源仓库中对应的 `private_dot_config/cm-demo.toml`，并调用系统默认的 `$EDITOR`（如nvim、vim或nano）打开它。我们将内容修改为：

```toml
theme = "light"
font_size = 14
```

修改完成并保存退出后，改动目前先保存在源仓库中，家目录下的真实配置文件尚未改变。在让它真正应用到家目录之前，可以先看一眼变动情况：

```bash
# 查看有哪些文件发生变动
chezmoi status

# 预先查看即将写入真实配置文件的具体差异
chezmoi diff
```

![image-20260915201047961](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915201047961.png)

从终端输出中可以看到：

- **`chezmoi status`** 输出类似 Git 的状态标记 ` M ~/.config/cm-demo.toml`，左侧的 ` M` 清楚表明源仓库中存在待应用的改动；
- **`chezmoi diff`** 则以标准的统一差异格式（Unified Diff）输出彩色高亮对比，清晰显示出即将写入真实配置文件的增删内容（绿色新增、红色删除）。

确认改动正是自己想要的之后，敲入应用命令让新配置在当前机器落地。`chezmoi apply` 极其灵活，既支持全量落地，也支持指定单文件、多文件或整个目录：

```bash
# 全量应用：重新计算并落地所有受管配置
chezmoi apply

# 单文件应用：仅落地指定的一个配置文件
chezmoi apply ~/.config/cm-demo.toml

# 多文件应用：同时指定多个受管文件
chezmoi apply ~/.config/cm-demo.toml ~/.bashrc

# 目录级应用：仅递归落地指定目录下的所有受管配置
chezmoi apply ~/.config
```

此时查看家目录下的真实配置文件，内容已经安全更新：

```bash
cat ~/.config/cm-demo.toml
```

![image-20260915201345541](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915201345541.png)

如果日常只是做点小调整，不想分步敲 `edit` 和 `apply`，可以在编辑时一步到位：

```bash
chezmoi edit --apply ~/.config/cm-demo.toml
```

只要在编辑器里保存并退出，修改就会立即自动同步到家目录。

### 3.4 检查差异与处理外部变动

在日常使用中，配置文件除了通过 `chezmoi edit` 统一修改之外，也经常会因为在外部直接改动、或者某些软件在运行过程中自动回写而产生变化。

这些变动会导致家目录里的真实配置文件与源仓库中记录的配置产生偏差。

这里直接修改配置文件来模拟这种情况。面对变动，第一步是看清究竟改了什么：

```bash
# 查看有哪些文件发生偏离
chezmoi status

# 查看具体的改动行差异
chezmoi diff
```

![image-20260915202044177](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915202044177.png)

看清 `diff` 显示的差异后，通常有三种针对性的处理策略：

![应对外部变动的 3 种处理策略对比](https://dg-typora.oss-cn-chengdu.aliyuncs.com/03-comparison-external-change-strategies.png)

**(1) 丢弃外部改动（覆盖复原）**

如果外部改动并不是你想要的，无需手动改回去，直接用源仓库中的记录覆盖配置文件：

```bash
chezmoi apply ~/.config/cm-demo.toml
```

执行后，配置文件会恢复到源仓库中声明的纯净状态。

**(2) 保留外部改动（反向吸收）**

如果外部改动正是你需要的，想把它同步回源仓库并持久化保存：

```bash
chezmoi re-add ~/.config/cm-demo.toml
```

`re-add` 会读取家目录下配置文件的当前内容，反向覆盖源仓库中的文件。

> **重要避坑提醒**  
> `re-add` 只适用于纯静态文本文件。如果某个文件后续被改造成了带语法判断的模板文件（`.tmpl`），**切忌对它执行 `re-add`**。否则家目录下渲染后的静态文本会直接反向抹掉你在源仓库里精心编写的模板逻辑。改动模板应当始终使用 `chezmoi edit` 手动调整。

**(3) 避免冲突的结构化方案**

如果某个文件经常在外部发生变动，可以从文件结构上避免反复手动处理：

- **使用 `create_` 前缀**：在源仓库中将文件命名为 `create_` 开头（例如 `create_dot_config/app/state.json`）。chezmoi 仅在目标文件不存在时创建，一旦存在就永不覆盖，后续无论外部怎么修改都不会影响日常 `apply`。
- **拆分主配置与 Local 本地配置**：将通用的全局配置交给 chezmoi 管理，在主配置末尾通过 `include` 引入外部文件（例如 `[include] path = ~/.gitconfig.local`），把变动频繁或私有的内容放在未纳管的本地文件中。

### 3.5 移除文件受管状态

如果某个文件以后不想再让chezmoi管理了，执行退出命令：

```bash
# 执行之后会有个确认交互
chezmoi forget ~/.config/cm-demo.toml
```

![image-20260915203229754](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915203229754.png)

![image-20260915203303353](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915203303353.png)

执行之后，源仓库里的对应文件会被移出版本控制，但家目录下的真实文件 `~/.config/cm-demo.toml` 依然完好无损地留在原处，依赖该配置的软件不会受到任何影响。

### 3.6 模板机制与Go Template语法

纯静态文件能解决多设备共享一套配置的问题，但解决不了差异化问题。比如个人桌面机和云服务器VPS在配置复杂度上完全不同，Linux与Windows在文件路径或换行符上存在差异，不同电脑上使用的Git邮箱或主题字号也各不相同。

针对这类场景，chezmoi内置了强大的Go Template模板引擎。

**(1) 声明与转换模板文件**

要让某个配置文件具备动态渲染能力，关键在于将其在源仓库中命名为以 `.tmpl` 结尾的文件。

无论是初次准备纳管的新文件，还是之前已经作为普通静态文件纳管的配置，直接使用同一条命令加上 `--template` 参数即可：

```bash
chezmoi add --template ~/.config/cm-demo.toml
```

如果是新文件，chezmoi会直接作为模板收纳进源仓库；如果是已有静态受管文件，chezmoi会自动在源仓库中把对应文件重命名并追加 `.tmpl` 后缀。

![image-20260915204910217](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915204910217.png)

带上 `.tmpl` 后缀意味着该文件在落地到家目录之前，会先由模板引擎执行求值计算。

**(2) 查看当前机器的内置变量数据**

chezmoi在启动时会自动采集当前机器的软硬件特征。运行以下命令可以查看本机的所有可用变量：

```bash
chezmoi data
```

终端会输出一段格式化的JSON数据，其中日常最常用的内置字段包括：

- `.chezmoi.os`：操作系统类型，如 `linux`、`windows`
- `.chezmoi.arch`：CPU架构，如 `amd64`、`arm64`
- `.chezmoi.hostname`：当前计算机的主机名
- `.chezmoi.homeDir`：当前用户的家目录绝对路径

**(3) 编写模板、预览与生效全流程**

通过 `chezmoi edit ~/.config/cm-demo.toml` 打开模板文件，就可以直接写入条件判断逻辑：

```toml
theme = "dark"

{{- if eq .chezmoi.os "windows" }}
font_size = 11
{{- else }}
font_size = 13
{{- end }}

{{- if eq .chezmoi.hostname "work-laptop" }}
profile = "work"
{{- else }}
profile = "personal"
{{- end }}
```

编写模板时，以下几个核心语法点最为常用：

1. **变量引用**：必须以 `.` 开头，例如 `{{ .chezmoi.hostname }}`。
2. **条件分支与比较运算符**：
   - 基础分支：`{{ if ... }} ... {{ else if ... }} ... {{ else }} ... {{ end }}`；
   - 比较运算符：`eq`（等于）、`ne`（不等于）、`lt`（小于）、`gt`（大于）；
   - 逻辑运算符：`and`、`or`、`not`。例如 `{{ if and (eq .chezmoi.os "linux") (ne .chezmoi.hostname "server") }}`。
3. **消除多余空行（核心格式技巧）**：
   Go Template中的 `{{ if ... }}` 在被引擎求值移除后，默认会留下一行难看的空白行。在花括号内侧加上减号（`{{-` 与 `-}}`），可以指示引擎**自动裁剪该标签前后的换行符与空格**，保证最终生成的真实配置文件整洁紧凑。

保存退出后，改动目前只保存在源仓库中。在应用生效前，可以先用只读命令安全预览当前机器渲染出来的最终内容：

```bash
# 预览当前机器计算后的最终渲染文本
chezmoi cat ~/.config/cm-demo.toml

# 或者直接对源仓库中的模板文件进行动态求值测试
chezmoi execute-template < ~/.local/share/chezmoi/private_dot_config/cm-demo.toml.tmpl
```

![image-20260915205531911](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915205531911.png)

终端会直接打印出计算后的纯文本结果，完全不会触碰家目录。确认变量与条件分支渲染无误后，敲入应用命令让新配置落地：

```bash
# 将模板渲染计算的结果写入配置文件
chezmoi apply ~/.config/cm-demo.toml

# 查看家目录中的真实配置文件
cat ~/.config/cm-demo.toml
```

![image-20260915205618150](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915205618150.png)

此时家目录里的真实配置文件已经变成了干净的纯文本，所有模板语法标签在落地后均已被正确求值消除。

**(4) 常用进阶函数与官方参考**

除了基础的条件分支，chezmoi还内置了上百个实用的模板函数，例如：

- 读取环境变量：`{{ env "USER" }}`
- 检查系统命令是否存在：`{{ if lookPath "starship" }} ... {{ end }}`
- 引入共享片段：`{{ template "common.toml" . }}` 或 `{{ include "snippets/header.txt" }}`
- 路径与字符串操作：`joinPath`、`lower`、`replace` 等

更多完整的模板语法与函数清单，可以查阅官方参考文档：

- [chezmoi 模板使用文档](https://www.chezmoi.io/reference/templates/)
- [chezmoi 模板内置函数完整列表](https://www.chezmoi.io/reference/templates/functions/)

## 4. 接入远程仓库与多设备协同

在本地单机走通了纳管、修改、生效与模板计算的闭环之后，所有配置目前仅保存在当前这台电脑的本地源仓库中。接下来，我们将本地源仓库托管到远端代码平台，构建跨设备同步的配置中枢。

![chezmoi 多设备远程协同与同步流程](https://dg-typora.oss-cn-chengdu.aliyuncs.com/04-flowchart-multidevice-sync.png)

### 4.1 托管到私有 Git 仓库

源仓库（`~/.local/share/chezmoi`）本质是一个标准的本地Git仓库，里面完整记录着所有受管源文件与版本提交历史。

**(1) 推送本地仓库到远端**

可以直接使用 `chezmoi cd` 命令切入源仓库，将其关联并推送到GitHub、GitLab或自建Git服务上，这里就是git常用操作了：

```bash
# 进入源仓库所在目录
chezmoi cd

# 关联远程仓库并推送到main分支
git remote add origin git@github.com:yourname/dotfiles.git
git add .
git commit -m "feat: init dotfiles"
git push -u origin main

# 退出子Shell，返回原工作目录
exit
```

强烈建议将远程仓库设置为Private私有仓库。即使配置中尚未包含密码，个人的主机名、内部网络代理、内网路径等信息一旦公开，依然存在隐私泄露风险。

**(2) 日常免切目录的 Git 包装命令**

如果平时不想频繁使用 `chezmoi cd` 进出子Shell，可以直接使用 `chezmoi git <命令>`。

它的机制非常简单直接，其实就是在常规Git命令前面加上 `chezmoi` 前缀。底层行为和参数与标准Git完全一样，区别仅仅在于它会自动以源仓库为工作目录，专门用来操作受管配置文件的版本历史与远程推送。

这里有一个细节需要注意：当传递包含短横线的Git参数（例如 `-m`、`-am` 或 `-b`）时，**必须在 `git` 后面加上双横线 `--` 分隔符**：

```bash
# 查看源仓库的Git状态
chezmoi git status

# 暂存所有变动
chezmoi git add .

# 提交改动：带 -m 参数时必须加 -- 分隔符
chezmoi git -- commit -m "chore: update config"

# 推送到远端仓库
chezmoi git push

# 查看源仓库提交历史
chezmoi git -- log --oneline -n 5
```

### 4.2 新设备拉取与一键初始化

当换到一台新电脑，或者需要在刚开通的云服务器上部署开发环境时，在安装好`chezmoi`之后，就可以直接从远程代码仓库拉取全部配置。

在新设备上，最常用的是通过一条命令完成拉取并立即落地：

```bash
# 使用SSH或HTTPS地址拉取你的私有仓库并直接应用
chezmoi init --apply git@github.com:yourname/dotfiles.git
```

如果使用的是GitHub上的公开仓库，甚至可以直接简写为你的GitHub用户名：

```bash
chezmoi init --apply yourname
```

这条命令在后台顺畅完成了三个动作：

1. 将远端Git仓库完整克隆到本机的 `~/.local/share/chezmoi`
2. 结合当前机器的操作系统、架构与主机名，由模板引擎动态计算出适合本机的期望配置
3. 将计算好的配置一次性写入家目录对应的真实配置文件中

如果新机器上已经存在现有配置，担心直接应用会意外覆盖现有文件，也可以将步骤拆开分步执行：

```bash
# 第一步，仅将远端仓库克隆到本地源仓库，不立即触碰家目录
chezmoi init git@github.com:yourname/dotfiles.git

# 第二步，只读对比远端配置与当前家目录现状的差异
chezmoi diff

# 第三步，确认差异无误后手动执行应用落地
chezmoi apply
```

![image-20260915232626332](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260915232626332.png)

从终端输出中可以看到，通过先 `init` 再 `diff` 的分步方式，可以清晰预判哪些文件即将被创建或修改，确认完全符合预期后再敲入 `apply` 落地，整个流程更加稳健可控。

如果面对的是一台连chezmoi都尚未安装的全新纯净系统，也可以直接使用官方提供的一行流复合脚本，把下载安装、克隆仓库与落地应用三个阶段一并搞定：

```bash
sh -c "$(curl -fsLS https://get.chezmoi.io)" -- init --apply git@github.com:yourname/dotfiles.git
```

### 4.3 多端同步与日常更新流程

在日常工作流中，我们在主力机上修改了某个配置并推送到GitHub后，另一台电脑如何同步最新配置？

chezmoi提供了专门的更新命令：

```bash
chezmoi update
```

执行这条命令时，chezmoi会在后台自动完成两件事：

1. 先在源仓库执行 `git pull --rebase`，拉取远端最新的提交记录
2. 紧接着自动触发一次 `chezmoi apply`，根据新拉取的源文件重新计算并就地更新家目录中的真实配置文件

如果只想先拉取远端改动、确认差异后再决定是否应用，也可以分步执行：

```bash
# 仅拉取远端最新提交到源仓库，不立即落地
chezmoi git pull

# 查看远端改动与当前机器真实配置文件的差异
chezmoi diff

# 确认无误后再执行应用
chezmoi apply
```

### 4.4 应对多端同步中的合并与冲突

在多台设备协同使用时，如果不同电脑上同时改动了同一份配置，或者本地真实配置文件被修改的同时远端也推送了更新，就会产生冲突。

在chezmoi中，冲突主要分为两类场景：

**(1) 真实配置文件与期望状态的合并冲突**

当某台电脑上的真实配置文件在外部被改动过，而远端源仓库也拉取到了新的修改，执行 `chezmoi apply` 或 `chezmoi update` 时，chezmoi会主动停下来进行安全保护，避免直接抹掉未同步的本地改动。

当前这里进行模拟下这种情况：

1. 第一步，直接手动修改家目录下的真实文件：
   ```bash
   echo 'theme="locally-modified"' > ~/.config/cm-demo.toml
   ```
2. 第二步，通过 `chezmoi edit` 把源仓库里的内容改成另一个不同的值：
   ```bash
   chezmoi edit ~/.config/cm-demo.toml
   # 在编辑器中将内容修改为 theme = "remotely-updated"，保存退出
   ```
3. 第三步，触发三方合并：
   可以直接运行合并命令：

   ```bash
   chezmoi merge ~/.config/cm-demo.toml
   ```

   从合并视图中可以看到，chezmoi会调用系统配置的合并工具（默认使用 `vimdiff` 或 `nvim -d`，也可以在配置中绑定VS Code），同时对比三个状态：

   - `.Destination`，当前电脑家目录里的真实配置文件
   - `.Source`，源仓库中记录的源文件
   - `.Target`，经过模板引擎计算后的期望目标配置

   ![image-20260916142058023](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260916142058023.png)

在合并工具中挑选并保留需要的配置行，保存退出后即可完成冲突解决。关于更多合并工具的参数绑定与配置，可以查阅官方参考文档：

- [chezmoi 冲突合并与工具配置指南](https://chezmoi.io/user-guide/tools/merge/)

或者使用交互式应用命令：

```bash
chezmoi apply --interactive
```

运行交互式应用命令后，终端会暂停并给出选项提示：输入 `m`（Merge）即可调起三方合并工具，输入 `d` 可以预览差异，输入 `y` 会强制覆盖，输入 `n` 则跳过该文件。

选择 `m` 后，终端会自动打开三路合并界面：

![image-20260916142151347](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260916142151347.png)

**(2) 源仓库的Git提交冲突**

当两台机器修改了同一个源配置文件的相同代码行并各自推送到GitHub时，运行 `chezmoi update` 会在源仓库底层触发标准的Git rebase冲突。

解决方式与日常处理普通Git冲突完全一致：

```bash
# 第一步，切入源仓库目录
chezmoi cd

# 第二步，查看冲突文件并手动打开编辑，解决冲突标记
git status
# 编辑冲突文件，消除 <<<<<<< HEAD 冲突标记...

# 第三步，标记解决并继续rebase流程
git add .
git rebase --continue

# 第四步，退出子Shell并重新应用配置
exit
chezmoi apply
```

### 4.5 用 .chezmoiignore 忽略不需要的文件

在管理 dotfiles 时，我们经常会遇到这种场景：仓库里有些文件只作备份或特定用途，并不希望它们每次都被释放到家目录下；或者某些仅在特定机器上使用的脚本，在当前电脑上根本不需要落地。

针对这种场景，chezmoi 提供了专门的 `.chezmoiignore` 规则文件。它的核心作用非常明确：**定义哪些文件在落地时应当被 chezmoi 跳过**。

初学者容易把它和 Git 自带的 `.gitignore` 搞混，其实两者的分工截然不同：

- `.gitignore` 作用于 Git 提交阶段：被匹配的文件不会提交到 Git 仓库，也不会同步到远端；
- `.chezmoiignore` 则只作用于 chezmoi 的本地应用阶段：文件依然完好保存在 Git 源仓库中并正常推送到 GitHub，只是在当前机器执行 `chezmoi apply` 时会被自动跳过，既不写入家目录，也不会出现在这台机器的受管清单中。

**(1) 基本使用**

我们直接通过一个实际操作来看看效果。假设当前环境下，我们先通过 `chezmoi managed` 查看受管文件清单：

```bash
chezmoi managed
```

终端输出了当前机器受管的所有文件与目录，其中包含了脚本 `.local/bin/my-script`：

```text
.config
.config/cm-demo.toml
.local
.local/bin
.local/bin/my-script
```

如果现在我们不想让这个脚本继续在当前环境受管，可以直接编辑源仓库根目录下的 `.chezmoiignore`（其路径为 `~/.local/share/chezmoi/.chezmoiignore`）：

```bash
vim ~/.local/share/chezmoi/.chezmoiignore
```

在文件中直接写上要忽略的目标路径：

```text
.local/bin/my-script
```

保存后查看该文件确认内容：

```bash
cat ~/.local/share/chezmoi/.chezmoiignore
```

此时再次执行命令检查受管清单：

```bash
chezmoi managed
```

终端输出发生了变化：

```text
.config
.config/cm-demo.toml
.local
.local/bin
```

可以看到，`.local/bin/my-script` 已经瞬间从受管列表中移除了。

![image-20260917215257734](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260917215257734.png)

一旦在 `.chezmoiignore` 中指定了排除路径，`chezmoi managed` 就不再将其视作受管目标，后续执行 `apply` 落地时 chezmoi 也会直接忽略该文件，不再触碰家目录。

**(2) 配合 Go Template 按条件跳过**

直接写死固定路径适合简单的排除，而在多设备协同场景下，`.chezmoiignore` 还有一个更强大的特性：**它原生支持 Go Template 模板语法**。

这有点类似于我们在具体配置文件内部局部使用模板条件判断：在 `.chezmoiignore` 中，我们同样可以直接使用 `{{ if ... }}` 条件分支，配合系统内置变量来决定在什么机器上跳过什么文件。

例如，某些配置或脚本只在云服务器上有用，或者特定配置只在特定操作系统下生效，就可以这样编写规则：

```text
# 源仓库根目录下的 .chezmoiignore

# 主机名不是特定服务器时，跳过该脚本
{{ if ne .chezmoi.hostname "vps-server" }}
.local/bin/my-script
{{ end }}

# 操作系统不是 Linux 时，跳过某些桌面专属配置
{{ if ne .chezmoi.os "linux" }}
.bashrc
{{ end }}
```

这样一来，同一个 dotfiles 仓库推送到 GitHub 之后，每台机器在执行 `chezmoi apply` 时，都会根据自身的主机名或操作系统动态计算出适合自己的忽略清单，既避免了无用配置堆积，又保证了全局仓库的整洁统一。

## 5. 隐私文件管理

很多人在刚开始管理 dotfiles 时最大的顾虑，就是配置中夹杂着的各类敏感信息：API Key、私人 Token、SSH 私钥等。

无论远程 Git 仓库是公开还是私有，**明文凭证绝不能直接硬编码提交进仓库**。因为 Git 的提交历史是永久留存的，后续一旦需要将仓库公开，或者授权给他人查看，很容易疏忽泄露历史 commit 中的敏感信息。

针对敏感文件，chezmoi 原生推荐搭配现代非对称加密工具 **[age](https://github.com/FiloSottile/age)** 来做文件级加密。相比配置极其繁琐、公钥环臃肿的 GPG，age 工具体积小巧，公私钥只有一行纯文本，心智负担非常低。

![基于 age 工具的 chezmoi 文件级透明加密治理模型](https://dg-typora.oss-cn-chengdu.aliyuncs.com/05-framework-age-encryption-security.png)

### 5.1 配置 age 加密环境

**(1) 安装 age 并生成密钥对**

各个常见系统的包管理器都可以直接安装 age：

```bash
# Debian / Ubuntu
sudo apt install age

# macOS
brew install age

# Arch Linux
sudo pacman -S age

# Windows (使用 winget 或 Scoop)
winget install FiloSottile.age
# 或 scoop install age
```

安装完成后，在当前机器上生成一对专属的公私钥。建议直接存放在 chezmoi 的配置目录下（Windows 下对应 `%LOCALAPPDATA%\chezmoi\key.txt`）：

```bash
# Linux / macOS 创建配置目录并生成密钥对文件
mkdir -p ~/.config/chezmoi
age-keygen -o ~/.config/chezmoi/key.txt
```

如果是在 Windows PowerShell 环境下，可以执行：

```powershell
# Windows PowerShell 下创建目录并生成密钥对
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\chezmoi"
age-keygen -o "$env:LOCALAPPDATA\chezmoi\key.txt"
```

![image-20260918204330858](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260918204330858.png)

命令执行后生成的 `key.txt` 中包含两行核心信息：

- `AGE-SECRET-KEY-1...`：以 `AGE-SECRET-KEY-` 开头的私钥（需严格保密，绝对不能推送到 Git 仓库）；
- `# public key: age1...`：以 `age1...` 开头的公钥（用于加密，可以公开）。

**(2) 在 chezmoi 中关联 age 密钥**

生成密钥后，需要在本地私有配置文件 `~/.config/chezmoi/chezmoi.toml`（Windows 下位于 `%LOCALAPPDATA%\chezmoi\chezmoi.toml`，该文件专属于本机且不进 Git 版本库）中声明加密引擎与密钥信息：

```toml
encryption = "age"

[age]
    identity = "~/.config/chezmoi/key.txt"
    recipient = "age1..." # 注意：必须保留英文双引号，将公钥完整包裹在引号内
```

其中：

- `identity` 指定本机解密时使用的私钥文件路径；
- `recipient` 指定加密时使用的目标公钥。

### 5.2 加密纳管与透明操作

**(1) 使用 --encrypt 纳管敏感文件**

我们先在本地创建一个包含模拟 Token 的敏感配置文件作为演示：

```bash
echo "MY_SECRET_API_KEY=sk-test-1234567890" > ~/.config/cm-token.env
```

纳管这类文件时，只需在常规 `add` 命令的基础上带上 `--encrypt` 参数：

```bash
chezmoi add --encrypt ~/.config/cm-token.env
```

执行后，chezmoi 会使用刚才配置的公钥将文件加密后写入源仓库。我们可以切入源仓库查看它现在的状态：

```bash
# 进入源仓库目录
chezmoi cd

# 查看源仓库里的对应文件名
ls private_dot_config/
```

你会发现该文件被自动赋予了 `encrypted_` 前缀，变成了 `encrypted_cm-token.env.age`。如果直接用 `cat` 查看它的内容：

```bash
cat private_dot_config/encrypted_cm-token.env.age
```

终端输出的是一段被 age 加密后的标准密文（以 `-----BEGIN AGE ENCRYPTED FILE-----` 开头），完全看不出原本的任何文本。你可以放心地把它随源仓库 `git commit` 并推送到 GitHub。

![image-20260918204606219](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260918204606219.png)

退出源仓库回到日常环境：

```bash
exit
```

**(2) 透明编辑与明文查看**

加密纳管之后，后续如果需要修改 Token，完全不需要先手动调用 age 解密、编辑完再手动加密。chezmoi 提供了**透明加解密**的丝滑体验：

- **只读查看明文**：使用 `chezmoi cat` 可以直接调用本地私钥在内存中解密打印明文，不会在磁盘上留下未加密的临时文件：
  ```bash
  chezmoi cat ~/.config/cm-token.env
  ```
- **直接编辑更新**：使用 `chezmoi edit` 打开该文件：

  ```bash
  chezmoi edit ~/.config/cm-token.env
  ```

  chezmoi 会在后台自动用私钥把密文解密到临时缓冲区供编辑器打开；修改保存退出后，chezmoi 会立刻用公钥重新加密写回源仓库。

跑通了这个流程后，无论是真实的 SSH 私钥（`chezmoi add --encrypt ~/.ssh/id_ed25519`），还是云服务的各类鉴权 Token，都可以用同样的方式安全纳管。

### 5.3 跨设备解密与私钥安全策略

**(1) 新设备导入私钥与一键还原**

当在另一台新电脑上克隆了 dotfiles 仓库时，由于源仓库中的文件都是加密的，新机器没有私钥便无法解密应用。

在新机器上还原的流程如下：

1. 新电脑上安装好 `chezmoi` 和 `age`；
2. 通过安全的离线渠道（如离线 U 盘、密码管理器等），将本机的 `key.txt` 复制到新设备的同名路径 `~/.config/chezmoi/key.txt`；
3. 配置新设备的 `~/.config/chezmoi/chezmoi.toml`，声明对应的私钥路径；
4. 执行应用：
   ```bash
   chezmoi apply
   ```
   chezmoi 会自动调用私钥将源仓库里的 `encrypted_` 密文解密，原汁原味地还原到新机器的家目录中。

如果不希望跨设备共享同一套私钥，也可以在每台机器上各自生成一套独立的 age 密钥对。只需在主机的 `chezmoi.toml` 中配置多个 `recipient` 公钥，这样文件加密时便会同时支持多把私钥解密，更符合零信任安全模型。

**(2) 私钥安全底线**

使用文件级加密时，必须牢记一条铁律：

> **`key.txt` 私钥文件绝对不能纳管进 chezmoi，更绝不能提交推送到 Git 仓库中！**

如果私钥不慎推送到远端，整个加密防线就会彻底失效；而如果本地私钥丢失且没有备份，源仓库中所有已加密的文件将永久无法解密。因此，请务必把 `key.txt` 私钥妥善备份。

## 6. 总结

chezmoi 最实用的地方，在于用三层状态模型彻底理清了配置管理的责任边界：家目录里的真实文件供日常软件自由读写，Git 源仓库作为唯一的版本信实来源；中间再配合 Go Template 模板动态渲染与 `.chezmoiignore` 忽略规则，抹平了多台电脑与跨平台的配置差异。

在日常使用中，日常修改只需要在 `chezmoi edit` 和 `chezmoi apply` 之间形成习惯，就能保持本地与源仓库的一致性；接入远端 Git 仓库后，新机器上一条 `chezmoi init --apply` 即可一键恢复完整的开发环境；而配合 age 进行透明文件级加密，更是在享受集中同步便利的同时，牢牢守住了敏感凭据绝不明文入库的安全底线。

一套舒服的 dotfiles 并不是一蹴而就的，也不需要一开始就追求把所有环境配满。先从最常用、最核心的 Shell、Git 或编辑器配置开始纳管，随用随加，遇到多机差异再逐步引入忽略规则或模板分支，慢慢就能沉淀出一套跟着自己走的高效生产力系统。

本文参考资料与官方文档：

- [chezmoi 官方网站](https://www.chezmoi.io/)
- [chezmoi 官方 GitHub 仓库](https://github.com/twpayne/chezmoi)
- [chezmoi 快速上手指南](https://www.chezmoi.io/quick-start/)
- [chezmoi 用户使用手册](https://www.chezmoi.io/user-guide/setup/)
- [chezmoi 模板参考文档](https://www.chezmoi.io/reference/templates/)
- [chezmoi age 加密使用指南](https://www.chezmoi.io/user-guide/encryption/age/)
- [age 加密工具官方仓库](https://github.com/FiloSottile/age)
