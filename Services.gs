/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - SERVICES LAYER
 * Domain Business Logic Services with Strict RBAC, Concurrency & ALCOA Compliance
 * ============================================================================
 */

// Dual environment compatibility guards
const _svc_Config = (typeof APP_CONFIG !== 'undefined') ? {
  APP_CONFIG, ROLES, REPORT_STATUS, APPOINTMENT_STATUS, CRISIS_KEYWORDS, STANDARD_SLOTS
} : (typeof require !== 'undefined' ? require('./Config.gs') : {});

const _svc_APP_CONFIG = _svc_Config.APP_CONFIG || { SPREADSHEET_ID: '', ALLOWED_DOMAIN: '' };
const _svc_ROLES = _svc_Config.ROLES || { STUDENT: 'STUDENT', COUNSELOR: 'COUNSELOR', ADMIN: 'ADMIN' };
const _svc_CRISIS_KEYWORDS = _svc_Config.CRISIS_KEYWORDS || ['dipukul', 'ancaman', 'takut sekolah', 'menyakiti', 'diperas', 'diancam', 'bunuh diri'];
const _svc_STANDARD_SLOTS = _svc_Config.STANDARD_SLOTS || [];

const _svc_Database = (typeof DatabaseConnection !== 'undefined') ? { DatabaseConnection } : (
  typeof require !== 'undefined' ? require('./Database.gs') : {}
);
const _svc_DatabaseConnection = _svc_Database.DatabaseConnection;

const _svc_Models = (typeof User !== 'undefined') ? {
  User, MoodEntry, JournalEntry, ReportIncident, Appointment, ChatMessage, DailyQuote, EducationalResource, SurveyQuestion, Survey, SurveyResponse
} : (typeof require !== 'undefined' ? require('./Models.gs') : {});

const _svc_Repositories = (typeof UserRepository !== 'undefined') ? {
  BaseRepository, UserRepository, MoodRepository, JournalRepository, ReportRepository, AppointmentRepository, MessageRepository, QuoteRepository, ResourceRepository, CounselorRepository, SurveyRepository
} : (typeof require !== 'undefined' ? require('./Repositories.gs') : {});

/**
 * ============================================================================
 * 1. AUTH SERVICE
 * Handles Google Session identification, domain verification & Role-Based Access
 * ============================================================================
 */
class AuthService {
  constructor(dependencies = {}) {
    this.userRepo = dependencies.userRepo || new _svc_Repositories.UserRepository();
    this.counselorRepo = dependencies.counselorRepo || new _svc_Repositories.CounselorRepository();
    this.resourceRepo = dependencies.resourceRepo || new _svc_Repositories.ResourceRepository();
    this.db = dependencies.db || _svc_DatabaseConnection.getInstance();
  }

  resolveSessionUser(callerEmail) {
    let email = '';
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        email = Session.getActiveUser().getEmail();
      }
    } catch (e) {
      email = '';
    }

    if (!email && callerEmail) {
      email = callerEmail;
    }

    if (!email || String(email).trim() === '') {
      throw new Error('401 Unauthorized: Sesi login Akun Google tidak terdeteksi. Silakan login ke akun Google Anda.');
    }

    const safeEmail = String(email).toLowerCase().trim();
    const allowedDomain = (_svc_APP_CONFIG && _svc_APP_CONFIG.ALLOWED_DOMAIN) ? _svc_APP_CONFIG.ALLOWED_DOMAIN : '';
    if (allowedDomain && !safeEmail.endsWith(allowedDomain.toLowerCase())) {
      throw new Error('Akses Ditolak: Anda harus login menggunakan akun Google resmi ' + allowedDomain);
    }

    let role = _svc_ROLES.STUDENT;
    let name = safeEmail.split('@')[0];
    let userClass = '';
    let status = 'ACTIVE';
    let isRegistered = false;

    const user = this.userRepo.findByEmail(safeEmail);
    if (user) {
      name = user.name || name;
      role = (user.role || _svc_ROLES.STUDENT).toUpperCase().trim();
      userClass = (user.class || '').trim();
      status = (user.status || 'ACTIVE').toUpperCase().trim();
      isRegistered = true;
    }

    // Cross-check with Counselors sheet: if present, enforce role = COUNSELOR
    const counselor = this.counselorRepo.findByEmail(safeEmail);
    if (counselor) {
      role = _svc_ROLES.COUNSELOR;
      if (!name || name === safeEmail.split('@')[0]) {
        name = counselor.name || name;
      }
      if (!userClass) {
        userClass = counselor.title || 'Guru BK';
      }
      isRegistered = true;
    }

    return {
      email: safeEmail,
      name: name,
      role: role,
      class: userClass,
      status: status,
      isRegistered: isRegistered
    };
  }

  checkUserSession(callerEmail) {
    const user = this.resolveSessionUser(callerEmail);
    return {
      email: user.email,
      name: user.name,
      role: user.role,
      class: user.class,
      status: user.status,
      isRegistered: user.isRegistered,
      needsClassOnboarding: (!user.isRegistered || !user.class || user.class.trim() === '') && (user.role === _svc_ROLES.STUDENT)
    };
  }

  registerStudent(data) {
    let sessionEmail = '';
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        sessionEmail = Session.getActiveUser().getEmail();
      }
    } catch (e) {}

    const email = (sessionEmail || (data && data.email ? data.email.trim() : '')).toLowerCase();
    if (!email) {
      throw new Error('Email siswa tidak terdeteksi.');
    }
    const studentClass = (data && data.class ? data.class.trim() : '');
    if (!studentClass) {
      throw new Error('Kelas wajib diisi saat onboarding.');
    }

    const defaultName = email.split('@')[0];
    const name = (data && data.name && data.name.trim() !== '') ? data.name.trim() : defaultName;

    return _svc_DatabaseConnection.withWriteLock(() => {
      const existing = this.userRepo.findByEmail(email);
      let targetRole = _svc_ROLES.STUDENT;

      if (existing) {
        if (existing.role === _svc_ROLES.ADMIN || existing.role === _svc_ROLES.COUNSELOR) {
          targetRole = existing.role;
        }
        this.userRepo.update(email, {
          name: name,
          role: targetRole,
          class: studentClass,
          status: 'ACTIVE'
        });
      } else {
        this.userRepo.insert(new _svc_Models.User({
          email: email,
          name: name,
          role: _svc_ROLES.STUDENT,
          class: studentClass,
          status: 'ACTIVE'
        }));
      }

      return {
        success: true,
        message: 'Data siswa berhasil disimpan. Selamat datang di Student Well-being Hub!',
        user: { email: email, name: name, role: targetRole, class: studentClass, status: 'ACTIVE' }
      };
    });
  }

  addCounselorByAdmin(data, adminEmail) {
    const admin = this.resolveSessionUser(adminEmail);
    if (admin.role !== _svc_ROLES.ADMIN) {
      throw new Error('403 Forbidden: Hanya ADMIN yang berwenang menambahkan Guru BK (COUNSELOR)!');
    }

    const email = (data && data.email ? data.email.toLowerCase().trim() : '');
    const name = (data && data.name ? data.name.trim() : '');
    const title = (data && data.title ? data.title.trim() : 'Guru BK');

    if (!email || !name) {
      throw new Error('Email dan Nama Guru BK wajib diisi!');
    }

    return _svc_DatabaseConnection.withWriteLock(() => {
      // 1. Upsert into Users
      const existingUser = this.userRepo.findByEmail(email);
      if (existingUser) {
        this.userRepo.update(email, {
          name: name,
          role: _svc_ROLES.COUNSELOR,
          class: title,
          status: 'ACTIVE'
        });
      } else {
        this.userRepo.insert(new _svc_Models.User({
          email: email,
          name: name,
          role: _svc_ROLES.COUNSELOR,
          class: title,
          status: 'ACTIVE'
        }));
      }

      // 2. Upsert into Counselors
      const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'BK';
      const existingCounselor = this.counselorRepo.findByEmail(email);
      if (existingCounselor) {
        this.counselorRepo.update(existingCounselor.id || email, {
          name: name,
          title: title,
          status: 'Tersedia Hari Ini',
          avatar_initials: initials
        });
      } else {
        const newId = 'c-' + Date.now().toString().slice(-4);
        this.counselorRepo.insert({
          id: newId,
          name: name,
          title: title,
          email: email,
          status: 'Tersedia Hari Ini',
          avatar_initials: initials
        });
      }

      return {
        success: true,
        message: 'Guru BK ' + name + ' (' + email + ') berhasil ditambahkan oleh Admin.',
        counselor: { email: email, name: name, title: title, role: _svc_ROLES.COUNSELOR }
      };
    });
  }

  getInitialContext(devEmail) {
    const user = this.resolveSessionUser(devEmail);
    const counselors = this.counselorRepo.getAll().map(c => ({
      id: c.id,
      name: c.name,
      title: c.title,
      email: c.email,
      status: c.status,
      avatar_initials: c.avatar_initials || 'BK'
    }));

    const resources = this.resourceRepo.getAll().map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      emoji: r.emoji || 'âœ¨',
      summary: r.summary,
      content_url_or_text: r.content_url_or_text || r.contentUrlOrText
    }));

    return {
      user: user,
      counselors: counselors,
      resources: resources
    };
  }

  getStudentDirectory(searchQuery, classFilter, callerEmail) {
    const user = this.resolveSessionUser(callerEmail);
    if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
      throw new Error('403 Forbidden: Siswa tidak diizinkan mengakses data Guru BK');
    }

    const query = (searchQuery ? String(searchQuery) : '').trim().toLowerCase();
    const filterClass = (classFilter ? String(classFilter) : '').trim().toLowerCase();

    const moodRepo = new _svc_Repositories.MoodRepository();
    const surveyRepo = new _svc_Repositories.SurveyRepository();

    const allUsers = this.userRepo.getAll();
    const allMoods = moodRepo.getAll();
    const allResponses = surveyRepo.getSheet ? (function(sRepo) {
      const db = _svc_DatabaseConnection.getInstance();
      const rSheet = db.getSheet('SurveyResponses');
      if (!rSheet || rSheet.getLastRow() <= 1) return [];
      const data = rSheet.getDataRange().getValues();
      return data.slice(1);
    })(surveyRepo) : [];

    // Group latest mood by email
    const latestMoodMap = {};
    allMoods.forEach(m => {
      const uEmail = String(m.userEmail || m.user_email || '').toLowerCase().trim();
      if (!uEmail) return;
      const ts = m.timestamp;
      const entry = {
        id: m.id,
        timestamp: ts instanceof Date ? ts.toISOString() : String(ts || ''),
        user_email: uEmail,
        mood_level: m.moodLevel || m.mood_level,
        mood_score: Number(m.moodScore || m.mood_score) || 0,
        triggers: m.triggers || '',
        notes: m.notes || ''
      };

      if (!latestMoodMap[uEmail] || new Date(entry.timestamp) > new Date(latestMoodMap[uEmail].timestamp)) {
        latestMoodMap[uEmail] = entry;
      }
    });

    const surveyUserSet = {};
    allResponses.forEach(r => {
      const sEmail = (r[2] || '').toString().toLowerCase().trim();
      if (sEmail) surveyUserSet[sEmail] = true;
    });

    const results = [];
    const seen = {};

    allUsers.forEach(u => {
      if (u.role === _svc_ROLES.STUDENT && (u.status || 'ACTIVE') === 'ACTIVE') {
        const emailLower = String(u.email || '').toLowerCase().trim();
        const nameLower = String(u.name || '').toLowerCase().trim();
        const sClass = String(u.class || '').trim();

        const matchesQuery = !query || nameLower.indexOf(query) !== -1 || emailLower.indexOf(query) !== -1;
        const matchesClass = !filterClass || filterClass === 'semua' || filterClass === 'semua kelas' || sClass.toLowerCase() === filterClass;

        if (matchesQuery && matchesClass) {
          if (!emailLower || seen[emailLower]) return;
          seen[emailLower] = true;

          results.push({
            email: u.email,
            name: u.name,
            role: u.role,
            class: sClass,
            status: u.status,
            latestMood: latestMoodMap[emailLower] || null,
            hasSurvey: !!surveyUserSet[emailLower]
          });
        }
      }
    });

    return results;
  }

  requireRole(user, allowedRoles = []) {
    if (!user || !user.role) {
      throw new Error('401 Unauthorized: Pengguna belum terautentikasi.');
    }
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!roles.includes(user.role)) {
      throw new Error('403 Forbidden: Anda tidak memiliki hak akses yang cukup.');
    }
    return true;
  }
}

