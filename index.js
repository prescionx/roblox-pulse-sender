const axios = require('axios');
const fs = require('fs');
const chalk = require('chalk');
const moment = require('moment');
const path = require('path');
console.log(chalk.cyanBright('https://github.com/prescionx/roblox-pulse-sender'));
class AccountManager {
    constructor(config) {
        this.accounts = new Map();
        this.globalConfig = config.globalConfig;
        
        if (!Array.isArray(config.accounts)) {
            throw new Error('Config must contain an accounts array');
        }
        
        this.logPath = path.join(process.cwd(), 'roblox_heartbeat.log');
        
        config.accounts.forEach(accountConfig => {
            const monitor = new RobloxHeartbeatMonitor({
                ...this.globalConfig,
                ...accountConfig,
                logPath: this.logPath  
            });
            this.accounts.set(accountConfig.username, monitor);
        });
    }

    async startAll() {
        const startPromises = [];
        for (const [username, monitor] of this.accounts.entries()) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            startPromises.push(
                monitor.start().catch(async error => {
                    console.error(chalk.red(`Failed to start monitor for ${username}:`, error.message));
                    return Promise.reject(error);
                })
            );
        }
        return Promise.all(startPromises);
    }

    async stopAll() {
        for (const monitor of this.accounts.values()) {
            monitor.stop();
        }
    }

    getStatus() {
        const status = {};
        this.accounts.forEach((monitor, username) => {
            status[username] = {
                isActive: !!monitor.intervalId,
                lastPulse: monitor.lastPulseTime,
                userId: monitor.userId,
                displayName: monitor.displayName
            };
        });
        return status;
    }
}

class RobloxHeartbeatMonitor {
    constructor(config) {
        this.ROBLOSECURITY = config.robloxCookie;
        this.pulseInterval = config.pulseInterval || 30000;
        this.retryAttempts = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 5000;
        this.logEnabled = config.enableLogging !== false;
        this.logPath = config.logPath;
        this.currentSessionId = null;
        this.userId = null;
        this.displayName = null;
        this.cookiesLogged = false;
        this.lastPulseTime = null;
        this.intervalId = null;
        
        this.validateConfig();
    }

    validateConfig() {
        if (!this.ROBLOSECURITY || this.ROBLOSECURITY?.lenght < 30 || this.ROBLOSECURITY?.startsWith('cookie')) {
            throw new Error('ROBLOX_COOKIE is not defined in config.json. Check your configuration.\n >> If you are trying to manage multiple accounts, make sure to define ROBLOX_COOKIE for each account separately.');
            
        }
    }

    formatTime() {
        return moment().format('DD/MM/YYYY HH:mm:ss');
    }

