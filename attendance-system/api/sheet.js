// api/sheet.js
export default async function handler(req, res) {
    // 1. إعدادات الأمان والوصول
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
    // التوكن السري المخزن في فيرسل (أو استخدم الثابت مؤقتاً كما اتفقنا)
    const SECRET_ADMIN_TOKEN = process.env.ADMIN_TOKEN || "secure_admin_session_token_v99";

    // السماح بالوصول من المتصفح (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. تجميع البيانات (سواء جاءت GET أو POST)
    const incomingData = { ...req.query, ...req.body };
    const { action, auth_token } = incomingData;

    // ============================================================
    // 🛡️ منطقة الحماية: نقطة التفتيش قبل التحدث مع جوجل
    // ============================================================
    
    // قائمة الإجراءات التي تتطلب "كارنيه" الأدمن
    const protectedActions = ["deleteEntry", "highlightUser", "clearAll", "getAlerts"];

    if (protectedActions.includes(action)) {
        // إذا كان التوكن القادم من الموقع غير مطابق للتوكن الموجود هنا
        if (!auth_token || auth_token !== SECRET_ADMIN_TOKEN) {
            // ⛔ توقف هنا فوراً ولا تكمل
            return res.status(401).json({
                result: "error",
                message: "⛔ Security Alert: Invalid or Missing Token. Access Denied."
            });
        }
    }
    // ============================================================

    // 3. تجهيز البيانات للإرسال إلى جوجل شيت
    const formParams = new URLSearchParams();
    for (const key in incomingData) {
        formParams.append(key, incomingData[key]);
    }

    try {
        // 4. السيرفر يمرر الطلب (الآن هو آمن)
        // نستخدم POST دائماً للتواصل مع App Script لأنه الأفضل في التعامل مع Payload
        const response = await fetch(GOOGLE_SHEET_URL, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formParams.toString()
        });
        
        const data = await response.json();
        
        // 5. إرجاع الرد للموقع
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: "حدث خطأ أثناء الاتصال بقاعدة البيانات", details: error.message });
    }
}
