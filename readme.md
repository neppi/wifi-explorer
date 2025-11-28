### Setting up the wireless interface in monitoring mode

```bash
sudo ip link set wlxc83a35ca40e1 down
sudo iw dev wlxc83a35ca40e1 set type monitor
sudo ip link set wlxc83a35ca40e1 up
```

### Capturing packets in monitoring with airodump-ng

```bash
  sudo airodump-ng wlxc83a35ca40e1
```

### Focusing on a specific BSSID and channel

Channel and BSSID can be taken from the output of the previous command.

```bash
sudo airodump-ng --bssid <your_BSSID> -c <channel> -w capture wlxc83a35ca40e1
```

# scans with airodump-ng

- [backery-kreischa](backery-kreischa-sids-from-airdump-ng.md) Scans with airodump-ng from Backery Kreischa
- [jens-home](jens-home-lilienthal-street-from-airdump-ng.md) Scans with airodump-ng from Jens' home on Lilienthal Street