    async log(message, type = 'info') {
        if (!this.logEnabled) return;

        const timestamp = this.formatTime();
        let consoleMessage;
        let fileMessage;

        const accountIdentifier = this.displayName || 'Unknown Account';

        switch (type) {
            case 'error':
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.red.bold('ERROR')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.red(message)}`;
                break;
            case 'success':
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.greenBright.bold('SUCCESS')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.greenBright(message)}`;
                break;
            case 'warning':
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.yellow.bold('WARNING')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.yellow(message)}`;
                break;
            case 'user':
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.blue.bold('USER')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.blue(message)}`;
                break;
            case 'system':
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.magenta.bold('SYSTEM')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.magenta(message)}`;
                break;
            default:
                consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.white.bold('INFO')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.white(message)}`;
        }

        fileMessage = `[${timestamp}] [${type.toUpperCase()}] [${accountIdentifier}] ${message}\n`;

        console.log(consoleMessage);

        if (this.logEnabled) {
            try {
                const lockFile = `${this.logPath}.lock`;
                while (fs.existsSync(lockFile)) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                fs.writeFileSync(lockFile, '');
                
                try {
                    fs.appendFileSync(this.logPath, fileMessage);
                } finally {
                    fs.unlinkSync(lockFile);
                }
            } catch (error) {
                console.error(chalk.red(`Failed to write to log file: ${error.message}`));
            }
        }
    }

    async getCsrfToken() {
        try {
            const response = await axios.post("https://auth.roblox.com/v2/logout", null, {
                headers: { 
                    "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
            });
            return response.headers["x-csrf-token"];
        } catch (error) {
            if (error.response?.headers["x-csrf-token"]) {
                await this.log("CSRF token obtained successfully", 'success');
                return error.response.headers["x-csrf-token"];
            }
            await this.log("Failed to get CSRF token", 'error');
            throw new Error("Failed to obtain CSRF token");
        }
    }

    async getUserInfo() {
        try {
            const response = await axios.get('https://users.roblox.com/v1/users/authenticated', {
                headers: {
                    'Cookie': `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const userData = response.data;
            this.userId = userData.id;

            const detailsResponse = await axios.get(`https://users.roblox.com/v1/users/${userData.id}`, {
                headers: {
                    'Cookie': `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const userDetails = detailsResponse.data;
            this.displayName = userDetails.displayName;

            await this.log('=== User Information ===', 'system');
            await this.log(`Username: ${userDetails.name}`, 'user');
            await this.log(`Display Name: ${userDetails.displayName}`, 'user');
            await this.log(`User ID: ${userDetails.id}`, 'user');
            await this.log(`Description: ${userDetails.description}`, 'user');
            await this.log(`Created: ${moment(userDetails.created).format('DD/MM/YYYY HH:mm:ss')}`, 'user');
            await this.log(`Is Banned: ${userDetails.isBanned}`, 'user');
            await this.log('==================', 'system');

            return userDetails;

        } catch (error) {
            const errorMessage = error.response?.data || error.message;
            await this.log(`Failed to fetch user info: ${errorMessage}`, 'error');
            throw error;
        }
    }

    async getSessionId() {
        try {
            const response = await axios.get("https://www.roblox.com/home", {
                headers: {
                    "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                },
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 400;
                }
            });

            if (!this.cookiesLogged && response.headers["set-cookie"]) {
                await this.log("=== Initial Cookies ===", 'system');
                await this.log(JSON.stringify(response.headers["set-cookie"], null, 2), 'info');
                await this.log('==================', 'system');
                this.cookiesLogged = true;
            }

            if (!response.headers["set-cookie"]) {
                throw new Error("No cookies received in response");
            }

            let sessionId = null;
            for (const cookie of response.headers["set-cookie"]) {
                if (cookie.includes('sessionid')) {
                    const matches = cookie.match(/sessionid=([^;]+)/);
                    if (matches && matches[1]) {
                        sessionId = matches[1];
                        break;
                    }
                }
            }

            if (!sessionId) {
                sessionId = this.ROBLOSECURITY;
            }

            this.currentSessionId = sessionId;
            await this.log(`New session established: ${sessionId}`, 'success');
            return sessionId;

        } catch (error) {
            const errorMessage = error.response?.data || error.message;
            await this.log(`Session ID error: ${errorMessage}`, 'error');
            throw error;
        }
    }

    async sendPulseRequest(attempt = 1) {
        try {
            const csrfToken = await this.getCsrfToken();
            const sessionId = await this.getSessionId();

            if (!csrfToken || !sessionId) {
                throw new Error("Failed to obtain required tokens");
            }

            const response = await axios.post(
                "https://apis.roblox.com/user-heartbeats-api/pulse",
                {
                    clientSideTimestampEpochMs: Date.now(),
                    sessionInfo: { 
                        sessionId: sessionId
                    },
                    locationInfo: {
                        robloxWebsiteLocationInfo: { 
                            url: "https://www.roblox.com/home",
                            referrerUrl: "https://www.roblox.com"
                        }
                    }
                },
                {
                    headers: {
                        "accept": "application/json, text/plain, */*",
                        "content-type": "application/json;charset=UTF-8",
                        "x-csrf-token": csrfToken,
                        "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                        "referer": "https://www.roblox.com/",
                        "origin": "https://www.roblox.com",
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                    }
                }
            );

            this.lastPulseTime = new Date();
            await this.log(`Pulse successful for ${this.displayName}`, 'success');
            return response.data;

        } catch (error) {
            const errorMessage = error.response?.data || error.message;
            await this.log(`Pulse request failed: ${errorMessage}`, 'error');

            if (attempt < this.retryAttempts) {
                await this.log(`Retrying... Attempt ${attempt + 1}/${this.retryAttempts}`, 'warning');
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.sendPulseRequest(attempt + 1);
            }

            throw new Error(`Failed after ${this.retryAttempts} attempts: ${errorMessage}`);
        }
    }

    async start() {
        try {
            await this.log("Starting Roblox Heartbeat Monitor...", 'system');
            
            await this.getUserInfo();
            
            await this.sendPulseRequest();
            
            this.intervalId = setInterval(() => {
                this.sendPulseRequest().catch(async error => {
                    await this.log(`Failed to send pulse: ${error.message}`, 'error');
                });
            }, this.pulseInterval);

            await this.log(`Monitor started with ${this.pulseInterval}ms interval for ${this.displayName}`, 'success');
        } catch (error) {
            await this.log(`Failed to start monitor: ${error.message}`, 'error');
            throw error;
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.log(`Heartbeat Monitor stopped for ${this.displayName}`, 'system');
        }
    }
}

try {
    const config = require('./config.json');

    const manager = new AccountManager(config);

    manager.startAll().then(() => {
        setInterval(() => {
            const status = manager.getStatus();
            console.log('Account Status:', status);
        }, 60000);
    });

    process.on('SIGINT', async () => {
        await manager.stopAll();
        process.exit(0);
    });

} catch (error) {
    console.error(chalk.red('Failed to start account manager:', error.message));
    process.exit(1);
}

