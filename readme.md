# WiFi Explorer

Automated WiFi network scanning and analysis tool using airodump-ng with TypeScript.

## Features

- 🔄 Automated WiFi network scanning
- 📊 Local JSON database for aggregating scan results
- 🎯 Track unique networks and clients over time
- 📈 Statistics and reporting
- 🔧 Environment variable configuration for interface names
- 🚀 Easy-to-use CLI commands

## Prerequisites

- Ubuntu/Linux system
- WiFi adapter capable of monitor mode
- `aircrack-ng` suite installed
- Node.js and Yarn

```bash
# Install aircrack-ng
sudo apt-get install aircrack-ng

# Install Node.js and Yarn
sudo apt-get install nodejs yarn
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure your WiFi interface:**
   
   **Option A: Using .env file (recommended):**
   ```bash
   # Copy the example file
   cp .env.example .env
   
   # Edit .env and set your interface
   # WIFI_INTERFACE=wlxc83a35ca40e1
   ```
   
   **Option B: Using environment variable:**
   ```bash
   # Find your WiFi interface name
   ip link show
   # or
   iwconfig
   
   # Set the environment variable
   export WIFI_INTERFACE=wlxc83a35ca40e1  # Replace with your interface
   ```

3. **Build the project:**
   ```bash
   yarn build
   ```

## Usage

### Automated Scanning

**Run a 60-second scan (default):**
```bash
yarn scan
```

**Quick 30-second scan:**
```bash
yarn scan:quick
```

**Long 5-minute scan:**
```bash
yarn scan:long
```

**Custom duration:**
```bash
yarn build && node dist/automate.js scan 120
```

**View statistics:**
```bash
yarn stats
```

### What the Scanner Does

1. ✅ Automatically switches your WiFi interface to monitor mode
2. 📡 Runs airodump-ng for the specified duration
3. 📄 Parses the CSV output files
4. 💾 Saves results to a local JSON database (`wifi-scan-db.json`)
5. 📊 Aggregates unique networks and clients across all scans
6. 🔄 Automatically switches back to managed mode when done

### Database Structure

The scanner maintains a `wifi-scan-db.json` file with:
- **Scans history**: All scan sessions with timestamps
- **Unique networks**: Deduplicated networks by BSSID
- **Unique clients**: Deduplicated clients by MAC address

### Manual Commands

All manual commands now support environment variables with fallback:

```bash
# Interface control
yarn up      # Bring interface up
yarn down    # Bring interface down
yarn info    # Show interface info

# Mode switching
yarn managed  # Switch to managed mode
yarn monitor  # Switch to monitor mode

# Manual scanning
yarn sniff    # Start airodump-ng manually

# Specific network capture
yarn capture  # Capture specific network (configured in package.json)

# Password cracking
yarn verify       # Verify capture has handshakes
yarn try-to-crack # Attempt to crack with rockyou.txt
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WIFI_INTERFACE` | WiFi interface name | `wlxc83a35ca40e1` |

**Tip:** Create a `.env` file (see `.env.example`) or export the variable in your shell profile.

## Output Files

- `captures/scan-*.csv` - Raw airodump-ng CSV files
- `wifi-scan-db.json` - Aggregated database of all scans
- `dist/` - Compiled TypeScript files

## Example Output

```
📡 Starting WiFi scan for 60 seconds...
   Interface: wlxc83a35ca40e1
   Output: /home/user/wifi-explorer/captures/scan-2025-12-02T10-30-45

.....................

✅ Scan completed

📄 Parsing scan results...
   Found 23 networks
   Found 45 clients

📊 Database updated:
   Total scans: 5
   Unique networks: 67
   Unique clients: 142

================================================================================
📊 SCAN SUMMARY
================================================================================

🌐 Networks:
--------------------------------------------------------------------------------
   MyHomeNetwork           | AA:BB:CC:DD:EE:FF | Ch: 6   | Pwr: -45  | WPA2
   NeighborWiFi            | 11:22:33:44:55:66 | Ch: 11  | Pwr: -67  | WPA2
   ...
```

## More Resources

- [aircrack-ng Documentation](https://www.aircrack-ng.org/doku.php?id=cracking_wpa)
