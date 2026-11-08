/**
 * ============================================================================
 * STUDENT WELL-BEING HUB - CONTROLLERS & RPC GATEWAY
 * Public Google Apps Script Entrypoint & Service Delegator
 * ============================================================================
 */

// Lazily instantiating service singletons
function _getAuthService() {
  const Svc = (typeof AuthService !== 'undefined') ? AuthService : (typeof require !== 'undefined' ? require('./Services.gs').AuthService : null);
  return new Svc();
}
function _getMoodService() {
  const Svc = (typeof MoodService !== 'undefined') ? MoodService : (typeof require !== 'undefined' ? require('./Services.gs').MoodService : null);
  return new Svc();
}
function _getTriageService() {
  const Svc = (typeof TriageService !== 'undefined') ? TriageService : (typeof require !== 'undefined' ? require('./Services.gs').TriageService : null);
  return new Svc();
}
function _getAppointmentService() {
  const Svc = (typeof AppointmentService !== 'undefined') ? AppointmentService : (typeof require !== 'undefined' ? require('./Services.gs').AppointmentService : null);
  return new Svc();
}
function _getJournalService() {
  const Svc = (typeof JournalService !== 'undefined') ? JournalService : (typeof require !== 'undefined' ? require('./Services.gs').JournalService : null);
  return new Svc();
}
function _getReportService() {
  const Svc = (typeof ReportService !== 'undefined') ? ReportService : (typeof require !== 'undefined' ? require('./Services.gs').ReportService : null);
  return new Svc();
}
function _getChatService() {
  const Svc = (typeof ChatService !== 'undefined') ? ChatService : (typeof require !== 'undefined' ? require('./Services.gs').ChatService : null);
  return new Svc();
}
function _getPsychoeducationService() {
  const Svc = (typeof PsychoeducationService !== 'undefined') ? PsychoeducationService : (typeof require !== 'undefined' ? require('./Services.gs').PsychoeducationService : null);
  return new Svc();
}
function _getSurveyService() {
  const Svc = (typeof SurveyService !== 'undefined') ? SurveyService : (typeof require !== 'undefined' ? require('./Services.gs').SurveyService : null);
  return new Svc();
}

/**
 * Web App Entrypoint
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  
  let activeEmail = '';
  try {
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      activeEmail = Session.getActiveUser().getEmail();
    }
  } catch (err) {
    activeEmail = '';
  }

  if ((!activeEmail || activeEmail.trim() === '') && e && e.parameter && e.parameter.email) {
    activeEmail = e.parameter.email.trim();
  }
  
  let detectedUser = null;
  if (activeEmail && activeEmail.trim() !== '') {
    try {
      detectedUser = checkUserSession(activeEmail);
    } catch (err) {
      if (typeof Logger !== 'undefined' && Logger.log) {
        Logger.log('checkUserSession error: ' + err.message);
      }
    }
  }

  let webAppUrl = '';
  try {
    if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
      webAppUrl = ScriptApp.getService().getUrl();
    }
  } catch (err) {
    webAppUrl = '';
  }
  if (!webAppUrl) {
    webAppUrl = 'https://script.google.com/macros/s/AKfycbxomEGvXWt2rZPxuJviuPNgvlBsqQ9yAx3RMzQXI66Q3GkKhsvGOs1WCnl5kIps9P3rUw/exec';
  }

  template.serverContext = JSON.stringify({
    webAppUrl: webAppUrl,
    activeEmail: activeEmail,
    detectedUser: detectedUser
  });

  return template.evaluate()
    .setTitle('IPEKA Student Well Being Hub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper: Menyertakan partial HTML ke dalam template
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Database Setup & Initialization
 */
function setupDatabase(forceReset) {
  const dbMod = (typeof DatabaseConnection !== 'undefined') ? { DatabaseConnection } : (typeof require !== 'undefined' ? require('./Database.gs') : {});
  const db = dbMod.DatabaseConnection ? dbMod.DatabaseConnection.getInstance() : null;
  if (db && typeof db.setupDatabase === 'function') {
    return db.setupDatabase(forceReset);
  }
  return true;
}

function initDatabase(forceReset) {
  return setupDatabase(forceReset);
}

/**
 * Public RPC Gateway Handlers (Thin Wrappers Delegating to Domain Services)
 */
function resolveSessionUser(callerEmail) {
  return _getAuthService().resolveSessionUser(callerEmail);
}

function checkUserSession(callerEmail) {
  return _getAuthService().checkUserSession(callerEmail);
}

function registerStudent(data) {
  return _getAuthService().registerStudent(data);
}

function addCounselorByAdmin(data, adminEmail) {
  return _getAuthService().addCounselorByAdmin(data, adminEmail);
}

function getInitialContext(devEmail) {
  return _getAuthService().getInitialContext(devEmail);
}

function getStudentDirectory(searchQuery, classFilter, callerEmail) {
  return _getAuthService().getStudentDirectory(searchQuery, classFilter, callerEmail);
}

function submitMood(payload, sessionEmail) {
  return _getMoodService().submitMood(payload, sessionEmail);
}

function getStudentMoodTrend(days, callerEmail) {
  return _getMoodService().getStudentMoodTrend(days, callerEmail);
}

function getStudentMoodHistory(callerEmail) {
  return _getMoodService().getStudentMoodHistory(callerEmail);
}

function getCounselorDashboard(sessionEmail) {
  return _getTriageService().getCounselorDashboard(sessionEmail);
}

function getAvailableSlots(arg1, arg2, sessionEmail) {
  return _getAppointmentService().getAvailableSlots(arg1, arg2, sessionEmail);
}

