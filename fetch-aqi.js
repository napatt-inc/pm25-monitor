const fs = require('fs');

// ปิดการตรวจสอบ SSL (เพื่อให้เข้า Air4Thai ได้)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
    console.log("🤖 Robot Starting (Hybrid Mode: Air4Thai + OpenMeteo)...");
    
    let airData = {};
    let postData = null;

    // ตัวแปรเก็บค่า (ตั้งค่าเริ่มต้นเป็น -)
    let finalAQI = "-";
    let finalPM25 = "-";
    let finalPM10 = "-";
    let finalO3 = "-";
    let finalStatus = "รอข้อมูล";
    let finalTime = "-";
    let finalLocation = "หลักสี่ (Hybrid)";

    // --- 1. ดึง AQI และ PM2.5 จาก Air4Thai ---
    try {
        console.log("🔌 Fetching Air4Thai (For AQI & PM2.5)...");
        const res = await fetch('http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000)
        });
        
        if (res.ok) {
            const data = await res.json();
            const stations = data.stations || data;
            
            // หาเขตหลักสี่ (bkp97t)
            let target = stations.find(s => s.stationID === "bkp97t");
            if (!target) target = stations.find(s => s.nameTH.includes("หลักสี่"));

            if (target) {
                console.log(`✅ Air4Thai Found: ${target.nameTH}`);
                const info = target.LastUpdate || target;
                
                // ดึงเฉพาะ AQI และ PM2.5
                // สูตรหาค่า: เช็คว่าเป็น object หรือตัวเลข
                const getVal = (obj) => (typeof obj === 'object') ? (obj.value || obj.aqi || "-") : obj;
                
                finalAQI = getVal(info.AQI || info.aqi);
                finalPM25 = getVal(info.PM25 || info.pm25);
                
                // ดึงระดับสี (Status) จาก Air4Thai
                const lvl = (typeof (info.AQI || info.aqi) === 'object') ? (info.AQI.Level || info.AQI.level) : "0";
                const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
                finalStatus = levels[Number(lvl)] || "ปานกลาง";

                // ดึงเวลา
                finalTime = `${info.date} ${info.time}`;
                finalLocation = target.nameTH;
            }
        }
    } catch (e) {
        console.log(`❌ Air4Thai Error: ${e.message}`);
    }

    // --- 2. ดึง PM10 และ O3 จาก OpenMeteo ---
    try {
        console.log("🔌 Fetching OpenMeteo (For PM10 & O3)...");
        // พิกัดเขตหลักสี่: 13.887, 100.579
        const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm10,ozone&timezone=Asia%2FBangkok');
        
        if (res.ok) {
            const data = await res.json();
            console.log("✅ OpenMeteo Connected");
            
            // เติมค่า PM10 และ O3
            finalPM10 = data.current.pm10;
            finalO3 = data.current.ozone;
            
            // ถ้า Air4Thai ล่ม ให้ใช้วันที่จาก OpenMeteo แทน
            if (finalTime === "-") {
                finalTime = data.current.time.replace('T', ' ');
            }
        }
    } catch (e) {
        console.log(`❌ OpenMeteo Error: ${e.message}`);
    }

    // รวมร่างข้อมูล
    airData = {
        source: 'Air4Thai + OpenMeteo',
        aqi: (finalAQI == "N/A" || finalAQI == null) ? "-" : finalAQI,
        pm25: (finalPM25 == "N/A" || finalPM25 == null) ? "-" : finalPM25,
        pm10: (finalPM10 == "N/A" || finalPM10 == null) ? "-" : finalPM10,
        o3: (finalO3 == "N/A" || finalO3 == null) ? "-" : finalO3,
        status: finalStatus,
        time: finalTime,
        location: finalLocation
    };

    // --- 3. ดึง Google Sheet (เหมือนเดิม) ---
    try {
        const sheetRes = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSoa90gy2q_JHhquiUHEYcJA_O-JI0ntib_9NG8heNoGv-GEtco9Bv-bWiSib3vrg7E85Dz5H7JnlWO/pub?gid=0&single=true&output=csv');
        const rows = (await sheetRes.text()).split(/\r?\n/);
        if (rows.length > 1) {
            const lastRow = rows[rows.length - 1] || rows[rows.length - 2];
            if (lastRow) {
                const cols = lastRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
                if(cols.length >= 3) postData = { timestamp: cols[0], type: cols[1], title: cols[2], fileUrl: cols[3] || '#' };
            }
        }
    } catch (e) {}

    // บันทึกไฟล์
    const output = { updated_at: new Date().toISOString(), air: airData, post: postData };
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log("🎉 Hybrid Data Saved!");
    console.log(JSON.stringify(airData, null, 2));
}

run();
