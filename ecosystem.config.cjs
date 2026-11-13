module.exports = {
  apps: [
    {
      name: 'absensi-bot',
      script: 'src/bot.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      ignore_watch: ['node_modules', 'logs', '.git', 'test', 'docs', '.bot.pid', '*.log'],
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
