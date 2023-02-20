let NODE_VERSION = "18.14.1";

module.exports = {
    apps : [{
        name   : "plumb-all-slack-integration",
        script : `npm`,
        args : "start",
        interpreter: `node`,
        env_production: {
            NODE_ENV : "production",
            ENV_LOCATION : "$HOME/plumb-all-slack-integration/.env"
        },
        // TODO: PM2 does not see a defined development environment
        // > pm2 deploy development
        // development environment is not defined in ecosystem.config.js file
        env_development: {
            NODE_ENV : "development",
            ENV_LOCATION : "$HOME/plumb-all-slack-integration/.env",
            DEBUGGING: true
        },
        autorestart: true,
        watch: true,
        ignore_path: [
            "node_modules"
        ],
        log_file: '$HOME/plumb-all-slack-integration/runtime.log'
    }],

    // Deployment to server configuration
    deploy: {
        production: {
            "key": "deploy.pem",
            "user": "ubuntu",
            "host": "pm2.plumb-all.com",
            "ref": "origin/master",
            "repo": "https://github.com/DeathCamel58/plumb-all-slack-integration.git",
            "path": "/home/ubuntu/plumb-all-slack-integration",
            "post-deploy" : `source $HOME/.nvm/nvm.sh; nvm use v${NODE_VERSION}; npm install; pm2 startOrRestart ecosystem.config.js --env production`
        }
    }
}
