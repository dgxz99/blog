---
id: 01N9525H6YHN
title: Git worktree详解：一个仓库同时维护多个工作目录
pubDatetime: 2026-08-29T15:20:44+08:00
series: Git实践
draft: false
tags:
  - Git
  - worktree
  - 开发工具
description: 说明Git worktree的共享与隔离边界，并通过创建、提交、推送和热修复流程梳理多工作目录的使用方式
---

正在开发一个改动范围很大的功能时，工作目录里往往既有已修改文件，也有还没准备提交的临时代码。这时如果突然要修复线上问题，直接切换分支可能失败；即使先执行`git stash`，也要记住稍后恢复哪个stash，还可能遇到冲突。

使用AI编程Agent时，这类并行需求会更加常见：一个Agent修改功能代码，另一个Agent排查缺陷或运行测试，如果它们共用同一个工作目录，很容易互相改写文件、暂存区或当前分支。开发者或任务编排工具可以为不同任务分配独立worktree，让每个Agent拥有自己的工作现场，同时复用同一个Git仓库。

重新`git clone`一份仓库可以解决问题，但它会复制一套对象库、远端配置和本地分支。两个仓库之后要分别`fetch`，本地引用也不会自动同步。Git提供的`worktree`处在这两种方案之间：它让同一个仓库同时拥有多个工作目录，每个目录可以检出不同分支，同时共享提交对象和大部分引用。

本文围绕一个最容易混淆的问题展开：**不同worktree之间到底共享什么，在哪个worktree执行commit、push、fetch或pull，会不会影响其他worktree**。先从一个常见场景建立直觉：功能开发尚未收尾，线上问题却要求立即从主分支修复。

