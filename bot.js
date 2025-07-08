import blessed from 'blessed';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ProxyChain from 'proxy-chain';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const formatTime = (date) => {
    return date.toTimeString().split(' ')[0];
};

class NexusMiner {
    constructor(account, id, proxy = null, proxyIp = null) {
        this.account = account;
        this.id = id;
        this.proxy = proxy || 'None';
        this.proxyIp = proxyIp || 'Unknown';
        this.userInfo = {
            address: account.address || '-',
            points: '-',
            ip: 'Unknown',
            proxy: this.proxy,
            ops: 'N/A',
            status: 'INACTIVE',
        };
        this.isMining = false;
        this.miningInterval = null;
        this.toggleCheckInterval = null;
        this.uiScreen = null;
        this.accountPane = null;
        this.logPane = null;
        this.isDisplayed = false;
        this.logs = [];
        this.browser = null;
        this.page = null;
        this.anonymizedProxy = null;
    }

    async start() {
        this.addLog(chalk.cyan(`Booting account [${this.id}] session...`));
        if (!(await this.checkConnection())) {
            this.addLog(chalk.yellow(`[${this.id}] Initial connection check failed. Using direct connection...`));
            this.proxy = 'None';
            this.userInfo.proxy = 'None';
        }
        await this.initPuppeteer();
        await this.loginWithRetry();
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.fetchUserInfo();
        await this.fetchIpAddress();
        this.refreshDisplay();
        this.addLog(chalk.green(`Account [${this.id}] initialized successfully`));
    }

    async checkConnection(maxRetries = 3) {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                this.addLog(chalk.cyan(`[${this.id}] Checking network connectivity (Attempt ${retries + 1})...`));
                const config = this.proxy !== 'None' ? { proxy: this.parseProxy(this.proxy) } : {};
                await axios.get('https://app.nexus.xyz/', { ...config, timeout: 20000 });
                this.addLog(chalk.green(`[${this.id}] Network connection verified`));
                return true;
            } catch (error) {
                retries++;
                this.addLog(chalk.red(`[${this.id}] Network connection attempt ${retries} failed: ${error.message}`));
                if (retries === maxRetries) return false;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        return false;
    }

    parseProxy(proxy) {
        try {
            const proxyUrl = new URL(proxy);
            return {
                host: proxyUrl.hostname,
                port: parseInt(proxyUrl.port),
                auth: proxyUrl.username && proxyUrl.password ? {
                    username: proxyUrl.username,
                    password: proxyUrl.password,
                } : undefined,
            };
        } catch (error) {
            this.addLog(chalk.red(`[${this.id}] Failed to parse proxy ${proxy}: ${error.message}`));
            return null;
        }
    }

    async initPuppeteer() {
        const launchOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        };
        
        if (this.proxy !== 'None') {
            try {
                this.anonymizedProxy = await ProxyChain.anonymizeProxy(this.proxy);
                launchOptions.args.push(`--proxy-server=${this.anonymizedProxy}`);
            } catch (error) {
                this.addLog(chalk.red(`[${this.id}] Failed to anonymize proxy ${this.proxy}: ${error.message}`));
                this.proxy = 'None';
                this.userInfo.proxy = 'None';
            }
        }
        
