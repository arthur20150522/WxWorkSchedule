#!/bin/bash
# deploy.sh

# 停止现有服务
sudo systemctl stop wxwork-schedule

# 拉取最新代码
cd /www/wwwroot/WxWork
git pull origin main

# 安装依赖
cd backend
pip install -r requirements.txt

# 构建前端
cd ../frontend
npm install
npm run build

# 数据库迁移
cd ../backend
# python -m alembic upgrade head
python -c "from app.init_db import init_db; init_db()"

# 启动服务
sudo systemctl start wxwork-schedule
sudo systemctl restart nginx

echo "部署完成"