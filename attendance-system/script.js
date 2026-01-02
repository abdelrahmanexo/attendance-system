// ==========================================
//  1. استيراد مكتبات Firebase (تم إضافة Auth)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, Timestamp, doc, getDoc, writeBatch, onSnapshot, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"; import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; // <--- هذا السطر الجديد
let unsubscribeSessionListener = null; // متغير لمراقبة الجلسة

const firebaseConfig = {
    apiKey: "AIzaSyAn4rmd8AfTf6oBvrDewqpeK9x1-mgksyI",
    authDomain: "attendance-system-pro-dbdf1.firebaseapp.com",
    projectId: "attendance-system-pro-dbdf1",
    storageBucket: "attendance-system-pro-dbdf1.firebasestorage.app",
    messagingSenderId: "1094544109334",
    appId: "1:1094544109334:web:a7395159d617b3e6e82a37"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // <--- تفعيل الـ Auth

// ==========================================
//  2. منطق التطبيق (System Logic)
// ==========================================
(function () {

    // رابط قديم لجلب أسماء الطلاب فقط (سنحتفظ به مؤقتاً كقاعدة بيانات للأسماء)
    // يمكن استبداله لاحقاً بـ Firebase Collection "students"
    const STUDENT_DB_URL = "https://script.google.com/macros/s/AKfycbxi2Itb_GW4OXkP6ki5PmzN1O8GFY70XoQyYiWKUdKYHxhXL7YGMFfA2tXcXAWbC_ez/exec";

    const CONFIG = {
        gps: {
            targetLat: 30.43841622978127,
            targetLong: 30.836735200410153,
            allowedDistanceKm: 5
        },
        modelsUrl: './models'
    };

    const LOCAL_STORAGE_DB_KEY = "offline_students_db_v2";
    const ALERT_STORAGE_KEY = "persistent_student_alerts_v2";
    const DEVICE_ID_KEY = "unique_device_id_v1";
    const HIGHLIGHT_STORAGE_KEY = "student_highlights_persistent";
    const EVAL_STORAGE_KEY = "student_evaluations_v1";

    let studentsDB = {};
    let wakeLock = null;
    let cachedReportData = [];
    let systemAlerts = [];
    let isOpeningMaps = false;
    let currentEvalID = null;
    let currentEvalName = null;

    let attendanceData = {};

    // تحميل التنبيهات المحلية
    try {
        const savedAlerts = localStorage.getItem(ALERT_STORAGE_KEY);
        if (savedAlerts) systemAlerts = JSON.parse(savedAlerts);
    } catch (e) { }

    // تحميل قاعدة بيانات الطلاب (Local Cache)
    const savedDB = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    if (savedDB) {
        try { studentsDB = JSON.parse(savedDB); } catch (e) { }
    }

    // محاولة تحديث أسماء الطلاب في الخلفية
    fetch(`${STUDENT_DB_URL}?action=getDB`).then(r => r.json()).then(d => { if (!d.error) { studentsDB = d; localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(d)); } }).catch(e => console.log("DB Fetch Error - Using Cache"));

    let defaultSubjects = {
        "first_year": ["اساسيات تمريض 1 نظري", "اساسيات تمريض 1 عملي", "تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "اناتومى نظرى", "اناتومى عملى", "تقييم صحى نظرى", "تقييم صحى عملى", "مصطلحات طبية", "فسيولوجى", "تكنولوجيا المعلومات"],
        "second_year": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "تمريض حالات حرجة 1 نظرى", "تمريض حالات حرجة 1 عملى", "امراض باطنة", "باثولوجى", "علم الأدوية", "الكتابة التقنية"]
    };
    let subjectsData = JSON.parse(localStorage.getItem('subjectsData_v4')) || defaultSubjects;

    let defaultHalls = ["037", "038", "039", "019", "025", "123", "124", "127", "131", "132", "133", "134", "231", "335", "121", "118", "E334", "E335", "E336", "E337", "E344", "E345", "E346", "E347", "E240", "E241", "E242", "E245", "E231", "E230", "E243", "E233", "E222", "E234"];
    let hallsList = JSON.parse(localStorage.getItem('hallsList_v4')) || defaultHalls;

    const ADMIN_AUTH_TOKEN = "secure_admin_session_token_v99";

    const DATA_ENTRY_TIMEOUT_SEC = 20;
    const SESSION_END_TIME_KEY = "data_entry_deadline_v2";
    const TEMP_NAME_KEY = "temp_student_name";
    const TEMP_ID_KEY = "temp_student_id";
    const TEMP_CODE_KEY = "temp_session_code";

    const MAX_ATTEMPTS = 9999;
    const TODAY_DATE_KEY = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
    const BAN_KEY = "daily_ban_" + TODAY_DATE_KEY;

    let userIP = "Unknown";
    let geo_watch_id = null;
    let countdownInterval;
    let html5QrCode;
    let sessionEndTime = 0;
    let processIsActive = false;

    let userLat = "", userLng = "";
    let lastNoseX = 0, lastNoseY = 0;
    let faceCheckInterval = null;
    let videoStream = null;
    const FACE_MODELS_URL = CONFIG.modelsUrl;
    const TIMER_DURATION_FACE = 3;
    const TIMER_CIRCUMFERENCE_FACE = 282.7;

    let isProcessingClick = false;

    // PWA Install Logic
    let deferredPrompt;
    const installBox = document.getElementById('installAppPrompt');
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (installBox) installBox.style.display = 'flex'; });
    window.addEventListener('appinstalled', () => { if (installBox) installBox.style.display = 'none'; deferredPrompt = null; showToast("شكراً لتثبيت التطبيق! 🚀", 4000, "#10b981"); });
    function triggerAppInstall() { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then((choiceResult) => { if (choiceResult.outcome === 'accepted') { if (installBox) installBox.style.display = 'none'; } deferredPrompt = null; }); } }

    // ========================
    // Logic Functions
    // ========================

    function safeClick(element, callback) {
        if (isProcessingClick) return;
        if (element && (element.disabled || element.classList.contains('disabled') || element.classList.contains('locked'))) return;
        isProcessingClick = true;
        if (element) { element.style.pointerEvents = 'none'; element.style.opacity = '0.7'; }
        if (typeof callback === 'function') callback();
        setTimeout(() => {
            isProcessingClick = false;
            if (element) { element.style.pointerEvents = 'auto'; element.style.opacity = '1'; }
        }, 600);
    }

    function getUniqueDeviceId() {
        let deviceId = localStorage.getItem(DEVICE_ID_KEY);
        if (!deviceId) {
            deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
            localStorage.setItem(DEVICE_ID_KEY, deviceId);
        }
        return deviceId;
    }

    function generateSessionKey() { return 'KEY-' + Math.random().toString(36).substr(2, 12).toUpperCase(); }

    function openDataEntryMenu() { document.getElementById('dataEntryModal').style.display = 'flex'; }
    function openManageHalls() { renderHallsManage(); document.getElementById('manageHallsModal').style.display = 'flex'; }
    function openManageSubjects() { renderSubjectsManage(); document.getElementById('manageSubjectsModal').style.display = 'flex'; }

    function renderHallsManage() {
        const container = document.getElementById('hallsListManage');
        container.innerHTML = hallsList.map(h => `<div class="list-item-manage"><span style="font-weight:bold;">${h}</span><button class="btn-delete-mini" onclick="deleteHall('${h}')"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }
    function addHall() {
        const val = document.getElementById('newHallInput').value.trim();
        if (val && !hallsList.includes(val)) { hallsList.push(val); localStorage.setItem('hallsList_v4', JSON.stringify(hallsList)); document.getElementById('newHallInput').value = ''; renderHallsManage(); renderHallOptions(); }
    }
    function deleteHall(val) { if (confirm('هل أنت متأكد من حذف القاعة؟')) { hallsList = hallsList.filter(h => h !== val); localStorage.setItem('hallsList_v4', JSON.stringify(hallsList)); renderHallsManage(); renderHallOptions(); } }

    function renderSubjectsManage() {
        const year = document.getElementById('manageYearSelect').value;
        const container = document.getElementById('subjectsListManage');
        container.innerHTML = subjectsData[year].map(s => `<div class="list-item-manage"><span style="font-weight:bold;">${s}</span><button class="btn-delete-mini" onclick="deleteSubject('${s}')"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }
    function addSubject() {
        const year = document.getElementById('manageYearSelect').value;
        const val = document.getElementById('newSubjectInput').value.trim();
        if (val && !subjectsData[year].includes(val)) { subjectsData[year].push(val); localStorage.setItem('subjectsData_v4', JSON.stringify(subjectsData)); document.getElementById('newSubjectInput').value = ''; renderSubjectsManage(); }
    }
    function deleteSubject(val) { if (confirm('هل أنت متأكد من حذف المادة؟')) { const year = document.getElementById('manageYearSelect').value; subjectsData[year] = subjectsData[year].filter(s => s !== val); localStorage.setItem('subjectsData_v4', JSON.stringify(subjectsData)); renderSubjectsManage(); } }

    // --- (Future) Firebase Sync Logic for Alerts ---
    async function syncGlobalAlerts() {
        // يمكن تفعيل هذا الجزء لاحقاً لجلب التنبيهات من Firebase
    }

    function showTopToast(msg) {
        const t = document.getElementById('topToast');
        t.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${msg}`; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    function checkStoredAlerts() {
        const btn = document.getElementById('notificationBtn'); const container = document.getElementById('alertsListContainer');
        const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        document.getElementById('adminDeleteAlert').style.display = isAdmin ? 'flex' : 'none';
        const unreadCount = systemAlerts.filter(a => !a.isRead).length;
        if (unreadCount > 0) btn.classList.add('has-alert'); else btn.classList.remove('has-alert');

        if (systemAlerts.length > 0) {
            let html = '';
            systemAlerts.forEach((alert, index) => {
                const deleteBtn = isAdmin ? `<i class="fa-solid fa-trash-can" style="color:#ef4444; cursor:pointer; margin-left:10px;" onclick="deleteSingleAlert(${index}); event.stopPropagation();"></i>` : '';
                let badgeColor = (alert.risk_level === "DEVICE_SHARING" || alert.risk_level === "FACE_SPOOF") ? "#ef4444" : "#f59e0b";
                const itemClass = alert.isRead ? 'read-alert' : 'unread-alert';
                html += `<div class="${itemClass}" style="border-radius:12px; padding:10px; margin-bottom:8px; cursor:pointer; transition:0.3s;" onclick="toggleAlertDetails(${index})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center;">${deleteBtn}<div style="font-weight:bold; font-size:13px;">${alert.name}</div></div>
                        <div class="en-font" style="font-size:10px; color:#94a3b8;">${alert.timestamp.split(' ')[1] || alert.timestamp}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                        <div style="display:flex; flex-direction:column;"><div class="en-font" style="font-size:12px; color:#64748b;">${alert.id}</div><div style="font-size:11px; color:#0f766e; font-weight:bold;">🏛️ ${alert.hall}</div></div>
                        <div style="text-align:left;"><span style="color:${badgeColor}; display:block; font-size:11px; font-weight:bold;">⚠️ ${alert.reason}</span></div>
                    </div>
                    <div id="alert-detail-${index}" style="display:none; border-top:1px dashed #e2e8f0; margin-top:8px; padding-top:8px; font-size:11px; color:#475569;">${alert.detail}<br>Time: <span class="en-font">${alert.timestamp}</span></div>
                </div>`;
            });
            container.innerHTML = html;
        } else { container.innerHTML = '<div class="empty-state" style="padding:15px; font-size:12px;">لا توجد تنبيهات.</div>'; }
    }

    function updateNotificationUI(data) {
        if (data.risk_level && data.risk_level !== "SAFE") {
            const now = new Date();
            const newAlert = {
                name: attendanceData.name || 'مجهول', id: attendanceData.uniID || '---', timestamp: now.toLocaleTimeString('en-US'),
                risk_level: data.risk_level, reason: "نشاط مشبوه", detail: "يرجى المراجعة", hall: document.getElementById('hallSelect').value || '---', isRead: false
            };
            systemAlerts.unshift(newAlert); localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts)); checkStoredAlerts();
        }
    }

    function toggleAlertDetails(index) {
        if (!systemAlerts[index].isRead) { systemAlerts[index].isRead = true; localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts)); checkStoredAlerts(); }
        const el = document.getElementById(`alert-detail-${index}`); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
    function deleteSingleAlert(index) { if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { systemAlerts.splice(index, 1); localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts)); checkStoredAlerts(); } }
    function openDeleteAlertsConfirm() { if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) document.getElementById('deleteAlertsConfirmModal').style.display = 'flex'; }
    function closeDeleteAlertsConfirm() { document.getElementById('deleteAlertsConfirmModal').style.display = 'none'; }
    function confirmClearNotifications() { if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { systemAlerts = []; localStorage.removeItem(ALERT_STORAGE_KEY); checkStoredAlerts(); closeDeleteAlertsConfirm(); closeIdentityAlert(); } }
    function filterAlerts() {
        const input = document.getElementById('alertSearchInput'); const filter = input.value.toUpperCase();
        const container = document.getElementById('alertsListContainer'); const items = container.querySelectorAll('div[onclick^="toggleAlertDetails"]');
        items.forEach(item => { const text = item.innerText || item.textContent; if (text.toUpperCase().indexOf(filter) > -1) item.style.display = ""; else item.style.display = "none"; });
    }
    function showNotificationModal() {
        const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        if (!isAdmin) { const btn = document.getElementById('notificationBtn'); btn.classList.add('shake-lock'); if (navigator.vibrate) navigator.vibrate(100); return; }
        checkStoredAlerts(); document.getElementById('identityAlertModal').style.display = 'flex';
    }
    function closeIdentityAlert() { document.getElementById('identityAlertModal').style.display = 'none'; }
    function filterStudents() {
        const input = document.getElementById('studentSearchInput'); const filter = input.value.toUpperCase();
        const container = document.getElementById('studentsContainer'); const cards = container.getElementsByClassName('student-detailed-card');
        for (let i = 0; i < cards.length; i++) { const text = cards[i].textContent || cards[i].innerText; if (text.toUpperCase().indexOf(filter) > -1) cards[i].style.display = ""; else cards[i].style.display = "none"; }
    }
    function openExamModal() { playClick(); document.getElementById('examModal').style.display = 'flex'; }
    function closeExamModal() { playClick(); document.getElementById('examModal').style.display = 'none'; }
    function handleReportClick() { const btn = document.getElementById('btnViewReport'); if (btn.classList.contains('locked')) { if (navigator.vibrate) navigator.vibrate(50); } else { safeClick(btn, openReportModal); } }

    function resetApplicationState() {
        attendanceData = {}; attendanceData.isVerified = false;
        sessionStorage.removeItem(TEMP_NAME_KEY); sessionStorage.removeItem(TEMP_ID_KEY); sessionStorage.removeItem(TEMP_CODE_KEY); sessionStorage.removeItem(SESSION_END_TIME_KEY);
        document.getElementById('uniID').value = ''; document.getElementById('attendanceCode').value = ''; document.getElementById('sessionPass').value = '';

        const yearWrapper = document.getElementById('yearSelectWrapper'); yearWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة --'; yearWrapper.classList.remove('open');
        yearWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); document.getElementById('yearSelect').value = '';

        const groupWrapper = document.getElementById('groupSelectWrapper'); groupWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة أولاً --'; groupWrapper.classList.add('disabled'); groupWrapper.classList.remove('open');
        document.getElementById('groupOptionsContainer').innerHTML = ''; document.getElementById('groupSelect').innerHTML = '<option value="" disabled selected>-- اختر الفرقة أولاً --</option>';

        const subjectWrapper = document.getElementById('subjectSelectWrapper'); subjectWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة أولاً --'; subjectWrapper.classList.add('disabled'); subjectWrapper.classList.remove('open');
        document.getElementById('subjectOptionsContainer').innerHTML = ''; document.getElementById('subjectSelect').innerHTML = '<option value="" disabled selected>-- اختر الفرقة أولاً --</option>';

        const hallWrapper = document.getElementById('hallSelectWrapper'); hallWrapper.querySelector('.trigger-text').textContent = '-- اختر المدرج --'; hallWrapper.classList.remove('open');
        hallWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); document.getElementById('hallSelect').value = '';

        const btn = document.getElementById('submitBtn'); btn.disabled = true; btn.style.opacity = "0.6"; btn.style.cursor = "not-allowed"; btn.innerHTML = 'تأكيد الحضور <i class="fa-solid fa-paper-plane"></i>';
        document.getElementById('scanNameDisplay').innerText = '--'; document.getElementById('scanIDDisplay').innerText = '--';
        document.getElementById('scanDisciplineDisplay').innerText = "0"; document.getElementById('scanDisciplineDisplay').className = "student-info-value discipline-score-display safe";

        const verifyBtn = document.getElementById('btnVerify'); if (verifyBtn) { verifyBtn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> التحقق من الهوية'; verifyBtn.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)'; verifyBtn.style.display = 'flex'; verifyBtn.classList.remove('disabled'); }
        const bypassCheck = document.getElementById('bypassCheckbox'); if (bypassCheck) bypassCheck.checked = false;
        checkStoredAlerts();
    }

    fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => userIP = d.ip).catch(e => userIP = "Hidden IP");
    function playClick() { document.getElementById('clickSound').play().catch(e => { }); if (navigator.vibrate) navigator.vibrate(10); }
    function playSuccess() { document.getElementById('successSound').play().catch(e => { }); if (navigator.vibrate) navigator.vibrate([50, 50, 50]); }
    function playBeep() { document.getElementById('beepSound').play().catch(e => { }); }
    function convertArabicToEnglish(s) { return s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }
    async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { } }
    function releaseWakeLock() { if (wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); } }

    function getAttemptsLeft() { return 999; }
    function decrementAttempts() { return 999; }
    function updateUIForAttempts() { const container = document.getElementById('attemptsHeartsContainer'); if (container) container.innerHTML = ''; }

    window.history.pushState(null, null, window.location.href);
    window.onpopstate = function () {
        if (processIsActive && !sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { checkBanStatus(); window.history.pushState(null, null, window.location.href); }
        else if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { goBackToWelcome(); }
    };
    function handleStrictPenalty() { }
    window.addEventListener('beforeunload', () => { handleStrictPenalty(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { if (isOpeningMaps) return; if (processIsActive && !sessionStorage.getItem(ADMIN_AUTH_TOKEN)) location.reload(); releaseWakeLock(); }
        else { if (isOpeningMaps) isOpeningMaps = false; if (processIsActive) requestWakeLock(); }
    });
    function checkBanStatus() { return false; }

    function updateHeaderState(screenId) {
        const wrapper = document.getElementById('heroIconWrapper'); const icon = document.getElementById('statusIcon');
        wrapper.classList.remove('show-icon');
        if (screenId !== 'screenWelcome') {
            wrapper.classList.add('show-icon');
            if (screenId === 'screenLoading') { icon.className = "fa-solid fa-satellite-dish hero-icon fa-spin"; icon.style.color = "var(--primary)"; }
            else if (screenId === 'screenReadyToStart') { icon.className = "fa-solid fa-map-location-dot hero-icon"; icon.style.color = "#10b981"; icon.style.animation = "none"; }
            else if (screenId === 'screenDataEntry') { icon.className = "fa-solid fa-user-pen hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
            else if (screenId === 'screenScanQR') { icon.className = "fa-solid fa-qrcode hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
            else if (screenId === 'screenFaceCheck') { icon.className = "fa-solid fa-id-card-clip hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
            else if (screenId === 'screenSuccess') { icon.className = "fa-solid fa-check hero-icon"; icon.style.color = "#10b981"; icon.style.animation = "none"; }
            else if (screenId === 'screenError') { icon.className = "fa-solid fa-triangle-exclamation hero-icon"; icon.style.color = "#ef4444"; icon.style.animation = "none"; }
            else if (screenId === 'screenAdminLogin') { icon.className = "fa-solid fa-lock hero-icon"; icon.style.color = "var(--primary-dark)"; icon.style.animation = "none"; }
        }
    }

    function switchScreen(id) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const allSections = document.querySelectorAll('.section'); const nextScreen = document.getElementById(id);
        allSections.forEach(el => { if (el.classList.contains('active')) el.classList.remove('active'); });
        nextScreen.classList.add('active'); updateHeaderState(id); updateUIForAttempts();
        const adminBack = document.getElementById('adminFloatingBack'); const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        if (isAdmin && id !== 'screenWelcome' && id !== 'screenAdminLogin') { adminBack.style.display = 'flex'; } else { adminBack.style.display = 'none'; }
        if (!isAdmin && (id === 'screenDataEntry' || id === 'screenScanQR' || id === 'screenFaceCheck' || id === 'screenLoading')) { processIsActive = true; requestWakeLock(); } else { processIsActive = false; releaseWakeLock(); }
    }

    function openMapsToRefreshGPS() {
        isOpeningMaps = true; const lat = CONFIG.gps.targetLat; const lng = CONFIG.gps.targetLong;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`; window.open(mapsUrl, '_blank');
    }

    window.onload = function () {
        initGlobalGuard(); updateUIForMode(); setupCustomSelects(); checkStoredAlerts(); startGPSWatcher(); renderHallOptions();
        document.getElementById('hallSearchInput').addEventListener('input', function (e) { renderHallOptions(e.target.value); });
        setInterval(() => {
            const now = new Date(); const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' }); const dateStr = now.toLocaleDateString('en-GB');
            const timeEl = document.getElementById('currentTime'); const dateEl = document.getElementById('currentDate');
            if (timeEl) timeEl.innerText = timeStr; if (dateEl) dateEl.innerText = dateStr;
        }, 1000);
        document.getElementById('submitBtn').addEventListener('click', function (e) { e.preventDefault(); submitToGoogle(); });
    };

    function renderHallOptions(filter = "") {
        const hallContainer = document.getElementById('hallOptionsContainer'); const hallSelect = document.getElementById('hallSelect');
        hallSelect.innerHTML = '<option value="" disabled selected>-- اختر المدرج --</option>'; hallContainer.innerHTML = '';
        const filteredHalls = hallsList.filter(h => h.includes(filter));
        filteredHalls.forEach(val => {
            let opt = document.createElement('option'); opt.value = val; opt.text = val; hallSelect.appendChild(opt);
            let cOpt = document.createElement('div'); cOpt.className = "custom-option"; cOpt.setAttribute('data-value', val); cOpt.innerHTML = `<span>${val}</span>`;
            cOpt.addEventListener('click', function (e) {
                e.stopPropagation(); hallContainer.parentElement.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected'); document.querySelector('#hallSelectWrapper .trigger-text').textContent = val;
                document.getElementById('hallSelectWrapper').classList.remove('open'); hallSelect.value = val; playClick(); checkAllConditions();
            }); hallContainer.appendChild(cOpt);
        });
        if (filteredHalls.length === 0) { hallContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#94a3b8; font-size:12px;">لا توجد نتائج</div>'; }
    }

    function startGPSWatcher() {
        if (navigator.geolocation) {
            geo_watch_id = navigator.geolocation.watchPosition(
                (position) => { userLat = position.coords.latitude; userLng = position.coords.longitude; }, (error) => { }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
            );
        }
    }

    function updateUIForMode() {
        const isAdmin = sessionStorage.getItem(ADMIN_AUTH_TOKEN);

        // 1. التحكم في العناصر القديمة (عشان ما نبوظش حاجة)
        const badge = document.getElementById('adminBadge');
        const loginBtn = document.getElementById('btnAdminLogin');
        const logoutBtn = document.getElementById('btnAdminLogout');
        const reportBtn = document.getElementById('btnViewReport');
        const adminFloating = document.getElementById('adminFloatingBack');
        const notifBtn = document.getElementById('notificationBtn');
        const adminBypassContainer = document.getElementById('adminBypassContainer');
        const btnDataEntry = document.getElementById('btnDataEntry');
        const sessionBtn = document.getElementById('btnToggleSession'); // <-- ده الجديد المهم

        if (isAdmin) {
            // --- وضع الأدمن ---
            if (badge) badge.style.display = 'block';
            if (loginBtn) loginBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'flex';

            if (reportBtn) {
                reportBtn.classList.remove('locked');
                reportBtn.classList.add('unlocked');
            }

            document.getElementById('adminDeleteAlert').style.display = 'flex';
            if (notifBtn) notifBtn.classList.remove('locked');
            if (adminBypassContainer) adminBypassContainer.style.display = 'none';
            if (btnDataEntry) btnDataEntry.style.display = 'flex';

            // إظهار زر التحكم في الجلسة وتشغيل المراقبة
            if (sessionBtn) sessionBtn.style.display = 'flex';
            if (!unsubscribeSessionListener) listenToSessionState();

            syncGlobalAlerts();

        } else {
            // --- وضع الطالب ---
            if (badge) badge.style.display = 'none';
            if (loginBtn) loginBtn.style.display = 'flex';
            if (logoutBtn) logoutBtn.style.display = 'none';

            if (reportBtn) {
                reportBtn.classList.remove('unlocked');
                reportBtn.classList.add('locked');
            }

            document.getElementById('adminDeleteAlert').style.display = 'none';
            if (notifBtn) notifBtn.classList.add('locked');
            if (adminBypassContainer) adminBypassContainer.style.display = 'none';
            if (btnDataEntry) btnDataEntry.style.display = 'none';

            // إخفاء زر التحكم في الجلسة وإيقاف المراقبة
            if (sessionBtn) sessionBtn.style.display = 'none';
            if (unsubscribeSessionListener) {
                unsubscribeSessionListener();
                unsubscribeSessionListener = null;
            }
        }

        updateUIForAttempts();
        checkStoredAlerts();
    }

    function detectFakeGPS(pos) { return (pos.coords.accuracy < 2 || (pos.coords.altitude === null && pos.coords.accuracy < 10)); }
    function checkLocationStrict(onSuccess) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (detectFakeGPS(pos)) { showError("🚫 تم اكتشاف موقع وهمي (Fake GPS). يرجى إغلاق أي برامج تلاعب بالموقع.", false); return; }
                    userLat = pos.coords.latitude; userLng = pos.coords.longitude; checkDistance(onSuccess);
                }, (err) => { document.getElementById('locationForceModal').style.display = 'flex'; }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
            );
        } else { document.getElementById('locationForceModal').style.display = 'flex'; }
    }
    function checkDistance(onSuccess) {
        let dist = getDistanceFromLatLonInKm(userLat, userLng, CONFIG.gps.targetLat, CONFIG.gps.targetLong);
        if (dist > CONFIG.gps.allowedDistanceKm) { showError("🚫 أنت خارج نطاق الكلية. يرجى التواجد في المكان الصحيح.", false); return; }
        onSuccess();
    }

    // ==========================================
    // 🎮 دوال التحكم في الجلسة (نسخة Global)
    // ==========================================

    // 1. دالة تغيير الحالة (فتح/قفل)
    window.toggleSessionState = async function () {
        // التأكد من أن المستخدم أدمن
        if (!sessionStorage.getItem("secure_admin_session_token_v99")) return;

        const btn = document.getElementById('btnToggleSession');
        // معرفة الحالة الحالية من شكل الزر
        const isCurrentlyOpen = btn.classList.contains('session-open');
        const newState = !isCurrentlyOpen;

        const txt = document.getElementById('sessionText');
        if (txt) txt.innerText = "جاري التحديث...";

        try {
            const docRef = doc(db, "settings", "control_panel");
            // إرسال الحالة الجديدة للسيرفر
            await setDoc(docRef, { isActive: newState }, { merge: true });

            // التحديث سيتم تلقائياً عبر الـ Listener
            if (newState) showToast("🟢 تم فتح التسجيل", 3000, "#10b981");
            else showToast("🔴 تم إغلاق التسجيل", 3000, "#ef4444");

        } catch (e) {
            console.error("Session Toggle Error:", e);
            showToast("خطأ في الاتصال", 3000, "#ef4444");
        }
    };

    // 2. دالة المراقبة الحية
    window.listenToSessionState = function () {
        if (!sessionStorage.getItem("secure_admin_session_token_v99")) return;

        const docRef = doc(db, "settings", "control_panel");

        // تشغيل المراقبة الحية (onSnapshot)
        unsubscribeSessionListener = onSnapshot(docRef, (docSnap) => {
            const isActive = docSnap.exists() ? docSnap.data().isActive : false;
            updateSessionButtonUI(isActive);
        }, (error) => {
            console.error("Session Listener Error:", error);
        });
    };

    // 3. تحديث شكل الزر
    function updateSessionButtonUI(isOpen) {
        const btn = document.getElementById('btnToggleSession');
        const icon = document.getElementById('sessionIcon');
        const txt = document.getElementById('sessionText');

        if (!btn) return;

        if (isOpen) {
            btn.classList.add('session-open');
            btn.style.background = "#dcfce7";
            btn.style.color = "#166534";
            btn.style.border = "2px solid #22c55e";
            if (icon) icon.className = "fa-solid fa-satellite-dish fa-beat-fade";
            if (txt) txt.innerText = "التسجيل متاح ";
        } else {
            btn.classList.remove('session-open');
            btn.style.background = "#fee2e2";
            btn.style.color = "#991b1b";
            btn.style.border = "2px solid #ef4444";
            if (icon) icon.className = "fa-solid fa-lock";
            if (txt) txt.innerText = "التسجيل مغلق";
        }
    }

    // ==========================================
    // 🚀 دالة البدء (معدلة لتفحص حالة الجلسة أولاً)
    // ==========================================
    window.startProcess = async function () {
        playClick();
        resetApplicationState();

        // 1. لو المستخدم أدمين -> يدخل فوراً بدون فحص
        if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) {
            generateCodeAndShowDataEntry();
            return;
        }

        // 2. لو طالب -> لازم نسأل السيرفر الأول: الباب مفتوح؟
        const btn = document.getElementById('mainActionBtn');
        const oldText = btn.innerHTML;

        // تغيير شكل الزر للتحميل
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري التسجيل...';
        btn.style.pointerEvents = 'none';

        try {
            // قراءة حالة الجلسة من Firebase
            // استخدام المتغيرات العامة db و doc و getDoc
            const docRef = doc(db, "settings", "control_panel");
            const docSnap = await getDoc(docRef);

            const isSessionActive = docSnap.exists() ? docSnap.data().isActive : false;

            if (!isSessionActive) {
                // ⛔ الحالة مغلقة
                if (navigator.vibrate) navigator.vibrate(500);
                showToast("⛔ .. التسجيل مغلق ", 4000, "#ef4444");

                // إرجاع الزر لحالته
                btn.innerHTML = oldText;
                btn.style.pointerEvents = 'auto';
                return; // 🛑 وقف التنفيذ هنا فوراً
            }

            // ✅ الحالة مفتوحة -> نكمل الإجراءات
            switchScreen('screenLoading');
            checkLocationStrict(() => {
                switchScreen('screenReadyToStart');
                playSuccess();
            });

        } catch (error) {
            console.error("Start Process Error:", error);
            showToast("⚠️ تأكد من اتصال الإنترنت", 3000, "#f59e0b");
            btn.innerHTML = oldText;
            btn.style.pointerEvents = 'auto';
        }
    };

    function generateCodeAndShowDataEntry() {
        playClick(); if (checkBanStatus()) return;
        attendanceData = {}; let code = (Math.floor(142 + Math.random() * 1280) * 7); if (code < 1000) code += 7000;
        attendanceData.code = code.toString(); document.getElementById('attendanceCode').value = code; sessionStorage.setItem(TEMP_CODE_KEY, code.toString());
        const newEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionEndTime = newEndTime; sessionStorage.setItem(SESSION_END_TIME_KEY, newEndTime.toString());
        switchScreen('screenDataEntry'); startCountdown();
    }

    function startCountdown() {
        const savedDeadline = sessionStorage.getItem(SESSION_END_TIME_KEY);
        if (savedDeadline) sessionEndTime = parseInt(savedDeadline); else { sessionEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionStorage.setItem(SESSION_END_TIME_KEY, sessionEndTime.toString()); }
        const circle = document.getElementById('timerProgress'); const text = document.getElementById('timerNumber'); const circumference = 2 * Math.PI * 35;
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const now = Date.now(); const remainingMs = sessionEndTime - now; const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
            const percent = Math.max(0, remainingMs / (DATA_ENTRY_TIMEOUT_SEC * 1000)); const offset = circumference - (percent * circumference);
            text.innerText = secondsLeft.toString(); circle.style.strokeDashoffset = offset;
            if (secondsLeft > 10) circle.style.stroke = "#10b981"; else if (secondsLeft > 5) circle.style.stroke = "#f59e0b"; else { circle.style.stroke = "#ef4444"; circle.parentElement.classList.add('timer-pulse'); }
            if (remainingMs <= 0) {
                clearInterval(countdownInterval);
                if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { text.innerText = "0"; return; }
                document.getElementById('nextStepBtn').disabled = true; hideConnectionLostModal(); processIsActive = false; releaseWakeLock();
                let left = decrementAttempts(); updateUIForAttempts();
                document.getElementById('timeoutMessage').innerText = `انتهى الوقت. انتبه: في المرة القادمة سيتم حظرك.`;
                document.getElementById('timeoutModal').style.display = 'flex'; if (navigator.vibrate) navigator.vibrate(300);
            }
        }, 100);
    }

    function closeTimeoutModal() { document.getElementById('timeoutModal').style.display = 'none'; location.reload(); }

    // ==========================================
    //  FIREBASE: SEARCH STUDENT (REAL-TIME)
    // ==========================================
    async function handleIdSubmit() {
        playClick();

        // 1. تجهيز الكود المدخل
        let rawId = document.getElementById('uniID').value.trim();
        const uniIdVal = convertArabicToEnglish(rawId); // تحويل الأرقام لعربي لإنجليزي
        const alertBox = document.getElementById('dataEntryAlert');
        const btn = document.getElementById('nextStepBtn'); // زر التالي

        // تنظيف الرسائل القديمة
        alertBox.style.display = 'none';

        if (!uniIdVal) {
            alertBox.innerText = "⚠️ يرجى إدخال الكود الجامعي.";
            alertBox.style.display = 'block';
            return;
        }

        // 2. تغيير شكل الزر لـ "جاري التحميل"
        const originalBtnText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري البحث...';
        btn.disabled = true;

        try {
            // 3. البحث في Firebase مباشرة
            // بنبحث في كولكشن students عن وثيقة اسمها هو نفس الكود المدخل
            const docRef = doc(db, "students", uniIdVal);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                // ✅ الطالب موجود!
                const studentData = docSnap.data();
                const studentName = studentData.name; // جلب الاسم من الداتا

                // حفظ البيانات مؤقتاً للجلسة الحالية
                attendanceData.uniID = uniIdVal;
                attendanceData.name = studentName;
                sessionStorage.setItem(TEMP_ID_KEY, uniIdVal);
                sessionStorage.setItem(TEMP_NAME_KEY, studentName);

                // عرض الاسم في الشاشة وتحديث الواجهة
                document.getElementById('scanNameDisplay').innerText = studentName;
                document.getElementById('scanIDDisplay').innerText = uniIdVal;

                // الانتقال للشاشة التالية (الكاميرا)
                if (countdownInterval) clearInterval(countdownInterval);
                stopCameraSafely();
                switchScreen('screenScanQR');
                playSuccess();

            } else {
                // ❌ الطالب غير موجود
                console.log("No student found with ID:", uniIdVal);
                alertBox.innerText = "❌ هذا الكود غير مسجل في النظام.";
                alertBox.style.display = 'block';
                if (navigator.vibrate) navigator.vibrate(300);
            }

        } catch (error) {
            console.error("Error fetching student:", error);
            alertBox.innerText = "⚠️ خطأ في الاتصال بالسيرفر.";
            alertBox.style.display = 'block';
        } finally {
            // 4. إرجاع الزر لحالته الأصلية
            btn.innerHTML = originalBtnText;
            btn.disabled = false;
        }
    }

    function toggleBypassMode() {
        const chk = document.getElementById('bypassCheckbox'); const btnVerify = document.getElementById('btnVerify');
        if (chk.checked) { attendanceData.isVerified = true; userLat = CONFIG.gps.targetLat; userLng = CONFIG.gps.targetLong; btnVerify.style.display = 'none'; document.getElementById('bypassModal').style.display = 'flex'; setTimeout(() => { document.getElementById('bypassModal').style.display = 'none'; }, 2000); }
        else { attendanceData.isVerified = false; btnVerify.style.display = 'flex'; btnVerify.innerHTML = '<i class="fa-solid fa-fingerprint"></i> التحقق من الهوية'; btnVerify.classList.remove('disabled'); }
        checkAllConditions();
    }

    async function startFaceVerificationProcess() {
        const year = document.getElementById('yearSelect').value; const group = document.getElementById('groupSelect').value;
        const sub = document.getElementById('subjectSelect').value; const hall = document.getElementById('hallSelect').value;
        if (!year || !group || !sub || !hall) { showToast('⚠️ اختر الفرقة والجروب والمادة والقاعة أولاً', 3000, '#f59e0b'); return; }
        if (!attendanceData.uniID) { showToast('حدث خطأ: لم يتم تحديد الهوية', 3000, '#ef4444'); return; }
        const btn = document.getElementById('btnVerify'); const oldText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري تحديد الموقع...';
        checkLocationStrict(() => { btn.innerHTML = oldText; proceedToCamera(); });
    }

    async function proceedToCamera() {
        playClick(); requestWakeLock(); await stopCameraSafely(); switchScreen('screenFaceCheck');
        const statusTxt = document.getElementById('statusTxt'); const loaderSpinner = document.getElementById('loaderSpinner');
        try {
            statusTxt.innerText = "الرجاء الانتظار..."; statusTxt.style.color = "var(--text-sub)"; loaderSpinner.style.display = 'flex';
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL),
                faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODELS_URL)
            ]);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
            videoStream = stream; const video = document.getElementById('video'); video.srcObject = stream;
            await new Promise((resolve) => { video.onloadedmetadata = () => { video.play(); resolve(); }; });
            await new Promise(resolve => setTimeout(resolve, 100));
            loaderSpinner.style.display = 'none'; statusTxt.innerText = "اثبت مكانك تماماً"; statusTxt.style.color = "var(--primary)"; startStrictAI();
        } catch (e) { console.error("Camera Error:", e); document.getElementById('cameraErrorModal').style.display = 'flex'; switchScreen('screenScanQR'); }
    }

    function startStrictAI() {
        let step = 0; let count = TIMER_DURATION_FACE; let counting = false; let timerInterval = null;
        const timerBar = document.getElementById('timerProgressFace'); const timerNum = document.getElementById('timerNumberFace');
        const modernTimer = document.getElementById('modernTimerContainer'); const alertBadge = document.getElementById('alertBadge');
        const video = document.getElementById('video'); const camBorder = document.getElementById('camBorder'); const statusTxt = document.getElementById('statusTxt');
        timerBar.style.strokeDashoffset = TIMER_CIRCUMFERENCE_FACE; timerNum.innerText = TIMER_DURATION_FACE;
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });
        if (faceCheckInterval) clearInterval(faceCheckInterval);
        faceCheckInterval = setInterval(async () => {
            if (video.paused || video.ended) return;
            const det = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor().withFaceExpressions();
            if (det) {
                const nose = det.landmarks.getNose()[0]; const jaw = det.landmarks.getJawOutline();
                const ratio = Math.abs(nose.x - jaw[0].x) / Math.abs(nose.x - jaw[16].x); const expr = det.expressions;
                const isStableFace = expr.neutral > 0.8 || (expr.happy < 0.1 && expr.surprised < 0.1);
                const moveDist = Math.sqrt(Math.pow(nose.x - lastNoseX, 2) + Math.pow(nose.y - lastNoseY, 2));
                lastNoseX = nose.x; lastNoseY = nose.y; const isNotMoving = moveDist < 10;
                if (step === 0) {
                    if (ratio > 0.8 && ratio < 1.2 && isStableFace && isNotMoving) {
                        camBorder.className = "cam-container status-ok"; statusTxt.innerText = "ممتاز.. خليك ثابت"; statusTxt.style.color = "var(--success)"; alertBadge.style.display = "none";
                        if (!counting) {
                            counting = true; modernTimer.style.display = "flex"; timerNum.innerText = count; timerBar.style.stroke = "#10b981";
                            timerInterval = setInterval(() => {
                                const elapsed = (TIMER_DURATION_FACE - count) + 1; const progress = elapsed / TIMER_DURATION_FACE;
                                const offset = TIMER_CIRCUMFERENCE_FACE - (progress * TIMER_CIRCUMFERENCE_FACE); timerBar.style.strokeDashoffset = offset;
                                count--; timerNum.innerText = count;
                                if (count <= 0) {
                                    clearInterval(timerInterval); modernTimer.style.display = "none"; step = 1; camBorder.className = "cam-container";
                                    statusTxt.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><span>انظر لليمين</span><i class="fa-solid fa-arrow-right-long arrow-anim"></i></div>';
                                    statusTxt.style.color = "var(--warning)"; if (navigator.vibrate) navigator.vibrate(50);
                                }
                            }, 1000);
                        }
                    } else {
                        if (counting) { clearInterval(timerInterval); counting = false; count = TIMER_DURATION_FACE; timerNum.innerText = TIMER_DURATION_FACE; modernTimer.style.display = "none"; timerBar.style.strokeDashoffset = TIMER_CIRCUMFERENCE_FACE; document.getElementById('beepSound').play(); }
                        camBorder.className = "cam-container status-error"; alertBadge.style.display = "block";
                        if (!isNotMoving) alertBadge.innerText = "⚠️ لا تتحرك!"; else if (!isStableFace) alertBadge.innerText = "😐 بدون تعابير!"; else alertBadge.innerText = "👀 انظر للأمام";
                        statusTxt.style.color = "var(--danger)";
                    }
                } else if (step === 1) {
                    if (ratio < 0.5) {
                        clearInterval(faceCheckInterval); if (videoStream) videoStream.getTracks().forEach(track => track.stop()); document.getElementById('beepSound').play();
                        attendanceData.vector = Array.from(det.descriptor);
                        const statusTxt = document.getElementById('statusTxt'); statusTxt.innerHTML = '<div class="progress-container"><div class="progress-fill"></div></div><div style="font-size:12px;margin-top:5px;">جاري التحليل...</div>';

                        // Fake verifying against Server for now (Logic ready)
                        setTimeout(() => {
                            const successModal = document.getElementById('verificationSuccessModal'); successModal.style.display = 'flex';
                            attendanceData.isVerified = true;
                            const verifyBtn = document.getElementById('btnVerify'); verifyBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> تم التحقق من الهوية';
                            verifyBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)'; verifyBtn.classList.add('disabled');
                            setTimeout(() => { successModal.style.display = 'none'; switchScreen('screenScanQR'); playSuccess(); checkAllConditions(); }, 2500);
                        }, 1000);

                    } else { camBorder.className = "cam-container status-wait"; statusTxt.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><span>انظر لليمين</span><i class="fa-solid fa-arrow-right-long arrow-anim"></i></div>'; statusTxt.style.color = "var(--warning)"; alertBadge.style.display = "none"; }
                }
            } else { camBorder.className = "cam-container status-error"; statusTxt.innerText = "⚠️ لم يتم العثور على وجه"; statusTxt.style.color = "var(--danger)"; alertBadge.style.display = "block"; alertBadge.innerText = "🚫 لا يوجد وجه"; }
        }, 500);
    }

    // ==========================================
    //  FIREBASE: SAVE ATTENDANCE (REAL-TIME)
    // ==========================================
    // ==========================================
    //  FIREBASE: SUBMIT ATTENDANCE (FINAL STEP)
    // ==========================================
    async function submitToGoogle() {
        playClick();
        const btn = document.getElementById('submitBtn');

        // منع التكرار لو الزر مضغوط
        if (btn.disabled && btn.innerText.includes('جاري')) return;

        // 1. التحقق من الموقع (GPS)
        if (!userLat || !userLng) {
            checkLocationStrict(() => submitToGoogle());
            return;
        }

        const originalText = "تأكيد الحضور <i class='fa-solid fa-paper-plane'></i>";

        // 2. تجميع البيانات
        const selectedSubject = document.getElementById('subjectSelect').value;
        const selectedGroup = document.getElementById('groupSelect').value;
        const sessionPassVal = document.getElementById('sessionPass').value;
        const selectedHall = document.getElementById('hallSelect').value;

        // التحقق من أن كل الخانات ممتلئة
        if (!attendanceData.uniID || !sessionPassVal || !selectedSubject || !selectedGroup || !attendanceData.isVerified) {
            showToast("يرجى إكمال جميع الخطوات.", 3000, '#f59e0b');
            return;
        }

        // تغيير الزر لـ "جاري الحفظ"
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        const now = new Date();
        // تنسيق التاريخ (عشان نمنع الطالب يسجل مرتين في نفس المادة في نفس اليوم)
        // Format: DD/MM/YYYY
        const dateStr = ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth() + 1)).slice(-2) + '/' + now.getFullYear();

        try {
            // 3. التحقق من التكرار في Firebase (Duplicate Check)
            // بنسأل السيرفر: هل الطالب ده سجل المادة دي في التاريخ ده قبل كده؟
            const q = query(collection(db, "attendance"),
                where("id", "==", attendanceData.uniID),
                where("date", "==", dateStr),
                where("subject", "==", selectedSubject));

            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                // الطالب مسجل قبل كده!
                document.getElementById('duplicateModal').style.display = 'flex';
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            // 4. تجهيز الحزمة للإرسال
            const deviceId = getUniqueDeviceId();
            const payload = {
                id: attendanceData.uniID,       // كود الطالب
                name: attendanceData.name,      // اسم الطالب
                group: selectedGroup,           // المجموعة
                subject: selectedSubject,       // المادة
                hall: selectedHall || "N/A",    // القاعة
                date: dateStr,                  // تاريخ اليوم
                timestamp: Timestamp.now(),     // وقت السيرفر الدقيق (للترتيب)
                time_str: now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' }), // وقت مقروء
                device_id: deviceId,            // بصمة الجهاز
                gps_lat: userLat,               // الموقع
                gps_lng: userLng,
                session_code: sessionPassVal,   // كود الـ QR
                verification: "FIREBASE_SECURE" // نوع التحقق
            };

            // 5. الحفظ الفعلي في Firestore
            await addDoc(collection(db, "attendance"), payload);

            // ===========================
            //  تم الحفظ بنجاح! 🎉
            // ===========================

            // تحديث واجهة الإيصال (Receipt)
            document.getElementById('receiptName').innerText = attendanceData.name;
            document.getElementById('receiptID').innerText = attendanceData.uniID;
            document.getElementById('receiptGroup').innerText = selectedGroup;
            document.getElementById('receiptSubject').innerText = selectedSubject;
            document.getElementById('receiptHall').innerText = selectedHall || 'N/A';
            document.getElementById('receiptDate').innerText = dateStr;
            document.getElementById('receiptTime').innerText = payload.time_str;

            // إنهاء العملية وتنظيف الذاكرة
            processIsActive = false;
            releaseWakeLock();
            let left = decrementAttempts();
            updateUIForAttempts();
            if (left === 0) { localStorage.setItem(BAN_KEY, "true"); }

            // التبديل لشاشة النجاح وتشغيل الصوت
            resetApplicationState();
            switchScreen('screenSuccess');
            playSuccess();

            // إضافة للسجل المحلي (عشان لو حب يشوف هو سجل إيه)
            cachedReportData.push({
                uniID: attendanceData.uniID,
                subject: selectedSubject,
                time: payload.time_str,
                group: selectedGroup,
                name: attendanceData.name,
                hall: selectedHall
            });

        } catch (err) {
            console.error("Firebase Submit Error: ", err);
            btn.innerHTML = originalText;
            btn.disabled = false;
            showToast("فشل الاتصال بالسيرفر. تأكد من الإنترنت.", 4000, '#ef4444');
        }
    }

    function addKey(num) { playClick(); const i = document.getElementById('uniID'); if (i.value.length < 10) i.value += num; }
    function backspaceKey() { playClick(); const i = document.getElementById('uniID'); i.value = i.value.slice(0, -1); }
    function clearKey() { playClick(); document.getElementById('uniID').value = ''; }
    function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) { var R = 6371; var dLat = (lat2 - lat1) * (Math.PI / 180); var dLon = (lon2 - lon1) * (Math.PI / 180); var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))); }

    async function goBackToWelcome() {
        playClick(); window.scrollTo({ top: 0, behavior: 'smooth' });
        if (geo_watch_id) navigator.geolocation.clearWatch(geo_watch_id);
        if (countdownInterval) clearInterval(countdownInterval); await stopCameraSafely();
        sessionStorage.removeItem(SESSION_END_TIME_KEY); sessionStorage.removeItem(TEMP_NAME_KEY); sessionStorage.removeItem(TEMP_ID_KEY); sessionStorage.removeItem(TEMP_CODE_KEY);
        processIsActive = false; releaseWakeLock(); document.getElementById('uniID').value = '';
        document.getElementById('startScanCard').style.display = 'flex'; hideConnectionLostModal(); switchScreen('screenWelcome');
    }

    function closeSelect(overlay) { const wrapper = overlay.parentElement; wrapper.classList.remove('open'); }
    function setupCustomSelects() {
        const yearWrapper = document.getElementById('yearSelectWrapper'); const groupWrapper = document.getElementById('groupSelectWrapper');
        const subjectWrapper = document.getElementById('subjectSelectWrapper'); const hallWrapper = document.getElementById('hallSelectWrapper');
        const allWrappers = [yearWrapper, groupWrapper, subjectWrapper, hallWrapper];
        function toggleSelect(wrapper, event) {
            event.stopPropagation();
            if (!wrapper.classList.contains('open')) { allWrappers.forEach(w => w.classList.remove('open')); if (!wrapper.classList.contains('disabled')) { wrapper.classList.add('open'); playClick(); } } else { wrapper.classList.remove('open'); }
        }
        yearWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(yearWrapper, e));
        groupWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(groupWrapper, e));
        subjectWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(subjectWrapper, e));
        hallWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(hallWrapper, e));

        yearWrapper.querySelectorAll('.custom-option').forEach(op => {
            op.addEventListener('click', function (e) {
                e.stopPropagation(); yearWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected'); yearWrapper.querySelector('.trigger-text').textContent = this.querySelector('span').textContent;
                yearWrapper.classList.remove('open'); document.getElementById('yearSelect').value = this.getAttribute('data-value');
                playClick(); updateGroups(); updateSubjects();
            });
        });
    }

    function updateGroups() {
        const y = document.getElementById("yearSelect").value;
        const gWrapper = document.getElementById('groupSelectWrapper'); const gOptions = document.getElementById('groupOptionsContainer');
        const gTriggerText = gWrapper.querySelector('.trigger-text'); const gReal = document.getElementById("groupSelect");
        gReal.innerHTML = '<option value="" disabled selected>-- اختر المجموعة --</option>'; gOptions.innerHTML = ''; gTriggerText.textContent = '-- اختر المجموعة --';
        if (y) {
            gReal.disabled = false; gWrapper.classList.remove('disabled');
            let prefix = (y === "first_year") ? "1G" : "2G";
            for (let i = 1; i <= 20; i++) {
                let groupName = prefix + i;
                const opt = document.createElement("option"); opt.value = groupName; opt.text = groupName; gReal.appendChild(opt);
                const cOpt = document.createElement('div'); cOpt.className = 'custom-option'; cOpt.innerHTML = `<span class="english-num">${groupName}</span>`; cOpt.setAttribute('data-value', groupName);
                cOpt.addEventListener('click', function (e) {
                    e.stopPropagation(); gOptions.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    this.classList.add('selected'); gTriggerText.textContent = groupName;
                    gWrapper.classList.remove('open'); gReal.value = this.getAttribute('data-value');
                    playClick(); checkAllConditions();
                }); gOptions.appendChild(cOpt);
            }
        } else { gReal.disabled = true; gWrapper.classList.add('disabled'); gTriggerText.textContent = '-- اختر الفرقة أولاً --'; }
    }

    function updateSubjects() {
        const y = document.getElementById("yearSelect").value;
        const sWrapper = document.getElementById('subjectSelectWrapper'); const sOptions = document.getElementById('subjectOptionsContainer');
        const sTriggerText = sWrapper.querySelector('.trigger-text'); const sReal = document.getElementById("subjectSelect");
        sReal.innerHTML = '<option value="" disabled selected>-- اختر المادة --</option>'; sOptions.innerHTML = ''; sTriggerText.textContent = '-- اختر المادة --';
        if (y && subjectsData[y]) {
            sReal.disabled = false; sWrapper.classList.remove('disabled');
            subjectsData[y].forEach(sub => {
                const opt = document.createElement("option"); opt.value = sub; opt.text = sub; sReal.appendChild(opt);
                const cOpt = document.createElement('div'); cOpt.className = 'custom-option'; cOpt.innerHTML = `<span>${sub}</span>`; cOpt.setAttribute('data-value', sub);
                cOpt.addEventListener('click', function (e) {
                    e.stopPropagation(); sOptions.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    this.classList.add('selected'); sTriggerText.textContent = this.querySelector('span').textContent;
                    sWrapper.classList.remove('open'); sReal.value = this.getAttribute('data-value');
                    playClick(); checkAllConditions();
                }); sOptions.appendChild(cOpt);
            });
        } else { sReal.disabled = true; sWrapper.classList.add('disabled'); sTriggerText.textContent = '-- اختر الفرقة أولاً --'; }
        checkAllConditions();
    }

    function checkAllConditions() {
        const year = document.getElementById('yearSelect').value; const group = document.getElementById('groupSelect').value;
        const sub = document.getElementById('subjectSelect').value; const qrPass = document.getElementById('sessionPass').value;
        const isVerified = attendanceData.isVerified === true; const hall = document.getElementById('hallSelect').value;
        const btn = document.getElementById('submitBtn');
        if (year && group && sub && hall && qrPass && isVerified) { btn.disabled = false; btn.style.opacity = "1"; btn.style.cursor = "pointer"; }
        else { btn.disabled = true; btn.style.opacity = "0.6"; btn.style.cursor = "not-allowed"; }
    }

    async function stopCameraSafely() { if (html5QrCode && html5QrCode.isScanning) { try { await html5QrCode.stop(); } catch (e) { } } document.getElementById('qr-reader').style.display = 'none'; releaseWakeLock(); }
    function retryCamera() { document.getElementById('cameraErrorModal').style.display = 'none'; proceedToCamera(); }
    async function startQrScanner() { playClick(); requestWakeLock(); await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('qr-reader').style.display = 'block'; document.getElementById('qr-reader').innerHTML = '<div class="scanner-laser" style="display:block"></div>'; document.getElementById('submitBtn').disabled = true; document.getElementById('sessionPass').value = ''; html5QrCode = new Html5Qrcode("qr-reader"); try { await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (t) => { playBeep(); html5QrCode.stop().then(() => { document.getElementById('qr-reader').style.display = 'none'; document.getElementById('scanSuccessMsg').style.display = 'flex'; document.getElementById('sessionPass').value = t; checkAllConditions(); if (navigator.vibrate) navigator.vibrate([100, 50, 100]); releaseWakeLock(); }); }); } catch (err) { await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('retryCamBtn').style.display = 'flex'; document.getElementById('cameraErrorModal').style.display = 'flex'; } }

    // 1. دالة إظهار وإخفاء كلمة المرور
    function togglePasswordVisibility() {
        const passInput = document.getElementById('adminPassword');
        const icon = document.getElementById('eyeIcon');

        if (passInput.type === 'password') {
            passInput.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
            icon.style.color = '#0ea5e9'; // لون أزرق عند الإظهار
        } else {
            passInput.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
            icon.style.color = '#94a3b8'; // لون رمادي عند الإخفاء
        }
    }

    async function checkAdminPassword() {
        playClick();

        // 1. تعريف العناصر (تأكدنا أن كل شيء موجود)
        const email = document.getElementById('adminEmailInput').value.trim();
        const pass = document.getElementById('adminPassword').value;
        const btn = document.querySelector('#screenAdminLogin .btn-main');
        const alertBox = document.getElementById('adminAlert'); // <--- تعريف الصندوق

        // 2. إخفاء التنبيه القديم عند بدء المحاولة الجديدة
        if (alertBox) alertBox.style.display = 'none';

        // 3. التحقق لو الخانات فاضية
        if (!email || !pass) {
            if (navigator.vibrate) navigator.vibrate(200);
            // إظهار التنبيه فوراً
            if (alertBox) {
                alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> يرجى كتابة البيانات`;
                alertBox.style.display = 'flex';
            }
            return;
        }

        // تغيير شكل الزر للتحميل
        const oldText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الدخول...';
        btn.disabled = true;

        try {
            // محاولة الدخول
            await signInWithEmailAndPassword(auth, email, pass);

            // --- نجاح الدخول ---
            playSuccess();
            const modal = document.getElementById('adminSuccessModal');
            modal.style.display = 'flex';

            const sessionToken = "admin_verified_SECURE_" + Date.now();
            sessionStorage.setItem(ADMIN_AUTH_TOKEN, sessionToken);

            setTimeout(() => {
                modal.style.display = 'none';
                updateUIForMode();
                switchScreen('screenWelcome');
                document.getElementById('adminPassword').value = '';
            }, 2000);

        } catch (error) {
            console.error("Login Error:", error);

            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

            // تحديد نص الرسالة
            let msg = "حدث خطأ غير معروف";

            if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                msg = "البريد أو كلمة المرور خطأ";
            } else if (error.code === 'auth/invalid-email') {
                msg = "صيغة البريد غير صحيحة";
            } else if (error.code === 'auth/too-many-requests') {
                msg = "محاولات كثيرة.. انتظر قليلاً";
            } else if (error.code === 'auth/network-request-failed') {
                msg = "تأكد من اتصال الإنترنت";
            }

            // 4. إظهار المربع الأحمر المودرن (هذا هو السطر المهم)
            if (alertBox) {
                alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${msg}`;
                alertBox.style.display = 'flex';
            }

        } finally {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }

    function showError(msg, isPermanent = false) { if (countdownInterval) clearInterval(countdownInterval); document.getElementById('errorMsg').innerHTML = msg; const retryBtn = document.getElementById('retryBtn'); if (isPermanent) retryBtn.style.display = 'none'; else { retryBtn.style.display = 'inline-block'; retryBtn.onclick = function () { location.reload(); }; } switchScreen('screenError'); if (navigator.vibrate) navigator.vibrate(300); }
    function performLogout() { playClick(); sessionStorage.removeItem(ADMIN_AUTH_TOKEN); location.reload(); }
    function openLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'flex'; }
    function closeLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'none'; }
    function showConnectionLostModal() { document.getElementById('connectionLostModal').style.display = 'flex'; }
    function hideConnectionLostModal() { document.getElementById('connectionLostModal').style.display = 'none'; }
    async function checkRealConnection() { return true; }
    function initGlobalGuard() {
        setInterval(async () => { const o = await checkRealConnection(); if (!o) showConnectionLostModal(); else hideConnectionLostModal(); }, 2000);
        if (!isMobileDevice()) { document.getElementById('desktop-blocker').style.display = 'flex'; document.body.style.overflow = 'hidden'; throw new Error("Desktop access denied."); }
    }

    // ==========================================
    //  FIREBASE: READ REPORTS (REAL-TIME)
    // ==========================================
    let unsubscribeReport = null; // أضف هذا السطر هنا بالضبط قبل الدالة
    // ==========================================
    // 1. دالة فتح السجل وجلب البيانات
    // ==========================================
    async function openReportModal() {
        playClick();
        document.getElementById('reportModal').style.display = 'flex';
        showSubjectsView();

        const now = new Date();
        const dateStr = ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth() + 1)).slice(-2) + '/' + now.getFullYear();
        document.getElementById('reportDateDisplay').innerText = dateStr;

        const container = document.getElementById('subjectsContainer');
        container.innerHTML = `<div style="text-align:center; padding:50px 20px;"><i class="fa-solid fa-circle-notch fa-spin" style="font-size:30px; color:var(--primary); margin-bottom:15px;"></i><div style="font-weight:bold; color:#64748b;">جاري الاتصال بالسيرفر...</div></div>`;

        if (window.unsubscribeReport) window.unsubscribeReport();

        try {
            const q = query(
                collection(db, "attendance"),
                where("date", "==", dateStr),
                orderBy("timestamp", "desc")
            );

            window.unsubscribeReport = onSnapshot(q, (querySnapshot) => {
                let allData = [];
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    allData.push({
                        docId: doc.id,
                        uniID: data.id,
                        subject: data.subject,
                        time: data.time_str || '--:--',
                        group: data.group,
                        name: data.name,
                        hall: data.hall,
                        code: data.session_code
                    });
                });

                // تحديث المتغيرات عشان الأسماء تظهر
                window.cachedReportData = allData;
                cachedReportData = allData;

                if (allData.length === 0) {
                    container.innerHTML = `<div class="empty-state">لا توجد سجلات اليوم.</div>`;
                } else {
                    renderSubjectsList(allData);
                }
            });

        } catch (e) {
            console.error("General Report Error:", e);
            container.innerHTML = `<div style="color:#ef4444; text-align:center; padding:30px;">⚠️ فشل فتح السجل.</div>`;
        }
    }

    function renderSubjectsList(data) {
        const subjects = [...new Set(data.map(item => item.subject || "غير محدد"))];
        let html = '';

        if (subjects.length === 0) {
            document.getElementById('subjectsContainer').innerHTML = '<div class="empty-state">لا توجد سجلات.</div>';
            return;
        }

        subjects.forEach(subject => {
            const count = data.filter(i => i.subject === subject).length;

            html += `
        <div class="subject-big-card" onclick="openSubjectDetails('${subject}')" 
             style="display: flex; flex-direction: column; padding: 15px 20px; gap: 12px; margin-bottom: 12px;">

            <div style="width: 100%; border-bottom: 1px dashed #e2e8f0; padding-bottom: 10px;">
                <h3 style="margin: 0; font-size: 17px; color: #1e293b; font-weight: 800; text-align: right; line-height: 1.5;">
                    ${subject}
                </h3>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="background: #e0f2fe; color: #0284c7; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                        <i class="fa-solid fa-users"></i>
                    </div>
                    <span style="font-size: 14px; color: #64748b; font-weight: 700;">${count} طالب</span>
                </div>

                <button onclick="event.stopPropagation(); exportAttendanceSheet('${subject}')" 
                        title="تصدير شيت إكسيل"
                        style="background: #ecfdf5; color: #047857; border: 1px solid #10b981; 
                               width: 42px; height: 42px; border-radius: 12px; 
                               display: flex; align-items: center; justify-content: center; 
                               cursor: pointer; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.15);">
                    <i class="fa-solid fa-file-excel" style="font-size: 20px;"></i>
                </button>

            </div>

        </div>`;
        });

        document.getElementById('subjectsContainer').innerHTML = html;
    }

    function getHighlights() { return JSON.parse(localStorage.getItem(HIGHLIGHT_STORAGE_KEY) || "[]"); }
    function toggleHighlightStorage(id) {
        let list = getHighlights(); if (list.includes(id)) list = list.filter(x => x !== id); else list.push(id);
        localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(list)); return list.includes(id);
    }

    function getEvaluations() { return JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY) || "{}"); }

    function updateSliderUI(val) {
        const display = document.getElementById('sliderValue'); const slider = document.getElementById('behaviorSlider');
        let colorClass = "slider-green"; let text = `مخالفة بسيطة (${val}/10)`; let colorHex = "#10b981";
        if (val >= 4 && val <= 6) { colorClass = "slider-yellow"; text = `مخالفة متوسطة (${val}/10)`; colorHex = "#f59e0b"; }
        else if (val >= 7 && val <= 8) { colorClass = "slider-orange"; text = `مخالفة مرتفعة (${val}/10)`; colorHex = "#f97316"; }
        else if (val >= 9) { colorClass = "slider-red"; text = `مخالفة جسيمة (${val}/10)`; colorHex = "#ef4444"; }
        slider.className = "range-slider " + colorClass; display.innerText = text; display.style.color = colorHex;
    }

    function openEvaluation(studentName, studentID, currentTotal = 0) {
        playClick(); currentEvalID = studentID; currentEvalName = studentName;
        document.getElementById('evalStudentName').innerText = studentName;
        const savedEvals = getEvaluations(); const totalScore = savedEvals[studentID] || 0;
        document.getElementById('evalCurrentTotal').innerText = totalScore;
        const slider = document.getElementById('behaviorSlider'); slider.value = 1; updateSliderUI(1);
        document.getElementById('evaluationModal').style.display = 'flex';
    }

    function closeEvaluation() { playClick(); document.getElementById('evaluationModal').style.display = 'none'; currentEvalID = null; currentEvalName = null; }

    // ==========================================
    //  FIREBASE: SAVE DISCIPLINE
    // ==========================================
    async function saveEvaluation() {
        if (!currentEvalID) return;
        const val = parseInt(document.getElementById('behaviorSlider').value);

        // Local Update
        let evals = getEvaluations(); const oldVal = parseInt(evals[currentEvalID] || 0);
        evals[currentEvalID] = oldVal + val; localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify(evals));

        const btn = document.querySelector('#evaluationModal .btn-main'); const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';

        try {
            await addDoc(collection(db, "discipline"), {
                id: currentEvalID,
                name: currentEvalName,
                score: val,
                total_score: evals[currentEvalID],
                timestamp: Timestamp.now()
            });

            playSuccess(); closeEvaluation(); showToast("تم تسجيل المخالفة بنجاح", 2000, "#ef4444");
            const currentSub = document.getElementById('currentSubjectTitle').innerText; if (currentSub !== "--") openSubjectDetails(currentSub);

        } catch (e) {
            console.error(e);
            alert("فشل في الاتصال بالسيرفر، تم الحفظ محلياً فقط.");
            closeEvaluation();
        } finally { btn.innerHTML = originalText; }
    }

    function getDisciplineBadge(score) {
        if (score <= 0) return '';
        let badgeClass = 'eval-badge-low'; let icon = 'fa-circle-exclamation';
        if (score >= 4 && score < 9) { badgeClass = 'eval-badge-med'; icon = 'fa-triangle-exclamation'; } else if (score >= 9) { badgeClass = 'eval-badge-high'; icon = 'fa-fire'; }
        return `<span class="eval-badge-modern ${badgeClass}"><i class="fa-solid ${icon}"></i> ${score}</span>`;
    }

    function openSubjectDetails(subjectName) {
        playClick(); document.getElementById('currentSubjectTitle').innerText = subjectName;
        let students = cachedReportData.filter(s => s.subject === subjectName);
        students.sort((a, b) => { return a.group.localeCompare(b.group, undefined, { numeric: true, sensitivity: 'base' }); });
        const highlights = getHighlights(); const evaluations = getEvaluations();
        let html = '';
        students.forEach(item => {
            const sessionCode = item.code || "N/A"; const hallName = item.hall || "N/A"; const groupName = item.group || "Unknown";
            const studentName = item.name || "غير معروف"; const studentID = item.uniID || "---"; const timeStr = item.time || "--:--";
            const totalDiscipline = evaluations[studentID] || 0;
            const highlightClass = highlights.includes(studentID) ? 'highlighted-red' : '';
            const evalBadge = getDisciplineBadge(totalDiscipline);
            html += `<div class="student-detailed-card ${highlightClass}" id="card-${studentID}">
                    <div class="st-data-col" style="width: 100%;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <div class="st-name" onclick="openEvaluation('${studentName}', '${studentID}', ${totalDiscipline})">${studentName} ${evalBadge}</div>
                            <div style="display:flex;">
                                <button class="btn-highlight-item" onclick="highlightEntry('${studentID}', '${subjectName}', this)"><i class="fa-solid fa-highlighter"></i></button>
                                <button class="btn-delete-item" onclick="deleteEntry('${studentID}', '${subjectName}', this)" style="margin-right:5px;"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div style="background:#e0f2fe; color:#0284c7; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid #bae6fd;"><i class="fa-solid fa-users-rectangle"></i> ${groupName}</div>
                            <div class="en-font" style="font-size:12px; color:#64748b; font-weight:600;">ID: ${studentID}</div>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="font-size:11px; color:#0ea5e9; font-weight:bold; background:#f0f9ff; padding:4px 8px; border-radius:6px;"><i class="fa-solid fa-fingerprint"></i> <span class="en-font">${sessionCode}</span></div>
                            <div class="std-time-badge" style="margin:0;"><i class="fa-regular fa-clock"></i> <span class="en-font">${timeStr}</span></div>
                        </div>
                        <div style="margin-top:5px; text-align:left; font-size:11px; color:#64748b;"><i class="fa-solid fa-building-columns"></i> ${hallName}</div>
                    </div>
                </div>`;
        });
        document.getElementById('studentsContainer').innerHTML = html;
        document.getElementById('viewSubjects').style.transform = 'translateX(100%)';
        document.getElementById('viewStudents').style.transform = 'translateX(0)';
    }

    function showSubjectsView() { playClick(); document.getElementById('viewSubjects').style.transform = 'translateX(0)'; document.getElementById('viewStudents').style.transform = 'translateX(100%)'; }
    function closeReportModal() { playClick(); document.getElementById('reportModal').style.display = 'none'; }

    let pendingAction = null;
    function showModernConfirm(title, text, actionCallback) {
        playClick(); document.getElementById('modernConfirmTitle').innerText = title; document.getElementById('modernConfirmText').innerHTML = text;
        const modal = document.getElementById('modernConfirmModal'); modal.style.display = 'flex'; pendingAction = actionCallback;
        const yesBtn = document.getElementById('btnConfirmYes'); yesBtn.onclick = function () { if (pendingAction) pendingAction(); closeModernConfirm(); }; if (navigator.vibrate) navigator.vibrate(50);
    }
    function closeModernConfirm() { playClick(); document.getElementById('modernConfirmModal').style.display = 'none'; pendingAction = null; }

    async function deleteEntry(id, subject, btn) {
        showModernConfirm("حذف نهائي", "سيتم حذف الطالب من السجل. هل أنت متأكد؟", async function () {
            const card = btn.closest('.student-detailed-card'); btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            card.style.opacity = '0'; setTimeout(() => { card.remove(); }, 300);
            showToast("تم الحذف من القائمة.", 2000, '#ef4444');
            // TODO: Delete from Firebase if needed
        });
    }

    async function highlightEntry(id, subject, btn) {
        playClick(); const card = btn.closest('.student-detailed-card');
        const isNowHighlighted = toggleHighlightStorage(id);
        if (isNowHighlighted) card.classList.add('highlighted-red'); else card.classList.remove('highlighted-red');
    }

    async function clearAllReport() {
        showModernConfirm("تصفيه السجل", "سيتم مسح البيانات. هل أنت متأكد؟", async function () {
            document.getElementById('subjectsContainer').innerHTML = '<div class="empty-state">تم التنظيف محلياً.</div>'; playSuccess();
            // Firebase clear logic can be added here if needed
        });
    }

    function isMobileDevice() { const ua = navigator.userAgent.toLowerCase(); const isTargetMobile = /android|iphone|ipod/i.test(ua); const isExcluded = /windows|macintosh|ipad|tablet|x11|kindle/i.test(ua); return (isTargetMobile && !isExcluded); }
    function showToast(message, duration = 3000, bgColor = '#334155') { const toast = document.getElementById('toastNotification'); toast.style.backgroundColor = bgColor; toast.innerText = message; toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, duration); }

    document.addEventListener('contextmenu', function (e) { e.preventDefault(); showToast('إجراء محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('copy', function (e) { e.preventDefault(); showToast('النسخ محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('cut', function (e) { e.preventDefault(); showToast('القص محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('paste', function (e) { e.preventDefault(); showToast('اللصق محظور لأسباب أمنية.', 2000, '#ef4444'); });

    // ==========================================
    //  New Smart Upload System (With Batch ID)
    // ==========================================

    // 1. دالة لفتح نافذة اختيار الملف فقط لو تم اختيار الفرقة
    window.triggerUploadProcess = function () {
        const level = document.getElementById('uploadLevelSelect').value;
        if (!level) {
            alert("⚠️ خطأ: يجب اختيار الفرقة الدراسية من القائمة أولاً!");
            return;
        }
        // لو اختار الفرقة، نفتح له نافذة الملفات
        document.getElementById('excelFileInput').click();
    };

    // 2. الاستماع لتغيير الملف (التنفيذ الفعلي)
    const fileInputSmart = document.getElementById('excelFileInput');
    if (fileInputSmart) {
        fileInputSmart.addEventListener('change', async function (e) {
            const file = e.target.files[0];
            if (!file) return;

            // قراءة المستوى المختار
            const selectedLevel = document.getElementById('uploadLevelSelect').value;
            const statusDiv = document.getElementById('uploadStatus');

            // إنشاء Batch ID فريد (السحر هنا)
            const batchID = `BATCH_L${selectedLevel}_${Date.now()}`;

            statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحليل والتصنيف...';

            try {
                const rows = await readXlsxFile(file);
                const data = rows.slice(1); // تخطي صف العناوين

                if (data.length === 0) {
                    statusDiv.innerText = "❌ الملف فارغ!";
                    return;
                }

                statusDiv.innerHTML = `<i class="fa-solid fa-server"></i> جاري رفع ${data.length} طالب للفرقة ${selectedLevel}...`;

                const batchSize = 450;
                let chunks = [];
                for (let i = 0; i < data.length; i += batchSize) chunks.push(data.slice(i, i + batchSize));

                let totalUploaded = 0;

                for (const chunk of chunks) {
                    const batch = writeBatch(db);

                    chunk.forEach(row => {
                        let studentId = row[0];
                        let studentName = row[1];

                        if (studentId && studentName) {
                            studentId = String(studentId).trim();
                            studentName = String(studentName).trim();

                            const docRef = doc(db, "students", studentId);

                            // البيانات الجديدة التي ستضاف لكل طالب
                            batch.set(docRef, {
                                name: studentName,
                                id: studentId,
                                academic_level: selectedLevel, // رقم الفرقة
                                upload_batch_id: batchID,      // كود الشيت للحذف
                                created_at: Timestamp.now()
                            }, { merge: true });
                        }
                    });

                    await batch.commit();
                    totalUploaded += chunk.length;
                    statusDiv.innerText = `تم معالجة ${totalUploaded} طالب...`;
                }

                // حفظ سجل الشيت في كولكشن منفصل
                await addDoc(collection(db, "upload_history"), {
                    batch_id: batchID,
                    level: selectedLevel,
                    filename: file.name,
                    count: totalUploaded,
                    timestamp: Timestamp.now(),
                    admin_name: "Admin"
                });

                statusDiv.innerHTML = `<span style="color: #10b981;">✅ تم بنجاح! تم حفظ وتصنيف ${totalUploaded} طالب.</span>`;
                playSuccess();
                fileInputSmart.value = '';

            } catch (error) {
                console.error("Upload Error:", error);
                statusDiv.innerText = "❌ حدث خطأ غير متوقع.";
                alert(error.message);
            }
        });
    }

    if (!isMobileDevice()) { document.getElementById('desktop-blocker').style.display = 'flex'; document.body.style.overflow = 'hidden'; throw new Error("Desktop access denied."); }

    // تصدير الدوال للاستخدام العام
    window.startProcess = startProcess;
    window.handleIdSubmit = handleIdSubmit;
    window.generateCodeAndShowDataEntry = generateCodeAndShowDataEntry;
    window.checkAdminPassword = checkAdminPassword;
    window.goBackToWelcome = goBackToWelcome;
    window.handleReportClick = handleReportClick;
    window.openExamModal = openExamModal;
    window.closeExamModal = closeExamModal;
    window.openDataEntryMenu = openDataEntryMenu;
    window.openManageHalls = openManageHalls;
    window.openManageSubjects = openManageSubjects;
    window.addHall = addHall;
    window.deleteHall = deleteHall;
    window.addSubject = addSubject;
    window.deleteSubject = deleteSubject;
    window.renderSubjectsManage = renderSubjectsManage;
    window.clearAllReport = clearAllReport;
    window.openReportModal = openReportModal;
    window.closeReportModal = closeReportModal;
    window.showSubjectsView = showSubjectsView;
    window.openSubjectDetails = openSubjectDetails;
    window.filterStudents = filterStudents;
    window.saveEvaluation = saveEvaluation;
    window.closeEvaluation = closeEvaluation;
    window.openEvaluation = openEvaluation;
    window.updateSliderUI = updateSliderUI;
    window.highlightEntry = highlightEntry;
    window.deleteEntry = deleteEntry;
    window.openDeleteAlertsConfirm = openDeleteAlertsConfirm;
    window.closeDeleteAlertsConfirm = closeDeleteAlertsConfirm;
    window.confirmClearNotifications = confirmClearNotifications;
    window.showNotificationModal = showNotificationModal;
    window.closeIdentityAlert = closeIdentityAlert;
    window.filterAlerts = filterAlerts;
    window.toggleAlertDetails = toggleAlertDetails;
    window.deleteSingleAlert = deleteSingleAlert;
    window.hideConnectionLostModal = hideConnectionLostModal;
    window.addKey = addKey;
    window.backspaceKey = backspaceKey;
    window.clearKey = clearKey;
    window.openMapsToRefreshGPS = openMapsToRefreshGPS;
    window.toggleBypassMode = toggleBypassMode;
    window.startFaceVerificationProcess = startFaceVerificationProcess;
    window.startQrScanner = startQrScanner;
    window.retryCamera = retryCamera;
    window.performLogout = performLogout;
    window.openLogoutModal = openLogoutModal;
    window.closeLogoutModal = closeLogoutModal;
    window.safeClick = safeClick;
    window.switchScreen = switchScreen;
    window.closeSelect = closeSelect;
    window.checkAllConditions = checkAllConditions;
    window.closeModernConfirm = closeModernConfirm;
    window.triggerAppInstall = triggerAppInstall;

})();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=3', { scope: './' })
            .then(registration => { console.log('ServiceWorker registration successful'); })
            .catch(err => { console.error('ServiceWorker registration failed: ', err); });
    });
}
// ==========================================
//  FIREBASE: EXPORT TO EXCEL (تصدير حسب المادة)
// ==========================================
// ==========================================
//  تصدير المادة المحددة إلى ملف Excel
// ==========================================
window.exportSubjectToExcel = function (subjectName) {
    // التحقق من وجود بيانات
    if (!window.cachedReportData || window.cachedReportData.length === 0) {
        alert("لا توجد بيانات متاحة حالياً للتصدير.");
        return;
    }

    // فلترة الطلاب حسب المادة المختارة
    const filteredStudents = window.cachedReportData.filter(s => s.subject === subjectName);

    if (filteredStudents.length === 0) {
        alert(`لا يوجد حضور مسجل في مادة: ${subjectName}`);
        return;
    }

    // تجهيز البيانات بتنسيق مناسب للإكسل
    const dataForExcel = filteredStudents.map((student, index) => ({
        "م": index + 1,
        "اسم الطالب": student.name,
        "الكود الجامعي": student.uniID,
        "المجموعة": student.group,
        "وقت التسجيل": student.time,
        "القاعة": student.hall || "غير محدد",
        "كود الجلسة": student.code || "N/A"
    }));

    try {
        // إنشاء ورقة العمل
        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "الحضور");

        // ضبط اتجاه النص للعربية (يمين لليسار)
        worksheet['!dir'] = 'rtl';

        // تحميل الملف
        const fileName = `حضور_${subjectName}_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    } catch (error) {
        console.error("Excel Export Error:", error);
        alert("حدث خطأ أثناء إنشاء ملف الإكسل. تأكد من إضافة مكتبة XLSX في ملف HTML.");
    }
};

// جعل الدالة متاحة للضغط
window.exportSubjectToExcel = exportSubjectToExcel;
function playClick() {
    if (navigator.vibrate) navigator.vibrate(10);
}
// ==========================================
//  تصدير الحضور لملف Excel باسم المادة
// ==========================================
window.exportSubjectToExcel = function (subjectName) {
    // 1. جلب البيانات من المخزن العالمي
    const allData = window.cachedReportData || [];

    // 2. فلترة البيانات للمادة المطلوبة فقط
    const filteredData = allData.filter(item => item.subject === subjectName);

    if (filteredData.length === 0) {
        alert(`⚠️ لا توجد بيانات مسجلة لمادة: ${subjectName}`);
        return;
    }

    // 3. تنسيق البيانات داخل الجدول
    const excelRows = filteredData.map((student, index) => ({
        "م": index + 1,
        "اسم المادة": subjectName, // إضافة اسم المادة داخل كل سطر
        "اسم الطالب": student.name,
        "الكود الجامعي": student.uniID,
        "المجموعة": student.group,
        "وقت الحضور": student.time,
        "المدرج/القاعة": student.hall,
        "كود الجلسة": student.code
    }));

    try {
        // 4. إنشاء ملف الإكسل
        const worksheet = XLSX.utils.json_to_sheet(excelRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, subjectName); // اسم الشيت بالأسفل

        // ضبط الاتجاه لليمين (RTL)
        worksheet['!dir'] = 'rtl';

        // 5. تحميل الملف باسم المادة والتاريخ
        const dateStr = new Date().toLocaleDateString('ar-EG').replace(/\//g, '-');
        const fileName = `حضور_${subjectName}_بتاريخ_${dateStr}.xlsx`;

        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error("Excel Export Error:", error);
        alert("حدث خطأ أثناء تصدير الملف. تأكد من تحميل الصفحة بالكامل.");
    }
};
// ==========================================
//  نظام إدارة وحذف الشيتات (Upload History)
// ==========================================

// 1. فتح السجل وجلب البيانات
window.openUploadHistory = async function () {
    playClick();
    document.getElementById('manageUploadsModal').style.display = 'flex';
    const container = document.getElementById('uploadsHistoryContainer');

    container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> جاري جلب السجل...</div>';

    try {
        // جلب آخر 20 عملية رفع
        const q = query(collection(db, "upload_history"), orderBy("timestamp", "desc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            container.innerHTML = '<div class="empty-state">لا توجد عمليات رفع مسجلة.</div>';
            return;
        }

        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const dateObj = data.timestamp ? data.timestamp.toDate() : new Date();
            const dateStr = dateObj.toLocaleDateString('en-GB') + ' ' + dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            // تحديد لون حسب الفرقة
            let badgeColor = "#0f172a";
            if (data.level == "1") badgeColor = "#0ea5e9";
            else if (data.level == "2") badgeColor = "#8b5cf6";

            html += `
            <div class="list-item-manage" style="flex-direction:column; align-items:flex-start; gap:8px; background:#fff; border:1px solid #e2e8f0; padding:15px; border-radius:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <div style="font-weight:bold; color:#1e293b; font-size:14px;">${data.filename || 'ملف بدون اسم'}</div>
                    <div style="background:${badgeColor}; color:white; padding:2px 8px; border-radius:6px; font-size:10px;">الفرقة ${data.level}</div>
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <div style="font-size:11px; color:#64748b;">${dateStr} • <span style="color:#10b981; font-weight:bold;">${data.count} طالب</span></div>
                    <button onclick="deleteBatch('${data.batch_id}', '${doc.id}')" style="background:#fee2e2; color:#ef4444; border:none; padding:5px 10px; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer;">
                        <i class="fa-solid fa-trash-can"></i> حذف الشيت
                    </button>
                </div>
            </div>`;
        });

        container.innerHTML = html;

    } catch (error) {
        console.error(error);
        container.innerHTML = '<div style="color:red; text-align:center;">حدث خطأ في جلب البيانات</div>';
    }
};

// ==========================================
//  تحديث نهائي: دالة الحذف (المضادة للتعليق)
// ==========================================
window.deleteBatch = function (batchId, historyDocId) {
    if (!batchId) return;

    showModernConfirm(
        "حذف الشيت نهائياً 🗑️",
        "تحذير: سيتم حذف جميع الطلاب المسجلين في هذا الشيت.<br>هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟",
        async function () {
            const container = document.getElementById('uploadsHistoryContainer');

            // تصميم رسالة التحميل
            container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px; animation: fadeIn 0.5s;">
                    <div style="position:relative; width:60px; height:60px; margin-bottom:20px;">
                        <div style="position:absolute; width:100%; height:100%; border:4px solid #f1f5f9; border-radius:50%;"></div>
                        <div style="position:absolute; width:100%; height:100%; border:4px solid #ef4444; border-top-color:transparent; border-radius:50%; animation: spin 1s linear infinite;"></div>
                        <i class="fa-solid fa-trash-can" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:#ef4444; font-size:20px;"></i>
                    </div>
                    <div style="font-weight:800; color:#1e293b; font-size:16px; margin-bottom:5px;">جاري حذف البيانات...</div>
                </div>
            `;

            try {
                // 1. حذف الطلاب (Batch Delete)
                const q = query(collection(db, "students"), where("upload_batch_id", "==", batchId));
                const snapshot = await getDocs(q);

                if (snapshot.docs.length > 0) {
                    const chunks = [];
                    const docs = snapshot.docs;
                    for (let i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));

                    for (const chunk of chunks) {
                        const batch = writeBatch(db);
                        chunk.forEach(doc => batch.delete(doc.ref));
                        await batch.commit();
                    }
                }

                // 2. حذف سجل الشيت
                await deleteDoc(doc(db, "upload_history", historyDocId));

                // 3. نجاح
                try { playSuccess(); } catch (e) { } // تشغيل الصوت بأمان
                showToast(`تم الحذف بنجاح.`, 3000, "#10b981");

            } catch (error) {
                console.error("Delete Error:", error);
                showToast("حدث خطأ بسيط، لكن قد يكون الحذف تم.", 3000, "#f59e0b");
            } finally {
                // =============================================
                // هذا الجزء سيعمل دائماً وسيخفي رسالة التحميل
                // =============================================
                openUploadHistory();
            }
        }
    );
};
// دوال فتح وإغلاق النافذة الجديدة
window.openManageStudentsModal = function () {
    playClick();
    document.getElementById('manageStudentsModal').style.display = 'flex';
};

