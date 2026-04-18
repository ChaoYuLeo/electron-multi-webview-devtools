# 主进程架构说明

这份文档说明 `src/main` 的主进程架构。

目标不是重复 README 里的功能介绍，而是给后续维护者一个清晰的“改哪里、为什么这么分、哪些边界不要再打穿”的参考。

## 设计目标

- 让主进程入口足够薄，只负责启动
- 把状态持有和行为编排分开
- 把 Electron 视图生命周期和 Chrome DevTools Protocol 逻辑分开
- 让会话相关改动尽量只落在会话模块内
- 保持渲染进程到主进程的接口稳定且收敛

## 模块划分

```text
src/main
├── index.ts               # 入口，只启动 MainApp
├── app.ts                 # 应用启动、窗口创建、IPC 注册、模块装配
├── state.ts               # 主进程内存态：窗口、布局、会话集合
├── session-manager.ts     # 会话生命周期、导航、事件绑定
├── layout-manager.ts      # WebContentsView 挂载/卸载与尺寸同步
├── emulation-manager.ts   # 移动端模拟、触控模式、检查元素模式
├── devtools-manager.ts    # DevTools 初始化与前端桥接脚本注入
├── constants.ts           # 共享常量
└── types.ts               # 主进程内部类型
```

## 分层思路

当前结构可以理解成四层：

1. 入口层
   `index.ts`
   只负责启动应用，不承载业务逻辑。

2. 组装层
   `app.ts`
   负责把各个模块接起来，处理 Electron 生命周期、主窗口创建和 IPC 注册。

3. 领域行为层
   `session-manager.ts`
   `layout-manager.ts`
   `emulation-manager.ts`
   `devtools-manager.ts`
   每个模块只负责一类相对完整的行为。

4. 状态与契约层
   `state.ts`
   `types.ts`
   `constants.ts`
   提供共享状态、内部类型和常量定义。

## 各模块职责

### `index.ts`

- 创建 `MainApp`
- 调用启动流程
- 不应该继续堆放任何业务逻辑

### `app.ts`

- 等待 `app.whenReady()`
- 设置应用标识
- 创建主窗口
- 注册 IPC
- 组装各个 manager
- 把会话变化广播给 renderer

约束：
`app.ts` 可以编排模块，但不应该继续吞并会话细节、协议细节和布局计算。

### `state.ts`

- 持有以下内存态：
  - 主窗口引用
  - 当前激活会话 id
  - 会话 Map
  - 会话顺序计数器
  - renderer 上报的最新布局
- 提供读写方法
- 提供有序的会话列表给 renderer 使用

约束：
`state.ts` 只做状态持有和基础读写，不做重行为逻辑。

### `session-manager.ts`

- 创建和销毁会话
- 标准化 URL
- 为每个会话创建内容视图和 DevTools 视图
- 绑定 `webContents` 事件
- 更新导航和加载状态
- 把不同职责委托给其他模块：
  - DevTools 初始化交给 `devtools-manager`
  - 仿真与检查模式交给 `emulation-manager`
  - 视图挂载和尺寸同步交给 `layout-manager`

约束：
凡是“会话生命周期、导航行为、页面事件响应”相关的逻辑，优先进入这里。

### `layout-manager.ts`

- 把视图挂到主窗口上
- 把视图从主窗口上移除
- 计算激活会话内容区和 DevTools 区的 bounds
- 计算后台预览卡片的堆叠布局
- 在视口变化后触发仿真更新

约束：
所有 `WebContentsView` 几何计算都应集中在这里，不要分散到别的模块。

### `emulation-manager.ts`

- 按需附加 debugger
- 开启 DOM / Overlay 协议域
- 设置移动端尺寸模拟
- 切换触控模式和鼠标模式
- 维护 inspect mode 与宿主页面输入模式的同步

约束：
所有和 Chrome DevTools Protocol 中“仿真、检查模式”相关的调用，都应该落在这里。

### `devtools-manager.ts`

- 绑定页面内容视图与 DevTools 视图
- 打开嵌入式 DevTools
- 向 DevTools 前端注入桥接脚本
- 感知 DevTools 内部触发的 inspect mode 切换

