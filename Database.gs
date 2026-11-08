/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - DATABASE LAYER
 * Singleton Database Connection, Concurrency Locking & Sheet Access
 * ============================================================================
 */

// Safely reference APP_CONFIG or fallback
const _APP_CONFIG = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : (
  (typeof require !== 'undefined') ? (() => {
    try {
      return require('./Config.gs').APP_CONFIG;
    } catch (e) {
      return { SPREADSHEET_ID: '' };
    }
  })() : { SPREADSHEET_ID: '' }
);

/**
 * Singleton DatabaseConnection managing SpreadsheetApp and Sheet references
 */
class DatabaseConnection {
  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!DatabaseConnection._instance) {
      DatabaseConnection._instance = new DatabaseConnection();
    }
    return DatabaseConnection._instance;
  }

  /**
   * Reset instance (primarily for testing and mock injection)
   */
  static resetInstance() {
    DatabaseConnection._instance = null;
    DatabaseConnection._lockDepth = 0;
    DatabaseConnection._currentLock = null;
  }

  constructor() {
    this._spreadsheet = null;
    this._sheets = new Map();
  }

  /**
   * Explicitly set or override the underlying spreadsheet (e.g. for mock testing)
   */
  setSpreadsheet(spreadsheet) {
    this._spreadsheet = spreadsheet;
    this._sheets.clear();
    return this;
  }

  /**
   * Get the active or configured spreadsheet instance
   */
  getSpreadsheet() {
    if (this._spreadsheet) {
      return this._spreadsheet;
    }

    const sheetId = (_APP_CONFIG && _APP_CONFIG.SPREADSHEET_ID)
      ? _APP_CONFIG.SPREADSHEET_ID
      : ((typeof SPREADSHEET_ID !== 'undefined') ? SPREADSHEET_ID : '');

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp) {
      if (sheetId && sheetId.trim() !== '') {
        try {
          this._spreadsheet = SpreadsheetApp.openById(sheetId.trim());
          return this._spreadsheet;
        } catch (e) {
          if (typeof Logger !== 'undefined') {
            Logger.log('SpreadsheetApp.openById warning: ' + e.message);
          }
        }
      }

      try {
        const active = SpreadsheetApp.getActiveSpreadsheet();
        if (active) {
          this._spreadsheet = active;
          return this._spreadsheet;
        }
      } catch (e) {
        if (typeof Logger !== 'undefined') {
          Logger.log('SpreadsheetApp.getActiveSpreadsheet warning: ' + e.message);
        }
      }
    }

    throw new Error(
      'Database connection failed: Tidak dapat mengakses Spreadsheet! ' +
      'Pastikan SPREADSHEET_ID diatur pada Config.gs atau Apps Script dijalankan dengan otorisasi yang benar.'
    );
  }

  /**
   * Clear cached sheet references
   */
  clearCache() {
    this._sheets.clear();
  }

  /**
   * Get a Sheet by name, with execution context caching and schema fallback
   */
  getSheet(sheetName, autoCreate = true) {
    if (!sheetName) return null;

    if (this._sheets.has(sheetName)) {
      return this._sheets.get(sheetName);
    }

    const ss = this.getSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);

    // Dynamic alias resolution
    if (!sheet) {
      if (sheetName === 'DailyQuotes') {
        sheet = ss.getSheetByName('MotivationalQuotes');
      } else if (sheetName === 'MotivationalQuotes') {
        sheet = ss.getSheetByName('DailyQuotes');
      } else if (sheetName === 'EducationalArticles') {
        sheet = ss.getSheetByName('Resources');
      } else if (sheetName === 'Resources') {
        sheet = ss.getSheetByName('EducationalArticles');
      }
    }

    // Auto-create if missing and autoCreate is true
    if (!sheet && autoCreate) {
      const def = DatabaseConnection.SHEET_DEFINITIONS.find(d => d.name === sheetName);
      sheet = ss.insertSheet(sheetName);
      if (def && Array.isArray(def.headers) && def.headers.length > 0) {
        sheet.appendRow(def.headers);
        try {
          if (typeof sheet.getRange === 'function') {
            sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
          }
        } catch (e) {}
      }
    }

    if (sheet) {
      this._sheets.set(sheetName, sheet);
    }
    return sheet;
  }

  /**
   * Concurrency lock wrapper using LockService with re-entrancy depth tracking
   * @param {Function} fn Function to execute with lock
   * @param {number} timeoutMs Max wait time in ms
   */
  static withWriteLock(fn, timeoutMs = 25000) {
    if (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function') {
      if (DatabaseConnection._lockDepth > 0) {
        DatabaseConnection._lockDepth++;
        try {
          return fn();
        } finally {
          DatabaseConnection._lockDepth--;
        }
      }

      const lock = LockService.getScriptLock();
      if (typeof lock.hasLock === 'function' && lock.hasLock()) {
        DatabaseConnection._lockDepth++;
        try {
          return fn();
        } finally {
          DatabaseConnection._lockDepth--;
        }
      }

      lock.waitLock(timeoutMs);
      DatabaseConnection._currentLock = lock;
      DatabaseConnection._lockDepth = 1;
      try {
        return fn();
      } finally {
        DatabaseConnection._lockDepth--;
        if (DatabaseConnection._lockDepth <= 0) {
          DatabaseConnection._lockDepth = 0;
          try {
            lock.releaseLock();
          } catch (e) {}
          DatabaseConnection._currentLock = null;
        }
      }
    } else {
      return fn();
    }
  }

  /**
   * Instance method delegating to static withWriteLock
   */
  withWriteLock(fn, timeoutMs = 25000) {
    return DatabaseConnection.withWriteLock(fn, timeoutMs);
  }

  /**
   * Initialize all standard sheets and headers
   */
  setupDatabase(forceReset = false) {
    const ss = this.getSpreadsheet();
    if (forceReset) {
      this.clearCache();
    }

    DatabaseConnection.SHEET_DEFINITIONS.forEach(item => {
      let sheet = ss.getSheetByName(item.name);
      if (!sheet) {
        sheet = ss.insertSheet(item.name);
      } else if (forceReset) {
        if (typeof sheet.clear === 'function') {
          sheet.clear();
        }
      }

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(item.headers);
        try {
          if (typeof sheet.getRange === 'function') {
            sheet.getRange(1, 1, 1, item.headers.length).setFontWeight('bold');
          }
        } catch (e) {}
      }
      this._sheets.set(item.name, sheet);
    });

    return true;
  }
}

