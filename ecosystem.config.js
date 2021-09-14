module.exports = {
    apps : [{
        name   : "plumb-all-slack-integration",
        script : "npm",
        args : "start",
        env_production: {
            NODE_ENV : "production"
        },
        env_development: {
            NODE_ENV : "development",
        },
        autorestart: true,
        watch: true
    }],

    // Deployment to server configuration
    deploy: {
        production: {
            "key": "deploy.pem",
            "user": "root",
            "host": "ftp.preview-wp.plumb-all.com",
            "ref": "origin/master",
            "repo": "https://github.com/DeathCamel58/plumb-all-slack-integration.git",
            "path": "/root/plumb-all-slack-integration",
            "post-deploy" : "npm install; pm2 startOrRestart ecosystem.config.js --env development"
        }
    }
}