/**
 * ============================================================================
 * 2. MOOD SERVICE
 * Manages daily mood tracking and historical trends
 * ============================================================================
 */
class MoodService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.moodRepo = dependencies.moodRepo || new _svc_Repositories.MoodRepository();
  }

  submitMood(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      const moodLevel = payload.moodLevel || payload.mood_level || 'Netral';
      const now = Date.now();

      // Server-Side Anti-Deduplication Guard within 10 seconds
      const userMoods = this.moodRepo.findByUserEmail(user.email);
      if (userMoods && userMoods.length > 0) {
        let lastMood = null;
        let lastTime = -Infinity;
        for (const m of userMoods) {
          const t = new Date(m.timestamp).getTime();
          if (!isNaN(t) && t > lastTime) {
            lastTime = t;
            lastMood = m;
          }
        }
        if (lastMood) {
          const prevEmail = String(lastMood.userEmail || lastMood.user_email || '').toLowerCase().trim();
          const prevLevel = String(lastMood.moodLevel || lastMood.mood_level || '').trim();
          if (prevEmail === user.email.toLowerCase().trim() && prevLevel.toLowerCase() === String(moodLevel).toLowerCase().trim() && Math.abs(now - lastTime) < 10000) {
            return { success: true, id: lastMood.id, deduplicated: true };
          }
        }
      }

      // Feelings Wheel & Legacy Score Mapping
      let rawScore = payload.moodScore !== undefined ? payload.moodScore : payload.mood_score;
      let moodScore = Number(rawScore) || 0;
      if (moodScore === 0) {
        const lvl = String(moodLevel).toLowerCase().trim();
        const scoreMap = [
          { prefix: 'happy', score: 5 }, { prefix: 'hebat', score: 5 }, { prefix: 'senang', score: 5 },
          { prefix: 'surprise', score: 4 }, { prefix: 'terkejut', score: 4 }, { prefix: 'kaget', score: 4 }, { prefix: 'baik', score: 4 },
          { prefix: 'b aja', score: 3 }, { prefix: 'netral', score: 3 },
          { prefix: 'sad', score: 2 }, { prefix: 'sedih', score: 2 }, { prefix: 'disgust', score: 2 }, { prefix: 'muak', score: 2 }, { prefix: 'lelah', score: 2 },
          { prefix: 'anger', score: 1 }, { prefix: 'angry', score: 1 }, { prefix: 'marah', score: 1 }, { prefix: 'fear', score: 1 }, { prefix: 'takut', score: 1 }, { prefix: 'cemas', score: 1 }, { prefix: 'stres', score: 1 }
        ];
        for (const item of scoreMap) {
          if (lvl === item.prefix || lvl.startsWith(item.prefix + ' ') || lvl.startsWith(item.prefix + '-') || lvl.startsWith(item.prefix + '_') || lvl.startsWith(item.prefix + ':')) {
            moodScore = item.score;
            break;
          }
        }
        if (moodScore === 0) moodScore = 3;
      }

      const id = 'm-' + now;
      const timestamp = new Date(now).toISOString();
      const triggers = Array.isArray(payload.triggers) ? payload.triggers.join(', ') : (payload.triggers || '');
      const notes = payload.notes || '';

      const entry = new _svc_Models.MoodEntry({
        id: id,
        timestamp: timestamp,
        user_email: user.email,
        mood_level: moodLevel,
        mood_score: moodScore,
        triggers: triggers,
        notes: notes
      });

      this.moodRepo.insert(entry);
      return { success: true, id: id };
    });
  }

  getStudentMoodTrend(days, callerEmail) {
    const user = this.authService.resolveSessionUser(callerEmail);
    const targetEmail = user.email.toLowerCase().trim();
    const numDays = Number(days) || 7;
    const cutoff = new Date(Date.now() - numDays * 86400000);

    const allMoods = this.moodRepo.findByUserEmail(targetEmail);
    const results = [];

    allMoods.forEach(m => {
      let tDate = null;
      if (m.timestamp instanceof Date) {
        tDate = m.timestamp;
      } else if (typeof m.timestamp === 'string') {
        tDate = new Date(m.timestamp);
      }

      if (tDate && !isNaN(tDate.getTime()) && tDate >= cutoff) {
        results.push({
          id: m.id,
          timestamp: tDate.toISOString(),
          mood_level: m.moodLevel,
          mood_score: Number(m.moodScore) || 0,
          triggers: m.triggers,
          notes: m.notes
        });
      }
    });

    results.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return results;
  }

  _computeMoodStreak(moodEntries) {
    if (!Array.isArray(moodEntries) || moodEntries.length === 0) return 0;
    const formatDay = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    };
    const dayKeys = new Set();
    moodEntries.forEach(m => {
      const d = new Date(m.timestamp);
      if (!isNaN(d.getTime())) {
        dayKeys.add(formatDay(d));
      }
    });
    if (dayKeys.size === 0) return 0;
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    const todayKey = formatDay(cursor);
    if (!dayKeys.has(todayKey)) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (true) {
      const key = formatDay(cursor);
      if (dayKeys.has(key)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  getStudentMoodHistory(callerEmail) {
    const user = this.authService.resolveSessionUser(callerEmail);
    const targetEmail = user.email.toLowerCase().trim();
    const allMoods = this.moodRepo.findByUserEmail(targetEmail);
    const results = [];

    allMoods.forEach(m => {
      let tDate = null;
      if (m.timestamp instanceof Date) {
        tDate = m.timestamp;
      } else if (typeof m.timestamp === 'string') {
        tDate = new Date(m.timestamp);
      }
      const tsIso = (tDate && !isNaN(tDate.getTime())) ? tDate.toISOString() : String(m.timestamp || '');
      results.push({
        id: m.id,
        timestamp: tsIso,
        user_email: targetEmail,
        mood_level: m.moodLevel || m.mood_level,
        mood_score: Number(m.moodScore || m.mood_score) || 0,
        triggers: Array.isArray(m.triggers) ? m.triggers.join(', ') : String(m.triggers || ''),
        notes: String(m.notes || '')
      });
    });

    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const streakDays = this._computeMoodStreak(results);
    return { success: true, streakDays: streakDays, data: results };
  }
}

/**
 * ============================================================================
 * 3. TRIAGE SERVICE
 * Rule-Based Early Warning System (EWS) for counselor intervention
 * ============================================================================
 */
class TriageService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.moodRepo = dependencies.moodRepo || new _svc_Repositories.MoodRepository();
    this.reportRepo = dependencies.reportRepo || new _svc_Repositories.ReportRepository();
    this.appointmentRepo = dependencies.appointmentRepo || new _svc_Repositories.AppointmentRepository();
    this.messageRepo = dependencies.messageRepo || new _svc_Repositories.MessageRepository();
    this.userRepo = dependencies.userRepo || new _svc_Repositories.UserRepository();
  }

  _isNegativeMood(entry) {
    if (!entry) return false;
    if (typeof entry.isNegative === 'function') {
      return entry.isNegative();
    }
    const score = Number(entry.moodScore !== undefined ? entry.moodScore : entry.mood_score) || 0;
    if (score > 0 && score <= 2) return true;
    const lvl = String(entry.moodLevel || entry.mood_level || '').toLowerCase().trim();
    const negativePrefixes = [
      'stres', 'lelah', 'buruk', 'sangat buruk', 'sedih', 'terpuruk', 'cemas', 'marah',
      'sad', 'disgust', 'anger', 'fear', 'muak', 'takut', 'kecewa', 'frustrasi',
      'angry', 'disgusted', 'scared', 'fearful', 'mad', 'bad'
    ];
    return negativePrefixes.some(prefix =>
      lvl === prefix || lvl.startsWith(prefix + ' ') || lvl.startsWith(prefix + '-') || lvl.startsWith(prefix + '_')
    );
  }

  evaluateMoodStreak(studentEmail, days = 7) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const moods = this.moodRepo.findByUserEmail(studentEmail);
    let stressCount = 0;
    moods.forEach(m => {
      const ts = new Date(m.timestamp).getTime();
      if (!isNaN(ts) && ts >= cutoff) {
        if (this._isNegativeMood(m)) {
          stressCount++;
        }
      }
    });
    return {
      studentEmail: studentEmail,
      stressCount: stressCount,
      isFlagged: stressCount >= 3
    };
  }

  evaluateReportRisk(detailText) {
    const text = String(detailText || '').toLowerCase();
    const isCrisis = _svc_CRISIS_KEYWORDS.some(w => text.indexOf(w) !== -1);
    return {
      isCrisis: isCrisis
    };
  }

  getCounselorDashboard(sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
      throw new Error('403 Forbidden: Hanya Guru BK / Konselor atau ADMIN yang memiliki hak akses');
    }

    const moods = this.moodRepo.getAll();
    const reports = this.reportRepo.getAll();
    const appointments = this.appointmentRepo.getAll();
    const messages = this.messageRepo.getAll();

    const stressMap = {};
    const cutoff7Days = Date.now() - 7 * 86400000;
    moods.forEach(m => {
      const email = String(m.userEmail || m.user_email || '').toLowerCase().trim();
      const ts = new Date(m.timestamp).getTime();
      if (!isNaN(ts) && ts >= cutoff7Days) {
        if (this._isNegativeMood(m)) {
          stressMap[email] = (stressMap[email] || 0) + 1;
        }
      }
    });

    const flaggedStudents = [];
    Object.keys(stressMap).forEach(email => {
      if (stressMap[email] >= 3) {
        flaggedStudents.push({
          email: email,
          stressCount: stressMap[email],
          riskLevel: 'SEDANG_TINGGI',
          reason: stressMap[email] + 'x tercatat emosi negatif/stres dalam 7 hari terakhir.'
        });
      }
    });

    const highRiskReports = [];
    const parsedReports = [];
    reports.forEach(r => {
      const rep = {
        id: r.id,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
        reporter_email: r.reporterEmail || r.reporter_email,
        role_type: r.roleType || r.role_type,
        detail: r.detail,
        status: r.status,
        counselor_notes: r.counselorNotes || r.counselor_notes || ''
      };
      parsedReports.push(rep);

      const text = (rep.detail || '').toLowerCase();
      const isCrisis = _svc_CRISIS_KEYWORDS.some(w => text.indexOf(w) !== -1);
      if (isCrisis) {
        highRiskReports.push(rep);
      }
    });

    const parsedAppointments = [];
    appointments.forEach(a => {
      if (a.id && String(a.id).trim() !== '') {
        let targetDateStr = '';
        if (a.targetDate instanceof Date) {
          const y = a.targetDate.getFullYear();
          const m = String(a.targetDate.getMonth() + 1).padStart(2, '0');
          const d = String(a.targetDate.getDate()).padStart(2, '0');
          targetDateStr = `${y}-${m}-${d}`;
        } else {
          targetDateStr = String(a.targetDate || '');
        }

        let timestampStr = '';
        if (a.timestamp instanceof Date) {
          timestampStr = a.timestamp.toISOString();
        } else {
          timestampStr = String(a.timestamp || '');
        }

        parsedAppointments.push({
          id: String(a.id),
          timestamp: timestampStr,
          student_email: String(a.studentEmail || a.student_email || ''),
          counselor_email: String(a.counselorEmail || a.counselor_email || ''),
          target_date: targetDateStr,
          time_slot: String(a.timeSlot || a.time_slot || ''),
          topic: String(a.topic || ''),
          status: String(a.status || 'MENUNGGU'),
          calendar_event_id: a.calendarEventId || a.calendar_event_id || ''
        });
      }
    });

    const parsedMessages = [];
    messages.forEach(m => {
      if (m.id) {
        let mTime = '';
        if (m.timestamp instanceof Date) {
          mTime = m.timestamp.toISOString();
        } else {
          mTime = String(m.timestamp || '');
        }
        parsedMessages.push({
          id: String(m.id),
          thread_id: String(m.threadId || m.thread_id || ''),
          timestamp: mTime,
          sender_email: String(m.senderEmail || m.sender_email || '').toLowerCase().trim(),
          sender_role: m.senderRole || m.sender_role,
          recipient_email: String(m.recipientEmail || m.recipient_email || '').toLowerCase().trim(),
          text: String(m.text || ''),
          is_read: m.isRead === true || String(m.isRead).toLowerCase() === 'true'
        });
      }
    });

    // Today unique checkins ratio calculation
    const allUsers = this.userRepo.getAll ? this.userRepo.getAll() : [];
    const activeStudentEmails = new Set(
      allUsers
        .filter(u => (u.role || u.userRole || u.roleType) === _svc_ROLES.STUDENT && (u.status || 'ACTIVE') === 'ACTIVE')
        .map(u => String(u.email || '').toLowerCase().trim())
    );

    const todayUniqueEmails = new Set();
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    moods.forEach(m => {
      const email = String(m.userEmail || m.user_email || '').toLowerCase().trim();
      if (!email) return;

      let mDateIso = '';
      let mDateLocal = '';
      if (m.timestamp instanceof Date) {
        mDateIso = m.timestamp.toISOString().slice(0, 10);
        mDateLocal = `${m.timestamp.getFullYear()}-${String(m.timestamp.getMonth() + 1).padStart(2, '0')}-${String(m.timestamp.getDate()).padStart(2, '0')}`;
      } else if (typeof m.timestamp === 'string') {
        mDateIso = m.timestamp.slice(0, 10);
        const d = new Date(m.timestamp);
        if (!isNaN(d.getTime())) {
          mDateLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }

      if ((mDateIso === todayIso || mDateLocal === todayLocal) && activeStudentEmails.has(email)) {
        todayUniqueEmails.add(email);
      }
    });

    const todayUniqueCount = todayUniqueEmails.size;
    const totalStudents = activeStudentEmails.size;
    return {
      metrics: {
        todayCheckins: `${todayUniqueCount}/${totalStudents}`,
        todayCheckinCount: todayUniqueCount,
        totalStudents: totalStudents,
        newReports: parsedReports.filter(r => r.status === 'BARU').length,
        pendingAppointments: parsedAppointments.filter(a => a.status === 'MENUNGGU').length,
        triageAlertsCount: flaggedStudents.length + highRiskReports.length
      },
      triageAlerts: {
        flaggedStudents: flaggedStudents,
        highRiskReports: highRiskReports
      },
      reports: parsedReports.reverse(),
      appointments: parsedAppointments.reverse(),
      messages: parsedMessages.reverse()
    };
  }
}

