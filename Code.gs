/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - CODE.GS ENTRYPOINT (BRIDGING TO CONTROLLERS)
 * Backward-compatible delegator maintaining exact function signatures
 * ============================================================================
 */

// In Google Apps Script runtime, all .gs files share the flat global namespace.
// The Controllers.gs file defines all global handlers (doGet, include, RPC endpoints).
// This file serves as documentation and ensures backward compatibility if needed.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = require('./Controllers.gs');
}
