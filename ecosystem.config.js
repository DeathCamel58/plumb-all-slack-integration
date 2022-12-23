module.exports = {
    apps : [{
        name   : "plumb-all-slack-integration",
        script : "npm",
        args : "start",
        env_production: {
            NODE_ENV : "production",
            ENV_LOCATION : "/root/plumb-all-slack-integration/.env"
        },
        env_development: {
            NODE_ENV : "development",
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
            "post-deploy" : "npm install; pm2 startOrRestart ecosystem.config.js --env production"
        }
    }
}