DatabaseConnection._lockDepth = 0;
DatabaseConnection._currentLock = null;

/**
 * Standard table schemas for Student Well-being Hub
 */
DatabaseConnection.SHEET_DEFINITIONS = Object.freeze([
  { name: 'Users', headers: ['email', 'name', 'role', 'class', 'status'] },
  { name: 'Moods', headers: ['id', 'timestamp', 'user_email', 'mood_level', 'mood_score', 'triggers', 'notes'] },
  { name: 'Journals', headers: ['id', 'timestamp', 'user_email', 'title', 'content'] },
  { name: 'Reports', headers: ['id', 'timestamp', 'reporter_email', 'role_type', 'detail', 'status', 'counselor_notes'] },
  { name: 'Counselors', headers: ['id', 'name', 'title', 'email', 'status', 'avatar_initials'] },
  { name: 'Messages', headers: ['id', 'thread_id', 'timestamp', 'sender_email', 'sender_role', 'recipient_email', 'text', 'is_read'] },
  { name: 'Appointments', headers: ['id', 'timestamp', 'student_email', 'counselor_email', 'target_date', 'time_slot', 'topic', 'status', 'calendar_event_id'] },
  { name: 'Resources', headers: ['id', 'title', 'category', 'emoji', 'summary', 'content_url_or_text'] },
  { name: 'MotivationalQuotes', headers: ['id', 'timestamp', 'counselor_email', 'counselor_name', 'quote', 'note', 'is_active'] },
  { name: 'EducationalArticles', headers: ['id', 'timestamp', 'author_email', 'author_name', 'title', 'category', 'cover_image_url', 'summary', 'content_markdown', 'status'] },
  { name: 'Surveys', headers: ['id', 'timestamp', 'title', 'description', 'status', 'created_by'] },
  { name: 'SurveyQuestions', headers: ['id', 'survey_id', 'category', 'question_text', 'question_type', 'order_num'] },
  { name: 'SurveyResponses', headers: ['id', 'survey_id', 'student_email', 'timestamp', 'category_scores_json', 'answers_json'] }
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DatabaseConnection };
}
