(function() {
    // ==========================================
    // إعدادات النظام
    // ==========================================
    const MASTER_REGISTRATION_LINK = "/api/sheet"; // رابط الـ API

    // تكوين روابط الجروبات (للمحاكاة)
    const GROUP_SHEET_URLS = {};
    for(let i=1; i<=20; i++) { GROUP_SHEET_URLS["1G"+i] = MASTER_REGISTRATION_LINK; }
    for(let i=1; i<=20; i++) { GROUP_SHEET_URLS["2G"+i] = MASTER_REGISTRATION_LINK; }

    const CONFIG = {
        sheetApiUrl: MASTER_REGISTRATION_LINK, 
        identitySheetUrl: "https://script.google.com/macros/s/AKfycbxi2Itb_GW4OXkP6ki5PmzN1O8GFY70XoQyYiWKUdKYHxhXL7YGMFfA2tXcXAWbC_ez/exec",
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

    // تحميل البيانات المحفوظة
    try {
        const savedAlerts = localStorage.getItem(ALERT_STORAGE_KEY);
        if (savedAlerts) systemAlerts = JSON.parse(savedAlerts);
    } catch (e) {}

    const savedDB = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    if (savedDB) {
        try { studentsDB = JSON.parse(savedDB); } catch(e) {}
    }
    
    // محاولة تحديث قاعدة البيانات في الخلفية
    fetch(CONFIG.sheetApiUrl).then(r => r.json()).then(d => { if(!d.error) { studentsDB = d; localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(d)); } }).catch(e => console.log("DB Fetch Error"));

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

    // ==========================================
    //  PWA INSTALLATION LOGIC (ADDED HERE)
    // ==========================================
    let deferredPrompt;
    const installBox = document.getElementById('installAppPrompt');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Show the install UI
        if(installBox) installBox.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
        // Hide the app-provided install promotion
        if(installBox) installBox.style.display = 'none';
        // Clear the deferredPrompt so it can be garbage collected
        deferredPrompt = null;
        showToast("شكراً لتثبيت التطبيق! 🚀", 4000, "#10b981");
    });

    function triggerAppInstall() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    if(installBox) installBox.style.display = 'none';
                }
                deferredPrompt = null;
            });
        }
    }

    // ==========================================
    //  تعريف الدوال (Logic Functions)
    // ==========================================

    function safeClick(element, callback) {
        if (isProcessingClick) return;
        if (element && (element.disabled || element.classList.contains('disabled') || element.classList.contains('locked'))) return;
        isProcessingClick = true;
        if(element) { element.style.pointerEvents = 'none'; element.style.opacity = '0.7'; }
        if (typeof callback === 'function') callback();
        setTimeout(() => {
            isProcessingClick = false;
            if(element) { element.style.pointerEvents = 'auto'; element.style.opacity = '1'; }
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

    function generateSessionKey() {
        return 'KEY-' + Math.random().toString(36).substr(2, 12).toUpperCase();
    }

    function openDataEntryMenu() { document.getElementById('dataEntryModal').style.display = 'flex'; }
    function openManageHalls() { renderHallsManage(); document.getElementById('manageHallsModal').style.display = 'flex'; }
    function openManageSubjects() { renderSubjectsManage(); document.getElementById('manageSubjectsModal').style.display = 'flex'; }
    
    function renderHallsManage() {
        const container = document.getElementById('hallsListManage');
        container.innerHTML = hallsList.map(h => `
            <div class="list-item-manage">
                <span style="font-weight:bold;">${h}</span>
                <button class="btn-delete-mini" onclick="deleteHall('${h}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');
    }
    function addHall() {
        const val = document.getElementById('newHallInput').value.trim();
        if(val && !hallsList.includes(val)) {
            hallsList.push(val); localStorage.setItem('hallsList_v4', JSON.stringify(hallsList));
            document.getElementById('newHallInput').value = ''; renderHallsManage(); renderHallOptions();
        }
    }
    function deleteHall(val) {
        if(confirm('هل أنت متأكد من حذف القاعة؟')) {
            hallsList = hallsList.filter(h => h !== val); localStorage.setItem('hallsList_v4', JSON.stringify(hallsList));
            renderHallsManage(); renderHallOptions();
        }
    }

    function renderSubjectsManage() {
        const year = document.getElementById('manageYearSelect').value;
        const container = document.getElementById('subjectsListManage');
        container.innerHTML = subjectsData[year].map(s => `
            <div class="list-item-manage">
                <span style="font-weight:bold;">${s}</span>
                <button class="btn-delete-mini" onclick="deleteSubject('${s}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');
    }
    function addSubject() {
        const year = document.getElementById('manageYearSelect').value;
        const val = document.getElementById('newSubjectInput').value.trim();
        if(val && !subjectsData[year].includes(val)) {
            subjectsData[year].push(val); localStorage.setItem('subjectsData_v4', JSON.stringify(subjectsData));
            document.getElementById('newSubjectInput').value = ''; renderSubjectsManage();
        }
    }
    function deleteSubject(val) {
        if(confirm('هل أنت متأكد من حذف المادة؟')) {
            const year = document.getElementById('manageYearSelect').value;
            subjectsData[year] = subjectsData[year].filter(s => s !== val); localStorage.setItem('subjectsData_v4', JSON.stringify(subjectsData));
            renderSubjectsManage();
        }
    }

    async function syncGlobalAlerts() {
        try {
            const nocache = new Date().getTime();
            const response = await fetch(`${CONFIG.identitySheetUrl}?action=getAlerts&t=${nocache}`);
            const data = await response.json();
            
            if (data && Array.isArray(data)) {
                const serverAlerts = data.map(item => {
                    return {
                        name: item.name,
                        id: item.id,
                        timestamp: item.timestamp,
                        risk_level: item.risk_level,
                        reason: item.reason,
                        detail: item.detail,
                        hall: item.hall,
                        distance: item.distance,
                        isRead: false
                    };
                });

                if (serverAlerts.length > 0) {
                    systemAlerts = serverAlerts;
                    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts));
                    checkStoredAlerts(); 
                    showTopToast("تم تحديث التنبيهات الأمنية");
                }
            }
        } catch (e) {
            console.error("Sync Error:", e);
        }
    }

    function showTopToast(msg) {
        const t = document.getElementById('topToast');
        t.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${msg}`;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    function checkStoredAlerts() {
        const btn = document.getElementById('notificationBtn');
        const container = document.getElementById('alertsListContainer');
        
        const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        
        document.getElementById('adminDeleteAlert').style.display = isAdmin ? 'flex' : 'none';

        const unreadCount = systemAlerts.filter(a => !a.isRead).length;
        if (unreadCount > 0) btn.classList.add('has-alert'); else btn.classList.remove('has-alert');

        if (systemAlerts.length > 0) {
            let html = '';
            systemAlerts.forEach((alert, index) => {
                const deleteBtn = isAdmin ? `<i class="fa-solid fa-trash-can" style="color:#ef4444; cursor:pointer; margin-left:10px;" onclick="deleteSingleAlert(${index}); event.stopPropagation();"></i>` : '';
                let badgeColor = "#f59e0b"; 
                if (alert.risk_level === "DEVICE_SHARING" || alert.risk_level === "FACE_SPOOF" || alert.risk_level === "LIMIT_EXCEEDED") {
                    badgeColor = "#ef4444"; 
                }
                const itemClass = alert.isRead ? 'read-alert' : 'unread-alert';

                html += `
                <div class="${itemClass}" style="border-radius:12px; padding:10px; margin-bottom:8px; cursor:pointer; transition:0.3s;" onclick="toggleAlertDetails(${index})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center;">
                            ${deleteBtn}
                            <div style="font-weight:bold; font-size:13px;">${alert.name}</div>
                        </div>
                        <div class="en-font" style="font-size:10px; color:#94a3b8;">${alert.timestamp.split(' ')[1] || alert.timestamp}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                        <div style="display:flex; flex-direction:column;">
                            <div class="en-font" style="font-size:12px; color:#64748b;">${alert.id}</div>
                            <div style="font-size:11px; color:#0f766e; font-weight:bold;">🏛️ قاعة: ${alert.hall}</div>
                        </div>
                        <div style="text-align:left;">
                            <span style="color:${badgeColor}; display:block; font-size:11px; font-weight:bold;">⚠️ ${alert.reason}</span>
                        </div>
                    </div>
                    <div id="alert-detail-${index}" style="display:none; border-top:1px dashed #e2e8f0; margin-top:8px; padding-top:8px; font-size:11px; color:#475569;">
                        ${alert.detail}<br>
                        التوقيت الكامل: <span class="en-font">${alert.timestamp}</span>
                    </div>
                </div>
                `;
            });
            container.innerHTML = html;
        } else { container.innerHTML = '<div class="empty-state" style="padding:15px; font-size:12px;">لا توجد تنبيهات مسجلة.</div>'; }
    }

    function updateNotificationUI(data) {
        if (data.risk_level && data.risk_level !== "SAFE") {
            let reasonText = "نشاط مشبوه";
            let detailText = "يرجى المراجعة";
            
            if (data.risk_level === "DEVICE_SHARING") { reasonText = "مشاركة جهاز"; detailText = "الجهاز مستخدم لطالب آخر"; }
            else if (data.risk_level === "FACE_SPOOF") { reasonText = "انتحال وجه"; detailText = "الوجه غير مطابق"; }
            else if (data.risk_level === "WRONG_LOCATION") { reasonText = "خارج الموقع"; detailText = `يبعد مسافة ${Math.round(data.distance)} م`; }
            else if (data.risk_level === "LIMIT_EXCEEDED") { reasonText = "تجاوز الحد"; detailText = "أكثر من 3 محاولات"; }

            const now = new Date();
            const newAlert = {
                name: attendanceData.name || 'مجهول',
                id: attendanceData.uniID || '---',
                timestamp: now.toLocaleTimeString('en-US'),
                risk_level: data.risk_level,
                reason: reasonText,
                detail: detailText,
                hall: document.getElementById('hallSelect').value || 'غير محدد',
                isRead: false
            };
            
            systemAlerts.unshift(newAlert);
            localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts));
            checkStoredAlerts();
        }
    }

    function toggleAlertDetails(index) {
        if (!systemAlerts[index].isRead) {
            systemAlerts[index].isRead = true; localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts)); checkStoredAlerts();
        }
        const el = document.getElementById(`alert-detail-${index}`);
        if(el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function deleteSingleAlert(index) {
        if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) {
            systemAlerts.splice(index, 1); localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(systemAlerts)); checkStoredAlerts();
        }
    }

    function openDeleteAlertsConfirm() {
        if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) {
            document.getElementById('deleteAlertsConfirmModal').style.display = 'flex';
        }
    }
    function closeDeleteAlertsConfirm() {
        document.getElementById('deleteAlertsConfirmModal').style.display = 'none';
    }
    function confirmClearNotifications() {
        if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) {
            systemAlerts = []; 
            localStorage.removeItem(ALERT_STORAGE_KEY); 
            checkStoredAlerts(); 
            closeDeleteAlertsConfirm();
            closeIdentityAlert(); 
        }
    }
    
    function filterAlerts() {
        const input = document.getElementById('alertSearchInput'); const filter = input.value.toUpperCase();
        const container = document.getElementById('alertsListContainer'); const items = container.querySelectorAll('div[onclick^="toggleAlertDetails"]');
        items.forEach(item => { const text = item.innerText || item.textContent; if (text.toUpperCase().indexOf(filter) > -1) item.style.display = ""; else item.style.display = "none"; });
    }

    function showNotificationModal() {
        const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        if (!isAdmin) {
            const btn = document.getElementById('notificationBtn'); btn.classList.add('shake-lock'); if(navigator.vibrate) navigator.vibrate(100); return;
        }
        checkStoredAlerts(); document.getElementById('identityAlertModal').style.display = 'flex';
    }

    function closeIdentityAlert() { document.getElementById('identityAlertModal').style.display = 'none'; }
    
    function filterStudents() {
        const input = document.getElementById('studentSearchInput'); const filter = input.value.toUpperCase();
        const container = document.getElementById('studentsContainer'); const cards = container.getElementsByClassName('student-detailed-card');
        for (let i = 0; i < cards.length; i++) {
            const textValue = cards[i].textContent || cards[i].innerText;
            if (textValue.toUpperCase().indexOf(filter) > -1) cards[i].style.display = ""; else cards[i].style.display = "none";
        }
    }

    function openExamModal() { playClick(); document.getElementById('examModal').style.display = 'flex'; }
    function closeExamModal() { playClick(); document.getElementById('examModal').style.display = 'none'; }
    function handleReportClick() { const btn = document.getElementById('btnViewReport'); if (btn.classList.contains('locked')) { if(navigator.vibrate) navigator.vibrate(50); } else { safeClick(btn, openReportModal); } }

    function resetApplicationState() {
        attendanceData = {}; attendanceData.isVerified = false; 
        sessionStorage.removeItem(TEMP_NAME_KEY); sessionStorage.removeItem(TEMP_ID_KEY); sessionStorage.removeItem(TEMP_CODE_KEY); sessionStorage.removeItem(SESSION_END_TIME_KEY);
        document.getElementById('uniID').value = ''; document.getElementById('attendanceCode').value = ''; document.getElementById('sessionPass').value = '';
        
        const yearWrapper = document.getElementById('yearSelectWrapper');
        yearWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة --'; yearWrapper.classList.remove('open');
        yearWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); document.getElementById('yearSelect').value = '';
        
        const groupWrapper = document.getElementById('groupSelectWrapper');
        groupWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة أولاً --'; groupWrapper.classList.add('disabled'); groupWrapper.classList.remove('open');
        document.getElementById('groupOptionsContainer').innerHTML = ''; document.getElementById('groupSelect').innerHTML = '<option value="" disabled selected>-- اختر الفرقة أولاً --</option>';

        const subjectWrapper = document.getElementById('subjectSelectWrapper');
        subjectWrapper.querySelector('.trigger-text').textContent = '-- اختر الفرقة أولاً --'; subjectWrapper.classList.add('disabled'); subjectWrapper.classList.remove('open');
        document.getElementById('subjectOptionsContainer').innerHTML = ''; document.getElementById('subjectSelect').innerHTML = '<option value="" disabled selected>-- اختر الفرقة أولاً --</option>';
        
        const hallWrapper = document.getElementById('hallSelectWrapper');
        hallWrapper.querySelector('.trigger-text').textContent = '-- اختر المدرج --'; hallWrapper.classList.remove('open');
        hallWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); document.getElementById('hallSelect').value = '';
        
        const btn = document.getElementById('submitBtn'); btn.disabled = true; btn.style.opacity = "0.6"; btn.style.cursor = "not-allowed"; btn.innerHTML = 'تأكيد الحضور <i class="fa-solid fa-paper-plane"></i>';
        document.getElementById('scanNameDisplay').innerText = '--'; document.getElementById('scanIDDisplay').innerText = '--';
        
        // Reset discipline display in Scan Card
        document.getElementById('scanDisciplineDisplay').innerText = "0";
        document.getElementById('scanDisciplineDisplay').className = "student-info-value discipline-score-display safe";

        const verifyBtn = document.getElementById('btnVerify');
        if(verifyBtn) { verifyBtn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> التحقق من الهوية'; verifyBtn.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)'; verifyBtn.style.display = 'flex'; verifyBtn.classList.remove('disabled'); }
        const bypassCheck = document.getElementById('bypassCheckbox'); if(bypassCheck) bypassCheck.checked = false;
        checkStoredAlerts(); 
    }

    fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => userIP = d.ip).catch(e => userIP = "Hidden IP");
    function playClick() { document.getElementById('clickSound').play().catch(e=>{}); if(navigator.vibrate) navigator.vibrate(10); }
    function playSuccess() { document.getElementById('successSound').play().catch(e=>{}); if(navigator.vibrate) navigator.vibrate([50, 50, 50]); }
    function playBeep() { document.getElementById('beepSound').play().catch(e=>{}); }
    function convertArabicToEnglish(s) { return s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }
    async function requestWakeLock() { try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} }
    function releaseWakeLock() { if (wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); } }
    
    function getAttemptsLeft() { 
        return 999; 
    }
    function decrementAttempts() { 
        return 999; 
    }
    function updateUIForAttempts() { 
        const container = document.getElementById('attemptsHeartsContainer');
        if(container) container.innerHTML = '';
    }

    window.history.pushState(null, null, window.location.href);
    window.onpopstate = function () {
        if (processIsActive && !sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { 
            checkBanStatus();
            window.history.pushState(null, null, window.location.href); 
        } else if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { 
            goBackToWelcome(); 
        }
    };
    
    function handleStrictPenalty() {}

    window.addEventListener('beforeunload', (event) => {
         handleStrictPenalty();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (isOpeningMaps) { return; }
            if (processIsActive && !sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { 
                location.reload(); 
            }
            releaseWakeLock();
        } else { 
            if (isOpeningMaps) { isOpeningMaps = false; }
            if(processIsActive) requestWakeLock(); 
        }
    });

    function checkBanStatus() { return false; }

    function updateHeaderState(screenId) {
        const wrapper = document.getElementById('heroIconWrapper');
        const icon = document.getElementById('statusIcon');
        wrapper.classList.remove('show-icon');
        if (screenId !== 'screenWelcome') {
            wrapper.classList.add('show-icon');
            if (screenId === 'screenLoading') { icon.className = "fa-solid fa-satellite-dish hero-icon fa-spin"; icon.style.color = "var(--primary)"; }
            else if (screenId === 'screenReadyToStart') { icon.className = "fa-solid fa-map-location-dot hero-icon"; icon.style.color = "#10b981"; icon.style.animation = "none"; }
            else if (screenId === 'screenDataEntry') { icon.className = "fa-solid fa-user-pen hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
            else if (screenId === 'screenScanQR') { icon.className = "fa-solid fa-qrcode hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
            else if (screenId === 'screenFaceCheck') { 
                icon.className = "fa-solid fa-id-card-clip hero-icon"; 
                icon.style.color = "var(--primary)"; icon.style.animation = "none"; 
            }
            else if (screenId === 'screenSuccess') { icon.className = "fa-solid fa-check hero-icon"; icon.style.color = "#10b981"; icon.style.animation = "none"; }
            else if (screenId === 'screenError') { icon.className = "fa-solid fa-triangle-exclamation hero-icon"; icon.style.color = "#ef4444"; icon.style.animation = "none"; }
            else if (screenId === 'screenAdminLogin') { icon.className = "fa-solid fa-lock hero-icon"; icon.style.color = "var(--primary-dark)"; icon.style.animation = "none"; }
        }
    }

    function switchScreen(id) {
        window.scrollTo({ top: 0, behavior: 'smooth' }); 
        const allSections = document.querySelectorAll('.section');
        const nextScreen = document.getElementById(id);
        allSections.forEach(el => { if (el.classList.contains('active')) el.classList.remove('active'); });
        nextScreen.classList.add('active');
        updateHeaderState(id);
        updateUIForAttempts(); 
        
        const adminBack = document.getElementById('adminFloatingBack');
        const isAdmin = !!sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        if (isAdmin && id !== 'screenWelcome' && id !== 'screenAdminLogin') { adminBack.style.display = 'flex'; } else { adminBack.style.display = 'none'; }
        if (!isAdmin && (id === 'screenDataEntry' || id === 'screenScanQR' || id === 'screenFaceCheck' || id === 'screenLoading')) { processIsActive = true; requestWakeLock(); } else { processIsActive = false; releaseWakeLock(); }
    }

    function openMapsToRefreshGPS() {
        isOpeningMaps = true; 
        const lat = CONFIG.gps.targetLat;
        const lng = CONFIG.gps.targetLong;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        window.open(mapsUrl, '_blank');
    }

    window.onload = function() {
        initGlobalGuard(); updateUIForMode(); setupCustomSelects();
        checkStoredAlerts(); 
        startGPSWatcher();
        renderHallOptions(); 
        
        document.getElementById('hallSearchInput').addEventListener('input', function(e) { renderHallOptions(e.target.value); });
        setInterval(() => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {hour12: true, hour:'2-digit', minute:'2-digit'});
            const dateStr = now.toLocaleDateString('en-GB'); 
            const timeEl = document.getElementById('currentTime'); const dateEl = document.getElementById('currentDate');
            if(timeEl) timeEl.innerText = timeStr; if(dateEl) dateEl.innerText = dateStr;
        }, 1000);
        document.getElementById('submitBtn').addEventListener('click', function(e) { e.preventDefault(); submitToGoogle(); });
    };
    
    function renderHallOptions(filter = "") {
        const hallContainer = document.getElementById('hallOptionsContainer');
        const hallSelect = document.getElementById('hallSelect');
        hallSelect.innerHTML = '<option value="" disabled selected>-- اختر المدرج --</option>';
        hallContainer.innerHTML = '';
        const filteredHalls = hallsList.filter(h => h.includes(filter));
        filteredHalls.forEach(val => {
            let opt = document.createElement('option'); opt.value = val; opt.text = val; hallSelect.appendChild(opt);
            let cOpt = document.createElement('div'); cOpt.className = "custom-option"; cOpt.setAttribute('data-value', val); cOpt.innerHTML = `<span>${val}</span>`;
            cOpt.addEventListener('click', function(e) {
                e.stopPropagation();
                hallContainer.parentElement.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                document.querySelector('#hallSelectWrapper .trigger-text').textContent = val;
                document.getElementById('hallSelectWrapper').classList.remove('open');
                hallSelect.value = val;
                playClick();
                checkAllConditions();
            });
            hallContainer.appendChild(cOpt);
        });
        if(filteredHalls.length === 0) { hallContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#94a3b8; font-size:12px;">لا توجد نتائج</div>'; }
    }

    function startGPSWatcher() {
        if (navigator.geolocation) {
            geo_watch_id = navigator.geolocation.watchPosition(
                (position) => { userLat = position.coords.latitude; userLng = position.coords.longitude; },
                (error) => { }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
            );
        }
    }

    // === دالة تحديث الواجهة ===
    function updateUIForMode() {
        const token = sessionStorage.getItem(ADMIN_AUTH_TOKEN);
        const isAdmin = !!token; 

        const badge = document.getElementById('adminBadge');
        const loginBtn = document.getElementById('btnAdminLogin');
        const logoutBtn = document.getElementById('btnAdminLogout');
        const reportBtn = document.getElementById('btnViewReport');
        const reportIcon = document.getElementById('reportIcon');
        const adminFloating = document.getElementById('adminFloatingBack');
        const notifBtn = document.getElementById('notificationBtn');
        const adminBypassContainer = document.getElementById('adminBypassContainer');
        const btnDataEntry = document.getElementById('btnDataEntry');
        
        if (isAdmin) {
            badge.style.display = 'block'; loginBtn.style.display = 'none'; logoutBtn.style.display = 'flex'; reportBtn.classList.remove('locked'); reportBtn.classList.add('unlocked'); reportIcon.className = 'fa-solid fa-list-check sub-btn-icon'; 
            document.getElementById('adminDeleteAlert').style.display = 'flex'; notifBtn.classList.remove('locked');
            if(adminBypassContainer) adminBypassContainer.style.display = 'block';
            if(btnDataEntry) btnDataEntry.style.display = 'flex';
            syncGlobalAlerts();
        } else {
            badge.style.display = 'none'; loginBtn.style.display = 'flex'; logoutBtn.style.display = 'none'; reportBtn.classList.remove('unlocked'); reportBtn.classList.add('locked'); reportIcon.className = 'fa-solid fa-lock sub-btn-icon'; adminFloating.style.display = 'none'; 
            document.getElementById('adminDeleteAlert').style.display = 'none'; notifBtn.classList.add('locked');
            if(adminBypassContainer) adminBypassContainer.style.display = 'block';
            if(btnDataEntry) btnDataEntry.style.display = 'none';
        }
        updateUIForAttempts(); checkStoredAlerts(); 
    }

    // --- Fake GPS Detection Logic ---
    function detectFakeGPS(pos) {
        if (pos.coords.accuracy < 2) return true;
        if (pos.coords.altitude === null && pos.coords.accuracy < 10) return true;
        return false;
    }

    function checkLocationStrict(onSuccess) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => { 
                    if (detectFakeGPS(pos)) {
                        showError("🚫 تم اكتشاف موقع وهمي (Fake GPS). يرجى إغلاق أي برامج تلاعب بالموقع.", false);
                        return;
                    }
                    userLat = pos.coords.latitude; 
                    userLng = pos.coords.longitude; 
                    checkDistance(onSuccess); 
                },
                (err) => { document.getElementById('locationForceModal').style.display = 'flex'; },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 } 
            );
        } else { document.getElementById('locationForceModal').style.display = 'flex'; }
    }

    function checkDistance(onSuccess) {
        let dist = getDistanceFromLatLonInKm(userLat, userLng, CONFIG.gps.targetLat, CONFIG.gps.targetLong);
        if (dist > CONFIG.gps.allowedDistanceKm) { showError("🚫 أنت خارج نطاق الكلية. يرجى التواجد في المكان الصحيح.", false); return; }
        onSuccess();
    }

    async function startProcess(skip = false) {
        playClick();
        resetApplicationState();
        if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { generateCodeAndShowDataEntry(); return; }
        switchScreen('screenLoading');
        checkLocationStrict(() => { 
            switchScreen('screenReadyToStart'); 
            playSuccess();
        });
    }

    function generateCodeAndShowDataEntry() {
        playClick();
        if (checkBanStatus()) return; 
        
        attendanceData = {};
        let code = (Math.floor(142 + Math.random() * 1280) * 7); if (code < 1000) code += 7000;
        attendanceData.code = code.toString(); document.getElementById('attendanceCode').value = code; sessionStorage.setItem(TEMP_CODE_KEY, code.toString());
        const newEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionEndTime = newEndTime; sessionStorage.setItem(SESSION_END_TIME_KEY, newEndTime.toString());
        switchScreen('screenDataEntry'); startCountdown();
    }

    function startCountdown() {
        const savedDeadline = sessionStorage.getItem(SESSION_END_TIME_KEY);
        if (savedDeadline) sessionEndTime = parseInt(savedDeadline); else { sessionEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionStorage.setItem(SESSION_END_TIME_KEY, sessionEndTime.toString()); }
        const circle = document.getElementById('timerProgress'); const text = document.getElementById('timerNumber'); const circumference = 2 * Math.PI * 35;
        if(countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const now = Date.now(); const remainingMs = sessionEndTime - now; const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
            const percent = Math.max(0, remainingMs / (DATA_ENTRY_TIMEOUT_SEC * 1000)); const offset = circumference - (percent * circumference);
            text.innerText = secondsLeft.toString(); circle.style.strokeDashoffset = offset;
            if (secondsLeft > 10) circle.style.stroke = "#10b981"; else if (secondsLeft > 5) circle.style.stroke = "#f59e0b"; else { circle.style.stroke = "#ef4444"; circle.parentElement.classList.add('timer-pulse'); }
            if (remainingMs <= 0) {
                clearInterval(countdownInterval); 
                if (sessionStorage.getItem(ADMIN_AUTH_TOKEN)) { text.innerText = "0"; return; }
                document.getElementById('nextStepBtn').disabled = true; hideConnectionLostModal(); processIsActive = false; releaseWakeLock();
                
                let left = decrementAttempts(); 
                updateUIForAttempts(); 
                
                document.getElementById('timeoutMessage').innerText = `انتهى الوقت. انتبه: في المرة القادمة سيتم حظرك.`;
                document.getElementById('timeoutModal').style.display = 'flex';
                if(navigator.vibrate) navigator.vibrate(300);
            }
        }, 100);
    }
    
    function closeTimeoutModal() {
        document.getElementById('timeoutModal').style.display = 'none';
        location.reload();
    }

    async function handleIdSubmit() {
        playClick();
        let rawId = document.getElementById('uniID').value.trim();
        const uniIdVal = convertArabicToEnglish(rawId);
        const alertBox = document.getElementById('dataEntryAlert');
        if (!uniIdVal) { alertBox.innerText = "⚠️ يرجى إدخال الكود الجامعي."; alertBox.style.display = 'block'; return; }
        if(Object.keys(studentsDB).length === 0) { alertBox.innerText = "⚠️ جاري تحميل البيانات.."; alertBox.style.display = 'block'; return; }
        const studentName = studentsDB[uniIdVal];
        if (studentName) {
            attendanceData.uniID = uniIdVal; attendanceData.name = studentName;
            sessionStorage.setItem(TEMP_ID_KEY, uniIdVal); sessionStorage.setItem(TEMP_NAME_KEY, studentName);
            
            document.getElementById('scanNameDisplay').innerText = studentName; 
            document.getElementById('scanIDDisplay').innerText = uniIdVal;
            
            // === منطق عرض درجة الانضباط في شاشة المسح ===
            const evals = getEvaluations();
            const score = evals[uniIdVal] || 0;
            const disciplineDisplay = document.getElementById('scanDisciplineDisplay');
            disciplineDisplay.innerText = score;
            
            if (score == 0) {
                disciplineDisplay.className = "student-info-value discipline-score-display safe";
            } else if (score < 9) {
                disciplineDisplay.className = "student-info-value discipline-score-display warn";
            } else {
                disciplineDisplay.className = "student-info-value discipline-score-display danger";
            }

            if(countdownInterval) clearInterval(countdownInterval); stopCameraSafely(); switchScreen('screenScanQR'); playSuccess();
        } else { alertBox.innerText = "❌ الكود غير صحيح."; alertBox.style.display = 'block'; if(navigator.vibrate) navigator.vibrate(300); }
    }

    // ==========================================
    //  التعديل 1: تجاوز التحقق (وجه + موقع)
    // ==========================================
    function toggleBypassMode() {
        const chk = document.getElementById('bypassCheckbox');
        const btnVerify = document.getElementById('btnVerify');
        if(chk.checked) {
            attendanceData.isVerified = true; 
            // وضع إحداثيات صحيحة وهمية لتجاوز فحص الموقع
            userLat = CONFIG.gps.targetLat;
            userLng = CONFIG.gps.targetLong;
            
            btnVerify.style.display = 'none'; 
            document.getElementById('bypassModal').style.display = 'flex';
            setTimeout(() => { document.getElementById('bypassModal').style.display = 'none'; }, 2000);
        } else {
            attendanceData.isVerified = false; 
            btnVerify.style.display = 'flex'; 
            btnVerify.innerHTML = '<i class="fa-solid fa-fingerprint"></i> التحقق من الهوية'; 
            btnVerify.classList.remove('disabled');
        }
        checkAllConditions();
    }

    async function startFaceVerificationProcess() {
        const year = document.getElementById('yearSelect').value; 
        const group = document.getElementById('groupSelect').value;
        const sub = document.getElementById('subjectSelect').value; 
        const hall = document.getElementById('hallSelect').value;
        if (!year || !group || !sub || !hall) {
            showToast('⚠️ اختر الفرقة والجروب والمادة والقاعة أولاً', 3000, '#f59e0b');
            return;
        }

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
        } catch (e) {
            console.error("Camera Error:", e); 
            document.getElementById('cameraErrorModal').style.display = 'flex';
            switchScreen('screenScanQR'); 
        }
    }

    function startStrictAI() {
        let step = 0; let count = TIMER_DURATION_FACE; let counting = false; let timerInterval = null;
        const timerBar = document.getElementById('timerProgressFace'); const timerNum = document.getElementById('timerNumberFace');
        const modernTimer = document.getElementById('modernTimerContainer'); const alertBadge = document.getElementById('alertBadge');
        const video = document.getElementById('video'); const camBorder = document.getElementById('camBorder'); const statusTxt = document.getElementById('statusTxt');
        timerBar.style.strokeDashoffset = TIMER_CIRCUMFERENCE_FACE; timerNum.innerText = TIMER_DURATION_FACE;
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });
        if(faceCheckInterval) clearInterval(faceCheckInterval);
        faceCheckInterval = setInterval(async () => {
            if(video.paused || video.ended) return;
            const det = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor().withFaceExpressions();
            if(det) {
                const nose = det.landmarks.getNose()[0]; const jaw = det.landmarks.getJawOutline();
                const ratio = Math.abs(nose.x - jaw[0].x) / Math.abs(nose.x - jaw[16].x); const expr = det.expressions;
                const isStableFace = expr.neutral > 0.8 || (expr.happy < 0.1 && expr.surprised < 0.1);
                const moveDist = Math.sqrt(Math.pow(nose.x - lastNoseX, 2) + Math.pow(nose.y - lastNoseY, 2));
                lastNoseX = nose.x; lastNoseY = nose.y; const isNotMoving = moveDist < 10; 
                if(step === 0) {
                    if(ratio > 0.8 && ratio < 1.2 && isStableFace && isNotMoving) {
                        camBorder.className = "cam-container status-ok"; statusTxt.innerText = "ممتاز.. خليك ثابت"; statusTxt.style.color = "var(--success)"; alertBadge.style.display = "none";
                        if(!counting) {
                            counting = true; modernTimer.style.display = "flex"; timerNum.innerText = count; timerBar.style.stroke = "#10b981";
                            timerInterval = setInterval(() => {
                                const elapsed = (TIMER_DURATION_FACE - count) + 1; const progress = elapsed / TIMER_DURATION_FACE;
                                const offset = TIMER_CIRCUMFERENCE_FACE - (progress * TIMER_CIRCUMFERENCE_FACE); timerBar.style.strokeDashoffset = offset;
                                count--; timerNum.innerText = count;
                                if(count <= 0) { 
                                    clearInterval(timerInterval); 
                                    modernTimer.style.display = "none"; 
                                    step = 1; 
                                    camBorder.className = "cam-container"; 
                                    statusTxt.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><span>انظر لليمين</span><i class="fa-solid fa-arrow-right-long arrow-anim"></i></div>';
                                    statusTxt.style.color = "var(--warning)"; 
                                    if(navigator.vibrate) navigator.vibrate(50); 
                                }
                            }, 1000);
                        }
                    } else {
                        if(counting) { clearInterval(timerInterval); counting = false; count = TIMER_DURATION_FACE; timerNum.innerText = TIMER_DURATION_FACE; modernTimer.style.display = "none"; timerBar.style.strokeDashoffset = TIMER_CIRCUMFERENCE_FACE; document.getElementById('beepSound').play(); }
                        camBorder.className = "cam-container status-error"; alertBadge.style.display = "block";
                        if(!isNotMoving) alertBadge.innerText = "⚠️ لا تتحرك!"; else if(!isStableFace) alertBadge.innerText = "😐 بدون تعابير!"; else alertBadge.innerText = "👀 انظر للأمام";
                        statusTxt.style.color = "var(--danger)";
                    }
                } else if(step === 1) {
                    if(ratio < 0.5) {
                        clearInterval(faceCheckInterval); if(videoStream) videoStream.getTracks().forEach(track => track.stop()); document.getElementById('beepSound').play(); 
                        attendanceData.vector = Array.from(det.descriptor); 
                        
                        const statusTxt = document.getElementById('statusTxt'); 
                        statusTxt.innerHTML = '<div class="progress-container"><div class="progress-fill"></div></div><div style="font-size:12px;margin-top:5px;">جاري التحليل...</div>';
                        
                        const deviceId = getUniqueDeviceId();
                        const sessionKey = generateSessionKey();
                        const payload = { 
                            action: "register_identity", 
                            id: attendanceData.uniID, 
                            name: attendanceData.name, 
                            vector: Array.from(det.descriptor), 
                            gps: `${userLat},${userLng}`, 
                            time: new Date().toLocaleTimeString('ar-EG'), 
                            hall: document.getElementById('hallSelect').value || 'N/A',
                            device_id: deviceId, 
                            deviceId: deviceId,  
                            session_key: sessionKey, 
                            publicKey: sessionKey
                        };
                        try {
                            const response = await fetch(CONFIG.identitySheetUrl, { method: 'POST', mode: 'cors', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify(payload) });
                            const result = await response.json();
                            updateNotificationUI(result);
                            
                            const successModal = document.getElementById('verificationSuccessModal');
                            successModal.style.display = 'flex';
                            
                            attendanceData.isVerified = true; 
                            const verifyBtn = document.getElementById('btnVerify'); 
                            verifyBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> تم التحقق من الهوية'; 
                            verifyBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)'; 
                            verifyBtn.classList.add('disabled');
                            
                            setTimeout(() => {
                                successModal.style.display = 'none';
                                switchScreen('screenScanQR'); 
                                playSuccess(); 
                                checkAllConditions(); 
                            }, 2500);

                        } catch(err) { console.log(err); showToast('تم التحقق محلياً (تعذر الاتصال بالسيرفر)', 3000, '#f59e0b'); attendanceData.isVerified = true; switchScreen('screenScanQR'); checkAllConditions(); }
                    } else { camBorder.className = "cam-container status-wait"; statusTxt.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><span>انظر لليمين</span><i class="fa-solid fa-arrow-right-long arrow-anim"></i></div>'; statusTxt.style.color = "var(--warning)"; alertBadge.style.display = "none"; }
                }
            } else { camBorder.className = "cam-container status-error"; statusTxt.innerText = "⚠️ لم يتم العثور على وجه"; statusTxt.style.color = "var(--danger)"; alertBadge.style.display = "block"; alertBadge.innerText = "🚫 لا يوجد وجه"; }
        }, 500);
    }

    async function submitToGoogle() {
        playClick();
        const btn = document.getElementById('submitBtn');
        if(btn.disabled && btn.innerText.includes('جاري')) return;
        
        // Re-check for Fake GPS before final submission
        if(!userLat || !userLng) {
            checkLocationStrict(() => submitToGoogle());
            return;
        }

        const originalText = "تأكيد الحضور <i class='fa-solid fa-paper-plane'></i>";
        const selectedSubject = document.getElementById('subjectSelect').value; 
        const selectedGroup = document.getElementById('groupSelect').value;
        const sessionPassVal = document.getElementById('sessionPass').value;
        const selectedHall = document.getElementById('hallSelect').value;
        
        if(!attendanceData.uniID || !sessionPassVal || !selectedSubject || !selectedGroup || !attendanceData.isVerified) { 
            showToast("يرجى إكمال جميع الخطوات.", 3000, '#f59e0b'); return; 
        }
        
        const isDuplicate = cachedReportData.some(item => 
            item.uniID === attendanceData.uniID && 
            item.subject === selectedSubject
        );

        if (isDuplicate) {
            document.getElementById('duplicateModal').style.display = 'flex';
            btn.innerHTML = originalText; btn.disabled = false;
            return;
        }

        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري تأكيد الحضور...'; 
        btn.disabled = true;
        
        const now = new Date(); 
        document.getElementById('receiptName').innerText = attendanceData.name; 
        document.getElementById('receiptID').innerText = attendanceData.uniID; 
        document.getElementById('receiptGroup').innerText = selectedGroup;
        document.getElementById('receiptSubject').innerText = selectedSubject; 
        document.getElementById('receiptHall').innerText = selectedHall || 'N/A'; 
        document.getElementById('receiptDate').innerText = now.toLocaleDateString('en-GB'); 
        document.getElementById('receiptTime').innerText = now.toLocaleTimeString('en-US', {hour12: true, hour: '2-digit', minute:'2-digit'});
        
        const finalCodeValue = `${attendanceData.code} (QR: ${sessionPassVal})`;
        const deviceId = getUniqueDeviceId();

        const formParams = new URLSearchParams();
        formParams.append("action", "register");
        formParams.append("id", attendanceData.uniID);
        formParams.append("name", attendanceData.name);
        formParams.append("group", selectedGroup);
        formParams.append("code", finalCodeValue);
        formParams.append("ip", userIP);
        formParams.append("subject", selectedSubject);
        formParams.append("hall", selectedHall || "N/A"); 
        if (attendanceData.vector) formParams.append("vector", JSON.stringify(attendanceData.vector));
        formParams.append("gps_lat", userLat);
        formParams.append("gps_lng", userLng);
        formParams.append("deviceId", deviceId);

        let targetUrl = GROUP_SHEET_URLS[selectedGroup];
        if (!targetUrl || targetUrl.includes("LINK_SHEET")) {
            showToast("عذراً، لم يتم تفعيل رابط هذا الجروب بعد.", 3000, '#ef4444');
            btn.innerHTML = originalText; btn.disabled = false;
            return;
        }

        const maxRetries = 5; 
        let attempt = 0;
        let success = false;

        while (attempt < maxRetries && !success) {
            try {
                attempt++;
                if (attempt > 1) {
                    btn.innerHTML = `<i class="fa-solid fa-rotate fa-spin"></i> محاولة ${attempt} من ${maxRetries}...`;
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                }

                let response = await fetch(targetUrl, { 
                    method: 'POST', 
                    mode: 'cors',  
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
                    body: formParams.toString() 
                });
                
                let result = await response.json();

                if (result.result === "success") {
                    success = true;
                } else if (result.result === "duplicate") {
                    success = true; 
                    showToast("مسجل مسبقاً", 3000, '#f59e0b');
                } else if (result.message === "Server Busy") {
                    throw new Error("Server Busy");
                } else {
                    throw new Error("Unknown Error");
                }

            } catch (err) {
                console.log("فشل الاتصال، المحاولة القادمة... " + err);
            }
        }

        if (success) {
            processIsActive = false; releaseWakeLock();
            let left = decrementAttempts(); 
            updateUIForAttempts();
            if (left === 0) { localStorage.setItem(BAN_KEY, "true"); }

            resetApplicationState();
            switchScreen('screenSuccess'); playSuccess(); 
            
            cachedReportData.push({
                uniID: attendanceData.uniID,
                subject: selectedSubject,
                time: now.toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute:'2-digit'}),
                group: selectedGroup,
                name: attendanceData.name,
                hall: selectedHall
            });

        } else {
            btn.innerHTML = originalText; btn.disabled = false; 
            showToast("السيرفر مشغول جداً، حاول مرة أخرى الآن.", 4000, '#ef4444');
        }
    }

    function addKey(num) { playClick(); const i = document.getElementById('uniID'); if(i.value.length<10) i.value+=num; }
    function backspaceKey() { playClick(); const i = document.getElementById('uniID'); i.value=i.value.slice(0,-1); }
    function clearKey() { playClick(); document.getElementById('uniID').value=''; }
    function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) { var R = 6371; var dLat = (lat2-lat1) * (Math.PI/180); var dLon = (lon2-lon1) * (Math.PI/180); var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); }
    
    async function goBackToWelcome() { 
        playClick(); window.scrollTo({ top: 0, behavior: 'smooth' });
        if (geo_watch_id) navigator.geolocation.clearWatch(geo_watch_id); 
        if(countdownInterval) clearInterval(countdownInterval); await stopCameraSafely(); 
        sessionStorage.removeItem(SESSION_END_TIME_KEY); sessionStorage.removeItem(TEMP_NAME_KEY); sessionStorage.removeItem(TEMP_ID_KEY); sessionStorage.removeItem(TEMP_CODE_KEY); 
        processIsActive = false; releaseWakeLock(); document.getElementById('uniID').value = ''; 
        document.getElementById('startScanCard').style.display = 'flex'; hideConnectionLostModal(); switchScreen('screenWelcome'); 
    }
    
    function closeSelect(overlay) { const wrapper = overlay.parentElement; wrapper.classList.remove('open'); }
    function setupCustomSelects() {
        const yearWrapper = document.getElementById('yearSelectWrapper');
        const groupWrapper = document.getElementById('groupSelectWrapper');
        const subjectWrapper = document.getElementById('subjectSelectWrapper');
        const hallWrapper = document.getElementById('hallSelectWrapper');
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
            op.addEventListener('click', function(e) {
                e.stopPropagation(); yearWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected'); yearWrapper.querySelector('.trigger-text').textContent = this.querySelector('span').textContent;
                yearWrapper.classList.remove('open'); document.getElementById('yearSelect').value = this.getAttribute('data-value');
                playClick(); updateGroups(); updateSubjects(); 
            });
        });
    }

    function updateGroups() {
        const y = document.getElementById("yearSelect").value;
        const gWrapper = document.getElementById('groupSelectWrapper'); 
        const gOptions = document.getElementById('groupOptionsContainer');
        const gTriggerText = gWrapper.querySelector('.trigger-text'); 
        const gReal = document.getElementById("groupSelect");
        
        gReal.innerHTML = '<option value="" disabled selected>-- اختر المجموعة --</option>'; 
        gOptions.innerHTML = ''; 
        gTriggerText.textContent = '-- اختر المجموعة --';

        if (y) {
            gReal.disabled = false; gWrapper.classList.remove('disabled');
            
            let prefix = (y === "first_year") ? "1G" : "2G";
            
            for(let i=1; i<=20; i++) {
                let groupName = prefix + i;
                
                const opt = document.createElement("option"); opt.value = groupName; opt.text = groupName; gReal.appendChild(opt);
                const cOpt = document.createElement('div'); cOpt.className = 'custom-option'; cOpt.innerHTML = `<span class="english-num">${groupName}</span>`; cOpt.setAttribute('data-value', groupName);
                
                cOpt.addEventListener('click', function(e) {
                    e.stopPropagation(); gOptions.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    this.classList.add('selected'); gTriggerText.textContent = groupName;
                    gWrapper.classList.remove('open'); gReal.value = this.getAttribute('data-value');
                    playClick(); checkAllConditions();
                }); 
                gOptions.appendChild(cOpt);
            }
        } else { 
            gReal.disabled = true; gWrapper.classList.add('disabled'); gTriggerText.textContent = '-- اختر الفرقة أولاً --'; 
        }
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
                cOpt.addEventListener('click', function(e) {
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
        const year = document.getElementById('yearSelect').value; 
        const group = document.getElementById('groupSelect').value;
        const sub = document.getElementById('subjectSelect').value; 
        const qrPass = document.getElementById('sessionPass').value; 
        const isVerified = attendanceData.isVerified === true;
        const hall = document.getElementById('hallSelect').value;
        const btn = document.getElementById('submitBtn'); 
        
        if(year && group && sub && hall && qrPass && isVerified) { 
            btn.disabled = false; btn.style.opacity = "1"; btn.style.cursor = "pointer"; 
        } else { 
            btn.disabled = true; btn.style.opacity = "0.6"; btn.style.cursor = "not-allowed"; 
        } 
    }
    
    async function stopCameraSafely() { if(html5QrCode && html5QrCode.isScanning) { try { await html5QrCode.stop(); } catch(e) {} } document.getElementById('qr-reader').style.display = 'none'; releaseWakeLock(); }
    function retryCamera() { document.getElementById('cameraErrorModal').style.display = 'none'; proceedToCamera(); } 
    async function startQrScanner() { playClick(); requestWakeLock(); await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('qr-reader').style.display = 'block'; document.getElementById('qr-reader').innerHTML = '<div class="scanner-laser" style="display:block"></div>'; document.getElementById('submitBtn').disabled = true; document.getElementById('sessionPass').value = ''; html5QrCode = new Html5Qrcode("qr-reader"); try { await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (t) => { playBeep(); html5QrCode.stop().then(() => { document.getElementById('qr-reader').style.display = 'none'; document.getElementById('scanSuccessMsg').style.display = 'flex'; document.getElementById('sessionPass').value = t; checkAllConditions(); if(navigator.vibrate) navigator.vibrate([100,50,100]); releaseWakeLock(); }); }); } catch (err) { await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('retryCamBtn').style.display = 'flex'; document.getElementById('cameraErrorModal').style.display = 'flex'; } }
    
    async function checkAdminPassword() { 
        playClick(); 
        const inputPass = document.getElementById('adminPassword').value;

        try {
            const response = await fetch(`/api/login?password=${inputPass}`);
            const data = await response.json();

            if (data.success) { 
                playSuccess(); 
                const modal = document.getElementById('adminSuccessModal'); 
                modal.style.display = 'flex';
                
                const sessionToken = data.token || "admin_verified_" + Date.now();
                sessionStorage.setItem(ADMIN_AUTH_TOKEN, sessionToken); 
                
                setTimeout(() => { 
                    modal.style.display = 'none'; 
                    updateUIForMode(); 
                    switchScreen('screenWelcome'); 
                }, 2000);
            } else { 
                document.getElementById('adminAlert').innerText = "❌ خطأ"; 
                document.getElementById('adminAlert').style.display = 'block'; 
                document.getElementById('adminPassword').value = ''; 
            } 
        } catch (e) {
            console.error(e);
            alert("حدث خطأ في الاتصال");
        }
    }

    function showError(msg, isPermanent = false) { if(countdownInterval) clearInterval(countdownInterval); document.getElementById('errorMsg').innerHTML = msg; const retryBtn = document.getElementById('retryBtn'); if(isPermanent) retryBtn.style.display = 'none'; else { retryBtn.style.display = 'inline-block'; retryBtn.onclick = function() { location.reload(); }; } switchScreen('screenError'); if(navigator.vibrate) navigator.vibrate(300); }
    
    function performLogout() { 
        playClick(); 
        sessionStorage.removeItem(ADMIN_AUTH_TOKEN); 
        location.reload(); 
    }
    
    function openLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'flex'; }
    function closeLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'none'; }
    function showConnectionLostModal() { document.getElementById('connectionLostModal').style.display = 'flex'; }
    
    function hideConnectionLostModal() { 
        document.getElementById('connectionLostModal').style.display = 'none'; 
    }
    
    async function checkRealConnection() { return true; }
    function initGlobalGuard() { setInterval(async () => { const o = await checkRealConnection(); if (!o) showConnectionLostModal(); else hideConnectionLostModal(); }, 2000); 
        if (!isMobileDevice()) { document.getElementById('desktop-blocker').style.display = 'flex'; document.body.style.overflow = 'hidden'; throw new Error("Desktop access denied."); }
    }
    
    async function openReportModal() {
        playClick();
        document.getElementById('reportModal').style.display = 'flex';
        showSubjectsView();

        const now = new Date();
        const d = ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth()+1)).slice(-2) + '/' + now.getFullYear();
        
        document.getElementById('reportDateDisplay').innerText = d;
        
        const container = document.getElementById('subjectsContainer');
        container.innerHTML = `<div style="text-align:center; padding:50px 20px;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size:30px; color:var(--primary); margin-bottom:15px;"></i>
            <div style="font-weight:bold; color:#64748b;">جاري جلب سجلات اليوم...</div>
        </div>`;

        try {
            const urls = [MASTER_REGISTRATION_LINK]; 
            
            const responses = await Promise.all(urls.map(url => fetch(`${url}?action=getReport&date=${d}`).then(res => res.json()).catch(e => [])));
            
            let allData = [].concat(...responses);

            if (!allData || allData.length === 0) {
                container.innerHTML = `<div class="empty-state" style="margin-top:50px;">
                    <i class="fa-solid fa-folder-open" style="font-size:40px; margin-bottom:15px; opacity:0.3;"></i>
                    <br>لا توجد سجلات مسجلة بتاريخ اليوم (${d}).
                </div>`;
                return;
            }

            allData.reverse(); 
            cachedReportData = allData; 
            renderSubjectsList(allData); 

        } catch (e) {
            console.error(e);
            container.innerHTML = '<div style="color:#ef4444; text-align:center; padding:30px;">حدث خطأ في الاتصال بالسيرفر.</div>';
        }
    }

    function renderSubjectsList(data) {
        const subjects = [...new Set(data.map(item => item.subject || "غير محدد"))];
        let html = '';
        subjects.forEach(subject => {
            const count = data.filter(i => i.subject === subject).length;
            html += `
                <div class="subject-big-card" onclick="openSubjectDetails('${subject}')">
                    <div class="sub-card-info">
                        <h3>${subject}</h3>
                        <span><i class="fa-solid fa-users"></i> إجمالي الحضور: ${count}</span>
                    </div>
                    <div class="sub-arrow"><i class="fa-solid fa-chevron-left"></i></div>
                </div>
            `;
        });
        document.getElementById('subjectsContainer').innerHTML = html;
    }

    // ==========================================
    //  التعديل 2: تثبيت التحديد (Persistent Highlight)
    // ==========================================
    function getHighlights() { return JSON.parse(localStorage.getItem(HIGHLIGHT_STORAGE_KEY) || "[]"); }
    function toggleHighlightStorage(id) {
        let list = getHighlights();
        if(list.includes(id)) list = list.filter(x => x !== id);
        else list.push(id);
        localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(list));
        return list.includes(id);
    }

    // ==========================================
    //  التعديل 3: نظام التقييم الحديث (Indiscipline)
    // ==========================================
    function getEvaluations() { return JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY) || "{}"); }
    
    function updateSliderUI(val) {
        const display = document.getElementById('sliderValue');
        const slider = document.getElementById('behaviorSlider');
        // 1 -> 10 (Indiscipline)
        // 1 = Minor, 10 = Severe
        
        let colorClass = "slider-green";
        let text = `مخالفة بسيطة (${val}/10)`;
        let colorHex = "#10b981";

        if(val >= 4 && val <= 6) { 
            colorClass = "slider-yellow"; 
            text = `مخالفة متوسطة (${val}/10)`; 
            colorHex = "#f59e0b";
        }
        else if(val >= 7 && val <= 8) { 
            colorClass = "slider-orange"; 
            text = `مخالفة مرتفعة (${val}/10)`; 
            colorHex = "#f97316";
        }
        else if(val >= 9) { 
            colorClass = "slider-red"; 
            text = `مخالفة جسيمة (${val}/10)`; 
            colorHex = "#ef4444";
        }

        // Update classes dynamically
        slider.className = "range-slider " + colorClass;
        
        display.innerText = text;
        display.style.color = colorHex;
    }

    function openEvaluation(studentName, studentID, currentTotal = 0) {
        playClick();
        currentEvalID = studentID;
        currentEvalName = studentName;
        document.getElementById('evalStudentName').innerText = studentName;
        
        // عرض المجموع الكلي كما طلبت
        const savedEvals = getEvaluations();
        const totalScore = savedEvals[studentID] || 0; // استخدام المخزون المحلي للأداء الأسرع
        document.getElementById('evalCurrentTotal').innerText = totalScore; 
        
        const slider = document.getElementById('behaviorSlider');
        slider.value = 1; // Default to 1 for new offense
        updateSliderUI(1);
        
        document.getElementById('evaluationModal').style.display = 'flex';
    }

    function closeEvaluation() {
        playClick();
        document.getElementById('evaluationModal').style.display = 'none';
        currentEvalID = null;
        currentEvalName = null;
    }

    async function saveEvaluation() {
        if(!currentEvalID) return;
        const val = parseInt(document.getElementById('behaviorSlider').value);
        
        // 1. حفظ محلي (تراكمي)
        let evals = getEvaluations();
        const oldVal = parseInt(evals[currentEvalID] || 0);
        evals[currentEvalID] = oldVal + val;
        localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify(evals));
        
        // 2. إرسال لجوجل شيت (تراكمي)
        const btn = document.querySelector('#evaluationModal .btn-main');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        
        try {
            const params = new URLSearchParams();
            params.append("action", "add_discipline");
            params.append("id", currentEvalID);
            params.append("name", currentEvalName);
            params.append("score", val); 
            
            await fetch(MASTER_REGISTRATION_LINK, { 
                method: 'POST', 
                mode: 'cors', 
                body: params 
            });
            
            playSuccess();
            closeEvaluation();
            showToast("تم تسجيل المخالفة بنجاح", 2000, "#ef4444");
            
            // تحديث القائمة لإعادة جلب البيانات الجديدة (بما فيها المجموع)
            const currentSub = document.getElementById('currentSubjectTitle').innerText;
            if(currentSub !== "--") openSubjectDetails(currentSub); // تحديث القائمة الحالية

        } catch(e) {
            console.error(e);
            alert("فشل في الاتصال بالسيرفر، تم الحفظ محلياً فقط.");
            closeEvaluation();
        } finally {
            btn.innerHTML = originalText;
        }
    }

    // === دالة إنشاء الشارة الفخمة (Luxury Badge) ===
    function getDisciplineBadge(score) {
        if (score <= 0) return '';
        
        let badgeClass = 'eval-badge-low';
        let icon = 'fa-circle-exclamation';
        
        if (score >= 4 && score < 9) {
            badgeClass = 'eval-badge-med';
            icon = 'fa-triangle-exclamation';
        } else if (score >= 9) {
            badgeClass = 'eval-badge-high';
            icon = 'fa-fire';
        }
        
        return `<span class="eval-badge-modern ${badgeClass}">
                    <i class="fa-solid ${icon}"></i> ${score}
                </span>`;
    }

    function openSubjectDetails(subjectName) {
        playClick();
        document.getElementById('currentSubjectTitle').innerText = subjectName;
        
        let students = cachedReportData.filter(s => s.subject === subjectName);

        students.sort((a, b) => {
            return a.group.localeCompare(b.group, undefined, {numeric: true, sensitivity: 'base'});
        });

        const highlights = getHighlights(); 
        const evaluations = getEvaluations(); 

        let html = '';
        students.forEach(item => {
            const sessionCode = item.code || "N/A";
            const hallName = item.hall || "N/A";
            const groupName = item.group || "Unknown"; 
            const studentName = item.name || "غير معروف";
            const studentID = item.uniID || "---";
            const timeStr = item.time || "--:--";
            
            // الحصول على الدرجة من المخزون المحلي لتكون محدثة دائماً
            const totalDiscipline = evaluations[studentID] || 0; 
            
            const highlightClass = highlights.includes(studentID) ? 'highlighted-red' : '';
            
            // استخدام دالة الشارة الجديدة
            const evalBadge = getDisciplineBadge(totalDiscipline);

            html += `
                <div class="student-detailed-card ${highlightClass}" id="card-${studentID}">
                    <div class="st-data-col" style="width: 100%;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <div class="st-name" onclick="openEvaluation('${studentName}', '${studentID}', ${totalDiscipline})">
                                ${studentName} ${evalBadge}
                            </div>
                            <div style="display:flex;">
                                <button class="btn-highlight-item" onclick="highlightEntry('${studentID}', '${subjectName}', this)"><i class="fa-solid fa-highlighter"></i></button>
                                <button class="btn-delete-item" onclick="deleteEntry('${studentID}', '${subjectName}', this)" style="margin-right:5px;"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                        
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div style="background:#e0f2fe; color:#0284c7; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid #bae6fd;">
                                <i class="fa-solid fa-users-rectangle"></i> ${groupName}
                            </div>
                            <div class="en-font" style="font-size:12px; color:#64748b; font-weight:600;">
                                ID: ${studentID}
                            </div>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="font-size:11px; color:#0ea5e9; font-weight:bold; background:#f0f9ff; padding:4px 8px; border-radius:6px;">
                                <i class="fa-solid fa-fingerprint"></i> <span class="en-font">${sessionCode}</span>
                            </div>
                            <div class="std-time-badge" style="margin:0;">
                                <i class="fa-regular fa-clock"></i> <span class="en-font">${timeStr}</span>
                            </div>
                        </div>
                        
                        <div style="margin-top:5px; text-align:left; font-size:11px; color:#64748b;">
                            <i class="fa-solid fa-building-columns"></i> ${hallName}
                        </div>
                    </div>
                </div>
            `;
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
        const yesBtn = document.getElementById('btnConfirmYes'); yesBtn.onclick = function() { if (pendingAction) pendingAction(); closeModernConfirm(); }; if(navigator.vibrate) navigator.vibrate(50);
    }
    function closeModernConfirm() { playClick(); document.getElementById('modernConfirmModal').style.display = 'none'; pendingAction = null; }

    async function deleteEntry(id, subject, btn) {
        showModernConfirm("حذف نهائي", "سيتم حذف الطالب من السجل ومن السيرفر نهائياً. هل أنت متأكد؟", async function() {
            const card = btn.closest('.student-detailed-card'); 
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                const params = new URLSearchParams();
                params.append("action", "deleteEntry");
                params.append("id", id);
                params.append("subject", subject);
                
                const token = sessionStorage.getItem(ADMIN_AUTH_TOKEN);
                if(token) params.append("auth_token", token);

                await fetch(MASTER_REGISTRATION_LINK, { 
                    method: 'POST', 
                    mode: 'cors', 
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
                    body: params.toString() 
                });

                card.style.opacity = '0';
                setTimeout(() => { card.remove(); }, 300);
                showToast("تم الحذف من السيرفر.", 2000, '#ef4444');

            } catch(e) { 
                alert("فشل الحذف. تأكد من الاتصال بالإنترنت."); 
                btn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            }
        });
    }

    async function highlightEntry(id, subject, btn) {
        playClick();
        const card = btn.closest('.student-detailed-card');
        
        const isNowHighlighted = toggleHighlightStorage(id);

        if (isNowHighlighted) {
            card.classList.add('highlighted-red');
        } else {
            card.classList.remove('highlighted-red');
        }

        try {
            const params = new URLSearchParams();
            params.append("action", "highlightUser");
            params.append("id", id);
            params.append("subject", subject);
            
            const token = sessionStorage.getItem(ADMIN_AUTH_TOKEN);
            if(token) params.append("auth_token", token);

            fetch(MASTER_REGISTRATION_LINK, { 
                method: 'POST', 
                mode: 'cors', 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
                body: params.toString() 
            });
        } catch(e) { console.log("Highlight Error: " + e); }
    }

    async function clearAllReport() {
        showModernConfirm("تصفيه السجل", "سيتم مسح البيانات. هل أنت متأكد؟", async function() {
             document.getElementById('subjectsContainer').innerHTML = '<div style="padding:20px; text-align:center;">جاري الحذف...</div>';
             const params = new URLSearchParams();
             params.append("action", "clearAll");
             
             const token = sessionStorage.getItem(ADMIN_AUTH_TOKEN);
             if(token) params.append("auth_token", token);

             fetch(MASTER_REGISTRATION_LINK, { method: 'POST', mode: 'cors', body: params });

             document.getElementById('subjectsContainer').innerHTML = '<div class="empty-state">تم التنظيف.</div>'; playSuccess();
        });
    }
    
    function isMobileDevice() { const ua = navigator.userAgent.toLowerCase(); const isTargetMobile = /android|iphone|ipod/i.test(ua); const isExcluded = /windows|macintosh|ipad|tablet|x11|kindle/i.test(ua); return (isTargetMobile && !isExcluded); }
    function showToast(message, duration = 3000, bgColor = '#334155') { const toast = document.getElementById('toastNotification'); toast.style.backgroundColor = bgColor; toast.innerText = message; toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, duration); }

    document.addEventListener('contextmenu', function(e) { e.preventDefault(); showToast('إجراء محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('copy', function(e) { e.preventDefault(); showToast('النسخ محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('cut', function(e) { e.preventDefault(); showToast('القص محظور لأسباب أمنية.', 2000, '#ef4444'); });
    document.addEventListener('paste', function(e) { e.preventDefault(); showToast('اللصق محظور لأسباب أمنية.', 2000, '#ef4444'); });
    
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
    // تصدير دالة التثبيت
    window.triggerAppInstall = triggerAppInstall;

})();

// ==========================================
//  Service Worker Registration
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=3', { scope: './' })
            .then(registration => { console.log('ServiceWorker registration successful with scope: ', registration.scope); })
            .catch(err => { console.error('ServiceWorker registration failed: ', err); });
    });
}
