# 优化计划：安全加固与代码重构

本计划旨在在保留 JSON 数据库的前提下，通过引入密码哈希、环境变量管理和统一错误处理，显著提升项目的安全性与可维护性。

## 1. 任务列表 (Todo List)
- [ ] **依赖安装**: 安装 `bcrypt` (用于密码加密) 和 `@types/bcrypt`。
- [ ] **环境配置**: 创建 `.env` 文件，配置 `JWT_SECRET` 和 `PORT`，移除代码中的硬编码密钥。
- [ ] **安全升级 (UserManager)**:
    - [ ] 修改 `UserManager` 支持 `bcrypt` 密码验证。
    - [ ] 实现“平滑迁移”逻辑：登录时自动将明文密码升级为哈希密码。
    - [ ] 优化性能：增加内存缓存，避免每次验证都读取文件。
- [ ] **代码优化 (API)**:
    - [ ] 创建统一的错误处理中间件/辅助函数，避免直接暴露 `e.message`。
    - [ ] 修复 `api.ts` 中的 `any` 类型隐患，增强类型安全。
- [ ] **验证**: 确保登录流程正常，且新生成的密码在文件中为加密字符串。

## 2. 详细实施步骤

### 阶段一：安全加固 (Security)
1.  **安装依赖**:
    ```bash
    npm install bcrypt
    npm install -D @types/bcrypt
    ```
2.  **环境变量**:
    -   创建 `server/.env`。
    -   在 `authMiddleware.ts` 中强制使用 `process.env.JWT_SECRET`。
3.  **密码哈希改造**:
    -   修改 `server/src/userManager.ts`:
        -   引入 `bcrypt`。
        -   在 `verifyUser` 中，如果密码匹配明文，则计算哈希并回写文件（自动迁移）。
        -   如果是哈希格式，则使用 `bcrypt.compare` 验证。

### 阶段二：代码与性能优化 (Refactoring)
1.  **UserManager 性能优化**:
    -   将 `fs.readFileSync` 改为启动时读取 + 内存缓存。
    -   仅在修改密码时写入文件。
2.  **API 错误处理**:
    -   封装 `handleError(res, error)` 函数。
    -   替换所有 `res.status(500)` 调用，统一日志记录格式。

### 阶段三：验证 (Verification)
1.  启动服务器，使用现有明文密码登录。
2.  检查 `.user` 文件，确认密码是否已自动转换为哈希值。
3.  再次登录，确保哈希验证通过。
