module.exports = {
  apps: [{
    name: 'wx-schedule',
    script: 'index.js',
    cwd: __dirname,
    env: {
      JWT_SECRET: 'wx-schedule-secret-2024',
      PORT: 3000
    }
  }]
};
