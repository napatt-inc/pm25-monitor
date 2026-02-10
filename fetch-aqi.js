const fs = require('fs');

async function run() {
    console.log("🤖 Robot Starting...");
    
    let airData = {};
    let postData = null;

    // --- 1. ดึงข้อมูล Air4Thai (ใช้ลิงก์ใหม่ HTTPS) ---
    try {
        console.log("Fetching Air4Thai...");
        // เปลี่ยนมาใช้ HTTPS และ www.air4thai.com ซึ่งเสถียรกว่า
        const res = await fetch('https://www.air4thai.com/forweb/getAQI_JSON.php?region=1', {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.air4thai.com/'
            }
        });
        
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        
        const data = await res.json();
        const stations = data.stations || data;

        // 🎯 ค้นหา: เขตหลักสี่ (bkp97t) เป็นอันดับแรก
        let target = stations.find(s => s.stationID === "bkp97t");
        
        // ถ้าไม่เจอ ให้ลองหาคำว่า "หลักสี่" ในชื่อไทย
        if (!target) {
            target = stations.find(s => s.nameTH.includes("หลักสี่"));
        }

        // ถ้ายังไม่เจออีก ให้ไปบางเขน (bkp53t)
        if (!target) {
            console.log("⚠️ Lak Si not found, switching to Bang Khen...");
            target = stations.find(s => s.stationID === "bkp53t");
        }

        if (!target) throw new Error("No station found");

        console.log(`✅ Found Station: ${target.nameTH} (${target.stationID})`);

        const getVal = (v) => (v && v !== "-" && v !== "N/A") ? v : "-";
        
        const getStatus = (lvl) => {
            const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
            return levels[Number(lvl)] || "รอข้อมูล";
        };

        // ตรวจสอบโครงสร้างข้อมูล (บางที Air4Thai ส่งมาไม่เหมือนกัน)
        const AQI = target.AQI || target.LastUpdate.AQI;
        const PM25 = target.PM25 || target.LastUpdate.PM25;
        const PM10 = target.PM10 || target.LastUpdate.PM10;
        const O3 = target.O3 || target.LastUpdate.O3;
        const date = target.date || target.LastUpdate.date;
        const time = target.time || target.LastUpdate.time;

        airData = {
            source: 'Air4Thai',
            aqi: getVal(AQI.aqi),
            pm25: getVal(PM25.value),
            pm10: getVal(PM10.value),
            o3: getVal(O3.value),
            status: getStatus(AQI.Level),
            time: `${date} ${time}`,
            location: target.nameTH
        };

    } catch (e) {
        console.error("❌ Air4Thai Failed:", e.message);
        // Fallback: OpenMeteo
        try {
            const om = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm2_5,pm10,ozone,us_aqi&timezone=Asia%2FBangkok').then(r => r.json());
            const aqi = om.current.us_aqi;
            let st = "ปานกลาง";
            if(aqi<=50) st="คุณภาพดีมาก"; else if(aqi<=100) st="คุณภาพดี"; else if(aqi>150) st="เริ่มมีผลกระทบ"; else if(aqi>200) st="มีผลกระทบ";
            
            airData = {
                source: 'OpenMeteo (Backup)',
                aqi: aqi,
                pm25: om.current.pm2_5,
                pm10: om.current.pm10,
                o3: om.current.ozone,
                status: st,
                time: om.current.time.replace('T', ' '),
                location: "หลักสี่ (Backup)"
            };
        } catch (err) { airData = { error: "Unavailable" }; }
    }

    // --- 2. ดึง Google Sheet (คงเดิม) ---
    try {
        const sheetRes = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSoa90gy2q_JHhquiUHEYcJA_O-JI0ntib_9NG8heNoGv-GEtco9Bv-bWiSib3vrg7E85Dz5H7JnlWO/pub?gid=0&single=true&output=csv');
        const text = await sheetRes.text();
        const rows = text.split(/\r?\n/);
        if (rows.length > 1) {
            let lastRow = rows[rows.length - 1] || rows[rows.length - 2];
            if (lastRow) {
                const cols = lastRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
                if(cols.length >= 3) {
                    postData = {
                        timestamp: cols[0],
                        type: cols[1],
                        title: cols[2] || 'ประกาศ',
                        fileUrl: cols[3] || '#'
                    };
                }
            }
        }
    } catch (e) { console.error("Sheet Failed"); }

    const finalData = {
        updated_at: new Date().toISOString(),
        air: airData,
        post: postData
    };

    fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2));
    console.log("🎉 Updated Data Saved!");
}

run();