/** */
class AppointmentService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.appointmentRepo = dependencies.appointmentRepo || new _svc_Repositories.AppointmentRepository();
  }

  getAvailableSlots(arg1, arg2, sessionEmail) {
    let counselorEmail = '';
    let targetDate = '';
    let effectiveSession = sessionEmail;

    if (arg1 && typeof arg1 === 'object') {
      counselorEmail = arg1.counselorEmail || arg1.counselor_email || '';
      targetDate = arg1.targetDate || arg1.target_date || '';
      effectiveSession = arg2 || sessionEmail;
    } else {
      counselorEmail = arg1;
      targetDate = arg2;
    }

    this.authService.resolveSessionUser(effectiveSession);
    const appointments = this.appointmentRepo.getAll();
    const bookedSlots = [];

    const normTarget = _normalizeDateHelper(targetDate);
    appointments.forEach(a => {
      const cEmail = String(a.counselorEmail || a.counselor_email || '').toLowerCase().trim();
      const rowDateNorm = _normalizeDateHelper(a.targetDate || a.target_date);
      const slotStr = a.timeSlot || a.time_slot;
      const status = a.status;

      if (cEmail === (counselorEmail || '').toLowerCase().trim() && rowDateNorm === normTarget && status !== 'DIBATALKAN' && status !== 'DITOLAK') {
        bookedSlots.push(slotStr);
      }
    });

    const slots = _svc_STANDARD_SLOTS.map(s => {
      const isBooked = bookedSlots.some(b => {
        if (!b) return false;
        if (b === s.label || b === s.id) return true;
        const sPrefix = s.label.split(' (')[0].trim().toLowerCase();
        const bPrefix = b.split(' (')[0].trim().toLowerCase();
        if (sPrefix === bPrefix) return true;
        const sTime = s.label.match(/\d{2}:\d{2}/);
        const bTime = b.match(/\d{2}:\d{2}/);
        return Boolean(sTime && bTime && sTime[0] === bTime[0]);
      });
      return {
        id: s.id,
        label: s.label,
        available: !isBooked
      };
    });

    return { success: true, data: slots };
  }

  getStudentAppointments(sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    const appointments = this.appointmentRepo.findByStudent(user.email);
    const result = [];

    appointments.forEach(a => {
      let targetDateStr = '';
      if (a.targetDate instanceof Date) {
        const y = a.targetDate.getFullYear();
        const m = String(a.targetDate.getMonth() + 1).padStart(2, '0');
        const d = String(a.targetDate.getDate()).padStart(2, '0');
        targetDateStr = `${y}-${m}-${d}`;
      } else {
        targetDateStr = String(a.targetDate || '');
      }

      let timestampStr = '';
      if (a.timestamp instanceof Date) {
        timestampStr = a.timestamp.toISOString();
      } else {
        timestampStr = String(a.timestamp || '');
      }

      result.push({
        id: String(a.id),
        timestamp: timestampStr,
        student_email: String(a.studentEmail || a.student_email),
        counselor_email: String(a.counselorEmail || a.counselor_email),
        target_date: targetDateStr,
        time_slot: String(a.timeSlot || a.time_slot || ''),
        topic: String(a.topic || ''),
        status: String(a.status || 'MENUNGGU'),
        calendar_event_id: a.calendarEventId || a.calendar_event_id || ''
      });
    });

    return result.reverse();
  }

  submitAppointment(payload, sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    return _svc_DatabaseConnection.withWriteLock(() => {
      const counselorEmail = payload.counselor_email || payload.counselorEmail;
      const targetDate = payload.target_date || payload.targetDate;
      const timeSlot = payload.time_slot || payload.timeSlot;
      const topic = payload.topic;

      const normTarget = _normalizeDateHelper(targetDate);
      const allAppointments = this.appointmentRepo.getAll();

      for (let i = 0; i < allAppointments.length; i++) {
        const a = allAppointments[i];
        const cEmail = String(a.counselorEmail || a.counselor_email || '').toLowerCase().trim();
        const sEmail = String(a.studentEmail || a.student_email || '').toLowerCase().trim();
        const rowDateNorm = _normalizeDateHelper(a.targetDate || a.target_date);
        const rowSlot = String(a.timeSlot || a.time_slot || '');
        const rowStatus = String(a.status || '');

        if (rowStatus !== 'DIBATALKAN' && rowStatus !== 'DITOLAK' && rowDateNorm === normTarget && rowSlot === timeSlot) {
          if (cEmail === (counselorEmail || '').toLowerCase().trim()) {
            throw new Error('Maaf, slot waktu ini baru saja dipesan oleh siswa lain. Silakan pilih slot atau tanggal lain.');
          }
          if (sEmail === (user.email || '').toLowerCase().trim()) {
            throw new Error('Maaf, slot waktu ini baru saja dipesan oleh siswa lain. Silakan pilih slot atau tanggal lain.');
          }
        }
      }

      const id = 'apt-' + new Date().getTime();
      const timestamp = new Date().toISOString();

      const newApt = new _svc_Models.Appointment({
        id: id,
        timestamp: timestamp,
        student_email: user.email,
        counselor_email: counselorEmail,
        target_date: targetDate,
        time_slot: timeSlot,
        topic: topic,
        status: 'MENUNGGU',
        calendar_event_id: ''
      });

      this.appointmentRepo.insert(newApt);

      const aptData = {
        id: id,
        timestamp: timestamp,
        student_email: user.email,
        counselor_email: counselorEmail,
        target_date: targetDate,
        time_slot: timeSlot,
        topic: topic,
        status: 'MENUNGGU',
        calendar_event_id: ''
      };

      return { success: true, id: id, appointment: aptData, data: aptData };
    });
  }

  requestAppointment(payload, sessionEmail) {
    return this.submitAppointment(payload, sessionEmail);
  }

  updateAppointmentStatus(idOrPayload, newStatus, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      let appointmentId = '';
      let status = '';
      let effectiveSession = sessionEmail;

      if (idOrPayload && typeof idOrPayload === 'object') {
        appointmentId = idOrPayload.appointmentId || idOrPayload.id;
        status = idOrPayload.status;
        effectiveSession = newStatus || sessionEmail;
      } else {
        appointmentId = idOrPayload;
        status = newStatus;
      }

      const user = this.authService.resolveSessionUser(effectiveSession);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang dapat menyetujui janji temu');
      }

      const targetApt = this.appointmentRepo.findById(appointmentId);
      if (!targetApt) {
        throw new Error('Janji temu tidak ditemukan');
      }

      const targetStatus = targetApt.status;
      let calendarEventId = targetApt.calendarEventId || targetApt.calendar_event_id || '';

      // Idempotent Calendar: If already DISETUJUI and calendarEventId already set, return immediately
      if (status === 'DISETUJUI' && targetStatus === 'DISETUJUI' && calendarEventId) {
        const existingAppointment = {
          id: targetApt.id,
          timestamp: targetApt.timestamp,
          student_email: targetApt.studentEmail || targetApt.student_email,
          counselor_email: targetApt.counselorEmail || targetApt.counselor_email,
          target_date: targetApt.targetDate || targetApt.target_date,
          time_slot: targetApt.timeSlot || targetApt.time_slot,
          topic: targetApt.topic,
          status: targetStatus,
          calendar_event_id: calendarEventId
        };
        return { success: true, appointment: existingAppointment, data: existingAppointment };
      }

      if (status === 'DISETUJUI') {
        if (!calendarEventId) {
          try {
            const studentEmail = targetApt.studentEmail || targetApt.student_email;
            let targetDateStr = '';
            if (targetApt.targetDate instanceof Date) {
              const y = targetApt.targetDate.getFullYear();
              const m = String(targetApt.targetDate.getMonth() + 1).padStart(2, '0');
              const d = String(targetApt.targetDate.getDate()).padStart(2, '0');
              targetDateStr = `${y}-${m}-${d}`;
            } else {
              targetDateStr = String(targetApt.targetDate || targetApt.target_date || '');
            }
            const timeSlotStr = targetApt.timeSlot || targetApt.time_slot;
            const topic = targetApt.topic;

            let startH = 10, startM = 0, endH = 10, endM = 30;
            const matchedSlot = _svc_STANDARD_SLOTS.find(s => {
              if (s.label === timeSlotStr || s.id === timeSlotStr) return true;
              const sPrefix = s.label.split(' (')[0].trim().toLowerCase();
              const bPrefix = String(timeSlotStr || '').split(' (')[0].trim().toLowerCase();
              return sPrefix === bPrefix;
            });
            if (matchedSlot) {
              startH = matchedSlot.startH;
              startM = matchedSlot.startM;
              endH = matchedSlot.endH;
              endM = matchedSlot.endM;
            } else if (timeSlotStr.indexOf('12:30') !== -1) {
              startH = 12; startM = 30; endH = 13; endM = 0;
            } else if (timeSlotStr.indexOf('15:00') !== -1) {
              startH = 15; startM = 0; endH = 15; endM = 30;
            }

            const dParts = targetDateStr.split('-');
            if (dParts.length === 3 && typeof CalendarApp !== 'undefined' && CalendarApp.getDefaultCalendar) {
              const start = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10), startH, startM, 0);
              const end = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10), endH, endM, 0);

              const event = CalendarApp.getDefaultCalendar().createEvent(
                '[Konseling BK] ' + topic + ' (' + studentEmail + ')',
                start,
                end,
                {
                  description: 'Sesi konseling tatap muka di ruang BK bersama siswa ' + studentEmail + '.\nTopik: ' + topic,
                  guests: studentEmail,
                  sendInvites: true
                }
              );
              calendarEventId = event ? event.getId() : ('cal-' + new Date().getTime());
            } else {
              calendarEventId = 'cal-' + new Date().getTime();
            }
          } catch (calErr) {
            calendarEventId = 'cal-' + new Date().getTime();
          }
        }
      }

      this.appointmentRepo.update(appointmentId, {
        status: status,
        calendar_event_id: calendarEventId
      });

      const updatedAppointment = {
        id: targetApt.id,
        timestamp: targetApt.timestamp,
        student_email: targetApt.studentEmail || targetApt.student_email,
        counselor_email: targetApt.counselorEmail || targetApt.counselor_email,
        target_date: targetApt.targetDate || targetApt.target_date,
        time_slot: targetApt.timeSlot || targetApt.time_slot,
        topic: targetApt.topic,
        status: status,
        calendar_event_id: calendarEventId
      };

      return { success: true, appointment: updatedAppointment, data: updatedAppointment };
    });
  }
  updateAppointment(payload, sessionEmail) {
    return this.updateAppointmentStatus(payload, null, sessionEmail);
  }
}