function getStudentAppointments(sessionEmail) {
  return _getAppointmentService().getStudentAppointments(sessionEmail);
}

function submitAppointment(payload, sessionEmail) {
  return _getAppointmentService().submitAppointment(payload, sessionEmail);
}

function requestAppointment(payload, sessionEmail) {
  return _getAppointmentService().requestAppointment(payload, sessionEmail);
}

function updateAppointmentStatus(idOrPayload, newStatus, sessionEmail) {
  return _getAppointmentService().updateAppointmentStatus(idOrPayload, newStatus, sessionEmail);
}

function updateAppointment(payload, sessionEmail) {
  return _getAppointmentService().updateAppointment(payload, sessionEmail);
}

function saveJournal(payload, sessionEmail) {
  return _getJournalService().saveJournal(payload, sessionEmail);
}

function submitJournal(payload, sessionEmail) {
  return _getJournalService().submitJournal(payload, sessionEmail);
}

function getJournals(sessionEmail) {
  return _getJournalService().getJournals(sessionEmail);
}

function getStudentJournals(sessionEmail) {
  return _getJournalService().getStudentJournals(sessionEmail);
}

function submitReport(payload, sessionEmail) {
  return _getReportService().submitReport(payload, sessionEmail);
}

function updateReportStatus(payload, sessionEmail) {
  return _getReportService().updateReportStatus(payload, sessionEmail);
}

function sendMessage(payload, sessionEmail) {
  return _getChatService().sendMessage(payload, sessionEmail);
}

function getMessages(sessionEmail) {
  return _getChatService().getMessages(sessionEmail);
}

function markMessagesAsRead(peerEmail, sessionEmail) {
  return _getChatService().markMessagesAsRead(peerEmail, sessionEmail);
}

function getActiveQuote(sessionEmail) {
  return _getPsychoeducationService().getActiveQuote(sessionEmail);
}

function setDailyQuote(payload, sessionEmail) {
  return _getPsychoeducationService().setDailyQuote(payload, sessionEmail);
}

function getEducationalArticles(sessionEmail) {
  return _getPsychoeducationService().getEducationalArticles(sessionEmail);
}

function saveEducationalArticle(payload, sessionEmail) {
  return _getPsychoeducationService().saveEducationalArticle(payload, sessionEmail);
}

function deleteEducationalArticle(idOrPayload, sessionEmail) {
  return _getPsychoeducationService().deleteEducationalArticle(idOrPayload, sessionEmail);
}

function getSurveys(callerEmail) {
  return _getSurveyService().getSurveys(callerEmail);
}

function getStudentSurveyResults(callerEmail) {
  return _getSurveyService().getStudentSurveyResults(callerEmail);
}

function submitSurveyResponse(payload, callerEmail) {
  return _getSurveyService().submitSurveyResponse(payload, callerEmail);
}

function saveSurvey(payload, callerEmail) {
  return _getSurveyService().saveSurvey(payload, callerEmail);
}

function getStudentDossier(studentEmail, callerEmail) {
  return _getSurveyService().getStudentDossier(studentEmail, callerEmail);
}

function deleteSurvey(idOrPayload, callerEmail) {
  return _getSurveyService().deleteSurvey(idOrPayload, callerEmail);
}

// ============================================================================
// GOOGLE WORKSPACE ADD-ON / GOOGLE CHAT INTEGRATION
// ============================================================================

function onMessage(event) {
  const message = (event && event.chat && event.chat.messagePayload && event.chat.messagePayload.message) || {};
  const user = (event && event.chat && event.chat.user) || {};

  let name = "";
  if (message.space && message.space.type === "DM") {
    name = "You";
  } else {
    name = user.displayName || "User";
  }

  const responseMessage = `${name} said "${message.text || ''}"`;
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: {
            text: responseMessage
          }
        }
      }
    }
  };
}

function onAddedToSpace(event) {
  const space = (event && event.chat && event.chat.addedToSpacePayload && event.chat.addedToSpacePayload.space) || {};
  const user = (event && event.chat && event.chat.user) || {};

  let message = "";
  if (space.singleUserBotDm) {
    message = `Thank you for adding me to a direct message, ${user.displayName || "User"}!`;
  } else {
    message = `Thank you for adding me to ${(space.displayName || "this space")}`;
  }

  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: {
            text: message
          }
        }
      }
    }
  };
}

function onRemovedFromSpace(event) {
  const space = (event && event.chat && event.chat.removedFromSpacePayload && event.chat.removedFromSpacePayload.space) || {};
  console.info(`Chat app removed from ${(space.name || "this chat")}`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doGet,
    include,
    setupDatabase,
    initDatabase,
    resolveSessionUser,
    checkUserSession,
    registerStudent,
    addCounselorByAdmin,
    getInitialContext,
    getStudentDirectory,
    submitMood,
    getStudentMoodTrend,
    getStudentMoodHistory,
    getCounselorDashboard,
    getAvailableSlots,
    getStudentAppointments,
    submitAppointment,
    requestAppointment,
    updateAppointmentStatus,
    updateAppointment,
    saveJournal,
    submitJournal,
    getJournals,
    getStudentJournals,
    submitReport,
    updateReportStatus,
    sendMessage,
    getMessages,
    markMessagesAsRead,
    getActiveQuote,
    setDailyQuote,
    getEducationalArticles,
    saveEducationalArticle,
    deleteEducationalArticle,
    getSurveys,
    getStudentSurveyResults,
    submitSurveyResponse,
    saveSurvey,
    getStudentDossier,
    deleteSurvey,
    onMessage,
    onAddedToSpace,
    onRemovedFromSpace
  };
}
