module.exports = {
  apps: [
    {
      name: 'realtoken-yam',
      script: 'npm',
      args: 'start',
      cwd: '/path/to/realtoken-yam-interface',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=2048',
    },
  ],
};

