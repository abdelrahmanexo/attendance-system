// api/sheet.js

// 1. ثوابت الموقع (مؤمنة في السيرفر)
const COLLEGE_LAT = 30.385839819568105;
const COLLEGE_LNG = 30.488877976075997;
const ALLOWED_DISTANCE_KM = 50; // 50000 متر

export default async function handler(req, res) {
    // إعدادات CORS (السماح فقط لموقعك إذا أردت زيادة الأمان استبدل * برابط موقعك)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
    const SECRET_ADMIN_TOKEN = process.env.ADMIN_TOKEN || "secure_admin_session_token_v99";

    const incomingData = { ...req.query, ...req.body };
    const { action, auth_token } = incomingData;

    // ============================================================
    // 🛡️ الحماية 0: التحقق من المصدر (Basic Anti-Bot)
    // ============================================================
    // هذا يمنع السكربتات البسيطة خارج المتصفح
    // لكن تذكر: يمكن تزويره، ولكنه يضيف طبقة إزعاج للمهاجم
    /*
    const referer = req.headers.referer || "";
    if (!referer.includes("vercel.app") && !referer.includes("localhost")) {
         return res.status(403).json({ result: "error", message: "⛔ Access Denied: Unknown Source." });
    }
    */

    // ============================================================
    // 🛡️ الحماية 1: بوابة المسؤول
    // ============================================================
    const protectedActions = ["deleteEntry", "highlightUser", "clearAll", "getAlerts"];
    if (protectedActions.includes(action)) {
        if (!auth_token || auth_token !== SECRET_ADMIN_TOKEN) {
            return res.status(401).json({ result: "error", message: "⛔ Security Alert: Invalid Admin Token." });
        }
    }

    // ============================================================
    // 🛡️ الحماية 2: التحقق من الموقع (GPS Logic)
    // ============================================================
    if (action === "register") {
        if (!incomingData.gps_lat || !incomingData.gps_lng) {
             return res.status(400).json({ result: "error", message: "⛔ بيانات الموقع ناقصة." });
        }

        const userLat = parseFloat(incomingData.gps_lat);
        const userLng = parseFloat(incomingData.gps_lng);

        // التحقق من أن القيم هي أرقام فعلية لمنع الحقن (Injection)
        if (isNaN(userLat) || isNaN(userLng)) {
            return res.status(400).json({ result: "error", message: "⛔ تنسيق الموقع غير صحيح." });
        }

        const distance = calculateDistance(userLat, userLng, COLLEGE_LAT, COLLEGE_LNG);
        
        // تسجيل المحاولة في الـ Console الخاصة بـ Vercel للمراجعة لاحقاً
        console.log(`Registration Attempt: ID=${incomingData.id}, Dist=${distance}km`);

        if (distance > ALLOWED_DISTANCE_KM) {
            return res.status(403).json({ 
                result: "error", 
                message: `⛔ موقعك بعيد جداً (${Math.round(distance * 1000)} متر). يجب أن تكون داخل الكلية.` 
            });
        }
    }

    // ============================================================
    // ✅ الإرسال إلى جوجل
    // ============================================================
    const formParams = new URLSearchParams();
    for (const key in incomingData) {
        formParams.append(key, incomingData[key]);
    }

    try {
        const response = await fetch(GOOGLE_SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formParams.toString()
        });
        
        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Google Sheet Error:", error);
        return res.status(500).json({ error: "خطأ في الاتصال بالخادم الداخلي" });
    }
}

// دالة Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}


