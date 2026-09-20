---
id: 01NAZB2MNJR1
title: Windows升级PowerShell 7
pubDatetime: 2026-09-20T17:46:31+08:00
series: Windows
draft: false
tags:
  - Windows
  - PowerShell
  - Windows Terminal
  - Starship
  - 命令行工具
description: 记录Windows升级PowerShell 7、配置Profile、智能补全、Starship提示符和常用命令行工具的完整流程
---

Windows系统自带的PowerShell 5.1确实太老了，平时敲命令既没有现代Shell那种顺手的行内预测和补全，遇到中文或者重定向还动不动就乱码，而且在命令行里拉取依赖经常遇到网络超时。

升级PowerShell 7本身用一条命令就能搞定，但要真正用得舒服，关键在于怎么调教好这份配置文件。这篇文章记录我日常在Windows上使用的配置方案，涵盖如何解决令人头疼的中文编码与网络代理问题，如何配置类似Fish的高效行内智能补全与前缀搜索，以及搭配轻量的Starship提示符与现代CLI工具，打造一个清爽好用的现代化终端。

## 1. 为什么选择PowerShell 7

动手升级前，先理清两个版本的本质区别，免得有些朋友担心装了新版会把现有的系统搞挂。

### 1.1 系统内置5.1与现代PowerShell 7的区别

Windows自带的叫**Windows PowerShell**，版本停留在5.1很多年了。它底层依赖旧的.NET Framework，为了兼容各种古董系统，默认编码和行为基本处于“养老冻结”状态。

