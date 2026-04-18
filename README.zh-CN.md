# Electron Multi WebView DevTools

[English](./README.md)

[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Template-0F172A)](#项目简介)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

一个面向多 WebView 调试需求项目的 Electron 技术模板。

## 项目简介

`electron-multi-webview-devtools` 是一个基于 Electron、React 19、TypeScript 和 `electron-vite` 构建的轻量级参考项目。

它的核心目标不是作为一个可直接交付给终端用户的调试产品，而是为“有多 WebView 调试需求的 Electron 项目”提供一个可复用的技术模板。

这个仓库演示了如何在一个窗口内组织多个 `WebContentsView`、为当前激活会话挂载 DevTools、启用移动端模拟能力，以及让 DevTools 的“检查元素”状态与宿主页面的交互模式保持同步，方便你把这套能力集成到自己的项目里。

## 功能特性

- 提供 Electron 多 WebView 调试能力的参考架构
- 以标签页方式管理多个相互隔离的 WebView 会话
- 默认启用移动端视口模拟和触控模式
- 当前激活会话可直接在应用内显示 DevTools
- DevTools 的“检查元素”和宿主页面输入模式自动同步
- 最近会话以卡片堆叠方式展示预览
- 提供后退、前进、刷新、打开 URL、新建、关闭等基础操作
- 拦截 `window.open()`，新页面会作为内部新会话打开
- 非 HTTP(S) 链接自动交给系统外部应用处理

## 适用场景

- 为内部平台或业务容器搭建多 WebView 调试能力
- 在接入正式产品前，先验证嵌入式 DevTools 的交互方案
- 复用当前仓库中的会话管理和视图编排逻辑，作为自定义调试平台的起点

## 非目标

- 不是一个打磨完整的独立浏览器产品
- 不是一个面向终端用户直接发布的调试器成品
- 不追求完整真实设备级别的模拟能力

## 技术栈

- Electron 41
- React 19
- TypeScript 5
- 基于 `electron-vite` 的 Vite 构建流程

## 目录结构

```text
.
├── src/main            # Electron 主进程，会话与视图管理
├── src/preload         # 暴露给渲染进程的 IPC 桥
├── src/renderer        # React 界面层，负责标签栏、控制区和布局容器
├── src/shared          # 主进程与渲染进程共享类型
├── electron.vite.config.ts
└── package.json
```

## 界面截图

![主界面截图](./docs/images/screenshot-main.svg)

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 类型检查

```bash
npm run typecheck
```

### 构建

```bash
npm run build
```

### 预览构建结果

```bash
npm run preview
```

## 工作原理

1. 渲染进程负责绘制应用壳层，并把移动端视口区域和 DevTools 区域的布局尺寸同步给主进程。
2. 主进程为每个会话创建一组独立视图：
   - 一个 `WebContentsView` 用于网页内容
   - 一个 `WebContentsView` 用于 DevTools
3. 当前激活会话会被挂载到主窗口中，同时显示对应的 DevTools 面板。
4. 应用通过 Chrome DevTools Protocol 实现：
   - 移动端尺寸覆盖
   - 触控事件模拟
   - 元素检查高亮层
5. DevTools 前端会注入一段桥接脚本，用于感知“检查元素”状态，并与宿主页面的鼠标/触控模式保持一致。

## 这个模板当前演示了什么

- 默认首页为 `https://example.com`
- 输入不带协议的地址时，会自动补全为 `https://...`
- 关闭最后一个会话后，应用会自动创建一个新的默认会话
- 只有当前激活会话显示 DevTools，其余会话以堆叠预览形式保留在左侧

## 当前限制

- 目前还没有打包安装器流程
- 目前还没有自动化测试
- 仓库当前有意保持小而聚焦，重点展示多 WebView 调试的核心模式
- 不等同于完整真实设备模拟

## 可用脚本

```bash
npm run dev
npm run build
npm run preview
npm run typecheck
```

## 后续计划

- 增加会话持久化
- 增加可配置的设备预设
- 增加地址历史与书签支持
- 增加打包与发布流程
- 增加自动化测试

## 开源发布建议

- 等到后续接入 CI、打包或发布流程后，再补对应徽章，避免 README 信息失真

## 参与贡献

欢迎提交 Issue 和 Pull Request。如果你要扩展调试能力，建议优先保持主进程中的视图管理逻辑和 DevTools 状态同步逻辑足够清晰、可维护。

## 许可证

当前仓库采用 MIT License，详见 [LICENSE](./LICENSE)。