        try {
            this.browser = await puppeteer.launch(launchOptions);
            this.page = await this.browser.newPage();
            await this.page.setUserAgent(this.getRandomUserAgent());
            await this.page.setViewport({ width: 1280, height: 720 });
            await this.page._client().send('Network.clearBrowserCache');
            await this.page._client().send('Network.clearBrowserCookies');
        } catch (error) {
            this.addLog(chalk.red(`[${this.id}] Failed to initialize browser: ${error.message}`));
            throw error;
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.page._client().send('Network.clearBrowserCache');
                await this.page._client().send('Network.clearBrowserCookies');
                await this.browser.close();
                this.addLog(chalk.yellow(`[${this.id}] Browser closed`));
            } catch (error) {
                this.addLog(chalk.red(`[${this.id}] Failed to close browser: ${error.message}`));
            }
            this.browser = null;
            this.page = null;
        }
        if (this.anonymizedProxy) {
            await ProxyChain.closeAnonymizedProxy(this.anonymizedProxy, true).catch(() => {});
            this.anonymizedProxy = null;
        }
    }

    async loginWithRetry(maxRetries = 3) {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                this.addLog(chalk.cyan(`[${this.id}] Accessing Nexus miner panel...`));
                await this.page.goto('https://app.nexus.xyz/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                const pageContent = await this.page.content();
                if (pageContent.includes('captcha') || pageContent.includes('verify you are not a bot') || 
                    pageContent.includes('Access Denied') || pageContent.includes('403 Forbidden')) {
                    this.addLog(chalk.red(`[${this.id}] CAPTCHA or access error detected`));
                    await this.page.screenshot({ path: `error-captcha-${this.id}-${Date.now()}.png` });
                    throw new Error('CAPTCHA or access error');
                }

                this.addLog(chalk.cyan(`[${this.id}] Processing login credentials...`));
                await this.page.evaluate((authToken, minAuthToken) => {
                    localStorage.setItem('dynamic_authentication_token', authToken);
                    localStorage.setItem('dynamic_min_authentication_token', minAuthToken);
                }, this.account.auth_token, this.account.min_auth_token);
                
                await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                const loginSuccess = await Promise.race([
                    this.page.waitForSelector('#balance-display span', { timeout: 30000 }).then(() => true),
                    this.page.waitForSelector('#connect-toggle-button', { timeout: 30000 }).then(() => true),
                ]).catch(() => false);

                if (!loginSuccess) {
                    this.addLog(chalk.red(`[${this.id}] Dashboard elements not found`));
                    await this.page.screenshot({ path: `error-dashboard-${this.id}-${Date.now()}.png` });
                    throw new Error('No dashboard elements found');
                }

                this.addLog(chalk.green(`[${this.id}] Login successful`));
                return;
            } catch (error) {
                retries++;
                this.addLog(chalk.red(`[${this.id}] Login attempt ${retries} failed: ${error.message}`));
                if (retries === maxRetries) {
                    this.addLog(chalk.red(`[${this.id}] Max login retries reached. Please check token or network.`));
                    await this.page.screenshot({ path: `error-login-${this.id}-${Date.now()}.png` });
                    throw new Error('Login failed after maximum retries');
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
                this.addLog(chalk.yellow(`[${this.id}] Retrying login...`));
            }
        }
    }

    async fetchUserInfo(maxRetries = 4) {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                this.addLog(chalk.cyan(`[${this.id}] Fetching user points...`));
                await this.page.goto('https://app.nexus.xyz/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 6000));
                
                const pointsSelectors = ['#balance-display span', '.balance-display', '[data-testid="balance"]'];
                let points = '-';
                
                for (const selector of pointsSelectors) {
                    try {
                        points = await this.page.$eval(selector, el => el.textContent.trim());
                        if (points) break;
                    } catch (e) { }
                }
                
                if (points === '-') throw new Error('Points data Not Found');
                
                this.userInfo.points = points;
                this.addLog(chalk.green(`[${this.id}] Points fetched successfully`));
                this.refreshDisplay();
                return;
            } catch (error) {
                retries++;
                this.addLog(chalk.red(`[${this.id}] Fetch points attempt ${retries} failed: ${error.message}`));
                if (retries === maxRetries) {
                    this.addLog(chalk.red(`[${this.id}] Max retries for fetching points. Points set to "-".`));
                    this.userInfo.points = '-';
                    await this.page.screenshot({ path: `error-fetchpoints-${this.id}-${Date.now()}.png` });
                    this.refreshDisplay();
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    async fetchIpAddress() {
        if (this.proxy !== 'None') {
            try {
                const config = { proxy: this.parseProxy(this.proxy) };
                const response = await axios.get('https://api.ipify.org?format=json', { ...config, timeout: 20000 });
                this.userInfo.ip = response.data.ip || this.proxyIp || 'Unknown';
                this.refreshDisplay();
                return;
            } catch (error) {
                this.addLog(chalk.red(`[${this.id}] Failed to fetch IP with proxy: ${error.message}`));
            }
        }
        
        try {
            const response = await axios.get('https://api.ipify.org?format=json', { timeout: 20000 });
            this.userInfo.ip = response.data.ip || 'Unknown';
            this.refreshDisplay();
        } catch (error) {
            this.userInfo.ip = 'Unknown';
            this.addLog(chalk.red(`[${this.id}] Failed to fetch IP without proxy: ${error.message}`));
            this.refreshDisplay();
        }
    }

    async refreshAccount() {
        this.addLog(chalk.cyan(`[${this.id}] Refreshing account...`));
        try {
            await this.stopMining(); 
            await this.closeBrowser(); 
            await this.initPuppeteer(); 
            await this.loginWithRetry(); 
            await new Promise(resolve => setTimeout(resolve, 10000));
            await this.fetchUserInfo(); 
            await this.fetchIpAddress(); 
            this.refreshDisplay(); 
            this.addLog(chalk.green(`[${this.id}] Account refreshed successfully`));
        } catch (error) {
            this.addLog(chalk.red(`[${this.id}] Failed to refresh account: ${error.message}`));
        }
    }

    async startMining() {
        if (this.isMining) {
            this.addLog(chalk.yellow(`[${this.id}] Mining already active`));
            return;
        }
        
        this.addLog(chalk.cyan(`[${this.id}] Activating Mining Process...`));
        let retries = 0;
        const maxRetries = 3;
        let toggleFound = false;

        while (retries < maxRetries && !toggleFound) {
            try {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const toggleStatus = await this.page.evaluate(() => {
                    let toggle = document.querySelector('#connect-toggle-button');
                    if (toggle) {
                        const isOff = toggle.classList.contains('border-[#79747E]');
                        if (isOff) toggle.click();
                        return { found: true, wasOff: isOff };
                    }
                    return { found: false, message: 'Toggle button not found' };
                });

                if (!toggleStatus.found) throw new Error(toggleStatus.message);

                toggleFound = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.addLog(toggleStatus.wasOff ? chalk.green(`[${this.id}] Mining Activated Successfully`) : chalk.cyan(`[${this.id}] Mining Already Active`));
                this.isMining = true;
                this.userInfo.status = 'ACTIVE';
                this.refreshDisplay();

                this.miningInterval = setInterval(() => {
                    this.updateOps();
                    this.updatePoints();
                }, 30000);

                this.addLog(chalk.green(`[${this.id}] Mining started`));
            } catch (error) {
                retries++;
                this.addLog(chalk.red(`[${this.id}] Start mining attempt ${retries} failed: ${error.message}`));
                if (retries === maxRetries) {
                    this.addLog(chalk.red(`[${this.id}] Max retries reached for start mining.`));
                    this.userInfo.status = 'INACTIVE';
                    this.refreshDisplay();
                    return;
                }
            }
        }
    }

    async stopMining() {
        if (!this.isMining) {
            this.addLog(chalk.yellow(`[${this.id}] Mining not active`));
            return;
        }
        
        this.addLog(chalk.cyan(`[${this.id}] Stopping Mining Process...`));
        try {
            this.isMining = false;
            this.userInfo.status = 'INACTIVE';
            
            if (this.miningInterval) {
                clearInterval(this.miningInterval);
                this.miningInterval = null;
            }
            if (this.toggleCheckInterval) {
                clearInterval(this.toggleCheckInterval);
                this.toggleCheckInterval = null;
            }
            
            this.userInfo.ops = 'N/A';
            this.refreshDisplay();
            this.addLog(chalk.yellow(`[${this.id}] Mining stopped`));
        } catch (error) {
            this.addLog(chalk.red(`[${this.id}] Failed to stop mining: ${error.message}`));
            this.userInfo.status = 'INACTIVE';
            this.refreshDisplay();
        }
    }

    async updateOps() {
        if (!this.page) return;
        try {
            const ops = await this.page.$eval('#speed-display', el => el.textContent.trim());
            this.userInfo.ops = ops;
        } catch (error) {
            this.userInfo.ops = 'N/A';
        }
        this.refreshDisplay();
    }

    async updatePoints() {
        if (!this.page) return;
        try {
            const points = await this.page.$eval('#balance-display span', el => el.textContent.trim());
            this.userInfo.points = points;
        } catch (error) {
        }
        this.refreshDisplay();
    }

    clearLogs() {
        this.logs = [];
        if (this.logPane) {
            this.logPane.setContent('');
            this.uiScreen.render();
        }
        this.addLog(chalk.yellow('Logs cleared'));
    }

    getRandomUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        ];
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    addLog(message) {
        const timestamp = formatTime(new Date());
        const logMessage = `[${timestamp}] ${message.replace(/\{[^}]+\}/g, '')}`; 
        this.logs.push(logMessage);
        if (this.logs.length > 200) this.logs.shift();
        if (this.logPane && this.isDisplayed) {
            this.logPane.log(`[${timestamp}] ${message}`); 
            this.uiScreen.render();
        }
    }

    refreshDisplay() {
        if (!this.isDisplayed || !this.accountPane || !this.logPane) return;
        
        const statusColor = this.userInfo.status === 'ACTIVE' ? '{green-fg}' : '{yellow-fg}';
        const info = 
            `  ACCOUNT DETAILS [${this.id}]\n` +
            `  ----------------------------------------------------------------\n` +
            `  Address         : {magenta-fg}${this.userInfo.address}{/magenta-fg}\n` +
            `  Points          : {green-fg}${this.userInfo.points}{/green-fg}\n` +
            `  Status          : ${statusColor}${this.userInfo.status}{/}\n` +
            `  IP Address      : {cyan-fg}${this.userInfo.ip}{/cyan-fg}\n` +
            `  Proxy           : {cyan-fg}${this.userInfo.proxy}{/cyan-fg}`;
        
        this.accountPane.setContent(info);
        
        this.logPane.setContent('');
        this.logs.forEach(log => this.logPane.log(log)); 
        
        this.uiScreen.render();
    }

    static async loadAccounts() {
        try {
            const filePath = path.join(__dirname, 'account.json');
            const data = await fs.readFile(filePath, 'utf8');
            const accounts = JSON.parse(data);
            if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('account.json is empty or not an array');
            accounts.forEach(acc => {
                if (!acc.address || !acc.auth_token || !acc.min_auth_token) throw new Error('Account missing required fields');
            });
            return accounts.map((account, index) => ({ id: index + 1, ...account }));
        } catch (error) {
            throw new Error(`Failed to load account.json: ${error.message}`);
        }
    }
}

async function main() {
    const screen = blessed.screen({
        smartCSR: true,
        title: 'NEXUS MINER TERMINAL',
        fullUnicode: true,
    });

const asciiArt = 
`{cyan-fg}███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗    ███╗   ███╗██╗███╗   ██╗███████╗██████╗ 
████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝    ████╗ ████║██║████╗  ██║██╔════╝██╔══██╗
██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗    ██╔████╔██║██║██╔██╗ ██║█████╗  ██████╔╝
██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║    ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██╔══██╗
██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║    ██║ ╚═╝ ██║██║██║ ╚████║███████╗██║  ██║
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝\n{/cyan-fg}{white-fg}@ByAutodropCentral{/white-fg}`;

    const headerBox = blessed.box({
        top: 0,
        left: 'center',
        width: '100%',
        height: 10,
        tags: true,
        content: asciiArt
    });
    screen.append(headerBox);

    const accountPane = blessed.box({
        top: 7,
        left: 0,
        width: '100%',
        height: 8,
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'white' } }
    });
    screen.append(accountPane);

    const logPane = blessed.log({
        top: 15,
        left: 0,
        width: '100%',
        height: screen.height - 15 - 5,
        tags: true,
        scrollable: true,
        mouse: true,
        keys: true,
        scrollbar: { bg: 'blue' },
        border: { type: 'line' },
        style: { border: { fg: 'white' } }
    });
    screen.append(logPane);

    const footerPane = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 5,
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'white' } }
    });
    screen.append(footerPane);

    let accounts = [];
    try {
        accounts = await NexusMiner.loadAccounts();
    } catch (error) {
        logPane.log(chalk.red(error.message));
        logPane.log('Press "q" or Ctrl+C to exit.');
        screen.render();
        screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
        return;
    }

    let activeIndex = 0;
    const miners = accounts.map((account, index) => new NexusMiner(account, index + 1));

    const updateFooter = (status = 'AWAITING INPUT') => {
        const footerContent = 
            `\n  ------------------------------------------------------------------\n` +
            `  STATUS          : {yellow-fg}${status}{/yellow-fg}\n` +
            `  ACTIVE USER     : ${activeIndex + 1} of ${miners.length}\n` +
            `  NAVIGATION      : [←/→] Switch | [Q] Quit\n` +
            `==================================================================`;
        footerPane.setContent(footerContent);
        screen.render();
    };

    miners.forEach(miner => {
        miner.uiScreen = screen;
        miner.accountPane = accountPane;
        miner.logPane = logPane;
    });

    const switchAccount = (newIndex) => {
        if (miners.length === 0) return;
        miners[activeIndex].isDisplayed = false;
        activeIndex = newIndex;
        miners[activeIndex].isDisplayed = true;
        miners[activeIndex].refreshDisplay();
        updateFooter('MONITORING');
    };

    const runAutomation = async (choice) => {
        const firstMiner = miners[0];
        switch (choice) {
            case 1:
                firstMiner.addLog(chalk.bgCyan.black(' AUTOMATION: STARTING ALL ACCOUNTS '));
                updateFooter('STARTING ALL...');
                for (const miner of miners) {
                    await miner.start();
                    await miner.startMining();
                }
                firstMiner.addLog(chalk.bgGreen.black(' AUTOMATION: ALL ACCOUNTS STARTED '));
                updateFooter('MONITORING');
                break;
            case 2:
                firstMiner.addLog(chalk.bgCyan.black(' AUTOMATION: REFRESHING ALL ACCOUNTS '));
                updateFooter('REFRESHING ALL...');
                for (const miner of miners) {
                    await miner.refreshAccount();
                }
                firstMiner.addLog(chalk.bgGreen.black(' AUTOMATION: ALL ACCOUNTS REFRESHED '));
                updateFooter('MONITORING');
                break;
            case 3:
                firstMiner.addLog(chalk.bgYellow.black(' AUTOMATION: STOPPING ALL ACCOUNTS '));
                updateFooter('STOPPING ALL...');
                for (const miner of miners) {
                    await miner.stopMining();
                }
                firstMiner.addLog(chalk.bgGreen.black(' AUTOMATION: ALL ACCOUNTS STOPPED '));
                updateFooter('READY');
                break;
            case 4:
                screen.emit('key', 'q');
                break;
        }
    };

    if (miners.length > 0) {
        miners[0].isDisplayed = true;
        miners[0].refreshDisplay();
        updateFooter();
    } else {
        logPane.log('No valid accounts found.');
        updateFooter('NO ACCOUNTS');
    }

    screen.key(['escape', 'q', 'C-c'], async () => {
        logPane.log(chalk.yellow('Shutting down all miners and closing browsers...'));
        for (const miner of miners) {
            await miner.stopMining();
            await miner.closeBrowser();
        }
        screen.destroy();
        process.exit(0);
    });

    screen.key(['right'], () => switchAccount((activeIndex + 1) % miners.length));
    screen.key(['left'], () => switchAccount((activeIndex - 1 + miners.length) % miners.length));

    const options = [
        '1. Start All Accounts', 
        '2. Refresh All Accounts', 
        '3. Stop All Accounts', 
        '4. Exit'
    ];
    
    const menu = blessed.list({
        parent: screen,
        top: 'center', left: 'center', width: '50%', height: options.length + 2,
        border: 'line', label: ' Select Automation ',
        style: { border: { fg: 'cyan' }, selected: { bg: 'blue' }, item: { fg: 'yellow' } },
        keys: true, mouse: true, items: options,
    });

    menu.on('select', async (item) => {
        const choice = parseInt(item.content.split('.')[0]);
        menu.destroy();
        await runAutomation(choice);
    });
    
    menu.focus();
    screen.render();

    screen.on('resize', () => {
        logPane.height = screen.height - 15 - 5;
        screen.render();
    });
}

main().catch(error => {
    console.error(chalk.red('A critical error occurred:'));
    console.error(error);
    process.exit(1);
});