window.closeManageStudentsModal = function () {
    playClick();
    document.getElementById('manageStudentsModal').style.display = 'none';
};

// تعديل دالة الرفع لتستخدم التنبيه الحديث (بدل alert)
window.triggerUploadProcess = function () {
    const level = document.getElementById('uploadLevelSelect').value;

    if (!level) {
        if (navigator.vibrate) navigator.vibrate(200);
        showToast("⚠️ يرجى اختيار الفرقة الدراسية أولاً!", 3000, "#ef4444");

        // تأثير بصري للفت الانتباه
        const selectBox = document.getElementById('uploadLevelSelect');
        selectBox.focus();
        selectBox.style.borderColor = "#ef4444";
        setTimeout(() => selectBox.style.borderColor = "#e2e8f0", 2000);
        return;
    }
    document.getElementById('excelFileInput').click();
};
// ==========================================
//  دوال نافذة التأكيد الحديثة (Modern Confirm)
// ==========================================

// 1. دالة الإظهار
window.showModernConfirm = function (title, text, actionCallback) {
    playClick(); // تشغيل صوت النقر

    // تحديث النصوص
    const titleEl = document.getElementById('modernConfirmTitle');
    const textEl = document.getElementById('modernConfirmText');

    if (titleEl) titleEl.innerText = title;
    if (textEl) textEl.innerHTML = text;

    // حفظ الأمر اللي هيتنفذ لو ضغط "نعم"
    window.pendingAction = actionCallback;

    // إظهار النافذة
    const modal = document.getElementById('modernConfirmModal');
    if (modal) modal.style.display = 'flex';
};

