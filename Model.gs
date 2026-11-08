/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - DOMAIN MODELS
 * ES6 Domain Entities for Google Apps Script & Local Testing Environment
 * ============================================================================
 */

// Safely reference constants from Config.gs or fallback in isolated environments
const _ROLES = (typeof ROLES !== 'undefined') ? ROLES : Object.freeze({
  STUDENT: 'STUDENT',
  COUNSELOR: 'COUNSELOR',
  ADMIN: 'ADMIN'
});

const _REPORT_STATUS = (typeof REPORT_STATUS !== 'undefined') ? REPORT_STATUS : Object.freeze({
  BARU: 'BARU',
  DALAM_TINJAUAN: 'DALAM_TINJAUAN',
  SELESAI: 'SELESAI'
});

const _APPOINTMENT_STATUS = (typeof APPOINTMENT_STATUS !== 'undefined') ? APPOINTMENT_STATUS : Object.freeze({
  MENUNGGU: 'MENUNGGU',
  DISETUJUI: 'DISETUJUI',
  DITOLAK: 'DITOLAK',
  SELESAI: 'SELESAI'
});

const _CRISIS_KEYWORDS = (typeof CRISIS_KEYWORDS !== 'undefined') ? CRISIS_KEYWORDS : Object.freeze([
  'dipukul', 'ancaman', 'takut sekolah', 'menyakiti', 'diperas', 'diancam', 'bunuh diri'
]);

/**
 * Utility: Normalize header string for resilient matching (e.g. 'user_email' -> 'useremail')
 */
function normalizeHeaderKey(str) {
  return String(str || '').toLowerCase().replace(/[\s_\-]/g, '');
}

/**
 * Utility: Format timestamps to ISO string if Date instance
 */
function formatTimestamp(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

/**
 * Utility: Normalize target date to YYYY-MM-DD
 */
function normalizeDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  const match = str.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : str;
}

/**
 * Utility: Safe JSON parsing with fallback
 */
