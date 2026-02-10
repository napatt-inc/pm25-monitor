const fs = require('fs');

// ปิดการตรวจสอบ SSL เพื่อให้เข้าเว็บรัฐบาลได้ชัวร์ๆ
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
    console.log("🤖 Robot Starting (Deep Search Mode)...");
    
    let airData = {};
    let postData = null;

    // ลิงก์ที่จะใช้ (แนะนำลิงก์นี้สำหรับ JSON ที่สมบูรณ์ที่สุด)
    const url = 'http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1';

    try {
        console.log(`🔌 Connecting to Air4Thai...`);
        const res = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: AbortSignal.timeout(15000) // ให้เวลา 15 วินาที
        });
        
        if (!res.ok) throw new Error("Server Connect Failed");
        
        const data = await res.json();
        const stations = data.stations || data;

        // 🎯 1. ค้นหาเขตหลักสี่
        let target = stations.find(s => s.stationID === "bkp97t"); 
        if (!target) target = stations.find(s => s.nameTH.includes("หลักสี่"));
        
        // ถ้าไม่เจอจริงๆ ให้ใช้บางเขน
        if (!target) {
            console.log("⚠️ Lak Si not found, switching to Bang Khen...");
            target = stations.find(s => s.stationID === "bkp53t");
        }

        if (target) {
            console.log(`✅ Found Station: ${target.nameTH}`);

            // 🕵️‍♂️ 2. เจาะหาข้อมูล (แก้ปัญหา undefined)
            // ข้อมูลมักจะอยู่ใน LastUpdate แต่บางทีก็อยู่ข้างนอก
            const info = target.LastUpdate || target;
            
            // ฟังก์ชันช่วยแกะค่า (ไม่ว่าจะเป็นตัวเลข หรือ object)
            const extract = (key) => {
                const item = info[key];
                if (!item) return "-";
                // ถ้าเป็น object ให้เอาค่า value หรือ aqi ข้างใน
                if (typeof item === 'object') {
                    return item.value || item.aqi || "-";
                }
                return item;
            };

            // ฟังก์ชันแปลงระดับสี
            const getStatusText = (lvl) => {
                const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
                return levels[Number(lvl)] || "รอข้อมูล";
            };

            // ดึงค่าต่างๆ อย่างระมัดระวัง
            const pm25Val = extract('PM25');
            const pm10Val = extract('PM10');
            const o3Val = extract('O3');
            
            // ค่า AQI บางทีซ่อนอยู่ใน object ชื่อ AQI
            let aqiVal = "-";
            let aqiLevel = "0";
            
            if (info.AQI) {
                aqiVal = info.AQI.aqi || info.AQI.value || "-";
                aqiLevel = info.AQI.Level || "0";
            }

            // จัดการวันที่ (แก้ปัญหา undefined undefined)
            const dateStr = info.date || target.date || "-";
            const timeStr = info.time || target.time || "-";

            airData = {
                source: 'Air4Thai',
                aqi: (aqiVal === "N/A") ? "-" : aqiVal,
                pm25: (pm25Val === "N/A") ? "-" : pm25Val,
                pm10: (pm10Val === "N/A") ? "-" : pm10Val,
                o3: (o3Val === "N/A") ? "-" : o3Val,
                status: getStatusText(aqiLevel),
                time: `${dateStr} ${timeStr}`,
                location: target.nameTH
            };
        } else {
            throw new Error("No station found in JSON");
        }

    } catch (e) {
        console.log(`❌ Air4Thai Error: ${e.message}`);
        // ถ้าพังจริงๆ ให้ใช้ OpenMeteo เป็นแผนสำรอง
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

    // ส่วนของประกาศ (Google Sheet) เหมือนเดิม
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

    const finalData = { updated_at: new Date().toISOString(), air: airData, post: postData };
    fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2));
    console.log("🎉 Data saved successfully!");
}

run();