/**
 * ============================================================================
 * 5. JOURNAL SERVICE
 * Manages private reflective journaling for students
 * ============================================================================
 */
class JournalService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.journalRepo = dependencies.journalRepo || new _svc_Repositories.JournalRepository();
  }

  saveJournal(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      const id = payload.id || ('j-' + new Date().getTime());
      const timestamp = new Date().toISOString();
      const title = payload.title || 'Catatan Refleksi';
      const content = payload.content || '';

      if (payload.id) {
        const updated = this.journalRepo.update(payload.id, {
          title: title,
          content: content,
          timestamp: timestamp
        });
        if (updated) {
          return { success: true, id: payload.id };
        }
      }

      this.journalRepo.insert(new _svc_Models.JournalEntry({
        id: id,
        timestamp: timestamp,
        user_email: user.email,
        title: title,
        content: content
      }));

      return { success: true, id: id };
    });
  }

  submitJournal(payload, sessionEmail) {
    return this.saveJournal(payload, sessionEmail);
  }

  getJournals(sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    const journals = this.journalRepo.findByUserEmail(user.email);
    return journals.map(j => ({
      id: j.id,
      timestamp: j.timestamp instanceof Date ? j.timestamp.toISOString() : String(j.timestamp || ''),
      user_email: j.userEmail || j.user_email,
      title: j.title,
      content: j.content
    }));
  }

  getStudentJournals(sessionEmail) {
    return this.getJournals(sessionEmail);
  }
}

