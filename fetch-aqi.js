const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ปิด SSL Check

async function run() {
    console.log("🤖 Robot Starting (Universal Decoder Mode)...");
    
    let airData = {};
    let postData = null;

    // ใช้ลิงก์หลัก (New API)
    const url = 'http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1';

    try {
        console.log(`🔌 Connecting to Air4Thai...`);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        const stations = data.stations || data;

        // 🎯 1. หาเขตหลักสี่ (bkp97t)
        let target = stations.find(s => s.stationID === "bkp97t");
        
        if (!target) {
            console.log("⚠️ Lak Si ID not found, searching by name...");
            target = stations.find(s => s.nameTH.includes("หลักสี่"));
        }

        if (target) {
            console.log(`✅ Found Station: ${target.nameTH} (${target.stationID})`);
            
            // 🕵️‍♂️ 2. ฟังก์ชันขุดหาข้อมูล (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
            const findVal = (obj, keySearch) => {
                if (!obj) return null;
                // หา key ที่ชื่อคล้ายๆ กัน (เช่น PM25, pm25, Pm25)
                const key = Object.keys(obj).find(k => k.toLowerCase() === keySearch.toLowerCase());
                if (!key) return null;
                
                const val = obj[key];
                // ถ้าเป็น Object ให้เจาะเข้าไปเอา value หรือ aqi
                if (typeof val === 'object') {
                    return val.value || val.Value || val.aqi || val.AQI || "-";
                }
                return val;
            };

            // กำหนดเป้าหมายข้อมูล (บางทีอยู่นอก บางทีอยู่ใน LastUpdate)
            const info = target.LastUpdate || target;

            // ดึงค่าโดยใช้ตัวขุด (pm25, pm10, o3, aqi)
            let pm25 = findVal(info, 'pm25');
            let pm10 = findVal(info, 'pm10');
            let o3 = findVal(info, 'o3');
            
            // กรณี AQI พิเศษ (บางทีซ่อนใน AQI -> aqi)
            let aqi = "-";
            let level = "0";
            
            // ลองหา AQI แบบ Object
            const aqiObj = info.AQI || info.aqi;
            if (typeof aqiObj === 'object') {
                aqi = aqiObj.aqi || aqiObj.value || "-";
                level = aqiObj.Level || aqiObj.level || "0";
            } else if (aqiObj) {
                aqi = aqiObj; // กรณีเป็นตัวเลขโดดๆ
            }

            // แปลงสถานะสี
            const getStatus = (lvl) => ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"][Number(lvl)] || "รอข้อมูล";

            // จัดการวันที่ (หา date หรือ Date)
            const d = findVal(info, 'date') || findVal(target, 'date') || "-";
            const t = findVal(info, 'time') || findVal(target, 'time') || "-";

            // 🧹 คลีนข้อมูล (ถ้าเป็น N/A ให้เปลี่ยนเป็น -)
            const clean = (v) => (v && v !== "N/A" && v !== "NaN") ? v : "-";

            airData = {
                source: 'Air4Thai',
                aqi: clean(aqi),
                pm25: clean(pm25),
                pm10: clean(pm10),
                o3: clean(o3),
                status: getStatus(level),
                time: `${d} ${t}`,
                location: target.nameTH
            };
            
            console.log("📊 Data Extracted:", JSON.stringify(airData));

        } else {
            throw new Error("Station not found");
        }

    } catch (e) {
        console.error("❌ Error:", e.message);
        // Fallback ไปใช้ OpenMeteo เหมือนเดิมถ้า Air4Thai พังจริง
        try {
            const om = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm2_5,pm10,ozone,us_aqi&timezone=Asia%2FBangkok').then(r => r.json());
            const aqi = om.current.us_aqi;
            let st = "ปานกลาง";
            if(aqi<=50) st="คุณภาพดีมาก"; else if(aqi<=100) st="คุณภาพดี"; else if(aqi>150) st="เริ่มมีผลกระทบ"; else if(aqi>200) st="มีผลกระทบ";
            airData = {
                source: 'OpenMeteo (Backup)',
                aqi: aqi, pm25: om.current.pm2_5, pm10: om.current.pm10, o3: om.current.ozone,
                status: st, time: om.current.time.replace('T', ' '), location: "หลักสี่ (Backup)"
            };
        } catch (err) { airData = { error: "Unavailable" }; }
    }

    // ส่วนประกาศ (Google Sheet)
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

    fs.writeFileSync('data.json', JSON.stringify({ updated_at: new Date().toISOString(), air: airData, post: postData }, null, 2));
    console.log("🎉 Process Finished.");
}

run();
