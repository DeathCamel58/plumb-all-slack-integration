let NODE_VERSION = "22.17.0";

module.exports = {
  apps: [
    {
      name: "plumb-all-slack-integration",
      script: `npm`,
      args: "start",
      interpreter: `/home/admin/.nvm/versions/node/v${NODE_VERSION}/bin/node`,
      env_production: {
        NODE_ENV: "production",
        ENV_LOCATION: "/home/admin/plumb-all-slack-integration/.env",
      },
      // TODO: PM2 does not see a defined development environment
      // > pm2 deploy development
      // development environment is not defined in ecosystem.config.cjs file
      env_development: {
        NODE_ENV: "development",
        ENV_LOCATION: "/home/admin/plumb-all-slack-integration/.env",
        DEBUGGING: true,
      },
      autorestart: true,
      watch: true,
      ignore_path: ["node_modules"],
      log_file: "/home/admin/plumb-all-slack-integration/runtime.log",
    },
  ],

  // Deployment to server configuration
  deploy: {
    production: {
      key: "deploy.pem",
      user: "admin",
      host: "pm2.plumb-all.com",
      ref: "origin/master",
      repo: "https://github.com/DeathCamel58/plumb-all-slack-integration.git",
      path: "/home/admin/plumb-all-slack-integration",
      "post-deploy": `source $HOME/.nvm/nvm.sh; nvm use v${NODE_VERSION}; npm install; npx prisma generate; pm2 startOrRestart ecosystem.config.js --env production`,
    },
  },
};
