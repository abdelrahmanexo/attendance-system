export default async function handler(req, res) {
    // 1. إعدادات السماح (CORS) - ضرورية جداً
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // الرد على طلبات الفحص (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // ============================================================
    // ⚠️ هام جداً: ضع رابط جوجل شيت الجديد هنا (الذي ينتهي بـ /exec)
    // ============================================================
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby......../exec"; 

    try {
        let response;

        // 2. التعامل الذكي مع نوع الطلب
        if (req.method === 'GET') {
            // حالة جلب الأسماء: نرسل GET صريح لجوجل
            // نقوم بنقل الباراميترات (إن وجدت) إلى رابط جوجل
            const queryParams = new URLSearchParams(req.query).toString();
            const targetUrl = queryParams ? `${SCRIPT_URL}?${queryParams}` : SCRIPT_URL;
            
            response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

        } else {
            // حالة تسجيل الحضور: نرسل POST
            const bodyData = new URLSearchParams(req.body).toString();
            
            response = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: bodyData
            });
        }

        // 3. استقبال الرد وتحويله
        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error("Proxy Error:", error);
        res.status(500).json({ result: "error", message: error.message });
    }
}