function safeParseJson(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

/**
 * Domain Entity: User
 */
class User {
  constructor(data = {}) {
    const rawEmail = data.email !== undefined ? data.email : data.user_email;
    const rawName = data.name !== undefined ? data.name : (data.user_name || data.userName);
    const rawRole = data.role !== undefined ? data.role : (data.user_role || data.userRole);
    const rawClass = data.class !== undefined ? data.class : (data.user_class || data.userClass);
    const rawStatus = data.status !== undefined ? data.status : data.user_status;

    this.email = String(rawEmail || '').trim().toLowerCase();
    this.name = String(rawName || '').trim();
    this.role = String(rawRole || _ROLES.STUDENT).toUpperCase().trim();
    this.class = String(rawClass || '').trim();
    this.status = String(rawStatus || 'ACTIVE').toUpperCase().trim();
  }

  get userClass() {
    return this.class;
  }

  set userClass(val) {
    this.class = String(val || '').trim();
  }

  isStudent() {
    return this.role === _ROLES.STUDENT;
  }

  isCounselor() {
    return this.role === _ROLES.COUNSELOR;
  }

  isAdmin() {
    return this.role === _ROLES.ADMIN;
  }

  needsClassOnboarding() {
    const cls = this.class || this.userClass || '';
    return (!cls || cls.trim() === '') && this.isStudent();
  }

  toDto() {
    return {
      email: this.email,
      name: this.name,
      role: this.role,
      class: this.class,
      userClass: this.class,
      status: this.status,
      needsClassOnboarding: this.needsClassOnboarding()
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new User();
    return new User(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'email':
      case 'useremail':
        return this.email;
      case 'name':
      case 'username':
        return this.name;
      case 'role':
      case 'userrole':
      case 'roletype':
        return this.role;
      case 'class':
      case 'userclass':
        return this.class;
      case 'status':
        return this.status;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: MoodEntry
 */
class MoodEntry {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawEmail = data.userEmail !== undefined ? data.userEmail : (data.user_email || data.email);
    const rawLevel = data.moodLevel !== undefined ? data.moodLevel : (data.mood_level || data.mood);
    const rawScore = data.moodScore !== undefined ? data.moodScore : (data.mood_score !== undefined ? data.mood_score : 0);
    const rawTriggers = data.triggers !== undefined ? data.triggers : (data.trigger_list || []);
    const rawNotes = data.notes !== undefined ? data.notes : (data.note || '');

    this.id = String(rawId || '');
    this.timestamp = formatTimestamp(rawTimestamp);
    this.userEmail = String(rawEmail || '').trim().toLowerCase();
    this.moodLevel = String(rawLevel || '').trim();
    this.moodScore = Number(rawScore) || 0;

    let parsedTriggers = [];
    if (Array.isArray(rawTriggers)) {
      parsedTriggers = rawTriggers;
    } else if (typeof rawTriggers === 'string') {
      const trimmed = rawTriggers.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        parsedTriggers = safeParseJson(trimmed, []);
      } else if (trimmed) {
        parsedTriggers = trimmed.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
    this.triggers = parsedTriggers;
    this.notes = String(rawNotes || '').trim();
  }

  isNegative() {
    const lvl = String(this.moodLevel || '').toLowerCase().trim();
    const negativePrefixes = [
      'stres', 'lelah', 'buruk', 'sangat buruk', 'sedih', 'terpuruk', 'cemas', 'marah',
      'sad', 'disgust', 'anger', 'fear', 'muak', 'takut', 'kecewa', 'frustrasi',
      'angry', 'disgusted', 'scared', 'fearful', 'mad', 'bad'
    ];
    const isLevelNegative = negativePrefixes.some(prefix => 
      lvl === prefix || lvl.startsWith(prefix + ' ') || lvl.startsWith(prefix + '-')
    );
    if (isLevelNegative) return true;
    if (this.moodScore > 0) {
      return this.moodScore <= 2;
    }
    return false;
  }

  toDto() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      userEmail: this.userEmail,
      user_email: this.userEmail,
      moodLevel: this.moodLevel,
      mood_level: this.moodLevel,
      moodScore: this.moodScore,
      mood_score: this.moodScore,
      triggers: this.triggers,
      notes: this.notes
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new MoodEntry();
    return new MoodEntry(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
        return this.timestamp;
      case 'useremail':
      case 'email':
        return this.userEmail;
      case 'moodlevel':
        return this.moodLevel;
      case 'moodscore':
        return this.moodScore;
      case 'triggers':
        return Array.isArray(this.triggers) ? this.triggers.join(', ') : (this.triggers || '');
      case 'notes':
        return this.notes;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: JournalEntry
 */
class JournalEntry {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawEmail = data.userEmail !== undefined ? data.userEmail : (data.user_email || data.email);
    const rawTitle = data.title !== undefined ? data.title : '';
    const rawContent = data.content !== undefined ? data.content : '';

    this.id = String(rawId || '');
    this.timestamp = formatTimestamp(rawTimestamp);
    this.userEmail = String(rawEmail || '').trim().toLowerCase();
    this.title = String(rawTitle || '').trim();
    this.content = String(rawContent || '').trim();
  }

  isOwnedBy(email) {
    return this.userEmail.toLowerCase().trim() === String(email || '').toLowerCase().trim();
  }

  toDto() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      userEmail: this.userEmail,
      user_email: this.userEmail,
      title: this.title,
      content: this.content
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new JournalEntry();
    return new JournalEntry(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
        return this.timestamp;
      case 'useremail':
      case 'email':
        return this.userEmail;
      case 'title':
        return this.title;
      case 'content':
        return this.content;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: ReportIncident
 */
class ReportIncident {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawReporter = data.reporterEmail !== undefined ? data.reporterEmail : (data.reporter_email || data.email);
    const rawRole = data.roleType !== undefined ? data.roleType : (data.role_type || data.role);
    const rawDetail = data.detail !== undefined ? data.detail : (data.incident_detail || '');
    const rawStatus = data.status !== undefined ? data.status : (data.report_status || _REPORT_STATUS.BARU);
    const rawNotes = data.counselorNotes !== undefined ? data.counselorNotes : (data.counselor_notes || '');

    this.id = String(rawId || '');
    this.timestamp = formatTimestamp(rawTimestamp);
    this.reporterEmail = String(rawReporter || '').trim();
    this.roleType = String(rawRole || '').trim();
    this.detail = String(rawDetail || '').trim();
    this.status = String(rawStatus || _REPORT_STATUS.BARU).toUpperCase().trim();
    this.counselorNotes = String(rawNotes || '').trim();
  }

  isHighRisk(crisisKeywords = _CRISIS_KEYWORDS) {
    if (!this.detail) return false;
    const keywords = Array.isArray(crisisKeywords) ? crisisKeywords : _CRISIS_KEYWORDS;
    const lowerDetail = this.detail.toLowerCase();
    return keywords.some(keyword => lowerDetail.includes(String(keyword).toLowerCase()));
  }

  isAnonymous() {
    if (!this.reporterEmail) return true;
    const lower = this.reporterEmail.toLowerCase().trim();
    return lower.startsWith('anon-') || lower === 'anonymous' || lower === 'anon';
  }

  toDto() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      reporterEmail: this.reporterEmail,
      reporter_email: this.reporterEmail,
      roleType: this.roleType,
      role_type: this.roleType,
      detail: this.detail,
      status: this.status,
      counselorNotes: this.counselorNotes,
      counselor_notes: this.counselorNotes,
      isAnonymous: this.isAnonymous()
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new ReportIncident();
    return new ReportIncident(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
        return this.timestamp;
      case 'reporteremail':
      case 'email':
        return this.reporterEmail;
      case 'roletype':
      case 'role':
        return this.roleType;
      case 'detail':
        return this.detail;
      case 'status':
        return this.status;
      case 'counselornotes':
      case 'notes':
        return this.counselorNotes;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: Appointment
 */
class Appointment {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawStudent = data.studentEmail !== undefined ? data.studentEmail : (data.student_email || data.student);
    const rawCounselor = data.counselorEmail !== undefined ? data.counselorEmail : (data.counselor_email || data.counselor);
    const rawDate = data.targetDate !== undefined ? data.targetDate : (data.target_date || data.date);
    const rawSlot = data.timeSlot !== undefined ? data.timeSlot : (data.time_slot || data.slot);
    const rawTopic = data.topic !== undefined ? data.topic : '';
    const rawStatus = data.status !== undefined ? data.status : (data.appointment_status || _APPOINTMENT_STATUS.MENUNGGU);
    const rawCalId = data.calendarEventId !== undefined ? data.calendarEventId : (data.calendar_event_id || '');

    this.id = String(rawId || '');
    this.timestamp = formatTimestamp(rawTimestamp);
    this.studentEmail = String(rawStudent || '').trim().toLowerCase();
    this.counselorEmail = String(rawCounselor || '').trim().toLowerCase();
    this.targetDate = normalizeDateStr(rawDate);
    this.timeSlot = String(rawSlot || '').trim();
    this.topic = String(rawTopic || '').trim();
    this.status = String(rawStatus || _APPOINTMENT_STATUS.MENUNGGU).toUpperCase().trim();
    this.calendarEventId = String(rawCalId || '').trim();
  }

  isPending() {
    const s = this.status;
    return s === _APPOINTMENT_STATUS.MENUNGGU || s === 'PENDING';
  }

  isApproved() {
    const s = this.status;
    return s === _APPOINTMENT_STATUS.DISETUJUI || s === 'APPROVED';
  }

  toDto() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      studentEmail: this.studentEmail,
      student_email: this.studentEmail,
      counselorEmail: this.counselorEmail,
      counselor_email: this.counselorEmail,
      targetDate: this.targetDate,
      target_date: this.targetDate,
      timeSlot: this.timeSlot,
      time_slot: this.timeSlot,
      topic: this.topic,
      status: this.status,
      calendarEventId: this.calendarEventId,
      calendar_event_id: this.calendarEventId
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new Appointment();
    return new Appointment(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
        return this.timestamp;
      case 'studentemail':
        return this.studentEmail;
      case 'counseloremail':
        return this.counselorEmail;
      case 'targetdate':
        return this.targetDate;
      case 'timeslot':
        return this.timeSlot;
      case 'topic':
        return this.topic;
      case 'status':
        return this.status;
      case 'calendareventid':
        return this.calendarEventId;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: ChatMessage
 */
class ChatMessage {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawThread = data.threadId !== undefined ? data.threadId : (data.thread_id || '');
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawSender = data.senderEmail !== undefined ? data.senderEmail : (data.sender_email || '');
    const rawRole = data.senderRole !== undefined ? data.senderRole : (data.sender_role || '');
    const rawRecipient = data.recipientEmail !== undefined ? data.recipientEmail : (data.recipient_email || '');
    const rawText = data.text !== undefined ? data.text : (data.message || '');
    const rawRead = data.isRead !== undefined ? data.isRead : (data.is_read !== undefined ? data.is_read : false);

    this.id = String(rawId || '');
    this.threadId = String(rawThread || '').trim();
    this.timestamp = formatTimestamp(rawTimestamp);
    this.senderEmail = String(rawSender || '').trim().toLowerCase();
    this.senderRole = String(rawRole || '').trim().toUpperCase();
    this.recipientEmail = String(rawRecipient || '').trim().toLowerCase();
    this.text = String(rawText || '').trim();
    this.isRead = rawRead === true || String(rawRead).toUpperCase() === 'TRUE';
  }

  isFromStudent() {
    return this.senderRole.toUpperCase() === 'STUDENT';
  }

  isFromCounselor() {
    return this.senderRole.toUpperCase() === 'COUNSELOR';
  }

  toDto() {
    return {
      id: this.id,
      threadId: this.threadId,
      thread_id: this.threadId,
      timestamp: this.timestamp,
      senderEmail: this.senderEmail,
      sender_email: this.senderEmail,
      senderRole: this.senderRole,
      sender_role: this.senderRole,
      recipientEmail: this.recipientEmail,
      recipient_email: this.recipientEmail,
      text: this.text,
      isRead: this.isRead,
      is_read: this.isRead
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new ChatMessage();
    return new ChatMessage(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'threadid':
        return this.threadId;
      case 'timestamp':
        return this.timestamp;
      case 'senderemail':
        return this.senderEmail;
      case 'senderrole':
        return this.senderRole;
      case 'recipientemail':
        return this.recipientEmail;
      case 'text':
      case 'message':
        return this.text;
      case 'isread':
        return this.isRead;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: DailyQuote
 */
class DailyQuote {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawQuote = data.quote !== undefined ? data.quote : '';
    const rawAuthor = data.author !== undefined ? data.author : (data.counselor_name || data.counselorName);
    const rawName = data.counselorName !== undefined ? data.counselorName : (data.counselor_name || rawAuthor || '');
    const rawUpdated = data.updatedAt !== undefined ? data.updatedAt : (data.updated_at || data.timestamp);
    const rawEmail = data.counselorEmail !== undefined ? data.counselorEmail : (data.counselor_email || '');
    const rawNote = data.note !== undefined ? data.note : '';
    const rawActive = data.isActive !== undefined ? data.isActive : (data.is_active !== undefined ? data.is_active : true);

    this.id = String(rawId || '');
    this.quote = String(rawQuote || '').trim();
    this.author = String(rawAuthor || rawName || '').trim();
    this.counselorName = String(rawName || rawAuthor || '').trim();
    this.updatedAt = formatTimestamp(rawUpdated);
    this.counselorEmail = String(rawEmail || '').trim().toLowerCase();
    this.note = String(rawNote || '').trim();
    this.isActive = rawActive === true || String(rawActive).toUpperCase() === 'TRUE';
  }

  toDto() {
    return {
      id: this.id,
      quote: this.quote,
      author: this.author,
      counselorName: this.counselorName,
      counselor_name: this.counselorName,
      updatedAt: this.updatedAt,
      timestamp: this.updatedAt,
      counselorEmail: this.counselorEmail,
      counselor_email: this.counselorEmail,
      note: this.note,
      isActive: this.isActive,
      is_active: this.isActive
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new DailyQuote();
    return new DailyQuote(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
      case 'updatedat':
        return this.updatedAt;
      case 'counseloremail':
        return this.counselorEmail;
      case 'counselorname':
      case 'author':
        return this.counselorName || this.author;
      case 'quote':
        return this.quote;
      case 'note':
        return this.note;
      case 'isactive':
        return this.isActive;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: EducationalResource
 */
class EducationalResource {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTitle = data.title !== undefined ? data.title : '';
    const rawCategory = data.category !== undefined ? data.category : '';
    const rawEmoji = data.emoji !== undefined ? data.emoji : '';
    const rawSummary = data.summary !== undefined ? data.summary : '';
    const rawUrlOrText = data.contentUrlOrText !== undefined ? data.contentUrlOrText : (data.content_url_or_text || data.content_markdown || data.contentMarkdown || '');
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawAuthorEmail = data.authorEmail !== undefined ? data.authorEmail : (data.author_email || '');
    const rawAuthorName = data.authorName !== undefined ? data.authorName : (data.author_name || '');
    const rawCover = data.coverImageUrl !== undefined ? data.coverImageUrl : (data.cover_image_url || '');
    const rawMarkdown = data.contentMarkdown !== undefined ? data.contentMarkdown : (data.content_markdown || rawUrlOrText);
    const rawStatus = data.status !== undefined ? data.status : (data.resource_status || 'PUBLISHED');

    this.id = String(rawId || '');
    this.title = String(rawTitle || '').trim();
    this.category = String(rawCategory || '').trim();
    this.emoji = String(rawEmoji || '').trim();
    this.summary = String(rawSummary || '').trim();
    this.contentUrlOrText = String(rawUrlOrText || '').trim();
    this.timestamp = formatTimestamp(rawTimestamp);
    this.authorEmail = String(rawAuthorEmail || '').trim().toLowerCase();
    this.authorName = String(rawAuthorName || '').trim();
    this.coverImageUrl = String(rawCover || '').trim();
    this.contentMarkdown = String(rawMarkdown || '').trim();
    this.status = String(rawStatus || 'PUBLISHED').toUpperCase().trim();
  }

  isPublished() {
    return String(this.status || '').toUpperCase() === 'PUBLISHED';
  }

  toDto() {
    return {
      id: this.id,
      title: this.title,
      category: this.category,
      emoji: this.emoji,
      summary: this.summary,
      contentUrlOrText: this.contentUrlOrText,
      content_url_or_text: this.contentUrlOrText,
      timestamp: this.timestamp,
      authorEmail: this.authorEmail,
      author_email: this.authorEmail,
      authorName: this.authorName,
      author_name: this.authorName,
      coverImageUrl: this.coverImageUrl,
      cover_image_url: this.coverImageUrl,
      contentMarkdown: this.contentMarkdown,
      content_markdown: this.contentMarkdown,
      status: this.status,
      isPublished: this.isPublished()
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new EducationalResource();
    return new EducationalResource(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'title':
        return this.title;
      case 'category':
        return this.category;
      case 'emoji':
        return this.emoji;
      case 'summary':
        return this.summary;
      case 'contenturlortext':
        return this.contentUrlOrText;
      case 'timestamp':
        return this.timestamp;
      case 'authoremail':
        return this.authorEmail;
      case 'authorname':
        return this.authorName;
      case 'coverimageurl':
        return this.coverImageUrl;
      case 'contentmarkdown':
        return this.contentMarkdown || this.contentUrlOrText;
      case 'status':
        return this.status;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: SurveyQuestion
 */
class SurveyQuestion {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawSurveyId = data.surveyId !== undefined ? data.surveyId : (data.survey_id || '');
    const rawCategory = data.category !== undefined ? data.category : '';
    const rawText = data.questionText !== undefined ? data.questionText : (data.question_text || '');
    const rawTypeStr = String(data.questionType !== undefined ? data.questionType : (data.question_type || 'BINARY_YES_NO')).trim();
    const rawOrder = data.orderNum !== undefined ? data.orderNum : (data.order_num !== undefined ? data.order_num : 0);

    let cleanType = rawTypeStr || 'BINARY_YES_NO';
    let parsedOptions = [];

    if (cleanType.indexOf('::') !== -1) {
      const parts = cleanType.split('::');
      cleanType = parts[0].trim() || 'BINARY_YES_NO';
      const optPart = parts.slice(1).join('::').trim();
      parsedOptions = safeParseJson(optPart, []);
    }

    if (Array.isArray(data.options) && data.options.length > 0) {
      parsedOptions = data.options;
    } else if (typeof data.options === 'string' && data.options.trim() !== '') {
      const trimmedOpt = data.options.trim();
      if (trimmedOpt.startsWith('[')) {
        parsedOptions = safeParseJson(trimmedOpt, []);
      } else {
        parsedOptions = trimmedOpt.split(',');
      }
    }

    this.id = String(rawId || '');
    this.surveyId = String(rawSurveyId || '').trim();
    this.category = String(rawCategory || '').trim();
    this.questionText = String(rawText || '').trim();
    this.questionType = cleanType;
    this.options = Array.isArray(parsedOptions)
      ? parsedOptions.map(o => String(o || '').trim()).filter(Boolean)
      : [];
    this.orderNum = Number(rawOrder) || 0;
  }

  toDto() {
    return {
      id: this.id,
      surveyId: this.surveyId,
      survey_id: this.surveyId,
      category: this.category,
      questionText: this.questionText,
      question_text: this.questionText,
      questionType: this.questionType,
      question_type: this.questionType,
      options: this.options,
      orderNum: this.orderNum,
      order_num: this.orderNum
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new SurveyQuestion();
    return new SurveyQuestion(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'surveyid':
        return this.surveyId;
      case 'category':
        return this.category;
      case 'questiontext':
        return this.questionText;
      case 'questiontype': {
        const optionTypes = ['MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN', 'SELECT', 'RADIO'];
        if ((optionTypes.includes(this.questionType) || this.options.length > 0) && Array.isArray(this.options) && this.options.length > 0) {
          return `${this.questionType}::${JSON.stringify(this.options)}`;
        }
        return this.questionType;
      }
      case 'options':
        return JSON.stringify(this.options);
      case 'ordernum':
        return this.orderNum;
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: Survey
 */
class Survey {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawTitle = data.title !== undefined ? data.title : '';
    const rawType = data.type !== undefined ? data.type : (data.survey_type || 'SURVEY');
    const rawStatus = data.status !== undefined ? data.status : (data.survey_status || 'PUBLISHED');
    const rawDescription = data.description !== undefined ? data.description : '';
    const rawQuestions = data.questions !== undefined ? data.questions : (data.question_list || []);
    const rawScoring = data.scoringRules !== undefined ? data.scoringRules : (data.scoring_rules || {});
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawCreated = data.createdBy !== undefined ? data.createdBy : (data.created_by || '');

    this.id = String(rawId || '');
    this.title = String(rawTitle || '').trim();
    this.type = String(rawType || 'SURVEY').toUpperCase().trim();
    this.status = String(rawStatus || 'PUBLISHED').toUpperCase().trim();
    this.description = String(rawDescription || '').trim();

    let parsedQuestions = [];
    if (Array.isArray(rawQuestions)) {
      parsedQuestions = rawQuestions.map(q => (q instanceof SurveyQuestion) ? q : SurveyQuestion.fromRow(q));
    } else if (typeof rawQuestions === 'string') {
      const parsed = safeParseJson(rawQuestions, []);
      parsedQuestions = Array.isArray(parsed) ? parsed.map(q => SurveyQuestion.fromRow(q)) : [];
    }
    this.questions = parsedQuestions;

    this.scoringRules = safeParseJson(rawScoring, rawScoring);
    this.timestamp = formatTimestamp(rawTimestamp);
    this.createdBy = String(rawCreated || '').trim().toLowerCase();
  }

  isPublished() {
    return this.status === 'PUBLISHED';
  }

  toDto() {
    return {
      id: this.id,
      title: this.title,
      type: this.type,
      status: this.status,
      description: this.description,
      questions: this.questions.map(q => (q && typeof q.toDto === 'function') ? q.toDto() : q),
      scoringRules: this.scoringRules,
      scoring_rules: this.scoringRules,
      timestamp: this.timestamp,
      createdBy: this.createdBy,
      created_by: this.createdBy
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new Survey();
    return new Survey(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'timestamp':
        return this.timestamp;
      case 'title':
        return this.title;
      case 'description':
        return this.description;
      case 'status':
        return this.status;
      case 'createdby':
        return this.createdBy;
      case 'type':
        return this.type;
      case 'scoringrules':
        return typeof this.scoringRules === 'object' ? JSON.stringify(this.scoringRules) : String(this.scoringRules || '');
      default:
        return '';
    }
  }
}

/**
 * Domain Entity: SurveyResponse
 */
class SurveyResponse {
  constructor(data = {}) {
    const rawId = data.id !== undefined ? data.id : '';
    const rawSurveyId = data.surveyId !== undefined ? data.surveyId : (data.survey_id || '');
    const rawTimestamp = data.timestamp !== undefined ? data.timestamp : '';
    const rawStudent = data.studentEmail !== undefined ? data.studentEmail : (data.student_email || data.student);
    const rawAnswers = data.answers !== undefined ? data.answers : (data.answers_json || []);
    const rawScores = data.scoreSummary !== undefined ? data.scoreSummary : (data.score_summary || data.category_scores || data.category_scores_json || {});
    const rawTraits = data.traitScores !== undefined ? data.traitScores : (data.trait_scores || data.trait_scores_json || rawScores);

    this.id = String(rawId || '');
    this.surveyId = String(rawSurveyId || '').trim();
    this.timestamp = formatTimestamp(rawTimestamp);
    this.studentEmail = String(rawStudent || '').trim().toLowerCase();

    let parsedAnswers = [];
    if (Array.isArray(rawAnswers)) {
      parsedAnswers = rawAnswers;
    } else if (typeof rawAnswers === 'string') {
      parsedAnswers = safeParseJson(rawAnswers, []);
    }
    this.answers = parsedAnswers;

    const parsedScores = safeParseJson(rawScores, typeof rawScores === 'object' ? rawScores : {});
    const parsedTraits = safeParseJson(rawTraits, typeof rawTraits === 'object' ? rawTraits : parsedScores);

    this.scoreSummary = parsedScores;
    this.traitScores = parsedTraits;
  }

  getScore(category) {
    if (!category || !this.scoreSummary) return 0;
    if (this.scoreSummary[category] !== undefined) {
      return Number(this.scoreSummary[category]) || 0;
    }
    const target = String(category).toLowerCase().trim();
    for (const key of Object.keys(this.scoreSummary)) {
      if (key.toLowerCase().trim() === target) {
        return Number(this.scoreSummary[key]) || 0;
      }
    }
    return 0;
  }

  toDto() {
    return {
      id: this.id,
      surveyId: this.surveyId,
      survey_id: this.surveyId,
      timestamp: this.timestamp,
      studentEmail: this.studentEmail,
      student_email: this.studentEmail,
      answers: this.answers,
      scoreSummary: this.scoreSummary,
      category_scores: this.scoreSummary,
      traitScores: this.traitScores,
      trait_scores: this.traitScores
    };
  }

  static fromRow(rowObj) {
    if (!rowObj) return new SurveyResponse();
    return new SurveyResponse(rowObj);
  }

  toRowValue(headerName) {
    const key = normalizeHeaderKey(headerName);
    switch (key) {
      case 'id':
        return this.id;
      case 'surveyid':
        return this.surveyId;
      case 'studentemail':
        return this.studentEmail;
      case 'timestamp':
        return this.timestamp;
      case 'categoryscoresjson':
      case 'categoryscores':
      case 'scoresjson':
      case 'scoresummary':
        return JSON.stringify(this.scoreSummary || this.traitScores || {});
      case 'traitscoresjson':
      case 'traitscores':
        return JSON.stringify(this.traitScores || this.scoreSummary || {});
      case 'answersjson':
      case 'answers':
        return JSON.stringify(this.answers || []);
      default:
        return '';
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    User,
    MoodEntry,
    JournalEntry,
    ReportIncident,
    Appointment,
    ChatMessage,
    DailyQuote,
    EducationalResource,
    SurveyQuestion,
    Survey,
    SurveyResponse
  };
}