/**
 * ============================================================================
 * 6. REPORT SERVICE
 * Incident reporting, full pseudonymization & counselor investigations
 * ============================================================================
 */
class ReportService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.reportRepo = dependencies.reportRepo || new _svc_Repositories.ReportRepository();
  }

  submitReport(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      const id = 'rep-' + new Date().getTime();
      const timestamp = new Date().toISOString();
      const roleType = payload.roleType || 'Korban';
      const detail = payload.detail || '';
      const isAnonymous = payload.isAnonymous === true;
      const reporter = isAnonymous ? ('ANON-' + Math.floor(1000 + Math.random() * 9000)) : user.email;

      this.reportRepo.insert(new _svc_Models.ReportIncident({
        id: id,
        timestamp: timestamp,
        reporter_email: reporter,
        role_type: roleType,
        detail: detail,
        status: 'BARU',
        counselor_notes: ''
      }));

      return { success: true, id: id, isAnonymous: isAnonymous };
    });
  }

  updateReportStatus(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang dapat mengubah status laporan');
      }

      const reportId = payload.reportId || payload.id;
      const updateData = { status: payload.status };
      if (payload.notes) {
        updateData.counselor_notes = payload.notes;
      }

      const updated = this.reportRepo.update(reportId, updateData);
      if (!updated) {
        throw new Error('Laporan tidak ditemukan');
      }

      return { success: true };
    });
  }
}

/**
 * ============================================================================
 * 7. CHAT SERVICE
 * Asynchronous messaging between student and counselor with de-duplication
 * ============================================================================
 */
