/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - REPOSITORIES LAYER
 * Domain-specific CRUD Repositories with dynamic header-to-model mapping
 * ============================================================================
 */

// Safely reference DatabaseConnection
const _DatabaseConnection = (typeof DatabaseConnection !== 'undefined') ? DatabaseConnection : (
  (typeof require !== 'undefined') ? (() => {
    try {
      return require('./Database.gs').DatabaseConnection;
    } catch (e) {
      return null;
    }
  })() : null
);

// Safely reference Models
const _models = (typeof require !== 'undefined') ? (() => {
  try {
    return require('./Models.gs');
  } catch (e) {
    return {};
  }
})() : {};

// Safely reference Config
const _config = (typeof require !== 'undefined') ? (() => {
  try {
    return require('./Config.gs');
  } catch (e) {
    return {};
  }
})() : {};

const _User = (typeof User !== 'undefined') ? User : _models.User;
const _MoodEntry = (typeof MoodEntry !== 'undefined') ? MoodEntry : _models.MoodEntry;
const _JournalEntry = (typeof JournalEntry !== 'undefined') ? JournalEntry : _models.JournalEntry;
const _ReportIncident = (typeof ReportIncident !== 'undefined') ? ReportIncident : _models.ReportIncident;
const _Appointment = (typeof Appointment !== 'undefined') ? Appointment : _models.Appointment;
const _ChatMessage = (typeof ChatMessage !== 'undefined') ? ChatMessage : _models.ChatMessage;
const _DailyQuote = (typeof DailyQuote !== 'undefined') ? DailyQuote : _models.DailyQuote;
const _EducationalResource = (typeof EducationalResource !== 'undefined') ? EducationalResource : _models.EducationalResource;
const _Survey = (typeof Survey !== 'undefined') ? Survey : _models.Survey;
const _SurveyQuestion = (typeof SurveyQuestion !== 'undefined') ? SurveyQuestion : _models.SurveyQuestion;
const _SurveyResponse = (typeof SurveyResponse !== 'undefined') ? SurveyResponse : _models.SurveyResponse;

/**
 * Normalization helper for header keys (matches 'user_email' -> 'useremail')
 */
function _normRepoKey(str) {
  return String(str || '').toLowerCase().replace(/[\s_\-]/g, '');
}

/**
 * Normalization helper for dates (YYYY-MM-DD)
 * Supports Date objects, ISO strings, slash format, and DMY strings (e.g. DD/MM/YYYY)
 */
function _normRepoDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  const isoMatch = str.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const dmyMatch = str.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
}

/**
 * Abstract Base Repository for Sheet operations
 */
class BaseRepository {
  constructor(sheetName, modelClass) {
    this.sheetName = sheetName;
    this.modelClass = modelClass;
  }

