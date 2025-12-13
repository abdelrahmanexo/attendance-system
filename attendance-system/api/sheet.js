// api/sheet.js
export default async function handler(req, res) {
    // 1. استقبال البيانات القادمة من موقعك
    const params = req.query; // أو req.body حسب طريقة الإرسال
    
    // 2. إحضار رابط جوجل السري من "الخزنة"
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    // 3. تحويل البيانات لكي يفهمها جوجل
    const queryString = new URLSearchParams(params).toString();
    
    try {
        // 4. السيرفر يرسل الطلب لجوجل (وليس المتصفح)
        const response = await fetch(`${GOOGLE_SHEET_URL}?${queryString}`, {
            method: req.method,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: req.method === 'POST' ? req.body : null
        });
        
        const data = await response.json();
        
        // 5. إرجاع رد جوجل إلى موقعك
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: "حدث خطأ في الاتصال بجوجل" });
    }
}