约束：
DevTools 前端相关逻辑放这里，不要再塞回 `session-manager.ts`。

## 运行时主链路

### 启动链路

1. `index.ts` 启动 `MainApp`
2. `MainApp.start()` 等待 Electron ready
3. `app.ts` 注册 IPC
4. `app.ts` 创建主窗口
5. 创建默认会话
6. renderer 通过 `app:set-layout` 上报内容区和 DevTools 区尺寸
7. `layout-manager` 根据当前激活会话挂载并布局视图

### 新建会话链路

1. renderer 调用 `app:create-session`
2. `session-manager` 创建内容视图和 DevTools 视图
3. 会话写入 `MainState`
4. 必要时将该会话设为激活
5. `layout-manager` 同步挂载视图
6. 内容视图加载目标 URL
7. 在 `dom-ready` 和 `did-finish-load` 时初始化 DevTools 和仿真能力

### 检查元素同步链路

检查模式有两个入口：

- renderer 通过 IPC 显式切换
- 用户直接在 DevTools UI 内部点击“检查元素”

统一同步路径：

1. 识别到 inspect mode 状态变化
2. `emulation-manager` 更新内存中的 inspect 状态
3. 同步切换触控模式、鼠标模式和光标样式
4. 必要时更新 Overlay inspect mode
5. 把新的会话列表广播给 renderer

## 状态归属

主进程状态被有意集中在 `MainState` 中。

状态归属约束如下：

- `MainState` 持有会话的权威状态
- `session-manager` 负责修改会话导航和生命周期相关状态
- `emulation-manager` 负责修改 debugger、overlay、inspect 相关状态
- `layout-manager` 可以读取状态，但不应该发明新的持久化会话字段
- `app.ts` 不应再保存一份平行状态副本

这样做的核心目的是避免多个模块各自维护一份“真相”。

## 依赖方向

依赖方向应该保持如下：

```text
index.ts
  -> app.ts
     -> state.ts
     -> session-manager.ts
     -> layout-manager.ts
     -> emulation-manager.ts
     -> devtools-manager.ts
```

需要长期遵守的约束：

- `state.ts` 不依赖任何 manager
- `layout-manager.ts` 不感知 IPC
- `emulation-manager.ts` 不负责创建或销毁会话
- `devtools-manager.ts` 不负责窗口布局
- `session-manager.ts` 可以协调其他 manager，但不应该把它们重新吞回去

## 后续扩展建议

新增能力时，建议按下面的落点处理：

- 会话持久化：
  新建独立 persistence 模块，由 `app.ts` 或 `session-manager.ts` 编排调用

- 设备预设：
  预设定义可以放在 `emulation-manager.ts` 邻近模块，协议应用逻辑仍留在 `emulation-manager.ts`

- 会话分组、固定、标签元数据：
  扩展 `state.ts` 和 `session-manager.ts`

- 更复杂的预览卡片布局：
  改 `layout-manager.ts`

- 更多 DevTools UI 状态联动：
  改 `devtools-manager.ts`

- 新的 renderer 指令：
  先在 `app.ts` 注册 IPC，再路由到对应 manager

## 架构守则

建议守住这些边界：

- 不要把业务逻辑重新塞回 `index.ts`
- 不要让 `app.ts` 演变成第二个大杂烩文件
- 不要把协议调用和窗口布局代码写在一起
- 不要让多个模块随意直接修改 session Map 而没有明确边界
- 不要把 renderer 的页面细节假设扩散到所有 manager

## 快速判断规则

当你不确定代码该放哪里时，可以直接按这个规则判断：

- “它是在创建、关闭、导航、响应页面事件吗？”
  放进 `session-manager.ts`

- “它是在算 bounds、挂载视图、卸载视图吗？”
  放进 `layout-manager.ts`

- “它是在调用 `webContents.debugger.sendCommand(...)` 做仿真或检查模式吗？”
  放进 `emulation-manager.ts`

- “它是在处理嵌入式 DevTools 前端行为吗？”
  放进 `devtools-manager.ts`

- “它是在组装模块或注册 IPC 吗？”
  放进 `app.ts`
