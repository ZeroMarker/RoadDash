/**
 * Tiny spatial note board. Anything that occupies a stretch of lane (traffic,
 * obstacles) registers it here, and anything that wants a free spot (coins,
 * power-ups) asks before spawning. Keeps pickups from spawning inside trucks.
 */
export interface BlockedZone {
  lane: number;
  z: number;
  halfLength: number;
}

export class TrackHints {
  zones: BlockedZone[] = [];
  block(lane: number, z: number, halfLength: number): void {
    this.zones.push({ lane, z, halfLength });
  }

  isBlocked(lane: number, z: number, pad = 2): boolean {
    for (const zone of this.zones) {
      if (zone.lane === lane && Math.abs(zone.z - z) < zone.halfLength + pad) return true;
    }
    return false;
  }

  /** Drop notes that have fallen far behind the player. */
  prune(playerZ: number): void {
    if (this.zones.length < 200) return;
    this.zones = this.zones.filter((zone) => zone.z < playerZ + 30);
  }
}