class ChatService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.messageRepo = dependencies.messageRepo || new _svc_Repositories.MessageRepository();
  }

  sendMessage(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      const id = 'msg-' + new Date().getTime();
      const timestamp = new Date().toISOString();
      const senderEmail = (user.email || '').toLowerCase().trim();
      const recipientEmail = (payload && payload.recipientEmail ? payload.recipientEmail.trim() : '').toLowerCase();
      const text = (payload && payload.text ? payload.text.trim() : '');

      if (!recipientEmail || !text) {
        throw new Error('Penerima dan pesan tidak boleh kosong.');
      }

      const participants = [senderEmail, recipientEmail].sort();
      const threadId = 'th-' + participants[0].replace(/[^a-zA-Z0-9]/g, '-') + '__' + participants[1].replace(/[^a-zA-Z0-9]/g, '-');

      // Server-Side Anti-Deduplication Guard within 6 seconds
      const allMessages = this.messageRepo.getAll();
      const recent = allMessages.slice(-5);
      const nowMs = new Date(timestamp).getTime();

      for (let i = recent.length - 1; i >= 0; i--) {
        const prev = recent[i];
        const prevSender = String(prev.senderEmail || prev.sender_email || '').toLowerCase().trim();
        const prevRecipient = String(prev.recipientEmail || prev.recipient_email || '').toLowerCase().trim();
        const prevText = String(prev.text || '').trim();
        const prevTimeMs = new Date(prev.timestamp).getTime();

        if (prevSender === senderEmail && prevRecipient === recipientEmail && prevText === text) {
          if (Math.abs(nowMs - prevTimeMs) < 6000) {
            return {
              success: true,
              id: prev.id,
              data: {
                id: prev.id,
                thread_id: prev.threadId || prev.thread_id,
                timestamp: prev.timestamp,
                sender_email: prevSender,
                sender_role: prev.senderRole || prev.sender_role,
                recipient_email: prevRecipient,
                text: prevText,
                is_read: prev.isRead !== undefined ? prev.isRead : prev.is_read
              }
            };
          }
        }
      }

      const chatMsg = new _svc_Models.ChatMessage({
        id: id,
        thread_id: threadId,
        timestamp: timestamp,
        sender_email: senderEmail,
        sender_role: user.role,
        recipient_email: recipientEmail,
        text: text,
        is_read: false
      });

      this.messageRepo.insert(chatMsg);

      return {
        success: true,
        id: id,
        data: {
          id: id,
          thread_id: threadId,
          timestamp: timestamp,
          sender_email: senderEmail,
          sender_role: user.role,
          recipient_email: recipientEmail,
          text: text,
          is_read: false
        }
      };
    });
  }

  getMessages(sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    const userEmail = (user.email || '').toLowerCase().trim();
    const allMessages = this.messageRepo.getAll();
    const result = [];

    allMessages.forEach(m => {
      const sender = String(m.senderEmail || m.sender_email || '').toLowerCase().trim();
      const recipient = String(m.recipientEmail || m.recipient_email || '').toLowerCase().trim();
      if (sender === userEmail || recipient === userEmail) {
        let timestampStr = '';
        if (m.timestamp instanceof Date) {
          timestampStr = m.timestamp.toISOString();
        } else {
          timestampStr = String(m.timestamp || '');
        }
        const isRead = m.isRead === true || String(m.isRead).toLowerCase() === 'true';

        result.push({
          id: String(m.id || ''),
          thread_id: String(m.threadId || m.thread_id || ''),
          timestamp: timestampStr,
          sender_email: sender,
          sender_role: m.senderRole || m.sender_role,
          recipient_email: recipient,
          text: String(m.text || ''),
          is_read: isRead
        });
      }
    });

    return { success: true, data: result };
  }

  markMessagesAsRead(peerEmail, sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    const myEmail = (user.email || '').toLowerCase().trim();
    const pEmail = (peerEmail || '').toLowerCase().trim();

    let threadId = null;
    if (pEmail) {
      const participants = [myEmail, pEmail].sort();
      threadId = 'th-' + participants[0].replace(/[^a-zA-Z0-9]/g, '-') + '__' + participants[1].replace(/[^a-zA-Z0-9]/g, '-');
    }

    const count = this.messageRepo.markAsRead(threadId, myEmail);
    return { success: true, updatedCount: count };
  }
}

/**
 * ============================================================================
 * 8. PSYCHOEDUCATION SERVICE
 * Quotes of the day & educational articles CMS
 * ============================================================================
 */
class PsychoeducationService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.quoteRepo = dependencies.quoteRepo || new _svc_Repositories.QuoteRepository();
    this.articleRepo = dependencies.articleRepo || new _svc_Repositories.ResourceRepository('EducationalArticles');
  }

  getActiveQuote(sessionEmail) {
    this.authService.resolveSessionUser(sessionEmail);
    const quote = this.quoteRepo.getActiveQuote();
    if (!quote) return { success: true, data: null };

    return {
      success: true,
      data: {
        id: quote.id,
        timestamp: quote.timestamp || quote.updatedAt,
        counselor_email: quote.counselorEmail || quote.counselor_email,
        counselor_name: quote.counselorName || quote.counselor_name || quote.author,
        quote: quote.quote,
        note: quote.note,
        is_active: quote.isActive !== undefined ? quote.isActive : true
      }
    };
  }

  setDailyQuote(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang berwenang memperbarui kata motivasi harian.');
      }

      const safeQuote = String(payload && payload.quote ? payload.quote : '').trim();
      const safeNote = String(payload && payload.note ? payload.note : '').trim();
      if (!safeQuote) {
        throw new Error('Kata motivasi tidak boleh kosong.');
      }

      const newId = 'mq-' + new Date().getTime();
      const timestamp = new Date().toISOString();
      const counselorEmail = user.email;
      const counselorName = user.name || counselorEmail.split('@')[0];

      // Insert new active quote
      const newQuote = new _svc_Models.DailyQuote({
        id: newId,
        timestamp: timestamp,
        counselor_email: counselorEmail,
        counselor_name: counselorName,
        quote: safeQuote,
        note: safeNote,
        is_active: true
      });
      this.quoteRepo.insert(newQuote);

      // Deactivate other quotes
      this.quoteRepo.setActiveQuote(newId);

      const quoteData = {
        id: newId,
        timestamp: timestamp,
        counselor_email: counselorEmail,
        counselor_name: counselorName,
        quote: safeQuote,
        note: safeNote,
        is_active: true
      };

      return { success: true, data: quoteData };
    });
  }

  getEducationalArticles(sessionEmail) {
    const user = this.authService.resolveSessionUser(sessionEmail);
    const isStaff = user.role === _svc_ROLES.COUNSELOR || user.role === _svc_ROLES.ADMIN;
    const allArticles = this.articleRepo.getAll();
    const articles = [];

    allArticles.forEach(r => {
      const status = String(r.status || 'PUBLISHED').toUpperCase().trim();
      if (!isStaff && status !== 'PUBLISHED') return;

      articles.push({
        id: r.id,
        timestamp: r.timestamp,
        author_email: r.author_email || r.authorEmail,
        author_name: r.author_name || r.authorName,
        title: r.title,
        category: r.category,
        cover_image_url: r.cover_image_url || r.coverImageUrl,
        summary: r.summary,
        content_markdown: r.content_markdown || r.contentMarkdown,
        status: status
      });
    });

    return { success: true, data: articles.reverse() };
  }

  saveEducationalArticle(payload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang berwenang mengelola artikel edukasi.');
      }

      const safeTitle = (payload && payload.title ? payload.title.trim() : '');
      if (!safeTitle) throw new Error('Judul artikel wajib diisi.');

      const rawContent = (payload && (payload.content_markdown !== undefined ? payload.content_markdown : payload.contentMarkdown)) || '';
      const safeContent = (typeof rawContent === 'string' ? rawContent : '').trim();
      if (!safeContent) throw new Error('Isi konten artikel wajib diisi.');

      const targetId = payload && (payload.id || payload.articleId) ? (payload.id || payload.articleId).toString().trim() : '';
      const authorEmail = user.email;
      const authorName = user.name || authorEmail.split('@')[0];
      const category = payload && payload.category ? payload.category.trim() : 'Umum';
      const rawCoverImage = (payload && (payload.cover_image_url !== undefined ? payload.cover_image_url : payload.coverImageUrl)) || '';
      const coverImageUrl = (typeof rawCoverImage === 'string' ? rawCoverImage : '').trim();
      const summary = payload && payload.summary ? payload.summary.trim() : '';
      const status = (payload && payload.status ? payload.status.trim().toUpperCase() : 'PUBLISHED');

      if (targetId) {
        const existing = this.articleRepo.findById(targetId);
        if (existing) {
          this.articleRepo.update(targetId, {
            title: safeTitle,
            category: category,
            cover_image_url: coverImageUrl,
            summary: summary,
            content_markdown: safeContent,
            status: status
          });
          const updatedArticle = {
            id: targetId,
            timestamp: existing.timestamp,
            author_email: existing.author_email || existing.authorEmail,
            author_name: existing.author_name || existing.authorName,
            title: safeTitle,
            category: category,
            cover_image_url: coverImageUrl,
            summary: summary,
            content_markdown: safeContent,
            status: status
          };
          return { success: true, data: updatedArticle };
        }
      }

      const newId = targetId || ('art-' + new Date().getTime());
      const timestamp = new Date().toISOString();

      this.articleRepo.insert({
        id: newId,
        timestamp: timestamp,
        author_email: authorEmail,
        author_name: authorName,
        title: safeTitle,
        category: category,
        cover_image_url: coverImageUrl,
        summary: summary,
        content_markdown: safeContent,
        status: status
      });

      const createdArticle = {
        id: newId,
        timestamp: timestamp,
        author_email: authorEmail,
        author_name: authorName,
        title: safeTitle,
        category: category,
        cover_image_url: coverImageUrl,
        summary: summary,
        content_markdown: safeContent,
        status: status
      };

      return { success: true, data: createdArticle };
    });
  }

  deleteEducationalArticle(idOrPayload, sessionEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(sessionEmail);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang berwenang menghapus artikel edukasi.');
      }

      const articleId = (typeof idOrPayload === 'object' && idOrPayload !== null)
        ? (idOrPayload.id || idOrPayload.articleId)
        : idOrPayload;

      if (!articleId) throw new Error('ID artikel wajib disertakan.');

      const existing = this.articleRepo.findById(articleId);
      if (!existing) throw new Error('Artikel tidak ditemukan.');

      this.articleRepo.delete(articleId);

      return {
        success: true,
        data: {
          id: existing.id,
          title: existing.title
        }
      };
    });
  }
}

