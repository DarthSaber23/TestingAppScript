/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - CONFIGURATION & CONSTANTS
 * ============================================================================
 */

const APP_CONFIG = {
  SPREADSHEET_ID: '',
  ALLOWED_DOMAIN: '',
  CANONICAL_URL: ''
};

const ROLES = Object.freeze({
  STUDENT: 'STUDENT',
  COUNSELOR: 'COUNSELOR',
  ADMIN: 'ADMIN'
});

const REPORT_STATUS = Object.freeze({
  BARU: 'BARU',
  DALAM_TINJAUAN: 'DALAM_TINJAUAN',
  SELESAI: 'SELESAI'
});

const APPOINTMENT_STATUS = Object.freeze({
  MENUNGGU: 'MENUNGGU',
  DISETUJUI: 'DISETUJUI',
  DITOLAK: 'DITOLAK',
  SELESAI: 'SELESAI'
});

const CRISIS_KEYWORDS = Object.freeze([
  'dipukul', 'ancaman', 'takut sekolah', 'menyakiti', 'diperas', 'diancam', 'bunuh diri'
]);

const STANDARD_SLOTS = Object.freeze([
  { id: 'slot-1', label: 'Istirahat Pertama (10:00 - 10:30)', startH: 10, startM: 0, endH: 10, endM: 30 },
  { id: 'slot-2', label: 'Istirahat Kedua (12:30 - 13:00)', startH: 12, startM: 30, endH: 13, endM: 0 },
  { id: 'slot-3', label: 'Pulang Sekolah (15:00 - 15:30)', startH: 15, startM: 0, endH: 15, endM: 30 }
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP_CONFIG,
    ROLES,
    REPORT_STATUS,
    APPOINTMENT_STATUS,
    CRISIS_KEYWORDS,
    STANDARD_SLOTS
  };
}
