const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'wx-bridge',
      script: 'C:\\Python314\\python.exe',
      args: ['-u', path.join(__dirname, 'pybridge', 'bridge.py')],
      interpreter: 'none',
      cwd: path.dirname(__dirname),
      autorestart: true,
      windowsHide: true,
      // WeChat is launched through the bridge and therefore appears in its
      // descendant process tree.  PM2's Windows default uses taskkill /T;
      // disabling tree-kill prevents a bridge restart/deploy from killing the
      // independently long-lived WeChat client.
      treekill: false,
      env: {
        PYTHONUNBUFFERED: '1',
        // Recovery changes foreground/UI state and can contaminate logout
        // attribution. Keep it manual unless an operator opts in explicitly.
        ALLOW_WECHAT_AUTO_RECOVERY: 'false',
        ALLOW_WECHAT_HARD_RECOVERY: 'false',
      },
    },
  ],
};
