import { spawn } from 'child_process';

/**
 * Set WiFi interface to monitor mode
 */
export async function setMonitorMode(wifiInterface: string): Promise<void> {
  console.log(`🔧 Setting ${wifiInterface} to monitor mode...`);
  
  return new Promise((resolve, reject) => {
    const down = spawn('sudo', ['ip', 'link', 'set', wifiInterface, 'down']);
    
    down.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to bring interface down`));
        return;
      }
      
      const monitor = spawn('sudo', ['iw', 'dev', wifiInterface, 'set', 'type', 'monitor']);
      
      monitor.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to set monitor mode`));
          return;
        }
        
        const up = spawn('sudo', ['ip', 'link', 'set', wifiInterface, 'up']);
        
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
 * Set WiFi interface back to managed mode
 */
export async function setManagedMode(wifiInterface: string): Promise<void> {
  console.log(`🔧 Setting ${wifiInterface} back to managed mode...`);
  
  return new Promise((resolve, reject) => {
    const down = spawn('sudo', ['ip', 'link', 'set', wifiInterface, 'down']);
    
    down.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to bring interface down`));
        return;
      }
      
      const managed = spawn('sudo', ['iw', 'dev', wifiInterface, 'set', 'type', 'managed']);
      
      managed.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to set managed mode`));
          return;
        }
        
        const up = spawn('sudo', ['ip', 'link', 'set', wifiInterface, 'up']);
        
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
