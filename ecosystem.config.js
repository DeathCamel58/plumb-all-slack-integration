module.exports = {
    apps : [{
        name   : "plumb-all-slack-integration",
        script : "npm",
        args : "start",
        interpreter: "/root/.nvm/versions/node/v18.12.1/bin/node",
        env_production: {
            NODE_ENV : "production",
            ENV_LOCATION : "/root/plumb-all-slack-integration/.env"
        },
        env_development: {
            NODE_ENV : "development",
            ENV_LOCATION : "/root/plumb-all-slack-integration/.env",
            DEBUGGING: true
        },
        autorestart: true,
        watch: true,
        ignore_path: [
            "node_modules"
        ],
        log_file: '/root/plumb-all-slack-integration/runtime.log'
    }],

    // Deployment to server configuration
    deploy: {
        production: {
            "key": "deploy.pem",
            "user": "root",
            "host": "pm2.plumb-all.com",
            "ref": "origin/master",
            "repo": "https://github.com/DeathCamel58/plumb-all-slack-integration.git",
            "path": "/root/plumb-all-slack-integration",
            "post-deploy" : "/root/.nvm/versions/node/v18.12.1/bin/npm install; pm2 startOrRestart ecosystem.config.js --env production"
        }
    }
}