  /**
   * Get underlying Google Sheet
   */
  getSheet() {
    const db = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection).getInstance();
    return db.getSheet(this.sheetName);
  }

  /**
   * Read all rows, dynamically map columns from header row, and return entity instances
   */
  getAll() {
    const sheet = this.getSheet();
    if (!sheet) return [];
    
    const lastRow = (typeof sheet.getLastRow === 'function') ? sheet.getLastRow() : 0;
    if (lastRow <= 1) return [];

    const data = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const headers = data[0].map(h => String(h || '').trim());
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) {
        continue;
      }

      const rowObj = {};
      headers.forEach((h, colIdx) => {
        if (h) {
          rowObj[h] = row[colIdx];
          rowObj[h.toLowerCase()] = row[colIdx];
          rowObj[_normRepoKey(h)] = row[colIdx];
        }
      });

      let entity;
      if (this.modelClass && typeof this.modelClass.fromRow === 'function') {
        entity = this.modelClass.fromRow(rowObj, i + 1);
      } else if (typeof this.modelClass === 'function') {
        entity = new this.modelClass(rowObj);
      } else {
        entity = rowObj;
      }

      if (entity && typeof entity === 'object') {
        entity._rowIndex = i + 1;
      }
      results.push(entity);
    }

    return results;
  }

  /**
   * Find single entity by ID or Email
   */
  findById(id) {
    if (id === undefined || id === null) return null;
    const target = String(id).trim().toLowerCase();
    return this.getAll().find(item => {
      const itemId = item.id !== undefined ? String(item.id).trim().toLowerCase() : '';
      const itemEmail = item.email !== undefined ? String(item.email).trim().toLowerCase() : '';
      return itemId === target || itemEmail === target;
    }) || null;
  }

  /**
   * Find all entities matching a predicate function
   */
  findWhere(predicate) {
    if (typeof predicate !== 'function') return [];
    return this.getAll().filter(predicate);
  }

  /**
   * Find first entity matching a predicate function
   */
  findOne(predicate) {
    if (typeof predicate !== 'function') return null;
    return this.getAll().find(predicate) || null;
  }

  /**
   * Insert a new entity within write lock by mapping each header to entity.toRowValue(header)
   */
  insert(entity) {
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const sheet = this.getSheet();
      if (!sheet) throw new Error(`Sheet ${this.sheetName} not found.`);

      let headers = [];
      const lastRow = (typeof sheet.getLastRow === 'function') ? sheet.getLastRow() : 0;
      const lastCol = (typeof sheet.getLastColumn === 'function') ? sheet.getLastColumn() : 0;

      if (lastRow > 0 && lastCol > 0) {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
      } else {
        const def = dbClass.SHEET_DEFINITIONS.find(d => d.name === this.sheetName);
        if (def && Array.isArray(def.headers)) {
          headers = def.headers;
          sheet.appendRow(headers);
        }
      }

      const rowVals = headers.map(header => {
        if (entity && typeof entity.toRowValue === 'function') {
          return entity.toRowValue(header);
        }
        const normH = _normRepoKey(header);
        if (entity && typeof entity === 'object') {
          for (const k of Object.keys(entity)) {
            if (_normRepoKey(k) === normH) {
              const val = entity[k];
              if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                return JSON.stringify(val);
              }
              return val;
            }
          }
          if (entity[header] !== undefined) return entity[header];
        }
        return '';
      });

      sheet.appendRow(rowVals);
      return entity;
    });
  }

  /**
   * Locate row by ID or Email within write lock, and update cells matching updateProps keys
   */
  update(id, updateProps) {
    if (id === undefined || id === null || String(id).trim() === '') return false;
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const sheet = this.getSheet();
      if (!sheet) return false;

      const data = sheet.getDataRange().getValues();
      if (!data || data.length <= 1) return false;

      const headers = data[0].map(h => String(h || '').trim());
      const normHeaders = headers.map(h => _normRepoKey(h));

      let idColIdx = normHeaders.indexOf('id');
      if (idColIdx === -1) idColIdx = normHeaders.indexOf('email');
      if (idColIdx === -1) idColIdx = 0;

      const targetId = String(id).trim().toLowerCase();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][idColIdx]).trim().toLowerCase() === targetId) {
          const rowNum = i + 1; // 1-indexed in Google Sheets

          Object.keys(updateProps || {}).forEach(key => {
            const normKey = _normRepoKey(key);
            const colIdx = normHeaders.indexOf(normKey);
            if (colIdx !== -1) {
              let val = updateProps[key];
              if (val === undefined) {
                val = '';
              } else if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                val = JSON.stringify(val);
              }
              sheet.getRange(rowNum, colIdx + 1).setValue(val);
            }
          });

          return true;
        }
      }
      return false;
    });
  }

  /**
   * Delete row matching ID or Email within write lock
   */
  delete(id) {
    if (id === undefined || id === null || String(id).trim() === '') return false;
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const sheet = this.getSheet();
      if (!sheet) return false;

      const data = sheet.getDataRange().getValues();
      if (!data || data.length <= 1) return false;

      const headers = data[0].map(h => String(h || '').trim());
      const normHeaders = headers.map(h => _normRepoKey(h));

      let idColIdx = normHeaders.indexOf('id');
      if (idColIdx === -1) idColIdx = normHeaders.indexOf('email');
      if (idColIdx === -1) idColIdx = 0;

      const targetId = String(id).trim().toLowerCase();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][idColIdx]).trim().toLowerCase() === targetId) {
          sheet.deleteRow(i + 1);
          return true;
        }
      }
      return false;
    });
  }
}

/**
 * User Repository
 */
