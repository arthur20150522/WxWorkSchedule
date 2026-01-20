#!/bin/bash

# 遇到错误立即停止
set -e

# 配置变量
WORK_DIR="/www/wwwroot/WxWork"
REPO_URL="https://github.com/arthur20150522/WxWorkSchedule.git"
SERVER_PORT=3000

# 颜色输出
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== 开始部署 WxWorkSchedule ===${NC}"

# 1. 检查并安装基础环境 (Node.js, Git, PM2)
echo -e "${GREEN}[1/6] 检查环境依赖...${NC}"
if ! command -v node &> /dev/null; then
    echo "安装 Node.js 20..."
    # 尝试检测系统类型
    if [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
        # 安装 Puppeteer/Chrome 依赖 (针对 OpenCloudOS/CentOS Stream 9)
        echo "安装 Chrome 依赖..."
        dnf install -y nss atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage libXrandr libgbm pango alsa-lib libXcursor libXi libXScrnSaver libXtst
    else
        # 假设是 Debian/Ubuntu 或者其他，尝试直接使用 nodesource 的脚本，如果不兼容再手动
        # 有些系统可能既不是 RH 也不是 Debian，比如 Alpine（不常见用于这种场景）
        # 这里强制使用 apt-get 的前置脚本
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || echo "Node source setup failed, trying direct install"
        apt-get install -y nodejs || yum install -y nodejs
    fi
fi

if ! command -v git &> /dev/null; then
    echo "安装 Git..."
    yum install -y git || apt-get install -y git
fi

if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
fi

# 2. 拉取/更新代码
echo -e "${GREEN}[2/6] 拉取代码...${NC}"
if [ ! -d "$WORK_DIR" ]; then
    mkdir -p $(dirname "$WORK_DIR")
    git clone "$REPO_URL" "$WORK_DIR"
else
    cd "$WORK_DIR"
    echo "重置并更新代码..."
    git fetch --all
    git reset --hard origin/main
    git pull
fi

# 3. 服务端部署
echo -e "${GREEN}[3/6] 部署服务端 (Server)...${NC}"
cd "$WORK_DIR/server"

# 安装依赖
echo "安装 Server 依赖..."
npm install

# 编译 TypeScript
echo "编译 Server 代码..."
npm run build

# 配置环境变量 (如果不存在)
if [ ! -f .env ]; then
    echo "生成 .env 配置文件..."
    cat > .env <<EOF
PORT=$SERVER_PORT
JWT_SECRET=$(openssl rand -hex 32)
EOF
fi

# 确保数据目录存在
mkdir -p users
if [ ! -f .user ]; then
    echo "{}" > .user
fi

# 4. 客户端部署
echo -e "${GREEN}[4/6] 部署客户端 (Client)...${NC}"
cd "$WORK_DIR/client"

# 安装依赖
echo "安装 Client 依赖..."
npm install

# 构建前端
echo "构建 Client 代码..."
npm run build

# 5. 启动服务
echo -e "${GREEN}[5/6] 启动服务...${NC}"
cd "$WORK_DIR/server"

# 使用 PM2 启动/重启
if pm2 list | grep -q "wx-schedule-server"; then
    pm2 restart wx-schedule-server
else
    pm2 start dist/index.js --name "wx-schedule-server"
fi
pm2 save

# 6. 完成
echo -e "${GREEN}=== 部署完成! ===${NC}"
echo -e "1. 服务端运行在端口: $SERVER_PORT"
echo -e "2. 客户端静态文件位于: $WORK_DIR/client/dist"
echo -e "3. 请配置 Nginx 反向代理以对外提供服务 (参考 nginx.conf.example)"
