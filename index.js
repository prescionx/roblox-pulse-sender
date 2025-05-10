const axios = require('axios');
const fs = require('fs');
const chalk = require('chalk');
const moment = require('moment');
const path = require('path');

console.log(chalk.cyanBright('https://github.com/prescionx/roblox-pulse-sender'));

class AccountManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.accounts = new Map();
        this.logPath = path.join(process.cwd(), 'roblox_heartbeat.log');
        this.loadConfig(); // Load config initially

        this.globalConfig = this.rawConfig.globalConfig || {
            retryAttempts: 3,
            retryDelay: 5000,
            defaultPulseIntervalFull: 30000, // Default 30s for full
            pulseIntervalPartial: 572123    // 5 minutes for partial
        };

        this.rawConfig.accounts.forEach(accountConfig => {
            const monitor = new RobloxHeartbeatMonitor({
                ...this.globalConfig, // Global config first
                ...accountConfig,     // Account specific overrides
                logPath: this.logPath,
                // Ensure mode-specific intervals are correctly applied by RobloxHeartbeatMonitor constructor
            });
            this.accounts.set(accountConfig.username, monitor);
        });
    }

    loadConfig() {
        try {
            const rawData = fs.readFileSync(this.configPath);
            this.rawConfig = JSON.parse(rawData);
            if (!this.rawConfig.accounts) this.rawConfig.accounts = [];
            if (!this.rawConfig.globalConfig) this.rawConfig.globalConfig = {};
        } catch (error) {
            console.error(chalk.red(`Failed to load config from ${this.configPath}:`), error);
            // Initialize with empty structure if file doesn't exist or is corrupt
            this.rawConfig = {
                accounts: [], globalConfig: {
                    retryAttempts: 3, retryDelay: 5000, defaultPulseIntervalFull: 30000, pulseIntervalPartial: 572123
                }
            };
            this.saveConfig(); // Create a default config if it failed to load
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.rawConfig, null, 2));
            console.log(chalk.blue('Configuration saved.'));
        } catch (error) {
            console.error(chalk.red('Failed to save config:'), error);
        }
    }

    async startAll() {
        const startPromises = [];
        for (const [username, monitor] of this.accounts.entries()) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Stagger starts slightly
            startPromises.push(
                monitor.start().catch(async error => {
                    // Monitor will log its own start errors. Manager can log a summary.
                    console.error(chalk.red(`AccountManager: Failed to start monitor for ${username}: ${error.message}`));
                    // No need to reject here, let other accounts try to start
                })
            );
        }
        // We don't necessarily need to Promise.all if we want robust startup for other accounts
        // await Promise.all(startPromises); 
        console.log(chalk.green('AccountManager: All account monitor startups initiated.'));
    }

    async stopAll() {
        for (const monitor of this.accounts.values()) {
            monitor.stop();
        }
        console.log(chalk.magenta('AccountManager: All monitors stopped.'));
    }

    async fetchAllPresences() {
        const userIds = Array.from(this.accounts.values())
            .map(monitor => monitor.userId)
            .filter(id => id != null);

        if (userIds.length === 0) {
            console.log(chalk.yellow('No user IDs available to fetch presences.'));
            return {};
        }

        try {
            const response = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds });
            const presencesData = response.data.userPresences;
            const presenceMap = {};

            presencesData.forEach(presence => {
                const monitor = Array.from(this.accounts.values()).find(m => m.userId === presence.userId);
                if (monitor) {
                    monitor.presence = presence;
                    presenceMap[monitor.username] = presence;
                }
            });
            console.log(chalk.green('Successfully fetched and updated presences.'));
            return presenceMap;
        } catch (error) {
            console.error(chalk.red('Failed to fetch presences:'), error.message);
            const firstMonitor = this.accounts.values().next().value;
            if (firstMonitor) {
                await firstMonitor.log(`Global presence fetch failed: ${error.message}`, 'error');
            }
            return { error: 'Failed to fetch presences' };
        }
    }

    getStatus() {
        const status = {};
        this.accounts.forEach((monitor, username) => {
            status[username] = {
                username: monitor.username,
                isActive: !!monitor.intervalId,
                lastPulse: monitor.lastPulseTime ? monitor.lastPulseTime.toISOString() : null,
                userId: monitor.userId,
                displayName: monitor.displayName,
                avatarUrl: monitor.avatarUrl,
                presence: monitor.presence,
                mode: monitor.mode,
                pulseInterval: monitor.currentPulseInterval, // Use the actual current interval
                logPath: monitor.logPath
            };
        });
        return status;
    }

    async addAccount(accountConfig) {
        if (this.accounts.has(accountConfig.username)) {
            throw new Error(`Account ${accountConfig.username} already exists.`);
        }
        // Ensure mode and pulseInterval are correctly set based on defaults if not provided
        const mode = accountConfig.mode || 'full';
        let pulseInterval;
        if (mode === 'partial') {
            pulseInterval = accountConfig.pulseInterval || this.globalConfig.pulseIntervalPartial;
        } else {
            pulseInterval = accountConfig.pulseInterval || this.globalConfig.defaultPulseIntervalFull;
        }

        const newAccountSetup = {
            username: accountConfig.username,
            robloxCookie: accountConfig.robloxCookie,
            pulseInterval: pulseInterval, // This is the initial pulseInterval for the specified mode
            enableLogging: accountConfig.enableLogging !== undefined ? accountConfig.enableLogging : true,
            mode: mode,
        };


        this.rawConfig.accounts.push(newAccountSetup);
        this.saveConfig();

        const monitor = new RobloxHeartbeatMonitor({
            ...this.globalConfig, // Global config first
            ...newAccountSetup,   // Then the new account's specific config
            logPath: this.logPath
        });

        this.accounts.set(accountConfig.username, monitor);
        try {
            await monitor.start();
            await monitor.log(`Account ${accountConfig.username} added and started in ${monitor.mode} mode.`, 'system');
            return { success: true, message: `Account ${accountConfig.username} added.` };
        } catch (error) {
            await monitor.log(`Failed to start newly added account ${accountConfig.username}: ${error.message}`, 'error');
            return { success: false, message: `Account ${accountConfig.username} added but failed to start.` };
        }
    }

    async removeAccount(username) {
        const monitor = this.accounts.get(username);
        if (!monitor) {
            throw new Error(`Account ${username} not found.`);
        }
        monitor.stop();
        this.accounts.delete(username);

        this.rawConfig.accounts = this.rawConfig.accounts.filter(acc => acc.username !== username);
        this.saveConfig();

        await monitor.log(`Account ${username} removed.`, 'system');
        return { success: true, message: `Account ${username} removed.` };
    }

    async updateAccountMode(username, newMode) {
        const monitor = this.accounts.get(username);
        if (!monitor) {
            throw new Error(`Account ${username} not found.`);
        }

        const accountIndex = this.rawConfig.accounts.findIndex(acc => acc.username === username);
        if (accountIndex > -1) {
            this.rawConfig.accounts[accountIndex].mode = newMode;
            // The monitor's setMode will handle its internal pulseInterval.
            // The config's pulseInterval property for the account should represent the 'full' mode interval.
            // If switching to 'partial', the actual interval is handled by the monitor using globalConfig.pulseIntervalPartial.
            // If switching to 'full', it uses its original configPulseInterval or globalConfig.defaultPulseIntervalFull.
            this.saveConfig();
        } else {
            throw new Error(`Account ${username} not found in raw config for mode update.`);
        }

        await monitor.setMode(newMode); // This will stop, change mode, update interval, and restart
        await monitor.log(`Account ${username} mode updated to ${newMode}. Effective interval: ${monitor.currentPulseInterval}ms.`, 'system');
        return { success: true, message: `Account ${username} mode updated to ${newMode}.` };
    }
}

