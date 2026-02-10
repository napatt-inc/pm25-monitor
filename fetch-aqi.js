const fs = require('fs');

// --- ไม้ตาย: สั่งปิดการตรวจสอบความปลอดภัย SSL (แก้ปัญหาเว็บรัฐบาลใบรับรองเก่า) ---
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
    console.log("🤖 Robot Starting (Triple-Check Mode)...");
    
    let airData = {};
    let postData = null;

    // รายชื่อประตูที่จะลองเข้า (ลองทีละลิงก์)
    const urls = [
        // ประตู 1: ลิงก์สำหรับเว็บหลัก (มักจะเสถียรสุด)
        'https://www.air4thai.com/forweb/getAQI_JSON.php?region=1',
        // ประตู 2: ลิงก์ API โดยตรง (HTTP)
        'http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1',
        // ประตู 3: ลิงก์สำรองเก่า
        'http://air4thai.pcd.go.th/services/getAQI_JSON.php?region=1'
    ];

    let foundData = null;

    // 1. เริ่มภารกิจเจาะ Air4Thai
    for (const url of urls) {
        try {
            console.log(`🔌 Trying URL: ${url}`);
            const res = await fetch(url, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://www.air4thai.com/'
                },
                signal: AbortSignal.timeout(10000) // รอแค่ 10 วินาทีพอ เดี๋ยวช้า
            });
            
            if (res.ok) {
                const data = await res.json();
                const stations = data.stations || data; // บางทีโครงสร้างไม่เหมือนกัน
                
                // หาเขตหลักสี่
                let target = stations.find(s => s.stationID === "bkp97t"); // หาด้วยรหัส
                if (!target) target = stations.find(s => s.nameTH.includes("หลักสี่")); // หาด้วยชื่อ
                
                if (target) {
                    foundData = target;
                    console.log(`✅ Success! Found: ${target.nameTH}`);
                    break; // เจอแล้วหยุดหา! ออกจากลูปทันที
                }
            }
        } catch (e) {
            console.log(`❌ Failed: ${e.message}`);
        }
    }

    // แปลงข้อมูล Air4Thai (ถ้าหาเจอ)
    if (foundData) {
        const getVal = (v) => (v && v !== "-" && v !== "N/A" && v != -1) ? v : "-";
        const getStatus = (lvl) => ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"][Number(lvl)] || "รอข้อมูล";

        // เช็คจุดที่ข้อมูลซ่อนอยู่ (บางทีอยู่ลึก บางทีอยู่ตื้น)
        const d = foundData.LastUpdate || foundData; 
        const AQI = d.AQI || {};
        const PM25 = d.PM25 || {};
        const PM10 = d.PM10 || {};
        const O3 = d.O3 || {};

        airData = {
            source: 'Air4Thai',
            aqi: getVal(AQI.aqi || AQI.value), // บางทีชื่อ aqi บางทีชื่อ value
            pm25: getVal(PM25.value),
            pm10: getVal(PM10.value),
            o3: getVal(O3.value),
            status: getStatus(AQI.Level),
            time: `${d.date} ${d.time}`,
            location: foundData.nameTH
        };
    } else {
        // ถ้าลอง 3 ประตูแล้วยังไม่เจอ -> ใช้ OpenMeteo เหมือนเดิม
        console.log("⚠️ All Air4Thai links failed. Switching to Backup...");
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

    // --- 2. ดึง Google Sheet (ส่วนนี้ทำงานได้ดีอยู่แล้ว) ---
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
    console.log("🎉 Data saved!");
}

run();
