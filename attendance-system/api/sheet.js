// api/sheet.js

export default async function handler(req, res) {
    // إعدادات CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ============================================================
    // ⚠️⚠️⚠️ ضع رابط جوجل شيت الجديد هنا بين علامتي التنصيص
    // الذي ينتهي بكلمة /exec
    // ============================================================
    const GOOGLE_SHEET_URL = "ضع_رابط_جوجل_شيت_الجديد_هنا_بالكامل"; 

    // دمج البيانات القادمة
    const incomingData = { ...req.query, ...req.body };
    const { action } = incomingData;

    /* // 🛑 تم تعطيل فحص الموقع (GPS) مؤقتاً للتجربة
    // لكي نتأكد أن المشكلة ليست في الموقع
    const COLLEGE_LAT = 30.385839819568105;
    const COLLEGE_LNG = 30.488877976075997;
    const ALLOWED_DISTANCE_KM = 0.5;

    if (action === "register") {
        if (incomingData.gps_lat && incomingData.gps_lng) {
             const userLat = parseFloat(incomingData.gps_lat);
             const userLng = parseFloat(incomingData.gps_lng);
             const distance = calculateDistance(userLat, userLng, COLLEGE_LAT, COLLEGE_LNG);
             // يمكنك إعادة تفعيل هذا الشرط لاحقاً
             // if (distance > ALLOWED_DISTANCE_KM) { ... }
        }
    }
    */

    // ============================================================
    // ✅ الإرسال المباشر إلى جوجل
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
        console.error("Connection Error:", error);
        return res.status(500).json({ 
            result: "error", 
            message: "فشل الاتصال: " + error.message 
        });
    }
}

// دالة حساب المسافة (متروكة للاستخدام المستقبلي)
function calculateDistance(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function deg2rad(deg) { return deg * (Math.PI / 180); }