// 2. دالة الإغلاق
window.closeModernConfirm = function () {
    playClick();
    const modal = document.getElementById('modernConfirmModal');
    if (modal) modal.style.display = 'none';
    window.pendingAction = null; // إلغاء الأمر المعلق
};

// 3. تفعيل زر "نعم"
const confirmBtn = document.getElementById('btnConfirmYes');
if (confirmBtn) {
    confirmBtn.onclick = function () {
        if (window.pendingAction) window.pendingAction(); // تنفيذ الأمر
        closeModernConfirm(); // إغلاق النافذة
    };
}
window.exportAttendanceSheet = async function (subjectName) {
    playClick();

    // ==========================================
    // 1. إصلاح مشكلة subjectsData (تعريف المواد داخلياً)
    // ==========================================

    // نحاول نجيب المواد من التخزين عشان لو أنت ضفت مواد جديدة
    let subjectsConfig = JSON.parse(localStorage.getItem('subjectsData_v4'));

    // لو مش موجودة، نستخدم القائمة الافتراضية (عشان الكود ميعطلش)
    if (!subjectsConfig) {
        subjectsConfig = {
            "first_year": ["اساسيات تمريض 1 نظري", "اساسيات تمريض 1 عملي", "تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "اناتومى نظرى", "اناتومى عملى", "تقييم صحى نظرى", "تقييم صحى عملى", "مصطلحات طبية", "فسيولوجى", "تكنولوجيا المعلومات"],
            "second_year": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "تمريض حالات حرجة 1 نظرى", "تمريض حالات حرجة 1 عملى", "امراض باطنة", "باثولوجى", "علم الأدوية", "الكتابة التقنية"],
            "third_year": [],
            "fourth_year": []
        };
    }

    // ==========================================
    // 2. التحديد التلقائي للفرقة
    // ==========================================
    let TARGET_LEVEL = "1"; // قيمة افتراضية

    // بنسأل القائمة اللي جهزناها فوق: المادة دي تبع سنة كام؟
    if (subjectsConfig["first_year"] && subjectsConfig["first_year"].includes(subjectName)) {
        TARGET_LEVEL = "1";
    } else if (subjectsConfig["second_year"] && subjectsConfig["second_year"].includes(subjectName)) {
        TARGET_LEVEL = "2";
    } else if (subjectsConfig["third_year"] && subjectsConfig["third_year"].includes(subjectName)) {
        TARGET_LEVEL = "3";
    } else if (subjectsConfig["fourth_year"] && subjectsConfig["fourth_year"].includes(subjectName)) {
        TARGET_LEVEL = "4";
    }

    const toastID = showToast(`⏳ جاري استخراج شيت (حضور + غياب) للفرقة ${TARGET_LEVEL}...`, 15000, "#3b82f6");

    try {
        // 3. جلب الحاضرين
        const attendees = cachedReportData.filter(s => s.subject === subjectName);
        const attendeesMap = {};
        attendees.forEach(a => attendeesMap[a.uniID] = a);

        // 4. جلب دفعة الغياب بالكامل (بناءً على الفرقة اللي حددناها)
        const q = query(collection(db, "students"), where("academic_level", "==", TARGET_LEVEL));
        const querySnapshot = await getDocs(q);

        let allStudentsInLevel = [];
        querySnapshot.forEach((doc) => {
            const s = doc.data();
            allStudentsInLevel.push({
                id: s.id,
                name: s.name,
                level: s.academic_level,
                isMainList: true
            });
        });

        let finalReport = [];

        // أ) معالجة أبناء الدفعة الأصليين
        allStudentsInLevel.forEach(student => {
            const attendanceRecord = attendeesMap[student.id];

            if (attendanceRecord) {
                // حاضر
                finalReport.push({
                    ...student,
                    status: "✅ حاضر",
                    time: attendanceRecord.time,
                    group: attendanceRecord.group,
                    rowColor: ""
                });
                delete attendeesMap[student.id];
            } else {
                // غائب
                finalReport.push({
                    ...student,
                    status: "❌ غائب",
                    time: "--:--",
                    group: "--",
                    rowColor: "style='color: #ef4444; background-color: #fef2f2;'"
                });
            }
        });

        // ب) معالجة التخلفات (المتبقيين)
        for (let intruderID in attendeesMap) {
            const intruder = attendeesMap[intruderID];
            let realLevel = "تخلفات";
            try {
                const docRef = doc(db, "students", intruderID);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) realLevel = docSnap.data().academic_level;
            } catch (e) { }

            finalReport.push({
                id: intruder.uniID,
                name: intruder.name,
                level: realLevel,
                status: "✅ حاضر",
                time: intruder.time,
                group: intruder.group,
                rowColor: "style='background-color: #fef08a; color: #854d0e; font-weight:bold;'"
            });
        }

        // 5. الترتيب الأبجدي
        finalReport.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

        // 6. بناء ملف الإكسيل
        let tableContent = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head>
                <meta charset="UTF-8">
                <style>
                    table { border-collapse: collapse; width: 100%; direction: rtl; }
                    th { background-color: #1e293b; color: white; border: 1px solid #000; padding: 10px; }
                    td { border: 1px solid #000; padding: 5px; text-align: center; }
                </style>
            </head>
            <body>
            <h3>كشف حضور وغياب مادة: ${subjectName} (الفرقة ${TARGET_LEVEL})</h3>
            <table>
                <thead>
                    <tr>
                        <th>م</th>
                        <th>الاسم</th>
                        <th>الكود الجامعي</th>
                        <th>الفرقة</th>
                        <th>الحالة</th>
                        <th>وقت الحضور</th>
                        <th>المجموعة</th>
                    </tr>
                </thead>
                <tbody>
        `;

        finalReport.forEach((row, index) => {
            tableContent += `
                <tr ${row.rowColor}>
                    <td>${index + 1}</td>
                    <td>${row.name}</td>
                    <td style='mso-number-format:"\\@"'>${row.id}</td>
                    <td>${row.level}</td>
                    <td>${row.status}</td>
                    <td>${row.time}</td>
                    <td>${row.group}</td>
                </tr>
            `;
        });

        tableContent += `</tbody></table></body></html>`;

        // 7. التنزيل
        const blob = new Blob([tableContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

        link.setAttribute("href", url);
        link.setAttribute("download", `${subjectName}_الفرقة_${TARGET_LEVEL}_${dateStr}.xls`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        playSuccess();
        if (document.getElementById('toastNotification')) document.getElementById('toastNotification').style.display = 'none';

    } catch (error) {
        console.error(error);
        alert("حدث خطأ: " + error.message);
    }
};

// ==========================================
// حل مشكلة showToast ورسائل التنبيه
// ==========================================
if (typeof showToast === 'undefined') {
    window.showToast = function (message, duration = 3000, bgColor = '#334155') {
        const toast = document.getElementById('toastNotification');
        if (toast) {
            toast.style.backgroundColor = bgColor;
            toast.innerText = message;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, duration);
        } else {
            // بديل لو العنصر مش موجود يظهر رسالة عادية
            console.log("تنبيه: " + message);
        }
    };
}
// ==========================================
// تعريف دوال الصوت عشان تمنع الأخطاء
// ==========================================
window.playSuccess = function () {
    // دالة فارغة: عشان الكود ميعطلش لما يحاول يشغل صوت
    console.log("تمت العملية بنجاح ✅");
};

window.playClick = function () {
    // دالة فارغة: عشان الكود ميعطلش عند النقر
};

window.playBeep = function () {
    // دالة فارغة
};
// ============================================================
//  منطقة الأرشيف الذكي (Auto-Complete)
// ============================================================

// 1. قائمة المواد (المرجع)
const ARCHIVE_SUBJECTS = {
    "1": ["اساسيات تمريض 1 نظري", "اساسيات تمريض 1 عملي", "تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "اناتومى نظرى", "اناتومى عملى", "تقييم صحى نظرى", "تقييم صحى عملى", "مصطلحات طبية", "فسيولوجى", "تكنولوجيا المعلومات"],
    "2": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "تمريض حالات حرجة 1 نظرى", "تمريض حالات حرجة 1 عملى", "امراض باطنة", "باثولوجى", "علم الأدوية", "الكتابة التقنية"],
    "3": [],
    "4": []
};

// 2. دالة تحديث الاقتراحات (بتشتغل لما تختار الفرقة)
window.updateArchiveSubjects = function () {
    const level = document.getElementById('archiveLevelSelect').value;
    const dataList = document.getElementById('subjectsList'); // القائمة الخفية
    const inputField = document.getElementById('archiveSubjectInput'); // مربع الكتابة

    // تفريغ الاقتراحات القديمة وتفريغ خانة الكتابة
    dataList.innerHTML = '';
    inputField.value = '';

    if (!level || !ARCHIVE_SUBJECTS[level]) return;

    // إضافة المواد كـ اقتراحات
    ARCHIVE_SUBJECTS[level].forEach(sub => {
        const option = document.createElement('option');
        option.value = sub; // القيمة اللي هتتكتب
        dataList.appendChild(option);
    });
};

// 3. دالة التحميل (تم إصلاح سبب رسالة الخطأ)
window.downloadHistoricalSheet = async function () {
    playClick();

    // جلب البيانات من المدخلات الجديدة
    const level = document.getElementById('archiveLevelSelect').value;
    // هنا التغيير: بنجيب القيمة من مربع الكتابة مش القائمة
    const subjectName = document.getElementById('archiveSubjectInput').value.trim();
    const rawDate = document.getElementById('historyDateInput').value;

    // التحقق من البيانات
    if (!level) {
        showToast("⚠️ يرجى اختيار الفرقة أولاً", 3000, "#f59e0b");
        return;
    }
    if (!subjectName) {
        showToast("⚠️ يرجى كتابة أو اختيار اسم المادة", 3000, "#f59e0b");
        return;
    }
    if (!rawDate) {
        showToast("⚠️ يرجى اختيار التاريخ", 3000, "#f59e0b");
        return;
    }

    // باقي الكود زي ما هو (تحويل التاريخ والبحث)
    const formattedDate = rawDate.split("-").reverse().join("/");
    const btn = document.querySelector('#attendanceRecordsModal .btn-main');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري البحث...';

    try {
        // البحث في الداتابيز
        const attQuery = query(collection(db, "attendance"), where("date", "==", formattedDate), where("subject", "==", subjectName));
        const attSnap = await getDocs(attQuery);

        if (attSnap.empty) {
            showToast(`❌ مفيش بيانات لمادة (${subjectName}) يوم ${formattedDate}`, 4000, "#ef4444");
            btn.innerHTML = oldText;
            return;
        }

        const attendeesMap = {};
        attSnap.forEach(d => { const data = d.data(); attendeesMap[data.id] = data; });

        const stQuery = query(collection(db, "students"), where("academic_level", "==", level));
        const stSnap = await getDocs(stQuery);

        // بناء ملف الإكسيل (CSV)
        let csvContent = "\uFEFFالاسم,الكود,الحالة,الوقت,المجموعة\n";

        stSnap.forEach(doc => {
            const s = doc.data();
            if (attendeesMap[s.id]) {
                csvContent += `${s.name},"${s.id}",✅ حاضر,${attendeesMap[s.id].time_str || '-'},${attendeesMap[s.id].group || '-'}\n`;
                delete attendeesMap[s.id];
            } else {
                csvContent += `${s.name},"${s.id}",❌ غائب,-,-\n`;
            }
        });

        for (let id in attendeesMap) {
            const intruder = attendeesMap[id];
            csvContent += `${intruder.name},"${intruder.id}",⚠️ حاضر (تخلفات),${intruder.time_str || '-'},${intruder.group || '-'}\n`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Archive_${subjectName}_${formattedDate.replace(/\//g, '-')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        playSuccess();
        document.getElementById('attendanceRecordsModal').style.display = 'none';

    } catch (e) {
        console.error(e);
        alert("حدث خطأ: " + e.message);
    } finally {
        btn.innerHTML = oldText;
    }
};
// ============================================================
//  نظام البحث الذكي المتطور (Google Style) 🧠
// ============================================================

const SEARCH_DB = {
    "1": ["اساسيات تمريض 1 نظري", "اساسيات تمريض 1 عملي", "تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "اناتومى نظرى", "اناتومى عملى", "تقييم صحى نظرى", "تقييم صحى عملى", "مصطلحات طبية", "فسيولوجى", "تكنولوجيا المعلومات"],
    "2": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "تمريض حالات حرجة 1 نظرى", "تمريض حالات حرجة 1 عملى", "امراض باطنة", "باثولوجى", "علم الأدوية", "الكتابة التقنية"],
    "3": [],
    "4": []
};

// دالة توحيد الحروف (السر كله هنا)
function normalizeText(text) {
    if (!text) return "";
    return text.toString()
        .replace(/[أإآ]/g, 'ا')  // الألفات
        .replace(/ة/g, 'ه')      // التاء المربوطة
        .replace(/ى/g, 'ي');     // الياء
}

// تعديل دالة البحث الذكي (عشان ما تمسحش الكلام)
window.smartSubjectSearch = function () {
    const input = document.getElementById('archiveSubjectInput');
    const box = document.getElementById('suggestionBox');
    const level = document.getElementById('archiveLevelSelect').value;

    // لو مفيش فرقة، نخفي القائمة بس وما نمسحش الكلام
    if (!level) {
        if (box) box.style.display = 'none';
        return;
    }

    const query = normalizeText(input.value);
    const list = SEARCH_DB[level] || [];

    box.innerHTML = '';
    let hasResults = false;

    list.forEach(subject => {
        if (normalizeText(subject).includes(query)) {
            hasResults = true;
            const item = document.createElement('div');
            item.innerText = subject;
            item.style.cssText = "padding:10px; cursor:pointer; border-bottom:1px solid #f1f5f9; color:#334155; transition:0.2s;";

            item.onmouseover = function () { this.style.backgroundColor = "#f0f9ff"; };
            item.onmouseout = function () { this.style.backgroundColor = "white"; };

            item.onclick = function () {
                input.value = subject;
                box.style.display = 'none';
            };

            box.appendChild(item);
        }
    });

    // إظهار الصندوق فقط لو فيه نتايج وفيه كلام مكتوب
    if (hasResults && query.length > 0) {
        box.style.display = 'block';
    } else {
        box.style.display = 'none';
    }
};

// 2. دالة مسح الخانة عند تغيير الفرقة
window.clearSearchBox = function () {
    document.getElementById('archiveSubjectInput').value = '';
    document.getElementById('suggestionBox').style.display = 'none';
};

// 3. إغلاق القائمة لو ضغطت في أي مكان بره
document.addEventListener('click', function (e) {
    const box = document.getElementById('suggestionBox');
    const input = document.getElementById('archiveSubjectInput');
    if (e.target !== box && e.target !== input) {
        if (box) box.style.display = 'none';
    }
});

// ==========================================
// دالة التحميل (زي ما هي بدون تعديل)
// ==========================================
window.downloadHistoricalSheet = async function () {
    playClick();
    const level = document.getElementById('archiveLevelSelect').value;
    const subjectName = document.getElementById('archiveSubjectInput').value; // هنا بناخد من الـ input
    const rawDate = document.getElementById('historyDateInput').value;

    if (!level || !subjectName || !rawDate) {
        showToast("⚠️ البيانات ناقصة", 3000, "#f59e0b"); return;
    }

    const formattedDate = rawDate.split("-").reverse().join("/");
    const btn = document.querySelector('#attendanceRecordsModal .btn-main');
    const oldText = btn.innerHTML;
    btn.innerHTML = 'Wait...';

    try {
        const attQuery = query(collection(db, "attendance"), where("date", "==", formattedDate), where("subject", "==", subjectName));
        const attSnap = await getDocs(attQuery);

        if (attSnap.empty) {
            showToast("❌ لا توجد بيانات", 3000, "#ef4444");
            btn.innerHTML = oldText; return;
        }

        const attendeesMap = {};
        attSnap.forEach(d => attendeesMap[d.data().id] = d.data());

        const stQuery = query(collection(db, "students"), where("academic_level", "==", level));
        const stSnap = await getDocs(stQuery);

        let report = [];
        stSnap.forEach(doc => {
            const s = doc.data();
            if (attendeesMap[s.id]) {
                report.push({ name: s.name, id: s.id, st: "✅ حاضر", bg: "" });
                delete attendeesMap[s.id];
            } else {
                report.push({ name: s.name, id: s.id, st: "❌ غائب", bg: "style='background:#fef2f2; color:red'" });
            }
        });

        for (let id in attendeesMap) report.push({ name: attendeesMap[id].name, id: id, st: "✅ حاضر (تخلفات)", bg: "style='background:#fef08a'" });

        let csv = `\uFEFFالاسم,الكود,الحالة\n`;
        report.forEach(r => csv += `${r.name},"${r.id}",${r.st}\n`);

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Archive_${subjectName}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        playSuccess();
        document.getElementById('attendanceRecordsModal').style.display = 'none';

    } catch (e) { console.error(e); } finally { btn.innerHTML = oldText; }
};
// ==========================================
//  نظام الدخول الآمن (Firebase Auth) 🔐
// ==========================================

// 1. دالة فتح نافذة الدخول (اربط دي بزرار "إدخال بيانات الطلاب" الرئيسي)
window.openAdminLogin = function () {
    // لو مسجل دخول قبل كده، افتح علطول
    if (sessionStorage.getItem("is_logged_in_securely")) {
        document.getElementById('dataEntryModal').style.display = 'flex';
    } else {
        document.getElementById('secureLoginModal').style.display = 'flex';
    }
};

// 2. دالة تنفيذ الدخول
window.performSecureLogin = async function () {
    const email = document.getElementById('adminEmail').value;
    const pass = document.getElementById('adminPass').value;
    const btn = document.querySelector('#secureLoginModal .btn-main');

    if (!email || !pass) {
        showToast("⚠️ اكتب البيانات الأول", 3000, "#f59e0b");
        return;
    }

    const oldText = btn.innerHTML;
    btn.innerHTML = 'جاري التحقق...';

    try {
        // هنا السحر: بنسأل سيرفر جوجل
        await signInWithEmailAndPassword(auth, email, pass);

        // لو مطلعش خطأ، يبقى تمام
        showToast("🔓 تم تسجيل الدخول بنجاح", 3000, "#10b981");
        document.getElementById('secureLoginModal').style.display = 'none';

        // حفظ حالة الدخول مؤقتاً (عشان ميسألوش تاني طول الجلسة)
        sessionStorage.setItem("is_logged_in_securely", "true");

        // فتح لوحة التحكم الأصلية
        document.getElementById('dataEntryModal').style.display = 'flex';

    } catch (error) {
        console.error(error);
        showToast("❌ بيانات الدخول غير صحيحة!", 3000, "#ef4444");
    } finally {
        btn.innerHTML = oldText;
    }
};
// ... (أكوادك السابقة) ...

// 1. ضع كود دالة العين هنا (قبل سطر التفعيل)
function togglePasswordVisibility() {
    const passInput = document.getElementById('adminPassword');
    const icon = document.getElementById('eyeIcon');

    if (passInput.type === 'password') {
        passInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        icon.style.color = '#0ea5e9';
    } else {
        passInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
        icon.style.color = '#94a3b8';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;
