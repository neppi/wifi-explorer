import { promises as fs } from 'fs';
import path from 'path';

export interface NetworkInfo {
  bssid: string;
  firstSeen: string;
  lastSeen: string;
  channel: string;
  speed: string;
  privacy: string;
  cipher: string;
  authentication: string;
  power: string;
  beacons: string;
  iv: string;
  lanIp: string;
  idLength: string;
  essid: string;
  key: string;
}

export interface ClientInfo {
  stationMac: string;
  firstSeen: string;
  lastSeen: string;
  power: string;
  packets: string;
  bssid: string;
  probedEssids: string;
}

export interface ScanResult {
  timestamp: string;
  duration: number;
  networks: NetworkInfo[];
  clients: ClientInfo[];
}

export interface Database {
  scans: ScanResult[];
  uniqueNetworks: Map<string, NetworkInfo>;
  uniqueClients: Map<string, ClientInfo>;
}

export class DatabaseManager {
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'wifi-scan-db.json');
  }

  /**
   * Load existing database or create new one
   */
  async loadDatabase(): Promise<Database> {
    try {
      const data = await fs.readFile(this.dbPath, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        scans: parsed.scans || [],
        uniqueNetworks: new Map(Object.entries(parsed.uniqueNetworks || {})),
        uniqueClients: new Map(Object.entries(parsed.uniqueClients || {}))
      };
    } catch (error) {
      // If file doesn't exist, return empty database
      return {
        scans: [],
        uniqueNetworks: new Map(),
        uniqueClients: new Map()
      };
    }
  }

  /**
   * Save database to disk
   */
  async saveDatabase(db: Database): Promise<void> {
    const serializable = {
      scans: db.scans,
      uniqueNetworks: Object.fromEntries(db.uniqueNetworks),
      uniqueClients: Object.fromEntries(db.uniqueClients)
    };
    await fs.writeFile(this.dbPath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  /**
   * Update database with new scan results
   */
  async updateDatabase(scanResult: ScanResult): Promise<Database> {
    const db = await this.loadDatabase();
    
    // Add scan to history
    db.scans.push(scanResult);
    
    // Update unique networks (use latest info if BSSID exists)
    for (const network of scanResult.networks) {
      db.uniqueNetworks.set(network.bssid, network);
    }
    
    // Update unique clients
    for (const client of scanResult.clients) {
      db.uniqueClients.set(client.stationMac, client);
    }
    
    await this.saveDatabase(db);
    
    console.log(`\n📊 Database updated:`);
    console.log(`   Total scans: ${db.scans.length}`);
    console.log(`   Unique networks: ${db.uniqueNetworks.size}`);
    console.log(`   Unique clients: ${db.uniqueClients.size}`);

    return db;
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<void> {
    const db = await this.loadDatabase();
    
    console.log('\n' + '='.repeat(80));
    console.log('📈 DATABASE STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total scans performed: ${db.scans.length}`);
    console.log(`Unique networks discovered: ${db.uniqueNetworks.size}`);
    console.log(`Unique clients seen: ${db.uniqueClients.size}`);
    
    if (db.scans.length > 0) {
      const latest = db.scans[db.scans.length - 1];
      console.log(`\nLast scan: ${new Date(latest.timestamp).toLocaleString()}`);
      console.log(`Duration: ${latest.duration}s`);
      console.log(`Networks found: ${latest.networks.length}`);
      console.log(`Clients found: ${latest.clients.length}`);
    }
    
    if (db.uniqueNetworks.size > 0) {
      console.log('\n🌐 Top Networks by Power:');
      console.log('-'.repeat(80));
      
      const sorted = Array.from(db.uniqueNetworks.values())
        .filter(n => n.essid && n.essid.trim() && n.power)
        .sort((a, b) => parseInt(b.power) - parseInt(a.power))
        .slice(0, 15);
      
      for (const network of sorted) {
        console.log(`   ${network.essid.padEnd(25)} | ${network.bssid} | Ch: ${network.channel.padEnd(3)} | Pwr: ${network.power.padEnd(4)} | ${network.privacy}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
  }

  /**
   * Parse airodump-ng CSV output line
   */
  parseCsvLine(line: string, isClient: boolean = false): NetworkInfo | ClientInfo | null {
    const parts = line.split(',').map(p => p.trim());
    
    if (isClient) {
      // Client format: Station MAC, First time seen, Last time seen, Power, # packets, BSSID, Probed ESSIDs
      if (parts.length < 6 || !parts[0] || parts[0] === 'Station MAC') return null;
      
      return {
        stationMac: parts[0],
        firstSeen: parts[1] || '',
        lastSeen: parts[2] || '',
        power: parts[3] || '',
        packets: parts[4] || '',
        bssid: parts[5] || '(not associated)',
        probedEssids: parts.slice(6).join(',').trim()
      } as ClientInfo;
    } else {
      // Network format: BSSID, First time seen, Last time seen, channel, Speed, Privacy, Cipher, Authentication, Power, # beacons, # IV, LAN IP, ID-length, ESSID, Key
      if (parts.length < 14 || !parts[0] || parts[0] === 'BSSID') return null;
      
      return {
        bssid: parts[0],
        firstSeen: parts[1] || '',
        lastSeen: parts[2] || '',
        channel: parts[3] || '',
        speed: parts[4] || '',
        privacy: parts[5] || '',
        cipher: parts[6] || '',
        authentication: parts[7] || '',
        power: parts[8] || '',
        beacons: parts[9] || '',
        iv: parts[10] || '',
        lanIp: parts[11] || '',
        idLength: parts[12] || '',
        essid: parts[13] || '',
        key: parts[14] || ''
      } as NetworkInfo;
    }
  }

  /**
   * Parse the airodump-ng CSV file
   */
  async parseCsvFile(csvPath: string): Promise<{ networks: NetworkInfo[], clients: ClientInfo[] }> {
    const fileContent = await fs.readFile(csvPath, 'utf-8');
    const lines = fileContent.split('\n');
    
    const networks: NetworkInfo[] = [];
    const clients: ClientInfo[] = [];
    let isClientSection = false;

    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Check if we've reached the client section
      if (line.includes('Station MAC')) {
        isClientSection = true;
        continue;
      }

      if (isClientSection) {
        const client = this.parseCsvLine(line, true);
        if (client) clients.push(client as ClientInfo);
      } else {
        const network = this.parseCsvLine(line, false);
        if (network) networks.push(network as NetworkInfo);
      }
    }

    return { networks, clients };
  }
}