class RobloxHeartbeatMonitor {
    constructor(config) {
        this.ROBLOSECURITY = config.robloxCookie;
        this.username = config.username;
        this.configPulseInterval = config.pulseInterval; // Interval specified for the account (intended for 'full' mode)
        this.mode = config.mode || 'full';

        this.retryAttempts = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 5000;
        this.logEnabled = config.enableLogging !== false;
        this.logPath = config.logPath;

        this.defaultPulseIntervalFull = config.defaultPulseIntervalFull || 30000;
        this.pulseIntervalPartial = config.pulseIntervalPartial || 572123; // 5 minutes

        this.currentPulseInterval = this.mode === 'partial'
            ? this.pulseIntervalPartial
            : (this.configPulseInterval || this.defaultPulseIntervalFull);

        this.currentSessionId = null; // Will be set by getSessionId
        this.userId = null;
        this.displayName = null;
        this.avatarUrl = null;
        this.presence = null;
        this.cookiesLogged = false; // For logging initial cookies from /home
        this.lastPulseTime = null;
        this.intervalId = null;
        this.validateConfig();
    }

    validateConfig() {
        if (!this.ROBLOSECURITY || this.ROBLOSECURITY.length < 30 || this.ROBLOSECURITY.startsWith('cookie')) {
            throw new Error('ROBLOSECURITY cookie is not properly configured. It should be the full cookie value.');
        }
    }

