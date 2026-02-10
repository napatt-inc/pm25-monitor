const fs = require('fs');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ปิด SSL

async function run() {
    console.log("🤖 Robot Starting (Final Fix: AQILast Mode)...");
    
    let airData = {};
    let postData = null;

    // ค่าเริ่มต้น
    let finalAQI = "-";
    let finalPM25 = "-";
    let finalPM10 = "-";
    let finalO3 = "-";
    let finalStatus = "รอข้อมูล";
    let finalTime = "-";
    let finalLocation = "หลักสี่ (Hybrid)";

    // --- 1. Air4Thai (AQI & PM2.5) ---
    try {
        const res = await fetch('http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();
        const stations = data.stations || data;
        
        // หาเขตหลักสี่ (bkp97t)
        const target = stations.find(s => s.stationID === "bkp97t");

        if (target) {
            console.log(`✅ Air4Thai Found: ${target.nameTH}`);
            finalLocation = target.nameTH;

            // 🎯 แก้ไขจุดสำคัญ: ใช้ AQILast ตาม JSON ที่คุณส่งมา
            const info = target.AQILast || target.LastUpdate; // กันเหนียวเผื่อมันสลับกลับ
            
            if (info) {
                // ดึงเวลา
                if (info.date && info.time) {
                    finalTime = `${info.date} ${info.time}`;
                }

                // ดึง PM2.5 (จาก JSON: AQILast -> PM25 -> value)
                if (info.PM25 && info.PM25.value && info.PM25.value !== "-1") {
                    finalPM25 = info.PM25.value;
                }

                // ดึง AQI (จาก JSON: AQILast -> AQI -> aqi)
                // หรือบางทีอยู่ใน PM25 -> aqi ก็มี
                if (info.AQI && info.AQI.aqi && info.AQI.aqi !== "-999") {
                    finalAQI = info.AQI.aqi;
                    // ดึงระดับสีจาก AQI
                    const lvl = info.AQI.color_id || "0";
                    // color_id 1=ดีมาก, 2=ดี, 3=ปานกลาง, 4=เริ่มมีผล, 5=มีผล
                    const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
                    finalStatus = levels[Number(lvl)] || "ปานกลาง";
                } else if (info.PM25 && info.PM25.aqi) {
                     finalAQI = info.PM25.aqi;
                     const lvl = info.PM25.color_id || "3";
                     const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
                     finalStatus = levels[Number(lvl)] || "ปานกลาง";
                }
            }
        }
    } catch (e) {
        console.log(`❌ Air4Thai Error: ${e.message}`);
    }

    // --- 2. OpenMeteo (PM10 & O3) ---
    // เพราะใน JSON ของคุณค่า PM10/O3 เป็น "-1" (เสีย) เราเลยต้องดึงจากที่นี่แทน
    try {
        const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm10,ozone&timezone=Asia%2FBangkok');
        const data = await res.json();
        
        finalPM10 = data.current.pm10;
        finalO3 = data.current.ozone;
        
        // ถ้า Air4Thai ไม่มีเวลา ให้ใช้เวลาจาก OpenMeteo
        if (finalTime === "-" || finalTime.includes("undefined")) {
            finalTime = data.current.time.replace('T', ' ');
        }
    } catch (e) { console.log(`❌ OpenMeteo Error: ${e.message}`); }

    // สร้างข้อมูลสุดท้าย
    airData = {
        source: 'Air4Thai + OpenMeteo',
        aqi: String(finalAQI),
        pm25: String(finalPM25),
        pm10: String(finalPM10),
        o3: String(finalO3),
        status: finalStatus,
        time: finalTime,
        location: finalLocation
    };

    // Google Sheet (คงเดิม)
    try {
        const sheetRes = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSoa90gy2q_JHhquiUHEYcJA_O-JI0ntib_9NG8heNoGv-GEtco9Bv-bWiSib3vrg7E85Dz5H7JnlWO/pub?gid=0&single=true&output=csv');
        const rows = (await sheetRes.text()).split(/\r?\n/);
        if (rows.length > 1) {
            const lastRow = rows[rows.length - 1] || rows[rows.length - 2];
            const cols = lastRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
            if(cols.length >= 3) postData = { timestamp: cols[0], type: cols[1], title: cols[2], fileUrl: cols[3] || '#' };
        }
    } catch (e) {}

    const output = { updated_at: new Date().toISOString(), air: airData, post: postData };
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log("🎉 Data Saved:", JSON.stringify(airData));
}

run();
