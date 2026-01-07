# WxWorkSchedule - 企业微信定时任务管理系统

## 📖 项目简介

WxWorkSchedule 是一个基于 **React** 和 **FastAPI** 构建的企业微信群组消息定时发送管理系统。它允许用户通过可视化的 Web 界面管理企业微信群组、创建富文本消息模板，并设置灵活的定时任务（单次、循环）来自动发送消息。

**当前状态**：项目处于开发演示阶段，核心的企业微信交互（登录、获取群组、发送消息）目前使用 **Mock（模拟）数据**，方便在无真实企业微信凭证的情况下进行功能体验和开发。

## ✨ 核心功能

*   **扫码登录**：模拟企业微信扫码登录流程。
*   **群组管理**：查看和管理企业微信群组（支持同步和搜索）。
*   **消息编辑**：内置富文本编辑器，支持创建、保存和复用消息模板。
*   **定时任务**：
    *   支持单次执行、每天、每周、每月等多种循环模式。
    *   基于 APScheduler 的高可靠任务调度。
    *   支持任务的暂停、恢复和删除。
*   **操作日志**：详细记录所有消息发送状态和系统操作日志。
*   **扩展面板**：现代化的 React UI 面板，支持响应式布局。

## 🛠️ 技术栈

*   **前端**：React 18, TypeScript, Vite, Ant Design, Axios, TailwindCSS
*   **后端**：Python 3.9+, FastAPI, SQLAlchemy (SQLite), APScheduler, Redis
*   **部署**：Nginx, Systemd, Shell Scripts

## ⚠️ 关于"模拟环境" (Mock Environment)

为了降低开发和体验门槛，本项目默认运行在**模拟模式**下：

1.  **模拟登录**：
    *   点击登录不会跳转真实的企业微信 OAuth。
    *   二维码是一个模拟图片。
    *   系统会自动模拟"等待扫码" -> "已扫码" -> "已确认"的登录全过程。
2.  **模拟群组数据**：
    *   群组列表是后端生成的测试数据，并非真实从企业微信服务器拉取。
3.  **模拟消息发送**：
    *   定时任务触发时，系统会记录"发送成功"的日志，但不会真正向微信服务器发送 HTTP 请求。

### 如何切换到真实环境？

要接入真实的企业微信，你需要：
1.  拥有一个企业微信管理员账号。
2.  在 `backend/.env` 中配置真实的企业 ID 和应用 Secret：
    ```env
    WECHAT_CORP_ID=你的企业ID
    WECHAT_CORP_SECRET=你的应用Secret
    WECHAT_AGENT_ID=你的应用AgentID
    ```
3.  修改 `backend/app/services/wechat.py` 和 `group_service.py`，将 Mock 逻辑替换为真实的 `wechaty` 或 `requests` 调用逻辑。

## 🚀 快速开始 (本地开发)

### 1. 后端启动
```bash
cd backend

# 创建虚拟环境 (推荐)
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 初始化数据库
# 系统启动时会自动初始化，无需手动操作

# 启动服务
uvicorn main:app --reload
```
后端服务地址：http://localhost:8000
API 文档：http://localhost:8000/docs

### 2. 前端启动
```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```
前端访问地址：http://localhost:5173

## 📦 服务器部署

本项目包含自动部署脚本，支持在 Linux 服务器（推荐 CentOS/OpenCloudOS/Ubuntu）上快速部署。

**前置要求**：
*   Python 3.9+
*   Nginx
*   Redis

**部署步骤**：

1.  **克隆项目**到服务器 `/www/wwwroot/WxWork` 目录。
2.  **配置 Nginx**：
    将 `deploy/nginx.conf` 复制到 Nginx 配置目录并重载。
3.  **运行部署脚本**：
    ```bash
    cd deploy
    bash deploy.sh
    ```
    脚本会自动安装 Python 依赖、构建前端资源、配置 Systemd 服务并启动。

## 📂 项目结构

```
WxWorkSchedule/
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── api/            # API 路由接口
│   │   ├── core/           # 核心配置
│   │   ├── models/         # 数据库模型
│   │   ├── schemas/        # Pydantic 数据验证
│   │   ├── services/       # 业务逻辑 (任务调度, 微信交互)
│   │   └── main.py         # 入口文件
│   ├── requirements.txt
│   └── wxwork.db           # SQLite 数据库
├── frontend/               # React 前端
│   ├── src/
│   │   ├── components/     # 公共组件
│   │   ├── pages/          # 页面组件
│   │   ├── layouts/        # 布局组件
│   │   └── api/            # API 封装
│   └── vite.config.ts
├── deploy/                 # 部署相关文件
│   ├── deploy.sh           # 一键部署脚本
│   ├── nginx.conf          # Nginx 配置文件
│   └── wxwork-schedule.service # Systemd 服务配置
└── README.md
```