![使用worktree保留功能开发现场并处理紧急修复](https://dg-typora.oss-cn-chengdu.aliyuncs.com/01-scene-parallel-contexts.png)

worktree的价值不只是“少切几次分支”，而是让两个工作现场同时存在。理解这一点后，再看下面几条结论会更容易：

- 分支是指向提交的引用，worktree是实际目录、`HEAD`、索引等状态的组合，二者不是同一层面的概念
- 不同worktree的文件、未提交修改、未跟踪文件和暂存区彼此独立
- 本地分支、标签、远程跟踪分支和提交对象由同一个仓库共享
- 在一个worktree提交时，目标分支会向前移动；其他worktree能立即看到新提交，但它们的文件不会自动刷新
- 在一个worktree推送时，指定的远端引用会改变；其他worktree不会自动切换分支、合并代码或重写文件
- Git默认不允许同一个本地分支同时被两个worktree检出，因为共享的分支引用与各自独立的文件、索引可能发生错位

下面先厘清概念，再依次说明创建方式、共享边界、命令影响和线上热修复流程。

## 1. worktree解决的不是分支问题，而是目录问题

理解worktree的关键，不是先记命令，而是分清仓库、分支、工作目录、索引和`HEAD`各自负责什么。

### 1.1 仓库、分支与工作目录

**(1) 仓库保存历史和引用**

Git仓库保存提交、目录树、文件内容等对象，也保存分支、标签和远程跟踪分支等引用。平时看到的`.git`目录，就是主工作树关联的仓库元数据入口。

同一个仓库可以拥有很多分支，也可以通过worktree关联多个工作目录。多个worktree共享同一个对象库，因此一个worktree创建的新提交，不需要复制一份才能被另一个worktree读取。

**(2) 分支本质上是一个可移动的引用**

本地分支`feature/login`通常对应`refs/heads/feature/login`，它记录该分支当前指向哪个提交。执行一次正常的`git commit`后，Git创建新提交，并让当前分支从父提交移动到新提交。

所以，分支不是一个目录，也不是一份代码副本。它更接近一个带名字、会随着提交向前移动的指针。Git官方术语表也将分支描述为一条开发线，分支头指向这条开发线的最新提交。

**(3) 工作目录、索引和HEAD各司其职**

一个日常开发目录至少涉及三类状态：

- **工作目录**：磁盘上能直接编辑、编译和运行的文件
- **索引**：也叫暂存区，记录下一次提交准备包含的内容
- **`HEAD`**：表示当前工作树检出的分支；处于分离`HEAD`状态时，它会直接指向某个提交

执行`git add`主要改变索引，执行`git commit`则根据索引创建提交并移动当前分支。仅仅编辑文件，不会自动改变分支引用。

**(4) worktree是目录与专属状态的组合**

Git官方将一个worktree定义为“工作目录加上该工作树专属的仓库元数据”。普通`git clone`得到的目录是**主worktree**；通过`git worktree add`创建的是**关联worktree**。

可以把它理解为上下两层：上层是所有worktree共同访问的仓库对象与引用，下层是相互独立的工作目录、`HEAD`和索引。判断一项操作会不会影响其他worktree，第一步就是确定它改动的是哪一层。

![Git worktree共享仓库与独立目录的两层结构](https://dg-typora.oss-cn-chengdu.aliyuncs.com/05-framework-shared-isolated-model.png)

图里的连线只表示三个目录访问同一套仓库级状态，不表示目录之间会同步文件。关联worktree根目录中的`.git`通常也不是目录，而是一个文本文件，它指向主仓库`.git/worktrees/<id>`下的专属元数据。一般不需要手动修改这些内部文件；需要查询路径时，应使用`git rev-parse --git-path`等Git命令。

### 1.2 分支、worktree和clone有什么区别

这三个概念经常被放在一起比较，但它们解决的问题不同。

| 对比项                 | 分支                   | worktree                         | 独立clone                  |
| ---------------------- | ---------------------- | -------------------------------- | -------------------------- |
| 本质                   | 指向提交的引用         | 工作目录加专属`HEAD`、索引等状态 | 完整且独立的Git仓库        |
| 是否直接包含可编辑文件 | 否                     | 是                               | 是                         |
| 是否共享提交对象       | 同一仓库内共享         | 与同仓库其他worktree共享         | 默认不共享                 |
| 是否共享本地分支       | 同一仓库内共享         | 共享                             | 不共享                     |
| 是否共享远程跟踪分支   | 同一仓库内共享         | 共享                             | 不共享                     |
| 是否共享默认仓库配置   | 不适用                 | 共享`.git/config`                | 不共享                     |
| 未提交修改是否隔离     | 只切分支时仍在同一目录 | 隔离                             | 隔离                       |
| 磁盘占用               | 几乎可以忽略           | 复制检出文件，但复用Git对象      | 同时复制检出文件和Git对象  |
| 适用场景               | 划分开发历史           | 同一仓库并行处理多个分支         | 需要仓库级强隔离或独立实验 |

下面的示意图则把三者所处的层级压缩到一张图里：分支是引用，worktree是共享仓库上的独立目录，clone才是另一套仓库。

![分支、worktree和独立clone的区别](https://dg-typora.oss-cn-chengdu.aliyuncs.com/02-comparison-branch-worktree-clone.png)

**(1) 只有分支，为什么还需要worktree**

分支解决的是“提交历史如何分线”，不解决“磁盘上如何同时放置多份检出结果”。只有一个工作目录时，从`feature/login`切到`hotfix/session`，Git必须改写当前目录中的文件和索引。

如果当前目录有未提交修改，切换可能被拒绝，也可能把能安全保留的修改一起带到新分支。使用worktree后，两个分支分别放在两个目录里，不需要来回切换。

**(2) worktree为什么不等于再clone一次**

两个独立clone各有自己的对象库和引用。仓库A创建本地提交后，仓库B并不能直接看到，必须通过远端、bundle或其他传输方式交换。

多个worktree则属于同一个仓库。worktree A创建提交并移动`feature/login`后，worktree B可以立即执行`git log feature/login`查看，不需要`fetch`。这种共享提高了效率，也意味着分支删除、标签修改、`fetch`等仓库级操作会被所有worktree共同看到。

**(3) 如何选择**

① **更适合worktree的场景**

- 长期功能开发尚未完成，需要临时修复线上问题
- 同时维护多个版本分支，例如`main`、`release/2.x`和`hotfix`
- 需要在一个目录运行测试，同时在另一个目录继续开发
- 需要临时检出某个提交做代码审查或问题复现
- 多个自动化任务需要并行处理同一仓库的不同分支

② **更适合独立clone的场景**

- 希望本地分支、远程跟踪引用和仓库配置完全隔离
- 需要测试可能破坏仓库元数据的脚本
- 两套环境使用不同凭据、不同对象替代规则或不兼容的仓库扩展
- 希望一个目录执行`fetch`、`gc`或引用改写时，完全不影响另一个目录

③ **不一定需要worktree的场景**

如果只是短暂查看另一个文件，`git show branch:path/to/file`可能已经足够。工具应服务于实际切换成本，而不是越多越好。

## 2. 创建和查看worktree

假设现有仓库位于`~/code/shop`，默认远端名为`origin`，主分支为`main`。把关联worktree放在主仓库的同级目录：

```text
~/code/
├── shop/                  # 主worktree
├── shop-feature-login/    # 功能分支worktree
├── shop-hotfix-session/   # 热修复worktree
└── shop-review/           # 临时审查worktree
```

把关联worktree放在同级目录更容易管理，也不会让主仓库把关联目录识别成一个嵌套的未跟踪仓库。

先检查Git版本和当前仓库状态：

```bash
# 进入主worktree
cd ~/code/shop

# 确认Git版本以及当前目录、分支和远端状态
git --version
git status --short --branch
git branch --show-current
git remote -v
```

只要当前Git提供`git worktree`命令，就可以继续：

```bash
git worktree -h
```

创建worktree并不要求主目录必须干净，因为新目录检出的是某个提交，而不是复制主目录的未提交修改。不过，在执行前确认当前分支和基准提交，能避免从错误位置创建新分支。

如果新worktree准备基于最新的远端`main`开发，先更新远程跟踪引用：

```bash
git fetch origin
```

这里的`git fetch`会更新同一仓库共享的对象和`origin/*`引用。它不会自动改写任何worktree的工作目录。

按照[Git worktree官方文档](https://git-scm.com/docs/git-worktree)给出的语法，`git worktree add`最常见的三个部分是：分支选项、目标目录和起点提交。把这三项都明确写出来，比依赖隐式推断更容易复查。下面介绍5种常见创建方式；创建后可以随时配合`git worktree list`检查结果。

**(1) 创建新分支并立即检出**

从`origin/main`创建`feature/login`，并检出到新目录：

```bash
# 创建worktree：新分支名、目标目录、起点提交
git worktree add -b feature/login ../shop-feature-login origin/main

# 立即确认主worktree和新worktree的路径、提交与分支
git worktree list
```

![创建feature/login后使用git worktree list检查结果](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829122152584.png)

这条命令完成三件事：

1. 创建本地分支`feature/login`
2. 让该分支从当前`origin/main`指向的提交开始
3. 创建`../shop-feature-login`目录，并在其中检出该分支

`git worktree add -b feature/login ../shop-feature-login origin/main`中的参数含义如下：

- `-b feature/login`：创建本地分支`feature/login`；如果分支已经存在，命令会拒绝，不会覆盖原分支
- `../shop-feature-login`：新worktree的目标路径，相对于当前的`~/code/shop`
- `origin/main`：新分支的起点，也就是执行命令时本地远程跟踪引用`origin/main`指向的提交

因为起点是远程跟踪分支，Git通常会按分支自动跟踪规则设置上游。是否已经设置，可以在新worktree中确认：

```bash
# 查看本地分支及其上游关系
git -C ../shop-feature-login branch -vv

# 查看新worktree的分支和工作区状态
git -C ../shop-feature-login status --short --branch
```

这里的`-C ../shop-feature-login`表示先让Git切换到指定目录再执行后续子命令，不需要当前Shell真的执行`cd`。

如果没有上游，第一次推送时使用`-u`显式设置即可：

```bash
git -C ../shop-feature-login push -u origin feature/login
```

这里的`-u`是`--set-upstream`的简写，会在推送成功后记录当前本地分支与`origin/feature/login`的上游关系。建立上游后，后续可以直接使用无参数的`git pull`；在常见的`push.default=simple`配置下，也可以直接使用`git push`。

**(2) 检出已经存在的本地分支**

如果`hotfix/session`已经存在，但没有被任何worktree检出，可以直接关联：

```bash
git worktree add ../shop-hotfix-session hotfix/session
```

若该分支已在其他worktree中使用，Git默认会拒绝并指出占用它的目录。这不是路径冲突，而是Git在阻止同一个分支引用同时驱动两套独立的索引和文件。

![将已有的hotfix/session分支检出到新worktree](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829123541810.png)

**(3) 基于远端分支创建本地分支**

假设远端已经存在`origin/feature/payment`，本地还没有同名分支。先抓取远端状态，再显式创建跟踪分支：

```bash
# 更新共享的远程跟踪引用
git fetch origin

# 创建本地分支、设置上游并检出到独立目录
git worktree add --track -b feature/payment ../shop-feature-payment origin/feature/payment
```

`--track`表示把起点分支设为新本地分支的上游；`-b feature/payment`创建本地分支；最后两个参数依次是目标目录和起点`origin/feature/payment`。

**(4) 创建分离HEAD的临时worktree**

只想审查、编译或测试某个提交，不准备直接在现有分支上开发时，可以创建分离`HEAD`的worktree：

```bash
# 不创建或检出现有本地分支，HEAD直接指向给定提交
git worktree add --detach ../shop-review origin/main
```

这个目录的`HEAD`直接指向`origin/main`当时对应的提交，不关联本地分支。它适合只读审查和一次性实验。

分离`HEAD`状态仍然允许提交，但新提交不会让某个普通分支自动指向它。若实验结果需要保留，应在删除worktree前创建分支：

```bash
# -C指定目标worktree，switch -c创建并切换到新分支
git -C ../shop-review switch -c experiment/review-result
```

**(5) 让Git根据目录名创建分支**

下面的简写会创建`../hotfix`目录，并在需要时自动创建名为`hotfix`的分支：

```bash
git worktree add ../hotfix
```

但其实我们常用的一般就是**前面三种方式**，后面用的比较少。

## 3. 不同worktree之间共享什么

这是判断各种操作是否会互相影响的基础。

| 状态或资源                   | 是否共享           | 实际影响                                                        |
| ---------------------------- | ------------------ | --------------------------------------------------------------- |
| 工作目录中的文件             | 否                 | 在A中编辑文件，不会改写B中的同名文件                            |
| 未跟踪文件和忽略文件         | 否                 | A中的`.env`、日志和构建产物不会自动出现在B中                    |
| 索引/暂存区                  | 否                 | A执行`git add`，B的暂存区不变                                   |
| `HEAD`                       | 否                 | 每个worktree可以指向不同分支或提交                              |
| 合并等操作的临时状态         | 通常按worktree隔离 | A发生合并冲突，不会让B直接进入同一个合并状态                    |
| 本地分支`refs/heads/*`       | 是                 | A推进、创建或删除分支，B立即看到引用变化                        |
| 标签`refs/tags/*`            | 是                 | 任一worktree创建标签，其他worktree都能看到                      |
| 远程跟踪分支`refs/remotes/*` | 是                 | 任一worktree执行`fetch`后，其他worktree看到同一批`origin/*`更新 |
| 提交、树和文件内容对象       | 是                 | A创建的提交对象可以立即从B读取                                  |
| `stash`列表                  | 是                 | A创建的stash可以从B列出和应用                                   |
| `.git/config`                | 默认共享           | 添加远端或修改仓库级配置会作用于所有worktree                    |
| 应用依赖和构建缓存           | 通常不共享         | `node_modules`、`target`等位于工作目录时需要分别准备            |

[Git worktree官方文档的引用规则](https://git-scm.com/docs/git-worktree#_refs)说明，大部分`refs/*`引用在worktree之间共享，`HEAD`等伪引用通常按worktree区分。这个规则可以解释表中的大部分行为。

**(1) 文件和未提交修改相互隔离**

在功能worktree中修改文件：

```bash
cd ~/code/shop-feature-login

# 在功能worktree中追加测试内容
echo "login" >> login.txt
git status
```

主worktree中的同名文件不会被同步修改：

```bash
git -C ~/code/shop status --short
```

![功能worktree修改文件而主worktree保持不变](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829124151870.png)

worktree只负责Git自身的目录和元数据关系。

**(2) 暂存区相互隔离**

在功能worktree执行：

```bash
git -C ~/code/shop-feature-login add login.txt
git -C ~/code/shop-feature-login diff --cached
```

主worktree的索引不会多出这项暂存内容：

```bash
git -C ~/code/shop diff --cached
```

![两个worktree分别查看各自的暂存区](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829124523507.png)

因此，可以在一个目录准备功能提交，同时在另一个目录准备热修复提交。两边的`git add`不会互相混入。

**(3) 分支和提交对象共同可见**

如果功能worktree创建了`feature/login`，主worktree无需`fetch`就能看到：

```bash
git -C ~/code/shop branch --list
git -C ~/code/shop log -1 --oneline feature/login
```

![主worktree读取共享的feature/login分支](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829124629301.png)

`git branch`通常会用`+`标记在其他worktree中检出的分支，用`*`标记当前worktree检出的分支。这也是定位“分支为什么无法切换”的快捷方式。

**(4) 远端和仓库配置默认共享**

在任意worktree中执行：

```bash
git remote add upstream https://example.com/team/shop.git
```

其中`https://example.com/team/shop.git`是演示地址，实际使用时需要替换为真实仓库URL。这会修改共享的仓库配置，因此其他worktree也能看到`upstream`。同样，`git config --local`默认写入共享的`.git/config`，并不是“只配置当前目录”。

确实需要worktree专属Git配置时，可以启用官方提供的`worktreeConfig`扩展：

```bash
git config extensions.worktreeConfig true
git config --worktree user.email "hotfix@example.com"
```

启用后，`git config --worktree`写入当前worktree专属配置。

注意：较旧的Git版本可能拒绝访问启用了该扩展的仓库，因此团队环境版本不一致时不要贸然开启。

**(5) stash不是每个worktree一份**

`git stash push`只收集当前worktree的修改，但保存结果使用共享的`refs/stash`。所以，在A中创建的stash可以在B中看到：

```bash
git -C ~/code/shop-feature-login stash push -m "feature/login: unfinished form"
git -C ~/code/shop stash list
```

在B中应用这个stash，会把内容尝试应用到B当前检出的代码上，可能发生冲突。多个worktree并行工作时，应给stash写清分支和用途，不要把`stash@{0}`当成某个目录私有的临时区。

## 4. 不同worktree中的Git操作会相互影响吗

判断影响范围时，只看命令改了哪类状态：

| 操作         | 直接改变                 | 其他worktree会看到什么         | 其他worktree不会自动发生什么      |
| ------------ | ------------------------ | ------------------------------ | --------------------------------- |
| `git add`    | 当前worktree的索引       | 无                             | 暂存区和文件不会变化              |
| `git commit` | 共享对象库和当前本地分支 | 能读取新提交和新的分支位置     | `HEAD`、索引和文件不会刷新        |
| `git push`   | 指定的远端引用           | 共享的远程跟踪状态可能变化     | 不会自动合并或改写文件            |
| `git fetch`  | 共享对象库和`origin/*`   | 所有worktree都能读取新远端状态 | 本地分支和文件不会更新            |
| `git pull`   | 先fetch，再集成当前分支  | fetch结果共享                  | 其他worktree不会一起merge或rebase |

![commit与push对共享引用和其他worktree的影响](https://dg-typora.oss-cn-chengdu.aliyuncs.com/06-flowchart-commit-push-impact.png)

图中的虚线表示“能够读取”，不是“自动同步”。下面只展开容易混淆的部分。

### 4.1 commit推进共享分支，不同步其他目录

在功能worktree提交：

```bash
cd ~/code/shop-feature-login

git add .
git commit -m "feat: add login flow"
```

提交后，共享对象库中新增提交，`feature/login`向前移动。主worktree仍检出`main`，它的`HEAD`、索引和文件都不会自动改变，但可以直接读取新提交：

```bash
# 对比两个worktree当前检出的提交
git -C ~/code/shop rev-parse --short HEAD
git -C ~/code/shop-feature-login rev-parse --short HEAD

# 从主worktree读取共享的功能分支
git -C ~/code/shop log -1 --oneline feature/login
```

![在主worktree中查看功能worktree创建的提交](https://dg-typora.oss-cn-chengdu.aliyuncs.com/image-20260829124943973.png)

`git add`只修改当前worktree的索引，因此A中已暂存但尚未提交的内容，不会出现在B的`git diff --cached`中，也不会被`push`发送。处于分离HEAD状态时，`commit`创建的对象仍然共享，但不会自动由普通分支长期引用；需要保留时应及时创建分支。

### 4.2 push更新所选远端引用，不按目录推送

第一次推送功能分支：

```bash
git -C ~/code/shop-feature-login push -u origin feature/login
```

这会把`feature/login`可到达的提交发送到`origin`，更新远端同名分支，并通过`-u`设置上游。它不会发送任何worktree中的未提交或仅暂存内容，也不会让主worktree自动合并功能分支。

push选择的是引用，不是工作目录。即使当前终端位于功能worktree，显式执行下面的命令仍会推送共享的本地`main`：

```bash
git push origin main
```

因此，执行前应确认当前目录、分支和refspec。两个进程推送不同远端分支通常互不冲突；如果同时更新同一远端分支，后到的非快进push通常会被拒绝，处理方式与普通Git仓库相同。

### 4.3 fetch结果共享，pull只集成当前worktree

在任意worktree执行fetch：

```bash
git -C ~/code/shop-feature-login fetch origin
```

新对象和`origin/*`写入共享仓库，其他worktree无需再次fetch就能读取它们，但本地分支和文件不会自动更新。

`git pull`是在fetch之后，对发出命令的当前分支执行merge或rebase。例如：

```bash
git -C ~/code/shop-feature-login pull --rebase
```

其中fetch结果对所有worktree可见，rebase只作用于功能worktree当前的`feature/login`、索引和文件。主worktree的`main`不会一起变基，只可能在状态检查中看到共享引用发生了变化。

## 5. 用worktree完成线上热修复

下面模拟最典型的场景：主目录正在开发`feature/payment`，里面有很多未提交修改；此时需要从最新`origin/main`创建热修复。先看完整路径，再逐步执行命令，可以避免把“创建目录”“提交修复”和“清理目录”混在一起。

![使用worktree完成线上热修复的完整流程](https://dg-typora.oss-cn-chengdu.aliyuncs.com/03-flowchart-hotfix-lifecycle.png)

这条流程的关键约束是：热修复目录拥有自己的文件、`HEAD`和索引，原功能目录中的未提交修改不会被带过去；两边仍共享同一个仓库及其中的引用。

**(1) 保留原目录中的未提交修改**

先在现有仓库更新远端信息：

```bash
cd ~/code/shop
git fetch origin
```

`fetch`不会覆盖当前功能目录中的未提交文件。然后直接从`origin/main`创建热修复worktree：

```bash
git worktree add -b hotfix/session-expired ../shop-hotfix-session origin/main
```

功能目录的修改不会复制到热修复目录。热修复目录得到的是`origin/main`所指提交的干净检出结果。

**(2) 在独立目录中修复和验证**

进入新目录：

```bash
cd ../shop-hotfix-session
git status --short --branch
```

安装这个目录所需的依赖并运行主要测试。以Node.js项目为例，`node_modules`通常位于工作目录中，因此每个worktree需要分别安装：

```bash
npm ci
npm test
```

如果项目会启动本地服务，需要给不同worktree分配不同端口。worktree隔离目录，不隔离操作系统端口、数据库、容器名或外部缓存。

**(3) 提交并推送热修复**

确认变更范围：

```bash
# 先确认当前分支和改动范围
git status --short
git diff
```

暂存、提交并推送：

```bash
# 将准备发布的源码加入当前worktree的索引
git add src/

# 从当前索引创建提交，再推送并设置上游
git commit -m "fix: reject expired sessions"
git push -u origin hotfix/session-expired
```

此时原来的功能worktree：

- 未提交修改仍然保留
- 当前分支仍然是`feature/payment`
- 工作目录不会出现热修复文件
- 可以立即读取本地`hotfix/session-expired`及`origin/hotfix/session-expired`

**(4) 合并后更新主分支**

远端合并热修复后，先在现有仓库抓取最新引用：

```bash
# 更新共享的origin/*引用，不改写当前功能目录
git -C ~/code/shop fetch origin
```

如果已有worktree检出`main`，进入那个目录执行`git merge --ff-only origin/main`。当前示例中，`~/code/shop`仍在维护`feature/payment`，本地`main`没有被任何worktree检出，因此可以再创建一个专门维护主分支的目录：

```bash
# 创建并检出本地main对应的独立worktree
git -C ~/code/shop worktree add ~/code/shop-main main

# 只允许快进到origin/main，出现分叉时直接拒绝
git -C ~/code/shop-main merge --ff-only origin/main
```

如果`main`已经被其他worktree检出，第一条命令会按预期拒绝；此时应到Git提示的现有目录中更新。若本地`main`有额外提交，`--ff-only`也会拒绝而不是隐式创建合并提交，应根据项目流程处理分叉。

**(5) 清理热修复worktree**

先确认目录没有未提交和未跟踪内容：

```bash
git -C ~/code/shop-hotfix-session status --short
```

没有输出后，从任意有效worktree执行：

```bash
git -C ~/code/shop worktree remove ~/code/shop-hotfix-session
```

这条命令会移除关联worktree及其目录，但**不会自动删除本地分支，也不会删除远端分支**。

确认`origin/main`已经包含热修复分支：

```bash
# --merged只列出已经合入origin/main的本地分支
git -C ~/code/shop-main branch --merged origin/main
```

输出中包含`hotfix/session-expired`，并且本地分支不再需要后，再单独删除：

```bash
# -d会在分支未安全合并时拒绝删除
git -C ~/code/shop-main branch -d hotfix/session-expired
```

`-d`会在Git认为分支尚未安全合并时拒绝，适合作为保护；前面的`--merged origin/main`则明确验证热修复已经进入远端主分支。远端分支是否删除取决于团队平台和分支管理规则，不应把删除worktree等同于删除远端分支。

## 6. 清理、移动和修复worktree

worktree不是创建后就不再管理的临时文件夹。正确移动、移除和修复关联关系，可以避免主仓库残留过期元数据。

**(1) 正常移除worktree**

正常清理使用：

```bash
git worktree remove ../shop-review
```

默认只允许移除干净的关联worktree。如果其中有已修改或未跟踪文件，命令会拒绝。应先检查并决定提交、备份还是丢弃，不要看到报错就直接加`--force`。

主worktree不能通过`git worktree remove`删除。

**(2) 误删目录后清理过期记录**

手动删除关联worktree目录，会让主仓库保留一份指向不存在路径的管理记录。下次Git可能仍认为某分支被占用。

如果目录已经被误删，先预览可清理项：

```bash
# 先预览将被清理的过期管理记录，不执行删除
git worktree prune --dry-run --verbose
```

确认输出后再清理过期管理记录：

```bash
# 确认预览结果后执行清理，并输出处理详情
git worktree prune --verbose
```

`--dry-run`只报告将要清理的记录，`--verbose`显示处理详情。`prune`处理的是工作目录已经不存在的过期元数据，不等于删除仍然有效的worktree，也不等于删除分支。

**(3) 通过Git移动worktree**

不要直接使用文件管理器移动关联目录，优先让Git同时更新路径信息：

```bash
# 由Git移动目录并同步更新worktree管理信息
git worktree move ../shop-feature-login ../worktrees/shop-login
```

根据官方文档，主worktree不能用该命令移动，包含子模块的关联worktree也存在移动限制。

**(4) 修复移动后的关联关系**

如果主仓库或关联目录已经被外部工具移动，可以尝试：

```bash
# 在当前可访问的worktree中修复关联关系
git worktree repair
```

多个关联目录被移动时，可以传入新路径：

```bash
# 参数依次是多个关联worktree移动后的新路径
git worktree repair ../worktrees/shop-login ../worktrees/shop-hotfix
```

`repair`修复的是worktree之间的管理链接，不会替代提交、备份或冲突处理。

**(5) 锁定不总是在线的worktree**

关联worktree位于移动硬盘或网络挂载中，临时不可访问时，不应让`prune`把它当作过期记录。可以锁定并写明原因：

```bash
# 锁定管理记录，并写明暂时不可访问的原因
git worktree lock --reason "stored on external SSD" ../shop-release
```

恢复稳定访问后解锁：

```bash
git worktree unlock ../shop-release
```

`--reason`只记录锁定原因，便于之后通过`git worktree list --verbose`排查；它不参与权限判断。锁定还会阻止普通移动和删除操作。它保护的是worktree管理记录，不是给分支增加远端访问控制。

## 7. worktree之外仍需处理的并行边界

worktree隔离的是Git工作目录和每个工作树的专属状态，不会替项目协调运行环境，也不会为并发任务增加额外的远端保护。

**(1) 推送前确认目录、分支和目标引用**

无参数`git push`会根据当前worktree的`HEAD`、上游关系和`push.default`选择推送内容。多个终端目录名称相似时，先确认：

```bash
pwd
git branch --show-current
git status --short --branch
```

首次推送当前分支可以使用`git push -u origin HEAD`，但仍需确认`origin`是否为预期远端。

**(2) 运行资源不会随目录自动隔离**

不同worktree可以分别安装依赖、维护`.env`和生成构建产物，但端口、数据库、缓存以及Docker Compose项目名仍可能冲突。

![两个worktree在独立编辑器窗口中并行开发](https://dg-typora.oss-cn-chengdu.aliyuncs.com/07-scene-parallel-ide-worktrees.png)

并行启动服务前，应为每个目录分配明确的端口、数据库、缓存前缀、容器名和临时目录。

![两个worktree仍会共享端口、数据库、容器名和缓存](https://dg-typora.oss-cn-chengdu.aliyuncs.com/04-infographic-runtime-boundaries.png)

**(3) 子模块需要单独验证**

[Git worktree官方文档的BUGS部分](https://git-scm.com/docs/git-worktree#_bugs)指出，多工作树场景中的子模块支持仍不完整。依赖子模块的项目，应先在可丢弃环境验证`add`、`update`、`move`和清理流程。

**(4) 多个Agent或自动化任务仍会竞争共享引用**

不同任务可以在各自worktree中编译和测试，但`fetch --prune`、标签修改、rebase和push仍作用于共享引用或同一远端。两个任务可能互不改写文件，却仍因同时推送同一分支或改写历史发生冲突。

需要严格隔离仓库状态时，应使用独立clone；必须共享仓库时，则应为修改同一引用的任务增加串行控制。

## 8. 总结：先判断目录状态，再判断共享引用

worktree最有价值的地方，是把“切换开发上下文”变成“切换目录”。正在进行的功能开发不必stash，热修复可以从干净的`main`提交开始，测试和审查也可以各自占用独立工作目录。

同时，它并不是多个仓库。判断一条命令会不会影响其他worktree时，可以沿着同一条规则分析：

- 命令修改的是工作目录、索引或当前worktree的`HEAD`，影响通常局限在当前worktree
- 命令修改的是本地分支、标签、远程跟踪分支、stash、对象库或仓库配置，其他worktree会看到变化
- 命令执行push，真正改变的是所选远端引用；其他worktree的文件不会自动同步，但共享引用状态可能变化

只要始终区分“目录状态”和“共享引用”，commit、push、fetch、pull在多个worktree之间的影响就不会显得神秘。默认坚持一个本地分支只检出到一个worktree，再配合明确的目录命名和清理流程，worktree会是一种相当稳定的并行开发方式。

本文参考资料：

- [Git worktree官方文档](https://git-scm.com/docs/git-worktree)
- [Git术语表](https://git-scm.com/docs/gitglossary)
- [Git push官方文档](https://git-scm.com/docs/git-push)