    formatTime() {
        return moment().format('DD/MM/YYYY HH:mm:ss');
    }

    async log(message, type = 'info') {
        if (!this.logEnabled) return;
        const timestamp = this.formatTime();
        const accountIdentifier = this.displayName || this.username || 'InitialSetup';
        let consoleMessage;

        switch (type) {
            case 'error': consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.red.bold('ERROR')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.red(message)}`; break;
            case 'success': consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.greenBright.bold('SUCCESS')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.greenBright(message)}`; break;
            case 'warning': consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.yellow.bold('WARNING')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.yellow(message)}`; break;
            case 'user': consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.blue.bold('USER')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.blue(message)}`; break;
            case 'system': consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.magenta.bold('SYSTEM')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.magenta(message)}`; break;
            default: consoleMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.white.bold('INFO')} ${chalk.gray(`[${accountIdentifier}]`)} ${chalk.white(message)}`;
        }
        console.log(consoleMessage);

        const fileMessage = `[${timestamp}] [${type.toUpperCase()}] [${accountIdentifier}] ${message}\n`;
        try {
            fs.appendFileSync(this.logPath, fileMessage);
        } catch (error) {
            console.error(chalk.red(`Failed to write to log file ${this.logPath}: ${error.message}`));
        }
    }

    async getCsrfToken() {
        try {
            // Attempt to get CSRF token by making a request that's known to return it in headers, even on error.
            // The /logout endpoint is commonly used for this.
            const response = await axios.post("https://auth.roblox.com/v2/logout", null, {
                headers: {
                    "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
            });
            // This path might not be hit if logout is successful and doesn't error, but check headers anyway.
            if (response.headers["x-csrf-token"]) {
                await this.log("CSRF token obtained from logout response headers.", 'info');
                return response.headers["x-csrf-token"];
            }
            // If the request was "successful" but didn't have the token (unlikely for logout), it's an issue.
            throw new Error("CSRF token not found in logout response headers despite 2xx status.");
        } catch (error) {
            // This is the more common path: request fails (e.g. 403) but includes the token.
            if (error.response && error.response.headers["x-csrf-token"]) {
                await this.log("CSRF token obtained from error response.", 'info');
                return error.response.headers["x-csrf-token"];
            }
            // If no token in error response either, then it's a genuine failure to get the token.
            await this.log(`Failed to get CSRF token: ${error.message}`, 'error');
            throw new Error("Failed to obtain CSRF token.");
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
            this.displayName = userData.displayName;
            // this.username = userData.name; // 'name' is the unique username

            try {
                const avatarResponse = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${this.userId}&size=150x150&format=Png&isCircular=false`);
                if (avatarResponse.data && avatarResponse.data.data && avatarResponse.data.data.length > 0) {
                    this.avatarUrl = avatarResponse.data.data[0].imageUrl;
                    await this.log(`Avatar URL fetched: ${this.avatarUrl}`, 'info');
                }
            } catch (avatarError) {
                await this.log(`Failed to fetch avatar: ${avatarError.message}`, 'warning');
                this.avatarUrl = null;
            }

            await this.log(`User info fetched: ${this.displayName} (ID: ${this.userId})`, 'success');
            return userData;

        } catch (error) {
            const errorMessage = error.response?.data?.errors?.[0]?.message || error.response?.data || error.message;
            await this.log(`Failed to fetch user info: ${errorMessage}`, 'error');
            if (error.response?.status === 401) {
                await this.log('The .ROBLOSECURITY cookie might be invalid or expired.', 'error');
            }
            throw error;
        }
    }

    async getSessionId() {
        // This method attempts to get a session ID similar to how a browser might receive it.
        // The pulse API might have specific expectations for this ID.
        try {
            const response = await axios.get("https://www.roblox.com/home", {
                headers: {
                    "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                },
                maxRedirects: 5, // Follow redirects, as /home might redirect
                validateStatus: function (status) {
                    return status >= 200 && status < 400; // Accept successful status codes
                }
            });

            // Log initial cookies only once
            if (!this.cookiesLogged && response.headers["set-cookie"]) {
                await this.log("=== Initial Cookies from /home ===", 'system');
                await this.log(JSON.stringify(response.headers["set-cookie"], null, 0), 'info');
                await this.log('=================================', 'system');
                this.cookiesLogged = true;
            }

            let foundSessionId = null;
            if (response.headers["set-cookie"]) {
                for (const cookie of response.headers["set-cookie"]) {
                    // Look for RBXSessionTracker or similar session-indicating cookies
                    if (cookie.toLowerCase().includes('rbxsessiontracker')) {
                        const matches = cookie.match(/sessionid=([^;]+)/i); // Case-insensitive match
                        if (matches && matches[1]) {
                            foundSessionId = matches[1];
                            await this.log(`RBXSessionTracker sessionid found: ${foundSessionId}`, 'info');
                            break;
                        }
                    }
                }
            }

            if (!foundSessionId) {
                // Fallback if no specific sessionid is found in set-cookie headers from /home
                // A consistent, derived ID might be better than a frequently changing one like Date.now()
                // Using a portion of the ROBLOSECURITY cookie is a common fallback.
                foundSessionId = `rbx_pulse_sess_${this.ROBLOSECURITY.substring(this.ROBLOSECURITY.length - 32)}`;
                await this.log(`No specific sessionid found from /home cookies, using derived session ID: ...${foundSessionId.slice(-10)}`, 'warning');
            }

            this.currentSessionId = foundSessionId;
            return this.currentSessionId;

        } catch (error) {
            const errorMessage = error.response?.data || error.message;
            await this.log(`Error fetching /home for session ID: ${errorMessage}. Will use a fallback session ID.`, 'error');
            // Fallback strategy in case of error
            this.currentSessionId = `fallback_pulse_sess_${this.ROBLOSECURITY.substring(this.ROBLOSECURITY.length - 32)}`;
            await this.log(`Using fallback session ID: ...${this.currentSessionId.slice(-10)}`, 'warning');
            return this.currentSessionId;
        }
    }

    async sendPulseRequest(attempt = 1) {
        try {
            const csrfToken = await this.getCsrfToken();
            const sessionId = await this.getSessionId(); // Ensure this provides a valid or acceptable session ID

            if (!csrfToken) throw new Error("CSRF token is missing for pulse request.");
            if (!sessionId) throw new Error("Session ID is missing for pulse request.");

            const payload = {
                clientSideTimestampEpochMs: Date.now(),
                sessionInfo: {
                    sessionId: sessionId // Ensure this is what the API expects
                },
                locationInfo: { // Reinstating locationInfo as it was likely there for a reason
                    robloxWebsiteLocationInfo: {
                        url: "https://www.roblox.com/home", // Standard URL
                        referrerUrl: "https://www.roblox.com/" // Standard referrer
                    }
                }
            };

            await this.log(`Sending pulse with sessionId: ...${sessionId.slice(-10)}`, 'info');

            const response = await axios.post(
                "https://apis.roblox.com/user-heartbeats-api/pulse",
                payload,
                {
                    headers: {
                        "accept": "application/json, text/plain, */*",
                        "content-type": "application/json;charset=UTF-8",
                        "x-csrf-token": csrfToken,
                        "cookie": `.ROBLOSECURITY=${this.ROBLOSECURITY}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                        "Origin": "https://www.roblox.com",
                        "Referer": "https://www.roblox.com/home"
                    }
                }
            );

            this.lastPulseTime = new Date();
            await this.log(`Pulse successful for ${this.displayName || this.username}. Mode: ${this.mode}.`, 'success');
            return response.data;

        } catch (error) {
            const statusCode = error.response?.status;
            const errorData = error.response?.data;
            let specificMessage = "";
            if (statusCode === 401) specificMessage = "Unauthorized (cookie might be invalid). ";
            if (statusCode === 403 && errorData?.message === "Token Validation Failed") specificMessage = "CSRF Token Validation Failed. ";
            else if (statusCode === 403) specificMessage = "Forbidden (check permissions or headers). ";

            const apiErrorMessage = errorData?.errors?.[0]?.message || errorData?.message || "No specific API error message.";
            const errorMessageToLog = `${specificMessage}${apiErrorMessage} (Full error: ${error.message})`;

            await this.log(`Pulse request failed for ${this.displayName || this.username}: ${errorMessageToLog} (Attempt ${attempt})`, 'error');

            if (attempt < this.retryAttempts) {
                await this.log(`Retrying pulse... Attempt ${attempt + 1}/${this.retryAttempts}`, 'warning');
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.sendPulseRequest(attempt + 1);
            }
            throw new Error(`Failed pulse after ${this.retryAttempts} attempts for ${this.displayName || this.username}: ${errorMessageToLog}`);
        }
    }

    async start() {
        const accountIdentifier = this.username || 'InitialSetup';
        try {
            await this.log(`Starting monitor for ${accountIdentifier} in ${this.mode} mode...`, 'system');
            await this.getUserInfo();

            const currentDisplayName = this.displayName || this.username;
            await this.log(`User info confirmed for ${currentDisplayName}.`, 'info');
            await this.getSessionId(); // Initial call to set currentSessionId, also logs initial cookies if any

            await this.sendPulseRequest();

            this.intervalId = setInterval(async () => {
                try {
                    await this.sendPulseRequest();
                } catch (pulseError) {
                    await this.log(`Scheduled pulse failed for ${currentDisplayName}: ${pulseError.message}`, 'error');
                }
            }, this.currentPulseInterval);

            await this.log(`Monitor started for ${currentDisplayName}. Mode: ${this.mode}, Interval: ${this.currentPulseInterval}ms.`, 'success');

        } catch (error) {
            const errorAccountIdentifier = this.displayName || this.username || 'InitialSetup';
            await this.log(`FATAL: Failed to start monitor for ${errorAccountIdentifier}: ${error.message}. This account will be inactive.`, 'error');
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        }
    }

    async setMode(newMode) {
        const currentDisplayName = this.displayName || this.username;
        await this.log(`Attempting to change mode from ${this.mode} to ${newMode} for ${currentDisplayName}...`, 'system');
        this.stop();

        this.mode = newMode;
        if (this.mode === 'partial') {
            this.currentPulseInterval = this.pulseIntervalPartial;
        } else {
            this.currentPulseInterval = this.configPulseInterval || this.defaultPulseIntervalFull;
        }

        await this.log(`Mode for ${currentDisplayName} set to ${this.mode}. New interval: ${this.currentPulseInterval}ms. Restarting monitor...`, 'system');
        await this.start();
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            const accountIdentifier = this.displayName || this.username;
            this.log(`Heartbeat Monitor stopped for ${accountIdentifier}.`, 'system');
        }
    }
}


