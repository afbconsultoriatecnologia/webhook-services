module.exports = {
  apps: [{
    name: 'webhook-services',
    script: './dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 4000
    },
    error_file: './logs/pm2/error.log',
    out_file: './logs/pm2/out.log',
    log_file: './logs/pm2/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }]
};