# Agent Radar

[English](README.en.md) · [下载安装包](https://github.com/YuYiChyan/opencode-agent-radar/releases/latest) · [反馈问题](https://github.com/YuYiChyan/opencode-agent-radar/issues)

通用 OpenCode Desktop 子代理监控插件。自动发现当前任务树中的任意代理，
以斜置的 3D 玻璃卡堆、按需展开的关系图和真实事件动效呈现协作；AI 分析和额度监控均为可选能力。

已验证开发目标：OpenCode Desktop / SDK **2.2.7**。GUI API 为实验性接口，其他版本需要单独验证。

## 一条命令安装

```sh
opencode plugin add github:YuYiChyan/opencode-agent-radar
```

安装后，在 OpenCode Desktop 的会话中输入 `/radar`，或点击右上角 **总控台 ↗**。
仓库自带预构建 bundle，安装者无需编译。基础监控无需 API Key，AI 分析默认关闭。

更新：

```sh
opencode plugin update github:YuYiChyan/opencode-agent-radar
```

本插件面向 **Desktop 原生界面**。已在 macOS 验证；Windows / Linux 尚未完成原生界面验收。
当前界面文案为中文；英文文档见上方链接。

## 界面预览

![深色大屏与磨砂抽卡](docs/images/dark-deck.png)

<details>
<summary>浅色关系图与侧栏</summary>

![浅色自动适应关系图](docs/images/light-relations.png)

![侧栏卡束](docs/images/compact.png)

</details>

截图使用开发预览：代理任务和额度均为模拟数据；实际安装后显示用户自己的会话与已接入额度来源。

## 使用

- 会话右上角 **总控台 ↗**、**⌘⇧J** 或 `/radar` 打开无地址栏的大屏。
- 右侧 **＋ → 总控台 · Agent Radar** 打开嵌入面板；Esc 收起大屏。
- 单击卡堆中的卡片，它会替换顶部的统筹卡，展开下方关系图；再次点击顶部选中卡、点击 **×** 或按 Esc，收起为预览并恢复统筹卡。
- 关系图按可用宽高自动缩放、居中，完整呈现当前关联节点，无需滚动；节点可拖动，**↺** 恢复布局并自动适应。点击图上方的 **Agent 名称 ↗** 进入会话。
- 卡堆最多展示七张，通过滚轮、堆下箭头或方向键首尾循环；选中卡不重复出现在下方卡束。
- 鼠标移入时，玻璃卡面轻轻抽出并亮起柔和面光，离开后缓缓归位；侧栏底部卡束只抬起最前一张。磨砂层更通透，仍随宿主主题配色。
- 侧栏使用正视叠卡：选中后，其余卡片收拢到底部的微错位卡束；滚动预览后点击卡束，可直接切换顶部代理。
- 背景、文字与卡片颜色跟随 OpenCode 当前主题；在 OpenCode 中切换浅色／深色或配色，面板会同步更新。右上角齿轮进入 **设置 → Agent Radar**。

主统筹卡固定在右上，明确显示 Agent、实际模型及可选额度环。子代理从左上到右下
斜向叠放在左下的小型卡堆中，随窗口尺寸锚定位置。抽出的卡片占用原统筹位，保持可读大小，腾出中下部给关系图。
背景采用单色底与极细流线／结构线，卡面使用毛玻璃。关系图在抽卡后才出现，仅呈现
选中代理的直接关系、有限二跳协作和真实祖先链，不通过统筹节点扩展整棵任务树。卡片按各自累计 tokens
有限度增长（含缓存读写，不合并后代）。关系图拖拽位置按任务树和选中代理保存在窗口内存。

## 真实任务与文件流转

- 派遣：真实派遣事件触发玻璃卡沿曲线飞向子代理卡堆或已展开的关系节点。
- 结果回报：飞行卡折叠并沿真实回传路径返回；手动抽卡选择与事件动效分别处理。
- 后台通知的入队与送达分开处理；执行结束状态不等同于结果正文已返回。
- 成功的 patch/write/edit 操作记录文件产出；同树另一会话随后读取相同规范路径时，
  记录文件交接并沿连接线播放光点。仅产出时显示本地脉冲，不猜测接收方。
- shell 构建产物缺少可靠的带会话文件事件时，不通过命令文本推定文件交接。
- 所有模型分析关系与已观察关系区分；推断关系使用虚线。

通信从插件加载后开始采集，每树最近 160 条，按服务器和任务树隔离。
打开面板后会有界补读同树近期 assistant 历史，只投影明确的 subagent 工具调用和已完成的公开文本。
不使用 reasoning、用户聊天、native 数据或 synthetic 消息恢复“送达”；历史记录不会重播为实时动画。
分析优先覆盖运行中、近期通信及近期创建的代理，保留祖先，最多 80 个节点；界面会标明当前卡是否未纳入本轮分析。
关系图直接显示 AI 关闭／分析中／失败／公开证据不足等状态，避免把缺少数据理解为“代理之间没有协作”。
减少动态效果设置会关闭飞行动效；减少透明度设置会使用实色卡片。

## 可选 AI 分析

通用安装默认关闭 AI 分析；基础监控、文件证据和导航可独立使用。

在 **设置 → Agent Radar** 选择：

1. **OpenCode 已配置模型**：填写现有 Provider ID 和模型 ID，复用宿主鉴权。
2. **自定义 API**：填写 OpenAI Chat Completions 兼容地址、模型 ID 和 API Key。
3. **关闭 AI 分析**：停止分析请求，保留监控。

Key 由系统安全存储加密，设置页只显示是否已保存；保存配置不发送测试请求。
留空保留已有 Key，更换地址时同时提供新 Key。分析输入仅包含公开任务、工具事件、
文件路径与结果摘要。短时文件变化合批、按签名去重、全局单并发，最短 20 秒启动间隔。
分析侧重公开任务中的实现、测试、评审和产物依赖；语义推断使用虚线，不能替代真实文件交接证据。

安装者也可明确指定首次启用的宿主模型，例如插件配置的 `options.analysis`：

```json
{ "mode": "host", "providerID": "your-provider", "modelID": "your-model" }
```

此预设仅作为未保存设置时的初始值；用户在设置页保存的选择优先。

## 可选额度同心环

安装并配置 `@slkiser/opencode-quota` 后，读取其已有 `snapshot` 缓存。
只有确有数值的来源才显示环，不为未接入的模型制造额度。

- GPT 白色，Gemini 紫色，国产来源蓝色，MiniMax 红色。
- 点击一层环查看该来源各账号／周期的精确值、重置时间、缓存更新时间和异常状态。
- 同一来源有多个周期时，环长度表示其中最低的剩余比例；右侧保留全部原始数值。
- 没有比例的真实余额使用虚线环；没有额度来源时，中心显示会话累计 tokens。
- 不主动刷新服务商、不实现额度截断或自动切号。

## 安装与构建

也可下载 Release 中的 ZIP，解压到持久目录，在全局 `opencode.json` 的现有 `plugins` 数组中追加该目录路径：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/agent-radar"]
}
```

路径指向包含 `package.json` 的目录。Windows 路径可写为 `C:/Plugins/agent-radar`。
此示例用于追加条目；保留原有插件与其他设置。全局配置一般位于 `~/.config/opencode/opencode.json(c)`。
正式 GUI 是单个预构建 `dist/gui-experimental.cjs`，由桌面宿主直接加载，
无需启动网页服务器。保留现有插件配置项即可升级；本地 bundle 变更自动热加载。

在 **设置 → 扩展 → 插件** 中可查看加载状态、启停界面或重新加载。

源码构建：

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

开发环境使用 Node.js 22；`npm run preview` 打开本地交互预览。
`preview/` 是开发交互验证入口，不包含在发布包中；任务和额度夹具不代表真实运行记录。

GitHub 安装依赖仓库中已构建的 `dist/gui-experimental.cjs`。修改运行代码后，请一并提交重新构建的 bundle。
包名 `agent-radar` 同时是插件 IPC 身份，不应只修改包名而不迁移协议。

## 许可证

[MIT](LICENSE)。欢迎使用、修改与贡献。