class UserRepository extends BaseRepository {
  constructor(sheetName = 'Users', modelClass = _User) {
    super(sheetName, modelClass);
  }

  findByEmail(email) {
    if (!email) return null;
    const target = String(email).trim().toLowerCase();
    return this.getAll().find(u => String(u.email || '').toLowerCase() === target) || null;
  }

  findStudents() {
    return this.findWhere(u => u.isStudent());
  }

  findCounselors() {
    return this.findWhere(u => u.isCounselor());
  }

  findAdmins() {
    return this.findWhere(u => u.isAdmin());
  }

  upsert(user) {
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const existing = this.findByEmail(user.email);
      if (existing) {
        this.update(user.email, {
          name: user.name,
          role: user.role,
          class: user.class,
          status: user.status
        });
        return this.findByEmail(user.email);
      } else {
        return this.insert(user);
      }
    });
  }
}

/**
 * Mood Repository
 */
class MoodRepository extends BaseRepository {
  constructor(sheetName = 'Moods', modelClass = _MoodEntry) {
    super(sheetName, modelClass);
  }

  findByUserEmail(email) {
    if (!email) return [];
    const target = String(email).trim().toLowerCase();
    return this.findWhere(m => String(m.userEmail || '').toLowerCase() === target);
  }

  findRecentByStudent(email, days = 7) {
    const target = String(email || '').trim().toLowerCase();
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return this.findWhere(m => {
      if (String(m.userEmail || '').toLowerCase() !== target) return false;
      const ts = new Date(m.timestamp).getTime();
      return !isNaN(ts) && ts >= cutoff;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
}

/**
 * Journal Repository
 */
class JournalRepository extends BaseRepository {
  constructor(sheetName = 'Journals', modelClass = _JournalEntry) {
    super(sheetName, modelClass);
  }

  findByUserEmail(email) {
    if (!email) return [];
    const target = String(email).trim().toLowerCase();
    return this.findWhere(j => String(j.userEmail || '').toLowerCase() === target)
               .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

/**
 * Report Incident Repository
 */
class ReportRepository extends BaseRepository {
  constructor(sheetName = 'Reports', modelClass = _ReportIncident) {
    super(sheetName, modelClass);
  }

  findByStatus(status) {
    const target = String(status || '').trim().toUpperCase();
    return this.findWhere(r => String(r.status || '').toUpperCase() === target);
  }

  findHighRisk(crisisKeywords) {
    return this.findWhere(r => r.isHighRisk(crisisKeywords));
  }
}

/**
 * Appointment Repository
 */
class AppointmentRepository extends BaseRepository {
  constructor(sheetName = 'Appointments', modelClass = _Appointment) {
    super(sheetName, modelClass);
  }

  findConflicting(counselorEmail, targetDate, timeSlot) {
    const email = String(counselorEmail || '').trim().toLowerCase();
    const dateStr = _normRepoDate(targetDate);
    const slot = String(timeSlot || '').trim().toLowerCase();

    return this.findWhere(a => {
      const st = String(a.status || '').toUpperCase();
      if (st === 'DITOLAK' || st === 'DIBATALKAN') return false; // Rejected or cancelled slots are open
      return String(a.counselorEmail || '').toLowerCase() === email &&
             _normRepoDate(a.targetDate) === dateStr &&
             String(a.timeSlot || '').trim().toLowerCase() === slot;
    });
  }

  findByStudent(email) {
    const target = String(email || '').trim().toLowerCase();
    return this.findWhere(a => String(a.studentEmail || '').toLowerCase() === target);
  }

  findByCounselor(email) {
    const target = String(email || '').trim().toLowerCase();
    return this.findWhere(a => String(a.counselorEmail || '').toLowerCase() === target);
  }

  findByDate(targetDate) {
    const dateStr = _normRepoDate(targetDate);
    return this.findWhere(a => _normRepoDate(a.targetDate) === dateStr);
  }
}

/**
 * Chat Message Repository
 */
class MessageRepository extends BaseRepository {
  constructor(sheetName = 'Messages', modelClass = _ChatMessage) {
    super(sheetName, modelClass);
  }

  findThread(user1, user2) {
    const u1 = String(user1 || '').trim().toLowerCase();
    const u2 = String(user2 || '').trim().toLowerCase();
    return this.findWhere(m => {
      const sender = String(m.senderEmail || '').toLowerCase();
      const recipient = String(m.recipientEmail || '').toLowerCase();
      return (sender === u1 && recipient === u2) || (sender === u2 && recipient === u1);
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  findByThreadId(threadId) {
    const tId = String(threadId || '').trim();
    return this.findWhere(m => m.threadId === tId)
               .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  markAsRead(threadId, readerEmail) {
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const sheet = this.getSheet();
      if (!sheet) return 0;

      const data = sheet.getDataRange().getValues();
      if (!data || data.length <= 1) return 0;

      const headers = data[0].map(h => String(h || '').trim());
      const normHeaders = headers.map(h => _normRepoKey(h));

      const threadIdx = normHeaders.indexOf('threadid');
      const recipientIdx = normHeaders.indexOf('recipientemail');
      const isReadIdx = normHeaders.indexOf('isread');
      if (isReadIdx === -1) return 0;

      const safeThread = String(threadId || '').trim();
      const safeReader = String(readerEmail || '').trim().toLowerCase();
      let count = 0;

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const matchThread = !safeThread || (threadIdx !== -1 && String(row[threadIdx]).trim() === safeThread);
        const matchReader = !safeReader || (recipientIdx !== -1 && String(row[recipientIdx]).trim().toLowerCase() === safeReader);
        const isRead = row[isReadIdx] === true || String(row[isReadIdx]).toLowerCase() === 'true';

        if (matchThread && matchReader && !isRead) {
          sheet.getRange(i + 1, isReadIdx + 1).setValue(true);
          count++;
        }
      }
      return count;
    });
  }
}

/**
 * Quote Repository
 */
class QuoteRepository extends BaseRepository {
  constructor(sheetName = 'MotivationalQuotes', modelClass = _DailyQuote) {
    super(sheetName, modelClass);
  }

  getActiveQuote() {
    const activeQuotes = this.findWhere(q => q.isActive);
    if (activeQuotes.length > 0) {
      return activeQuotes[activeQuotes.length - 1];
    }
    return this.getAll()[0] || null;
  }

  setActiveQuote(id) {
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const targetId = String(id).trim();
      const all = this.getAll();
      let found = false;
      all.forEach(q => {
        const isTarget = String(q.id).trim() === targetId;
        if (isTarget) found = true;
        if (q.isActive && !isTarget) {
          this.update(q.id, { is_active: false });
        } else if (!q.isActive && isTarget) {
          this.update(q.id, { is_active: true });
        }
      });
      return found;
    });
  }
}

/**
 * Educational Resource Repository
 */
class ResourceRepository extends BaseRepository {
  constructor(sheetName = 'EducationalArticles', modelClass = _EducationalResource) {
    super(sheetName, modelClass);
  }

  findPublished() {
    return this.findWhere(r => r.isPublished());
  }

  findByCategory(category) {
    const target = String(category || '').trim().toLowerCase();
    return this.findWhere(r => String(r.category || '').toLowerCase() === target);
  }
}

/**
 * Survey Repository
 */
class CounselorRepository extends BaseRepository {
  constructor(sheetName = 'Counselors') {
    super(sheetName, null);
  }

  findByEmail(email) {
    if (!email) return null;
    const target = String(email).trim().toLowerCase();
    return this.getAll().find(c => String(c.email || '').trim().toLowerCase() === target) || null;
  }
}

class SurveyRepository extends BaseRepository {
  constructor(
    sheetName = 'Surveys',
    modelClass = _Survey,
    responseSheetName = 'SurveyResponses',
    questionSheetName = 'SurveyQuestions'
  ) {
    super(sheetName, modelClass);
    this.responseSheetName = responseSheetName;
    this.questionSheetName = questionSheetName;
  }

  _getAllQuestions() {
    const db = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection).getInstance();
    const qSheet = db.getSheet(this.questionSheetName);
    if (!qSheet) return [];

    const lastRow = (typeof qSheet.getLastRow === 'function') ? qSheet.getLastRow() : 0;
    if (lastRow <= 1) return [];

    const data = qSheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const headers = data[0].map(h => String(h || '').trim());
    const questions = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const obj = {};
      headers.forEach((h, idx) => {
        if (h) {
          obj[h] = row[idx];
          obj[h.toLowerCase()] = row[idx];
          obj[_normRepoKey(h)] = row[idx];
        }
      });

      const q = _SurveyQuestion ? _SurveyQuestion.fromRow(obj, i + 1) : obj;
      questions.push(q);
    }
    return questions;
  }

  getAll() {
    const surveys = super.getAll();
    if (surveys.length === 0) return surveys;

    const allQuestions = this._getAllQuestions();
    const questionsBySurvey = new Map();
    allQuestions.forEach(q => {
      const sId = String(q.surveyId || q.survey_id || '').trim();
      if (!questionsBySurvey.has(sId)) {
        questionsBySurvey.set(sId, []);
      }
      questionsBySurvey.get(sId).push(q);
    });

    surveys.forEach(survey => {
      const sId = String(survey.id || '').trim();
      if (survey.id && (!survey.questions || survey.questions.length === 0)) {
        const qList = questionsBySurvey.get(sId) || [];
        survey.questions = qList.sort((a, b) => (Number(a.orderNum || a.order_num) || 0) - (Number(b.orderNum || b.order_num) || 0));
      }
    });
    return surveys;
  }

  findPublishedSurveys() {
    return this.findWhere(s => s.isPublished());
  }

  getQuestionsForSurvey(surveyId) {
    const targetId = String(surveyId || '').trim();
    const questions = this._getAllQuestions().filter(q => String(q.surveyId || q.survey_id || '').trim() === targetId);
    return questions.sort((a, b) => (Number(a.orderNum || a.order_num) || 0) - (Number(b.orderNum || b.order_num) || 0));
  }

  saveResponse(response) {
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      const db = dbClass.getInstance();
      const respSheet = db.getSheet(this.responseSheetName);
      if (!respSheet) throw new Error('Response sheet ' + this.responseSheetName + ' not found.');

      const lastCol = (typeof respSheet.getLastColumn === 'function') ? respSheet.getLastColumn() : 0;
      let headers = [];
      if (lastCol > 0) {
        headers = respSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
      } else {
        const def = dbClass.SHEET_DEFINITIONS.find(d => d.name === this.responseSheetName);
        if (def && Array.isArray(def.headers)) {
          headers = def.headers;
          respSheet.appendRow(headers);
        }
      }

      const normHeaders = headers.map(h => _normRepoKey(h));
      const targetSurveyId = String(response.surveyId || response.survey_id || '').trim();
      const targetStudentEmail = String(response.studentEmail || response.student_email || '').trim().toLowerCase();

      let existingRowIndex = -1;
      let existingId = null;

      const lastRow = (typeof respSheet.getLastRow === 'function') ? respSheet.getLastRow() : 0;
      if (lastRow > 1) {
        const data = respSheet.getDataRange().getValues();
        let surveyColIdx = normHeaders.indexOf('surveyid');
        if (surveyColIdx === -1) surveyColIdx = 1;
        let emailColIdx = normHeaders.indexOf('studentemail');
        if (emailColIdx === -1) emailColIdx = 2;
        let idColIdx = normHeaders.indexOf('id');
        if (idColIdx === -1) idColIdx = 0;

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const rowSurveyId = String(row[surveyColIdx] || '').trim();
          const rowEmail = String(row[emailColIdx] || '').trim().toLowerCase();
          if (rowSurveyId.toLowerCase() === targetSurveyId.toLowerCase() && rowEmail === targetStudentEmail) {
            existingRowIndex = i + 1;
            if (idColIdx !== -1 && row[idColIdx]) {
              existingId = row[idColIdx];
            }
            break;
          }
        }
      }

      if (existingId) {
        response.id = existingId;
      }

      const rowVals = headers.map(header => {
        if (response && typeof response.toRowValue === 'function') {
          return response.toRowValue(header);
        }
        const normH = _normRepoKey(header);
        if (response && typeof response === 'object') {
          for (const k of Object.keys(response)) {
            if (_normRepoKey(k) === normH) {
              const val = response[k];
              if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                return JSON.stringify(val);
              }
              return val;
            }
          }
          if (response[header] !== undefined) return response[header];
        }
        return '';
      });

      if (existingRowIndex > 1) {
        respSheet.getRange(existingRowIndex, 1, 1, rowVals.length).setValues([rowVals]);
      } else {
        respSheet.appendRow(rowVals);
      }
      return response;
    });
  }

  deleteSurvey(surveyId) {
    if (!surveyId) return false;
    const targetId = String(surveyId).trim().toLowerCase();
    const dbClass = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection);
    return dbClass.withWriteLock(() => {
      // 1. Delete survey from Surveys sheet
      const surveySheet = this.getSheet();
      if (surveySheet) {
        const lastRow = (typeof surveySheet.getLastRow === 'function') ? surveySheet.getLastRow() : 0;
        if (lastRow > 1) {
          const data = surveySheet.getDataRange().getValues();
          const headers = data[0].map(h => String(h || '').trim());
          const normHeaders = headers.map(h => _normRepoKey(h));
          let idColIdx = normHeaders.indexOf('id');
          if (idColIdx === -1) idColIdx = 0;

          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idColIdx]).trim().toLowerCase() === targetId) {
              surveySheet.deleteRow(i + 1);
            }
          }
        }
      }

      // 2. Delete questions from SurveyQuestions sheet
      const db = dbClass.getInstance();
      const qSheet = db.getSheet(this.questionSheetName);
      if (qSheet) {
        const lastRow = (typeof qSheet.getLastRow === 'function') ? qSheet.getLastRow() : 0;
        if (lastRow > 1) {
          const data = qSheet.getDataRange().getValues();
          const headers = data[0].map(h => String(h || '').trim());
          const normHeaders = headers.map(h => _normRepoKey(h));
          let sIdColIdx = normHeaders.indexOf('surveyid');
          if (sIdColIdx === -1) sIdColIdx = 1;

          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][sIdColIdx]).trim().toLowerCase() === targetId) {
              qSheet.deleteRow(i + 1);
            }
          }
        }
      }

      return true;
    });
  }

  delete(id) {
    return this.deleteSurvey(id);
  }

  getResponsesForSurvey(surveyId) {
    const targetId = String(surveyId || '').trim();
    const db = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection).getInstance();
    const respSheet = db.getSheet(this.responseSheetName);
    if (!respSheet) return [];

    const lastRow = (typeof respSheet.getLastRow === 'function') ? respSheet.getLastRow() : 0;
    if (lastRow <= 1) return [];

    const data = respSheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const headers = data[0].map(h => String(h || '').trim());
    const responses = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const obj = {};
      headers.forEach((h, idx) => {
        if (h) {
          obj[h] = row[idx];
          obj[h.toLowerCase()] = row[idx];
          obj[_normRepoKey(h)] = row[idx];
        }
      });

      const resp = _SurveyResponse ? _SurveyResponse.fromRow(obj) : obj;
      if (String(resp.surveyId || resp.survey_id || '').trim() === targetId) {
        responses.push(resp);
      }
    }

    return responses;
  }

  getResponsesForStudent(studentEmail) {
    const target = String(studentEmail || '').trim().toLowerCase();
    const db = (typeof DatabaseConnection !== 'undefined' ? DatabaseConnection : _DatabaseConnection).getInstance();
    const respSheet = db.getSheet(this.responseSheetName);
    if (!respSheet) return [];

    const lastRow = (typeof respSheet.getLastRow === 'function') ? respSheet.getLastRow() : 0;
    if (lastRow <= 1) return [];

    const data = respSheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const headers = data[0].map(h => String(h || '').trim());
    const responses = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const obj = {};
      headers.forEach((h, idx) => {
        if (h) {
          obj[h] = row[idx];
          obj[h.toLowerCase()] = row[idx];
          obj[_normRepoKey(h)] = row[idx];
        }
      });

      const resp = _SurveyResponse ? _SurveyResponse.fromRow(obj) : obj;
      if (String(resp.studentEmail || resp.student_email || '').trim().toLowerCase() === target) {
        responses.push(resp);
      }
    }

    return responses;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BaseRepository,
    UserRepository,
    MoodRepository,
    JournalRepository,
    ReportRepository,
    AppointmentRepository,
    MessageRepository,
    QuoteRepository,
    ResourceRepository,
    CounselorRepository,
    SurveyRepository
  };
}