/** */
class SurveyService {
  constructor(dependencies = {}) {
    this.authService = dependencies.authService || new AuthService(dependencies);
    this.surveyRepo = dependencies.surveyRepo || new _svc_Repositories.SurveyRepository();
    this.moodRepo = dependencies.moodRepo || new _svc_Repositories.MoodRepository();
    this.journalRepo = dependencies.journalRepo || new _svc_Repositories.JournalRepository();
    this.userRepo = dependencies.userRepo || new _svc_Repositories.UserRepository();
  }

  getSurveys(callerEmail) {
    const user = this.authService.resolveSessionUser(callerEmail);
    const isCounselorOrAdmin = (user.role === _svc_ROLES.COUNSELOR || user.role === _svc_ROLES.ADMIN);

    const allSurveys = this.surveyRepo.getAll();
    const filtered = allSurveys.filter(s => {
      if (!s.id) return false;
      if (!isCounselorOrAdmin && s.status !== 'PUBLISHED') return false;
      return true;
    });

    return filtered.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      title: s.title,
      description: s.description,
      status: s.status,
      created_by: s.createdBy || s.created_by,
      questions: (s.questions || []).map(q => ({
        id: q.id,
        survey_id: q.surveyId || q.survey_id,
        category: q.category || 'Care Core',
        question_text: q.questionText || q.question_text || '',
        question_type: q.questionType || q.question_type || 'BINARY_YES_NO',
        options: q.options || [],
        order_num: Number(q.orderNum || q.order_num) || 0
      }))
    }));
  }

  submitSurveyResponse(payload, callerEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(callerEmail);
      const surveyId = (payload && payload.survey_id && typeof payload.survey_id === 'string') ? payload.survey_id.trim() : '';
      const answers = (payload && Array.isArray(payload.answers)) ? payload.answers : [];

      if (!surveyId) throw new Error('ID survei wajib disertakan.');

      const surveyQuestions = this.surveyRepo.getQuestionsForSurvey(surveyId);
      const qMap = {};
      surveyQuestions.forEach(q => {
        if (q.id) qMap[q.id] = q;
      });

      // Deduplicate answers by question_id
      const seenQuestions = {};
      const dedupedAnswers = [];
      answers.forEach(a => {
        const qId = a.question_id || a.id;
        if (qId) {
          if (!seenQuestions[qId]) {
            seenQuestions[qId] = true;
            dedupedAnswers.push(a);
          }
        } else {
          dedupedAnswers.push(a);
        }
      });

      const categoriesSet = {};
      surveyQuestions.forEach(q => { if (q.category) categoriesSet[q.category] = true; });
      dedupedAnswers.forEach(a => {
        const cat = a.category || (a.question_id && qMap[a.question_id] && qMap[a.question_id].category);
        if (cat) categoriesSet[cat] = true;
      });

      // Scoring algorithm for multi-type questions:
      // - BINARY_YES_NO: YA/YES/true = 100, TIDAK/NO/false = 0
      // - LINEAR_SCALE: Math.round(((val - 1) / 4) * 100)
      // - Qualitative types (MULTIPLE_CHOICE, SHORT_ANSWER, etc.): not scored
      // - If category has no scored questions, score is left undefined
      const categoryScores = {};
      Object.keys(categoriesSet).forEach(cat => {
        let scoredSum = 0;
        let scoredCount = 0;

        dedupedAnswers.forEach(a => {
          const qId = a.question_id || a.id;
          const qObj = qId ? qMap[qId] : null;
          const aCat = a.category || (qObj && qObj.category);
          if (aCat !== cat) return;

          const qType = (qObj ? (qObj.questionType || qObj.question_type) : (a.question_type || a.questionType)) || '';

          if (qType === 'BINARY_YES_NO' || (!qType && (a.answer === 'YA' || a.answer === 'TIDAK' || a.answer === 'YES' || a.answer === 'NO' || typeof a.answer === 'boolean'))) {
            scoredCount++;
            const val = a.answer;
            const isYes = String(val).toUpperCase() === 'YA' || val === true || String(val).toLowerCase() === 'yes';
            scoredSum += isYes ? 100 : 0;
          } else if (qType === 'LINEAR_SCALE') {
            scoredCount++;
            const numVal = Number(a.answer) || 1;
            const score = Math.max(0, Math.min(100, Math.round(((numVal - 1) / 4) * 100)));
            scoredSum += score;
          }
        });

        if (scoredCount > 0) {
          categoryScores[cat] = Math.round(scoredSum / scoredCount);
        }
      });

      const newId = 'sr-' + new Date().getTime() + '-' + Math.random().toString(36).substr(2, 4);
      const timestamp = new Date().toISOString();

      const respObj = new _svc_Models.SurveyResponse({
        id: newId,
        survey_id: surveyId,
        student_email: user.email,
        timestamp: timestamp,
        category_scores_json: JSON.stringify(categoryScores),
        answers_json: JSON.stringify(dedupedAnswers)
      });

      const savedResp = this.surveyRepo.saveResponse(respObj);
      const effectiveId = (savedResp && savedResp.id) ? savedResp.id : (respObj.id || newId);

      return {
        success: true,
        id: effectiveId,
        category_scores: categoryScores,
        data: {
          id: effectiveId,
          survey_id: surveyId,
          student_email: user.email,
          timestamp: timestamp,
          category_scores: categoryScores,
          answers: dedupedAnswers
        }
      };
    });
  }

  saveSurvey(payload, callerEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      const user = this.authService.resolveSessionUser(callerEmail);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Siswa tidak diizinkan mengakses data Guru BK');
      }

      const safeTitle = payload && payload.title ? payload.title.toString().trim() : '';
      if (!safeTitle) throw new Error('Judul survei wajib diisi.');

      const surveyId = payload && payload.id ? payload.id.toString().trim() : ('sv-' + new Date().getTime());
      const description = payload && payload.description ? payload.description.toString().trim() : '';
      const status = payload && payload.status ? payload.status.toString().trim().toUpperCase() : 'PUBLISHED';
      const timestamp = new Date().toISOString();

      const existingSurvey = this.surveyRepo.findById(surveyId);
      if (existingSurvey) {
        this.surveyRepo.update(surveyId, {
          title: safeTitle,
          description: description,
          status: status
        });
      } else {
        this.surveyRepo.insert(new _svc_Models.Survey({
          id: surveyId,
          timestamp: timestamp,
          title: safeTitle,
          description: description,
          status: status,
          created_by: user.email
        }));
      }

      // Handle questions if provided
      if (payload && Array.isArray(payload.questions)) {
        const db = _svc_DatabaseConnection.getInstance();
        const qSheet = db.getSheet('SurveyQuestions');
        if (qSheet) {
          // Remove old questions for this survey
          const lastRow = qSheet.getLastRow();
          if (lastRow > 1) {
            const data = qSheet.getDataRange().getValues();
            const headers = data[0].map(h => String(h || '').trim());
            const normHeaders = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
            let sIdColIdx = normHeaders.indexOf('surveyid');
            if (sIdColIdx === -1) sIdColIdx = 1;
            for (let i = data.length - 1; i >= 1; i--) {
              if (String(data[i][sIdColIdx] || '').trim().toLowerCase() === surveyId.toLowerCase()) {
                qSheet.deleteRow(i + 1);
              }
            }
          }

          const lastCol = (typeof qSheet.getLastColumn === 'function') ? qSheet.getLastColumn() : 0;
          const qHeaders = lastCol > 0
            ? qSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim())
            : ['id', 'survey_id', 'category', 'question_text', 'question_type', 'order_num'];

          payload.questions.forEach((q, idx) => {
            const qObj = new _svc_Models.SurveyQuestion({
              id: q.id || ('sq-' + surveyId + '-' + (idx + 1)),
              survey_id: surveyId,
              category: q.category || 'Care Core',
              question_text: q.question_text || q.questionText || '',
              question_type: q.question_type || q.questionType || 'BINARY_YES_NO',
              options: q.options || [],
              order_num: q.order_num !== undefined ? Number(q.order_num) : (q.orderNum !== undefined ? Number(q.orderNum) : (idx + 1))
            });

            const rowVals = qHeaders.map(h => qObj.toRowValue(h));
            qSheet.appendRow(rowVals);
          });
        }
      }

      return {
        success: true,
        survey_id: surveyId,
        data: {
          id: surveyId,
          title: safeTitle,
          description: description,
          status: status,
          created_by: user.email
        }
      };
    });
  }

  deleteSurvey(idOrPayload, callerEmail) {
    return _svc_DatabaseConnection.withWriteLock(() => {
      let surveyId = '';
      let effectiveSession = callerEmail;

      if (idOrPayload && typeof idOrPayload === 'object') {
        surveyId = idOrPayload.id || idOrPayload.surveyId || idOrPayload.survey_id;
        effectiveSession = idOrPayload.sessionEmail || callerEmail;
      } else {
        surveyId = idOrPayload;
      }

      const user = this.authService.resolveSessionUser(effectiveSession);
      if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
        throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang berwenang menghapus survei.');
      }

      if (!surveyId) throw new Error('ID survei wajib disertakan.');

      const success = this.surveyRepo.deleteSurvey(surveyId);
      return { success: !!success, id: surveyId };
    });
  }

  getStudentSurveyResults(callerEmail) {
    const user = this.authService.resolveSessionUser(callerEmail);
    const targetEmail = (user.email || '').toLowerCase().trim();

    const surveys = this.surveyRepo.getAll();
    const surveyTitleMap = {};
    surveys.forEach(s => {
      surveyTitleMap[s.id] = { title: s.title, description: s.description };
    });

    const allQuestions = this.surveyRepo._getAllQuestions ? this.surveyRepo._getAllQuestions() : [];
    const qTextMap = {};
    allQuestions.forEach(q => {
      if (q.id) qTextMap[q.id] = q.questionText || q.question_text || '';
    });

    const studentResponses = this.surveyRepo.getResponsesForStudent(targetEmail);
    studentResponses.sort((a, b) => {
      const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return tB - tA;
    });

    const enrichedHistory = studentResponses.map(resp => {
      const sId = resp.surveyId || resp.survey_id;
      const ts = resp.timestamp;
      let scores = resp.categoryScores || resp.scoreSummary || {};
      let answers = resp.answers || [];

      if (typeof scores === 'string') {
        try { scores = JSON.parse(scores); } catch (e) {}
      }
      if (typeof answers === 'string') {
        try { answers = JSON.parse(answers); } catch (e) {}
      }

      const sMeta = surveyTitleMap[sId] || {};
      const enrichedAnswers = (Array.isArray(answers) ? answers : []).map(a => ({
        ...a,
        question_text: a.question_text || qTextMap[a.question_id || a.id] || 'Pertanyaan Survei'
      }));

      return {
        id: resp.id,
        survey_id: sId,
        survey_title: sMeta.title || 'Survei Siswa',
        timestamp: ts instanceof Date ? ts.toISOString() : ts,
        category_scores: scores,
        answers: enrichedAnswers
      };
    });

    const latestSurvey = enrichedHistory.length > 0 ? enrichedHistory[0] : null;

    return {
      success: true,
      latestSurvey: latestSurvey,
      history: enrichedHistory
    };
  }

  getStudentDossier(studentEmail, callerEmail) {
    const user = this.authService.resolveSessionUser(callerEmail);
    if (user.role !== _svc_ROLES.COUNSELOR && user.role !== _svc_ROLES.ADMIN) {
      throw new Error('403 Forbidden: Hanya Guru BK atau ADMIN yang berwenang mengakses berkas konseling siswa.');
    }

    const targetEmail = (studentEmail || '').toLowerCase().trim();
    if (!targetEmail) {
      throw new Error('Email siswa wajib disertakan.');
    }

    const studentProfile = this.userRepo.findByEmail(targetEmail);
    const allSurveys = this.surveyRepo.getAll();
    const surveyTitleMap = {};
    allSurveys.forEach(s => {
      surveyTitleMap[s.id] = s.title;
    });

    const studentResponses = this.surveyRepo.getResponsesForStudent(targetEmail);
    studentResponses.sort((a, b) => {
      const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return tB - tA;
    });

    const allQuestions = this.surveyRepo._getAllQuestions ? this.surveyRepo._getAllQuestions() : [];
    const qTextMap = {};
    allQuestions.forEach(q => {
      if (q.id) qTextMap[q.id] = q.questionText || q.question_text || '';
    });

    const surveyHistory = studentResponses.map(resp => {
      const sId = resp.surveyId || resp.survey_id;
      const ts = resp.timestamp;
      let scores = resp.categoryScores || resp.scoreSummary || {};
      let answers = resp.answers || [];
      if (typeof scores === 'string') {
        try { scores = JSON.parse(scores); } catch (e) {}
      }
      if (typeof answers === 'string') {
        try { answers = JSON.parse(answers); } catch (e) {}
      }
      const enrichedAnswers = (Array.isArray(answers) ? answers : []).map(a => ({
        ...a,
        question_text: a.question_text || a.questionText || (a.question_id && qTextMap[a.question_id]) || ''
      }));
      return {
        id: resp.id,
        survey_id: sId,
        survey_title: surveyTitleMap[sId] || 'Survei Siswa',
        timestamp: ts instanceof Date ? ts.toISOString() : ts,
        category_scores: scores,
        answers: enrichedAnswers
      };
    });

    const rawMoods = this.moodRepo.findByUserEmail(targetEmail);
    const moodTrend = rawMoods.map(m => {
      const ts = m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp;
      return {
        id: m.id,
        timestamp: ts,
        mood_level: m.moodLevel,
        mood_score: Number(m.moodScore) || 0,
        triggers: m.triggers,
        notes: m.notes
      };
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const rawJournals = this.journalRepo.findByUserEmail(targetEmail);
    const journals = rawJournals.map(j => {
      const ts = j.timestamp instanceof Date ? j.timestamp.toISOString() : j.timestamp;
      return {
        id: j.id,
        timestamp: ts,
        title: j.title,
        content: j.content
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
      profile: {
        email: targetEmail,
        name: studentProfile ? studentProfile.name : targetEmail.split('@')[0],
        class: studentProfile ? (studentProfile.class || studentProfile.userClass || '-') : '-'
      },
      latestSurvey: surveyHistory.length > 0 ? surveyHistory[0] : null,
      surveyHistory: surveyHistory,
      moodTrend: moodTrend,
      journals: journals
    };
  }
}

/**
 * Normalization helper for dates (YYYY-MM-DD)
 */
function _normalizeDateHelper(val) {
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
  return str;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AuthService,
    MoodService,
    TriageService,
    AppointmentService,
    JournalService,
    ReportService,
    ChatService,
    PsychoeducationService,
    SurveyService
  };
}