而PowerShell 7（通常简称**PowerShell**或`pwsh`，详见[PowerShell官方文档](https://learn.microsoft.com/powershell/)）是微软基于现代.NET完全重构的开源跨平台版本。两者主要有三个实在的区别。

第一是安装后与旧版本独立并存。PowerShell 7装完后是一个独立的可执行文件`pwsh.exe`，配置文件路径也完全独立，丝毫不会影响系统原有的`powershell.exe`（5.1版本），Windows内部各种依赖旧版PowerShell的系统组件依然能够照常运行。

第二是底层运行性能明显更好。得益于现代.NET运行时的优化，复杂脚本循环、JSON/CSV文本解析和管道处理的吞吐量都要比5.1版本快上一大截。

第三是原生支持更多现代语法。比如三元运算符（`$a ? $b : $c`）、空值合并（`??`和`??=`）、管道并行处理（`ForEach-Object -Parallel`），以及更省心的原生UTF-8字符支持。

### 1.2 终端配置的核心追求

配终端别光顾着好看，平时踩过几次坑就会发现，好用的配置无非三个实在的要求。

首先是启动零感知延迟。开新标签页或分屏时不卡顿，提示符与补全引擎能眨眼间就绪，不要为了花哨特效每次开终端都要等上一两秒。

其次是输入过程高效且不打扰。补全建议悄悄跟在光标后面，想用就一键采纳，不会频繁弹出一大坨候选列表遮挡屏幕上下文。

最后是底层编码与网络环境稳定可靠。遇到中文字符时绝不乱码，终端和外置工具之间能顺畅走代理拉取依赖，不给日常开发添堵。

## 2. 安装与基础环境准备

升级过程无需卸载任何原有组件，通过Windows自带的包管理器即可平滑完成。

### 2.1 通过winget安装PowerShell 7

推荐使用微软官方的Winget包管理器进行安装与后续的版本维护。

这里需要特别注意微软官方文档（参见[PowerShell在Windows上的安装文档](https://learn.microsoft.com/zh-cn/powershell/scripting/install/install-powershell-on-windows?view=powershell-7.6)）特别说明的一个细节：从PowerShell 7.6版本开始，winget直接安装默认会选择**MSIX包**；如果你想要传统的**MSI包**，需要显式指定`--installer-type wix`。

这两者打包机制不同，适用的场景和限制也完全不同。

默认安装的MSIX包属于应用商店沙盒架构。它的最大好处是省心，能跟随Windows系统的Microsoft Update在后台自动静默更新；但短板也很明显，因为运行在虚拟化沙盒里，仅支持当前单个用户使用，根目录`$PSHOME`受写保护，导致它无法配置WSMAN远程管理，也不能为整机所有用户创建全局Profile文件，某些需要写入系统环境的命令会直接受阻。

而通过WiX构建的经典MSI包则是传统的本地独立程序，默认安装在`$Env:ProgramFiles\PowerShell\7`标准路径下。它的权限完整，支持全机所有用户共享，支持注册资源管理器右键“在此处打开PowerShell”菜单，并且完全支持系统级远程管理，后续可以通过winget常规检测升级。

对于日常进行软件开发、运维脚本编写或经常需要右键快捷打开终端的朋友，强烈建议加上`--installer-type wix`安装传统的MSI版本：

```powershell
# 推荐开发者使用：安装传统的 MSI 安装包
winget install --id Microsoft.PowerShell --source winget --installer-type wix
```

如果你只是轻度使用，更喜欢系统在后台自动帮你静默更新，也可以直接用默认命令安装MSIX版本：

```powershell
# 默认安装：安装 MSIX 沙盒版本
winget install --id Microsoft.PowerShell --source winget
```

安装完成后，在终端中输入`pwsh`并回车，即可进入PowerShell 7环境。执行以下命令核对当前版本信息：

```powershell
# 打印完整的环境变量表与运行时架构（确认 PSEdition 为 Core）
$PSVersionTable

# 或者直接查看 pwsh 主版本号
pwsh --version
```

![在终端中核对 PowerShell 7 版本信息与 PSEdition 字段](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920163502962.png)

核对终端输出，如果`PSEdition`确认显示为`Core`，并且版本号在`7.x`以上，说明PowerShell 7已经成功就绪。

> 若后续想要卸载PowerShell 7，直接用winget执行一键卸载最方便：
>
> ```powershell
> winget uninstall --id Microsoft.PowerShell
> ```
>
> 如果当初使用的是MSI安装程序，也可以在Windows设置的“安装的应用”或者传统控制面板中找到PowerShell 7点击卸载；若是应用商店安装的MSIX版本，直接在“开始”菜单搜索PowerShell 7并右键卸载即可。需要留意的是，卸载软件本体并不会连带删除你在本地编写的Profile配置文件，如果想彻底清理，后续手动删除`$HOME\Documents\PowerShell\`目录即可。

### 2.2 在Windows Terminal中设为默认终端

日常使用中建议配合[Windows Terminal](https://learn.microsoft.com/windows/terminal/)以获得完整的现代渲染支持（若未预装可通过`winget install Microsoft.WindowsTerminal`获取）。

也可以直接通过`Microsoft Store`下载获取。

![](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920162940560.png)

为了让每次打开终端窗口或点击新建标签页时默认进入PowerShell 7，需要将其设为默认配置文件：

(1) 在Windows Terminal界面中按下快捷键`Ctrl+,`进入“设置”页面。
(2) 在左侧导航栏选择“启动”选项卡。
(3) 将“默认配置文件”从“Windows PowerShell”更改为“PowerShell”（注意认准带有黑白现代图标的选项，它对应PowerShell 7）。
(4) 点击右下角“保存”。

![image-20260920163815128](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920163815128.png)

设置完成后，后续不管是按下快捷键新开终端，还是点击标签页的`+`号，都会默认以PowerShell 7启动，这样就不用每次启动终端需要手动输入命令`pwsh`进行切换了。

### 2.3 放行当前用户的本地脚本执行策略

Windows出于安全考量，默认的脚本执行策略（Execution Policy）为`Restricted`，这会阻止PowerShell在启动时加载我们编写的自定义`$PROFILE`配置文件。

为了在保证系统安全的前提下正常加载本地配置，需要放行当前用户的执行权限：

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

- `RemoteSigned`表示从互联网下载的脚本仍必须拥有受信任的数字签名才能运行，而本地编写的脚本文件可直接执行；
- 作用域限制在`CurrentUser`，避免修改系统全局策略。

### 2.4 安装Nerd Font字体

为了确保后续Starship提示符以及现代CLI工具中的Git分支符号、文件夹图标等能够正常显示而不出现乱码方框，需要安装一款包含特殊字形的Nerd Font等宽字体。

我日常主力使用的是**CaskaydiaMono NF**（也就是微软Cascadia Mono的Nerd Font图标定制版，字形硬朗干净，和Windows Terminal的原生风格最为契合）。

推荐直接前往[Nerd Fonts官网](https://www.nerdfonts.com/)的Downloads页面，搜索并下载`CaskaydiaMono`（或`CascadiaCode`）字体压缩包。下载完成后解压，全选里面的`.ttf`字体文件，鼠标右键选择“为所有用户安装”即可。当然，如果你更偏好JetBrainsMono、FiraCode或MesloLGS等其他字体，也可以直接在官网上按喜好挑选下载。

字体安装好后，在Windows Terminal中按`Ctrl+,`，打开设置在左侧选择“配置文件”下的“PowerShell”，切换到“外观”选项卡，在“字体”下拉菜单中选中刚才安装的`CaskaydiaMono NF`，保存即可生效。

![image-20260920165203454](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920165203454.png)

## 3. 配置文件调优与智能补全

PowerShell的所有个性化配置、函数与快捷键，本质上都保存在一个叫做Profile的初始化脚本里。每次新开终端窗口，PowerShell都会自动静默读取并执行它。在调优补全之前，我们先搞清楚这份配置文件存放在哪里，以及没有时该怎么创建。

### 3.1 查找与创建配置文件 $PROFILE

在PowerShell中，内置变量`$PROFILE`记录了当前用户的配置文件路径。直接在终端中敲入变量名查看：

```powershell
$PROFILE
```

通常它会输出类似如下的路径：
`C:\Users\你的用户名\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`

在全新安装的系统上，这个文件默认并不存在。我们可以先检查一下，如果不存在就直接用命令自动创建：

```powershell
# 检查配置文件是否存在
Test-Path $PROFILE

# 如果返回 False，使用该命令自动创建文件及所需的父级文件夹
New-Item -Path $PROFILE -Type File -Force
```

创建好之后，可以使用记事本或VS Code直接打开编辑：

```powershell
# 使用记事本打开
notepad $PROFILE

# 或者使用 VS Code 打开
code $PROFILE
```

后续每次修改并保存配置文件后，不需要关掉终端重开，只要在当前窗口执行下面的命令就能立即重载生效（注意开头的点号与变量之间有一个空格）：

```powershell
. $PROFILE
```

搞定配置文件的载体后，接下来就可以往里面加入核心配置了。

### 3.2 通用字符编码与网络代理

在配置漂亮的补全之前，有两个最容易让人摔跟头的底层问题必须先解决，那就是中文字符编码与网络代理。

在Windows系统里，中文乱码几乎是家常便饭。PowerShell传统默认编码非常混乱，向外部程序传递文本或者重定向输出文件时，动不动就用带BOM的UTF-16或者系统默认的ANSI（GBK），导致文本读出来全是一堆问号或乱码字符。

很多教程图省事，教大家直接写`$PSDefaultParameterValues['*:Encoding'] = 'utf8'`。千万不要抄这个，通配符`*:Encoding`等于强行向所有命令注入`-Encoding`参数，一旦遇到不支持该参数的命令或第三方函数，直接当场报参数绑定错误。

最稳妥的方案是显式构造无BOM的UTF-8编码对象，并精准绑定到真正负责文本输出与文件写入的几个命令上：

```powershell
# 构造标准的 UTF-8 无 BOM 编码对象
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# PowerShell 向外部程序传递文本时统一使用 UTF-8
$OutputEncoding = $utf8NoBom

# 文件写入 cmdlet 精准默认使用 UTF-8，避免粗暴使用 *:Encoding
$PSDefaultParameterValues['Out-File:Encoding']    = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'
```

另一个至关重要的配置是网络代理。平时在命令行里执行`Install-Module`拉取模块、用Git克隆仓库，或者下载各类开发依赖时，经常因为网络原因超时报错。在Profile中直接设置代理环境变量，终端每次启动就会自动生效：

```powershell
# 本地网络代理（端口根据自己本地客户端实际情况修改）
$env:HTTP_PROXY  = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY    = 'localhost,127.0.0.1,::1'
```

把编码和网络配置之后，命令行操作就不会再被乱码和网络超时打扰了。

### 3.3 类似Fish的行内历史预测（InlineView）

PowerShell 7的现代交互体验核心依赖内置模块[PSReadLine](https://github.com/PowerShell/PSReadLine)，虽然默认自带，但开箱状态比较保守，需要做针对性调优。

PSReadLine 2.2及以上版本自带了预测性智能感知功能，可以从历史记录或插件中读取建议。

网上很多教程喜欢推荐`ListView`列表视图，打一个字就在光标下方弹出一大坨候选列表。在实际写代码或排查问题时，这个大弹窗经常把刚刚打印出来的关键报错或者日志遮得严严实实，非常影响视线。

我更推荐类似Fish Shell的行内预测（`InlineView`）：

```powershell
# 将预测来源设为执行过的历史命令
Set-PSReadLineOption -PredictionSource History -ErrorAction Stop

# 使用行内预测视图，只以暗淡虚字在当前命令行后方提示建议
Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction Stop
```

配好之后，敲命令开头时，终端会自动根据历史记录在光标右边显示灰色的建议命令。如果这就是你想跑的，按一下键盘右箭头`→`直接全行补齐；如果不匹配，就当没看见继续正常敲你的键盘，灰色文字会自动后移或消失，完全不抢戏。

![image-20260920170722472](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920170722472.png)

### 3.4 具备前缀感知的历史回溯与光标定位

在默认状态下，按下方向键`↑`只会机械地翻看上一条、上上一条历史记录。但真实场景中，我们往往是想找“刚才执行过的某一条git命令”或“之前执行过的某个长路径命令”。

重新映射方向键的行为之后，就能实现按输入前缀过滤搜索历史：

```powershell
# 输入 git 后按 ↑，仅搜索历史中以 git 开头的命令
Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward

# 历史搜索命中后，自动将光标移至命令尾部，方便直接补充参数或按回车
Set-PSReadLineOption -HistorySearchCursorMovesToEnd -ErrorAction Stop
```

这项配置带来的体验提升非常明显。先在命令行敲入前几个字母（例如`ssh`或`docker compose`），接着连续按`↑`，翻出来的全部都是以此为前缀的历史记录，再配合光标自动定位到行尾，省去了重复输入或多次按`End`键的繁琐。

### 3.5 菜单式Tab补全体验

默认的Tab补全方式是在多个候选路径或参数之间单向循环滚动，一旦按快了错过目标选项，就得重新按一整轮。

将其改为菜单式补全：

```powershell
Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
```

按一次Tab键后，终端会在命令行下方展示一个清晰的双向可选菜单网格，可以使用方向键在选项间自由切换，选中后回车即可填入。

![image-20260920171056614](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920171056614.png)

## 4. 搭配Starship提示符

在终端主题的选择上，Oh My Posh功能非常丰富，如果喜欢也可以直接在Microsoft Store搜索下载。

不过我个人更推荐[Starship](https://starship.rs/)。它是一个完全使用Rust编写的跨平台轻量提示符工具。Starship采用单二进制架构，没有庞大的脚本运行时依赖，独立文件体积小，回车响应非常干脆；并且并发采集状态极快，在渲染命令行提示符时会自动异步检测Git分支状态与各种语言环境。

使用winget一键安装Starship：

```powershell
winget install Starship.Starship
```

安装完成后，在配置文件中通过`Invoke-Expression (&starship init powershell)`挂载即可。初次启动时，Starship默认呈现的效果如下图所示：

![Starship 默认提示符渲染效果](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920172312662.png)

Starship的全局配置文件默认位于`$HOME\.config\starship.toml`。如果想快速更换预设主题，可以直接执行官方预设命令（例如切换为经典的gruvbox-rainbow风格）：

```powershell
# 快速应用官方预设主题
starship preset gruvbox-rainbow -o ~/.config/starship.toml
```

![应用 gruvbox-rainbow 预设主题后的提示符效果](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920173154402.png)

更多开箱即用的预设可以参考[Starship官方预设库（Presets）](https://starship.rs/presets/)，你想进一步调整提示符外观，可以通过自定义配置文件来实现，可以查阅[Starship官方配置文档](https://starship.rs/config/)。

> 如果配置完后发现分支符号或特殊图标显示为方框乱码，记得检查第2.4节的字体配置，确保Windows Terminal外观中已选中`CaskaydiaMono NF`等Nerd Font字体。

## 5. 常用效率与AI命令行工具推荐

除了补全和提示符之外，Windows命令行中旧有的`dir`、`type`、`find`等传统命令不仅排布单调，在复杂处理时也略显吃力。

下面这几款现代开源CLI工具，不仅能大幅提升日常手动敲命令的体验，同时也是目前各类AI Coding Agent（例如在终端跑任务的代码辅助工具）进行代码检索、文件过滤与数据解析时最常用到的基础依赖，非常推荐一并安装：

- **[eza](https://github.com/eza-community/eza)**：现代`ls`替代品，支持彩色排版、文件图标与Git修改状态内联展示。
- **[fd](https://github.com/sharkdp/fd)**：简单好用的`find`替代品，搜索速度极快，默认自动忽略`.gitignore`规则与隐藏目录，也是很多Agent查找文件时的首选。
- **[bat](https://github.com/sharkdp/bat)**：带语法高亮与行号的`cat`替代品，查看代码文件更清晰。
- **[ripgrep (rg)](https://github.com/BurntSushi/ripgrep)**：极速文本全局搜索工具，大项目中按关键字检索代码秒出结果，几乎是现代代码辅助工具的标配。
- **[jq](https://github.com/jqlang/jq)**：强大的命令行JSON解析与过滤工具，调试API响应、提取特定字段或格式化复杂JSON时必不可少。
- **[fzf](https://github.com/junegunn/fzf)**：通用的交互式模糊搜索器，快速检索历史命令和文件路径。

这些工具全部可以通过winget一键安装：

```powershell
# 一键安装常用现代化 CLI 工具
winget install eza-community.eza
winget install sharkdp.fd
winget install sharkdp.bat
winget install BurntSushi.ripgrep.MSVC
winget install jqlang.jq
winget install junegunn.fzf
```

安装完成后，在`$PROFILE`中建立常用别名映射（例如将`ls`映射给`eza`，`find`映射给`fd`，`cat`映射给`bat`），日常敲命令时就能无缝享受现代工具的便利了：

```powershell
Set-Alias -Name ls -Value eza
Set-Alias -Name find -Value fd
Set-Alias -Name cat -Value bat
```

![image-20260920174544063](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260920174544063.png)

## 6. 总结与完整配置

至此，一个兼顾高效输入、稳定编码与美观视觉的PowerShell 7环境就已经全部搭建完毕了。

### 6.1 完整Profile配置

这份配置文件结合了日常交互打字与AI Agent或自动化脚本后台调用的双重视角。当你在Windows Terminal中敲键盘时，它会自动加载Starship提示符、Fish风格行内预测补全、前缀搜历史以及CLI别名；当外部构建任务、Git钩子或AI Coding Agent在后台非交互调用PowerShell时，它能通过前置环境检测自动跳过所有UI渲染与输入劫持，输出干干净净的纯文本，彻底杜绝转义字符污染与死锁挂起问题。

你可以直接将以下整段代码粘贴进`$PROFILE`文件中：

```powershell
# ============================================================
# 判断当前是否为真正的交互式控制台
#
# 目的：
#   - Windows Terminal / 普通 pwsh 交互终端：加载 Starship、PSReadLine 等 UI 功能
#   - 脚本 / 管道 / 重定向 / Agent / 非交互调用：跳过 UI 功能，保证输出纯净
# ============================================================

$isInteractiveConsole = $false

try {
    $commandLine = [Environment]::CommandLine

    $isInteractiveConsole =
        [Environment]::UserInteractive -and
        $Host.Name -eq 'ConsoleHost' -and
        -not [Console]::IsInputRedirected -and
        -not [Console]::IsOutputRedirected -and
        -not [Console]::IsErrorRedirected -and
        ($commandLine -notmatch '(?i)(^|\s)-(NonInteractive|noni|Command|c|File|f|EncodedCommand|e)(\s|$)')
}
catch {
    # 无法确认时按非交互环境处理，避免影响脚本或 Agent
    $isInteractiveConsole = $false
}


# ============================================================
# 通用编码与网络代理配置（交互与非交互共享）
# ============================================================

# UTF-8 无 BOM
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# PowerShell 向外部程序传递文本时使用 UTF-8
$OutputEncoding = $utf8NoBom

# 文件写入 cmdlet 精准默认使用 UTF-8
$PSDefaultParameterValues['Out-File:Encoding']    = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'

# 本地开发网络代理（根据自己客户端端口修改，例如 7890 或 7500）
$env:HTTP_PROXY  = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY    = 'localhost,127.0.0.1,::1'


# ============================================================
# 仅在真正的交互式控制台中加载 UI / 输入体验相关功能
# ============================================================
if ($isInteractiveConsole) {
    # 1. 提示符引擎 Starship
    try {
        Invoke-Expression (&starship init powershell)
    }
    catch {
        # Starship 加载失败时不影响 PowerShell 正常使用
    }

    # 2. PSReadLine 类似 Fish 的行内智能预测与按键增强
    try {
        if (-not (Get-Module PSReadLine)) {
            Import-Module PSReadLine -ErrorAction Stop
        }

        # 保持 Windows 习惯编辑模式
        Set-PSReadLineOption -EditMode Windows -ErrorAction Stop

        # 基于历史记录提供预测来源
        Set-PSReadLineOption -PredictionSource History -ErrorAction Stop

        # Fish 风格 在光标右侧展示灰色行内预测
        Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction Stop

        # 历史命令搜索时自动将光标移至末尾，方便直接修改或回车
        Set-PSReadLineOption -HistorySearchCursorMovesToEnd -ErrorAction Stop

        # Tab 键启用网格菜单式补全
        Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete

        # 方向键根据已输入的前缀过滤搜索历史命令
        Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
        Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    }
    catch {
        # PSReadLine 加载失败时不影响底层命令执行
    }

    # 3. 现代化 CLI 别名
    Set-Alias -Name ls -Value eza
    Set-Alias -Name find -Value fd
    Set-Alias -Name cat -Value bat

    # 4. 控制台界面输入输出编码
    [Console]::InputEncoding  = $utf8NoBom
    [Console]::OutputEncoding = $utf8NoBom
}
```

保存后在当前终端运行`. $PROFILE`即可立即重载生效。

### 6.2 日常更新与避坑说明

后续日常维护非常简单，通过winget可以一键检测并更新所有工具：

```powershell
# 检查并更新 PowerShell 7、Starship 与 CLI 工具
winget upgrade Microsoft.PowerShell
winget upgrade Starship.Starship
winget upgrade eza-community.eza
winget upgrade sharkdp.fd
winget upgrade sharkdp.bat
winget upgrade BurntSushi.ripgrep.MSVC
winget upgrade jqlang.jq
winget upgrade junegunn.fzf
```

另外在日常使用中留意两点细节：

- 如果在某些特定批处理中需要调用Windows原生自带的`find.exe`，直接敲完整名称`find.exe`即可绕过别名。
- 如果更换了本地代理客户端或修改了监听端口，记得同步更新Profile中的`HTTP_PROXY`端口。

### 6.3 常用官方文档与资源链接

最后附上本文涉及的核心组件官方资源，方便后续查阅进阶用法与更新动态：

- [PowerShell 官方文档](https://learn.microsoft.com/powershell/)：微软官方关于PowerShell安装、语法与模块特性的权威指南。
- [PSReadLine GitHub 仓库](https://github.com/PowerShell/PSReadLine)：行内预测、键位绑定与自定义处理函数的官方说明。
- [Starship 官方文档](https://starship.rs/config/) 与 [预设主题库 Presets](https://starship.rs/presets/)：提示符全模块配置参数与开箱即用主题。
- [Nerd Fonts 官网](https://www.nerdfonts.com/)：等宽图标字体下载与字形预览。
- [eza GitHub 仓库](https://github.com/eza-community/eza)：现代化文件列表工具的参数说明与色彩配置。
- [fd GitHub 仓库](https://github.com/sharkdp/fd)：简洁快速的文件查找工具指南。
- [bat GitHub 仓库](https://github.com/sharkdp/bat)：代码语法高亮与终端预览工具说明。
- [ripgrep GitHub 仓库](https://github.com/BurntSushi/ripgrep)：极速文本全局搜索工具使用手册。
- [jq 官方主页](https://jqlang.github.io/jq/)：命令行JSON语法过滤与数据处理手册。
- [fzf GitHub 仓库](https://github.com/junegunn/fzf)：交互式命令行模糊搜索器的配置与绑定指南。
