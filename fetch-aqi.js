const fs = require('fs');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ปิด SSL เพื่อความชัวร์

async function run() {
    console.log("🤖 Robot Starting (Specific Extraction Mode)...");
    
    let airData = {};
    let postData = null;

    // ตัวแปรเก็บค่า (ค่าเริ่มต้น)
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

            // 🎯 จุดสำคัญ: เจาะเข้าไปใน LastUpdate เท่านั้น
            const lastUp = target.LastUpdate;
            
            if (lastUp) {
                // ดึงวันที่และเวลา
                if (lastUp.date && lastUp.time) {
                    finalTime = `${lastUp.date} ${lastUp.time}`;
                }

                // ดึง PM2.5 (ดูจาก XML คือ PM25 -> value)
                if (lastUp.PM25 && lastUp.PM25.value) {
                    finalPM25 = lastUp.PM25.value;
                } else if (lastUp.pm25 && lastUp.pm25.value) {
                     finalPM25 = lastUp.pm25.value;
                }

                // ดึง AQI (ดูจาก XML คือ AQI -> aqi)
                if (lastUp.AQI && lastUp.AQI.aqi) {
                    finalAQI = lastUp.AQI.aqi;
                    // ดึงระดับสี
                    const lvl = lastUp.AQI.Level || "0";
                    const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
                    finalStatus = levels[Number(lvl)] || "ปานกลาง";
                }
            }
        }
    } catch (e) {
        console.log(`❌ Air4Thai Error: ${e.message}`);
    }

    // --- 2. OpenMeteo (PM10 & O3) ---
    try {
        const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm10,ozone&timezone=Asia%2FBangkok');
        const data = await res.json();
        
        finalPM10 = data.current.pm10;
        finalO3 = data.current.ozone;
        
        // ถ้า Air4Thai หาเวลาไม่เจอ ให้ใช้เวลาจาก OpenMeteo
        if (finalTime === "-" || finalTime.includes("undefined")) {
            finalTime = data.current.time.replace('T', ' ');
        }
    } catch (e) { console.log(`❌ OpenMeteo Error: ${e.message}`); }

    // สร้างข้อมูลสุดท้าย
    airData = {
        source: 'Air4Thai + OpenMeteo',
        aqi: String(finalAQI),   // แปลงเป็นข้อความกันเหนียว
        pm25: String(finalPM25), // แปลงเป็นข้อความกันเหนียว
        pm10: String(finalPM10),
        o3: String(finalO3),
        status: finalStatus,
        time: finalTime,
        location: finalLocation
    };

    // Google Sheet (ส่วนประกาศ)
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
    console.log("🎉 Process Complete:", JSON.stringify(airData));
}

run();
