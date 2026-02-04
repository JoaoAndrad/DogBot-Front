/**
 * Placeholder for JamMonitor compatibility
 * In production, jam state is managed by backend
 */
class JamMonitor {
  static getJamState(senderNumber) {
    // This is a placeholder - in the new architecture,
    // we check jam state via backend API instead
    return null;
  }
}

module.exports = { JamMonitor };
