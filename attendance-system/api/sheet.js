// api/sheet.js

export default async function handler(req, res) {
    // إحضار رابط جوجل السري من إعدادات Vercel
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    try {
        // ==========================================
        // 1. التعامل مع طلبات القراءة (GET) - مثل جلب التقرير
        // ==========================================
        if (req.method === 'GET') {
            // تحويل الباراميترز إلى نص لعنوان الرابط
            const queryString = new URLSearchParams(req.query).toString();
            
            const response = await fetch(`${GOOGLE_SHEET_URL}?${queryString}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            return res.status(200).json(data);
        }

        // ==========================================
        // 2. التعامل مع طلبات التسجيل (POST) - مثل تسجيل الحضور
        // ==========================================
        if (req.method === 'POST') {
            // Vercel يستلم البيانات كـ Object في req.body
            // نحن سنقوم بتحويلها إلى JSON نصي لإرسالها لجوجل بشكل نظيف
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json', // نحدد النوع JSON
                },
                body: JSON.stringify(req.body) // هذا هو التصحيح المهم
            });

            const data = await response.json();
            return res.status(200).json(data);
        }

    } catch (error) {
        console.error("Error connecting to Google Sheet:", error);
        return res.status(500).json({ 
            result: "error", 
            message: "فشل الاتصال بقاعدة البيانات",
            error: error.message 
        });
    }
}
