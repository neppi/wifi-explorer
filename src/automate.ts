import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { DatabaseManager, NetworkInfo, ClientInfo, ScanResult } from './database';

// Load environment variables from .env file
dotenv.config();

class WiFiScanner {
  private wifiInterface: string;
  private capturesDir: string;
  private scanProcess: ChildProcess | null = null;
  private dbManager: DatabaseManager;

  constructor() {
    this.wifiInterface = process.env.WIFI_INTERFACE || '';
    if (!this.wifiInterface) {
      throw new Error('WIFI_INTERFACE environment variable is not set');
    }
    this.capturesDir = path.join(__dirname, '..', 'captures');
    this.dbManager = new DatabaseManager();
  }

  /**
   * Set interface to monitor mode
   */
  private async setMonitorMode(): Promise<void> {
    console.log(`🔧 Setting ${this.wifiInterface} to monitor mode...`);
    
    return new Promise((resolve, reject) => {
      const down = spawn('sudo', ['ip', 'link', 'set', this.wifiInterface, 'down']);
      
      down.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to bring interface down`));
          return;
        }
        
        const monitor = spawn('sudo', ['iw', 'dev', this.wifiInterface, 'set', 'type', 'monitor']);
        
        monitor.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Failed to set monitor mode`));
            return;
          }
          
          const up = spawn('sudo', ['ip', 'link', 'set', this.wifiInterface, 'up']);
          