// Main execution block (typically in server.js or a separate main.js, but kept here as per original structure)
// This part should be moved or adapted if you are running this primarily via server.js
// For now, commenting out direct execution from index.js if server.js is the entry point.

/*
try {
    const configPath = path.join(__dirname, 'config.json'); // Ensure config.json is in the same directory or adjust path
    if (!fs.existsSync(configPath)) {
        console.log(chalk.yellow(`Configuration file not found at ${configPath}. Creating a default one.`));
        const defaultConfig = {
            accounts: [{
                username: "DefaultAccount",
                robloxCookie: "YOUR_ROBLOX_COOKIE_HERE",
                pulseInterval: 30000, // For full mode
                enableLogging: true,
                mode: "full"
            }],
            globalConfig: {
                retryAttempts: 3,
                retryDelay: 5000,
                defaultPulseIntervalFull: 30000,
                pulseIntervalPartial: 572123 
            }
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(chalk.green(`Default config.json created. Please edit it with your account details.`));
        process.exit(0);
    }


    const manager = new AccountManager(configPath);

    manager.startAll().then(() => {
        // Optional: Periodic status logging to console if not running via server
        // setInterval(async () => {
        //     await manager.fetchAllPresences(); // Keep presence data fresh for status
        //     const status = manager.getStatus();
        //     console.log(chalk.blue('--- Account Status Update ---'));
        //     for (const accName in status) {
        //         const acc = status[accName];
        //         console.log(chalk.whiteBright(`${acc.displayName || acc.username}: Mode=${acc.mode}, Active=${acc.isActive}, LastPulse=${acc.lastPulse ? moment(acc.lastPulse).fromNow() : 'N/A'}`));
        //     }
        //     console.log(chalk.blue('---------------------------'));
        // }, 60000); // Log status every minute
    }).catch(error => {
        console.error(chalk.red('Critical error during manager startup:'), error);
    });

    process.on('SIGINT', async () => {
        console.log(chalk.magenta('SIGINT received. Stopping all monitors...'));
        await manager.stopAll();
        console.log(chalk.magenta('All monitors stopped. Exiting.'));
        process.exit(0);
    });

} catch (error) {
    console.error(chalk.bgRed.whiteBright('APPLICATION FAILED TO INITIALIZE:'), error.message);
    if (error.stack) {
        console.error(error.stack);
    }
    process.exit(1);
}
*/

module.exports = { AccountManager, RobloxHeartbeatMonitor }; // Export classes for server.js