          up.on('close', (code) => {
            if (code === 0) {
              console.log('✅ Monitor mode enabled');
              resolve();
            } else {
              reject(new Error(`Failed to bring interface up`));
            }
          });
        });
      });
    });
  }

  /**
   * Set interface back to managed mode
   */
  private async setManagedMode(): Promise<void> {
    console.log(`🔧 Setting ${this.wifiInterface} back to managed mode...`);
    
    return new Promise((resolve, reject) => {
      const down = spawn('sudo', ['ip', 'link', 'set', this.wifiInterface, 'down']);
      
      down.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to bring interface down`));
          return;
        }
        
        const managed = spawn('sudo', ['iw', 'dev', this.wifiInterface, 'set', 'type', 'managed']);
        
        managed.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Failed to set managed mode`));
            return;
          }
          
          const up = spawn('sudo', ['ip', 'link', 'set', this.wifiInterface, 'up']);
          
          up.on('close', (code) => {
            if (code === 0) {
              console.log('✅ Managed mode enabled');
              resolve();
            } else {
              reject(new Error(`Failed to bring interface up`));
            }
          });
        });
      });
    });
  }

  /**
   * Run airodump-ng scan for specified duration
   */
  private async runScan(durationSeconds: number): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPrefix = path.join(this.capturesDir, `scan-${timestamp}`);
    
    // Ensure captures directory exists
    await fs.mkdir(this.capturesDir, { recursive: true });
    
    console.log(`\n📡 Starting WiFi scan for ${durationSeconds} seconds...`);
    console.log(`   Interface: ${this.wifiInterface}`);
    console.log(`   Output: ${outputPrefix}`);
    
    return new Promise((resolve, reject) => {
      this.scanProcess = spawn('sudo', [
        'airodump-ng',
        '--write', outputPrefix,
        '--output-format', 'csv',
        '--write-interval', '1',
        this.wifiInterface
      ]);

      let errorOutput = '';
      let timeoutHandle: NodeJS.Timeout;
      
      this.scanProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      this.scanProcess.stdout?.on('data', (data) => {
        // Airodump-ng outputs to stdout, we can show progress
        process.stdout.write('.');
      });

      // Set timeout to stop scan
      timeoutHandle = setTimeout(async () => {
        if (this.scanProcess && this.scanProcess.pid) {
          try {
            // Use pkill with sudo to kill the airodump-ng process
            const killProcess = spawn('sudo', ['pkill', '-SIGINT', 'airodump-ng']);
            
            // Wait a moment for graceful shutdown
            await new Promise(res => setTimeout(res, 500));
            
            // If still running, force kill
            if (this.scanProcess && !this.scanProcess.killed) {
              spawn('sudo', ['pkill', '-9', 'airodump-ng']);
            }
          } catch (err) {
            console.warn('Warning: Could not gracefully stop scan process');
          }
        }
      }, durationSeconds * 1000);

      this.scanProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        console.log('\n✅ Scan completed');
        
        if (code !== 0 && code !== null && code !== 2) {
          // Code 2 is normal for SIGINT termination
          console.error(`Error output: ${errorOutput}`);
          reject(new Error(`Scan failed with code ${code}`));
        } else {
          resolve(`${outputPrefix}-01.csv`);
        }
      });

      this.scanProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Perform a complete scan cycle
   */
  async scan(durationSeconds: number = 60): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Set monitor mode
      await this.setMonitorMode();
      
      // Run scan
      const csvPath = await this.runScan(durationSeconds);
      
      // Parse results
      console.log(`\n📄 Parsing scan results...`);
      const { networks, clients } = await this.dbManager.parseCsvFile(csvPath);
      
      console.log(`   Found ${networks.length} networks`);
      console.log(`   Found ${clients.length} clients`);
      
      // Create scan result
      const scanResult: ScanResult = {
        timestamp: new Date().toISOString(),
        duration: Math.round((Date.now() - startTime) / 1000),
        networks,
        clients
      };
      
      // Update database
      await this.dbManager.updateDatabase(scanResult);
      
      // Print summary
      this.printSummary(networks, clients);
      
    } catch (error) {
      console.error('❌ Scan failed:', error);
      throw error;
    } finally {
      // Always try to restore managed mode
      try {
        await this.setManagedMode();
      } catch (error) {
        console.error('⚠️  Failed to restore managed mode:', error);
      }
    }
  }

  /**
   * Print summary of scan results
   */
  private printSummary(networks: NetworkInfo[], clients: ClientInfo[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 SCAN SUMMARY');
    console.log('='.repeat(80));
    
    if (networks.length > 0) {
      console.log('\n🌐 Networks:');
      console.log('-'.repeat(80));
      
      const sorted = networks
        .filter(n => n.essid && n.essid.trim())
        .sort((a, b) => parseInt(b.power) - parseInt(a.power));
      
      for (const network of sorted.slice(0, 10)) {
        console.log(`   ${network.essid.padEnd(25)} | ${network.bssid} | Ch: ${network.channel.padEnd(3)} | Pwr: ${network.power.padEnd(4)} | ${network.privacy}`);
      }
      
      if (sorted.length > 10) {
        console.log(`   ... and ${sorted.length - 10} more networks`);
      }
    }
    
    if (clients.length > 0) {
      console.log('\n👤 Active Clients:');
      console.log('-'.repeat(80));
      
      const activeClients = clients
        .filter(c => c.bssid && c.bssid !== '(not associated)')
        .slice(0, 10);
      
      for (const client of activeClients) {
        console.log(`   ${client.stationMac} -> ${client.bssid} | Pwr: ${client.power.padEnd(4)} | Pkts: ${client.packets}`);
      }
      
      if (clients.length > 10) {
        console.log(`   ... and ${clients.length - 10} more clients`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
  }

  /**
   * Export database statistics
   */
  async getStats(): Promise<void> {
    await this.dbManager.getStats();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'scan';
  const duration = parseInt(args[1]) || 60;

  const scanner = new WiFiScanner();

  try {
    if (command === 'scan') {
      await scanner.scan(duration);
    } else if (command === 'stats') {
      await scanner.getStats();
    } else {
      console.log('Usage:');
      console.log('  yarn scan [duration]  - Scan for WiFi networks (default: 60 seconds)');
      console.log('  yarn stats            - Show database statistics');
      console.log('\nMake sure to set WIFI_INTERFACE environment variable!');
      console.log('Example: WIFI_INTERFACE=wlxc83a35ca40e1 yarn scan 120');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { WiFiScanner };
export { DatabaseManager, NetworkInfo, ClientInfo, ScanResult } from './database';
